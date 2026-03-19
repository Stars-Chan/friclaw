# 11 定时任务系统

## 目标

实现持久化的定时任务调度，支持 Cron 表达式和一次性任务，任务触发时以指定用户身份向 AI 发起对话。

## 核心设计

定时任务本质上是"在指定时间，以某个用户的身份发送一条消息给 AI"。

```
Cron 调度器
  → 触发任务
  → 构造 InboundMessage（模拟用户消息）
  → 发送给 Dispatcher
  → Claude Code Agent 处理
  → 通过对应网关回复用户
```

## 子任务

### 11.1 任务数据结构

```typescript
// src/cron/types.ts
interface CronJob {
  id: string
  name: string
  // Cron 表达式或 ISO 时间字符串（一次性任务）
  schedule: string
  // 触发时发送给 AI 的消息
  message: string
  // 回复发送到哪个会话
  chatId: string
  platform: 'feishu' | 'wecom' | 'dashboard'
  userId: string
  enabled: boolean
  createdAt: number
  lastRunAt?: number
  nextRunAt?: number
}
```

### 11.2 持久化存储

任务存储在 SQLite 中，服务重启后自动恢复：

```typescript
// src/cron/scheduler.ts
function initCronTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS cron_jobs (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      schedule TEXT NOT NULL,
      message TEXT NOT NULL,
      chat_id TEXT NOT NULL,
      platform TEXT NOT NULL,
      user_id TEXT NOT NULL,
      enabled INTEGER DEFAULT 1,
      created_at INTEGER NOT NULL,
      last_run_at INTEGER,
      next_run_at INTEGER
    )
  `)
}
```

### 11.3 CronScheduler 实现

```typescript
export class CronScheduler {
  private jobs = new Map<string, { job: CronJob; timer: Timer }>()
  private db: Database.Database
  private dispatcher: Dispatcher

  async start(): Promise<void> {
    // 从数据库加载所有启用的任务
    const jobs = this.db.prepare(
      'SELECT * FROM cron_jobs WHERE enabled = 1'
    ).all() as CronJob[]

    for (const job of jobs) {
      this.schedule(job)
    }
    logger.info(`已加载 ${jobs.length} 个定时任务`)
  }

  private schedule(job: CronJob): void {
    const next = getNextRunTime(job.schedule)
    const delay = next - Date.now()

    const timer = setTimeout(async () => {
      await this.runJob(job)
      // 如果是 Cron 表达式（循环任务），重新调度
      if (isCronExpression(job.schedule)) {
        this.schedule(job)
      } else {
        // 一次性任务，执行后禁用
        this.disable(job.id)
      }
    }, delay)

    this.jobs.set(job.id, { job, timer })

    // 更新 next_run_at
    this.db.prepare(
      'UPDATE cron_jobs SET next_run_at = ? WHERE id = ?'
    ).run(next, job.id)
  }

  private async runJob(job: CronJob): Promise<void> {
    logger.info(`执行定时任务: ${job.name}`)

    // 构造模拟消息
    const msg: InboundMessage = {
      id: `cron_${job.id}_${Date.now()}`,
      text: job.message,
      chatId: job.chatId,
      authorId: job.userId,
      gatewayKind: job.platform,
      chatType: 'private',
      meta: { isCronJob: true, jobId: job.id },
    }

    // 通过 Dispatcher 处理
    await this.dispatcher.handle(msg)

    // 更新 last_run_at
    this.db.prepare(
      'UPDATE cron_jobs SET last_run_at = ? WHERE id = ?'
    ).run(Date.now(), job.id)
  }
}
```

### 11.4 任务管理 API

```typescript
// 创建任务
create(params: Omit<CronJob, 'id' | 'createdAt'>): CronJob {
  const job: CronJob = {
    ...params,
    id: nanoid(),
    createdAt: Date.now(),
  }
  this.db.prepare(`
    INSERT INTO cron_jobs VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(/* ... */)
  this.schedule(job)
  return job
}

// 删除任务
delete(id: string): void {
  const entry = this.jobs.get(id)
  if (entry) {
    clearTimeout(entry.timer)
    this.jobs.delete(id)
  }
  this.db.prepare('DELETE FROM cron_jobs WHERE id = ?').run(id)
}

// 列出所有任务
list(): CronJob[] {
  return this.db.prepare('SELECT * FROM cron_jobs ORDER BY created_at DESC').all() as CronJob[]
}
```

### 11.5 Cron 表达式解析

使用 `croner` 库解析标准 5 字段 Cron 表达式：

```bash
bun add croner
```

```typescript
import { Cron } from 'croner'

function getNextRunTime(schedule: string): number {
  if (isCronExpression(schedule)) {
    return new Cron(schedule).nextRun()!.getTime()
  }
  // ISO 时间字符串（一次性任务）
  return new Date(schedule).getTime()
}

function isCronExpression(schedule: string): boolean {
  return /^[\d\s\*\/\-\,]+$/.test(schedule.trim())
}
```

### 11.6 MCP 工具暴露

通过 MCP 让 Claude Code 可以管理定时任务：

```typescript
// 工具：创建定时任务
{
  name: 'cron_create',
  description: '创建定时任务',
  inputSchema: {
    type: 'object',
    properties: {
      name: { type: 'string' },
      schedule: { type: 'string', description: 'Cron 表达式或 ISO 时间' },
      message: { type: 'string', description: '触发时发送的消息' },
    },
    required: ['name', 'schedule', 'message']
  }
}

// 工具：列出定时任务
{ name: 'cron_list', description: '列出所有定时任务' }

// 工具：删除定时任务
{ name: 'cron_delete', description: '删除定时任务', inputSchema: { ... } }
```

### 11.7 Dashboard 展示

定时任务列表页展示：
- 任务名称、Cron 表达式
- 上次执行时间、下次执行时间
- 启用/禁用开关
- 手动触发按钮

## 验收标准

- Cron 任务按时触发，误差 < 5 秒
- 服务重启后任务自动恢复
- 一次性任务执行后自动禁用
- MCP 工具可正常创建/删除任务
- Dashboard 正确展示任务列表
