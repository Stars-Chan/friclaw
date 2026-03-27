---
name: refactor-20260327-refactorCronScheduling-Stars-Chan
status: draft
strategy: follow
depends_on: []
---

# 规格说明：重构 Cron 定时任务系统

> 创建时间：2026-03-27

## 概述

重构 cron 定时任务系统，使用高效的 cron 计算、SQLite 持久化、基于事件的架构和时区支持。

## 用户故事

### US-1: 高效的 Cron 调度

**作为**系统管理员，**我希望**调度周期性任务时不产生轮询开销，**以便**系统使用最少的 CPU 资源

#### 验收标准

- [ ] AC-1.1: Cron 任务计算下次执行时间，而非每 60 秒轮询一次
- [ ] AC-1.2: 支持标准 cron 表达式，包括步长值（`*/5`）、范围（`1-5`）和列表（`1,3,5`）
- [ ] AC-1.3: 一次性任务在精确的 ISO 时间执行，无需轮询

### US-2: 持久化任务存储

**作为**开发者，**我希望**将 cron 任务存储在 SQLite 中，**以便**持久化方式与应用其他部分保持一致

#### 验收标准

- [ ] AC-2.1: 任务持久化到 SQLite `cron_jobs` 表
- [ ] AC-2.2: 执行历史存储在 `cron_executions` 表

### US-3: 时区支持

**作为**用户，**我希望**在本地时区调度任务，**以便**无论服务器位置如何，任务都在正确的时间运行

#### 验收标准

- [ ] AC-3.1: 任务支持可选的 `timezone` 字段（例如 "America/New_York"）
- [ ] AC-3.2: 如果未指定，默认时区为 UTC
- [ ] AC-3.3: 底层库正确处理夏令时转换

### US-4: 执行历史

**作为**开发者，**我希望**查看任务执行历史，**以便**调试问题和审计任务执行

#### 验收标准

- [ ] AC-4.1: 每次执行记录时间戳、状态和错误消息
- [ ] AC-4.2: MCP 工具 `cron_history` 返回任务的最近执行记录
- [ ] AC-4.3: 失败的执行包含错误详情

## 功能需求

### FR-1: Cron 库集成

- **描述**：使用 `croner` 库替换自定义 cron 解析器
- **优先级**：P0
- **依赖**：无

### FR-2: SQLite 数据库模式

- **描述**：定义任务和执行记录的数据库模式
- **优先级**：P0
- **依赖**：无

### FR-3: 基于事件的执行

- **描述**：任务触发时发出事件，而非直接调用 dispatcher
- **优先级**：P1
- **依赖**：FR-1

### FR-4: MCP API 更新

- **描述**：实现 MCP 工具以支持任务管理（创建、列表、删除、更新、历史查询）
- **优先级**：P0
- **依赖**：FR-1, FR-2

## 非功能需求

- **性能**：每个任务的调度开销 < 10ms
- **安全**：验证 cron 表达式以防止注入攻击
- **兼容性**：尽可能保持现有 MCP 客户端的向后兼容性

## 数据模型

### 表：`cron_jobs`

```sql
CREATE TABLE cron_jobs (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  schedule TEXT NOT NULL,
  action_type TEXT NOT NULL, -- 'message' | 'command' | 'webhook'
  action_data TEXT NOT NULL, -- JSON: 消息内容 / 命令 / webhook URL
  chat_id TEXT NOT NULL,
  platform TEXT NOT NULL,
  user_id TEXT NOT NULL,
  timezone TEXT DEFAULT 'UTC',
  enabled INTEGER DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

### 表：`cron_executions`

```sql
CREATE TABLE cron_executions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id TEXT NOT NULL,
  executed_at TEXT NOT NULL,
  status TEXT NOT NULL, -- 'success' | 'failed'
  result TEXT, -- 执行结果（成功时）
  error TEXT, -- 错误信息（失败时）
  FOREIGN KEY (job_id) REFERENCES cron_jobs(id) ON DELETE CASCADE
);

CREATE INDEX idx_executions_job_id ON cron_executions(job_id);
CREATE INDEX idx_executions_executed_at ON cron_executions(executed_at);
```

## API 设计

### CronScheduler 类

```typescript
interface CronJob {
  id: string
  name: string
  schedule: string
  actionType: 'message' | 'command' | 'webhook'
  actionData: string // JSON 字符串
  chatId: string
  platform: 'feishu' | 'wecom' | 'weixin' | 'dashboard'
  userId: string
  timezone: string
  enabled: boolean
  createdAt: string
  updatedAt: string
}

interface CronExecution {
  id: number
  jobId: string
  executedAt: string
  status: 'success' | 'failed'
  result?: string // 执行结果
  error?: string // 错误信息
}

class CronScheduler extends EventEmitter {
  constructor(storage: CronStorage)

  start(): Promise<void>
  stop(): Promise<void>

  create(input: CreateJobInput): Promise<CronJob>
  list(): Promise<CronJob[]>
  get(id: string): Promise<CronJob | undefined>
  update(id: string, patch: Partial<CronJob>): Promise<CronJob | undefined>
  delete(id: string): Promise<void>

  history(jobId: string, limit?: number): Promise<CronExecution[]>

  // 事件
  on(event: 'job:trigger', listener: (job: CronJob) => void): this
  on(event: 'job:success', listener: (job: CronJob) => void): this
  on(event: 'job:error', listener: (job: CronJob, error: Error) => void): this
}
```

### MCP 工具

**工具**：`cron_create`
```json
{
  "name": "cron_create",
  "description": "创建定时任务",
  "inputSchema": {
    "type": "object",
    "properties": {
      "name": { "type": "string", "description": "任务名称" },
      "schedule": { "type": "string", "description": "Cron 表达式或 ISO 时间" },
      "action_type": {
        "type": "string",
        "enum": ["message", "command", "webhook"],
        "description": "动作类型：message=发送消息, command=执行命令, webhook=调用 webhook"
      },
      "action_data": {
        "type": "string",
        "description": "动作数据（JSON 字符串）：message 类型为消息内容，command 类型为命令文本，webhook 类型为 URL"
      },
      "timezone": {
        "type": "string",
        "description": "IANA 时区（例如 'America/New_York'，默认 'UTC'）"
      }
    },
    "required": ["name", "schedule", "action_type", "action_data"]
  }
}
```

**工具**：`cron_list`
```json
{
  "name": "cron_list",
  "description": "列出所有定时任务",
  "inputSchema": {
    "type": "object",
    "properties": {}
  }
}
```

**工具**：`cron_get`
```json
{
  "name": "cron_get",
  "description": "获取单个定时任务详情",
  "inputSchema": {
    "type": "object",
    "properties": {
      "id": { "type": "string", "description": "任务 ID" }
    },
    "required": ["id"]
  }
}
```

**工具**：`cron_update`
```json
{
  "name": "cron_update",
  "description": "更新定时任务（启用/禁用）",
  "inputSchema": {
    "type": "object",
    "properties": {
      "id": { "type": "string", "description": "任务 ID" },
      "enabled": { "type": "boolean", "description": "是否启用" }
    },
    "required": ["id"]
  }
}
```

**工具**：`cron_delete`
```json
{
  "name": "cron_delete",
  "description": "删除定时任务",
  "inputSchema": {
    "type": "object",
    "properties": {
      "id": { "type": "string", "description": "任务 ID" }
    },
    "required": ["id"]
  }
}
```

**工具**：`cron_history`
```json
{
  "name": "cron_history",
  "description": "查看 cron 任务的执行历史",
  "inputSchema": {
    "type": "object",
    "properties": {
      "id": { "type": "string", "description": "任务 ID" },
      "limit": { "type": "number", "description": "最大记录数（默认 10）" }
    },
    "required": ["id"]
  }
}
```

## 动作类型详细说明

### message 类型
- **用途**：定时发送消息给用户
- **action_data 格式**：纯文本消息内容
- **执行行为**：调用 Dispatcher 发送消息到指定平台和聊天
- **结果汇报**：发送成功后无需额外汇报

### command 类型
- **用途**：定时执行 shell 命令
- **action_data 格式**：JSON 字符串，包含 `command` 字段
  ```json
  { "command": "bun run backup.ts" }
  ```
- **执行行为**：
  - 使用 `Bun.$` 执行命令
  - 捕获 stdout 和 stderr
  - 设置超时（默认 30 秒）
- **结果汇报**：
  - 成功：发送消息包含命令输出（截断到 1000 字符）
  - 失败：发送消息包含错误信息和退出码

### webhook 类型
- **用途**：定时调用 HTTP webhook
- **action_data 格式**：JSON 字符串，包含 `url`、`method`、`headers`、`body`
  ```json
  {
    "url": "https://api.example.com/notify",
    "method": "POST",
    "headers": { "Authorization": "Bearer token" },
    "body": { "event": "scheduled_check" }
  }
  ```
- **执行行为**：
  - 使用 `fetch` 发送 HTTP 请求
  - 设置超时（默认 10 秒）
  - 支持 GET、POST、PUT、DELETE 方法
- **结果汇报**：
  - 成功：发送消息包含状态码和响应体（截断到 500 字符）
  - 失败：发送消息包含错误信息

## 边界情况

1. **系统停机期间任务触发**：停机期间错过的任务不会追溯执行
2. **夏令时转换**：`croner` 正确处理 DST；任务在转换期间可能跳过或重复
3. **无效的 cron 表达式**：创建时验证，向用户返回错误
4. **并发执行**：使用执行中追踪防止重复执行
5. **任务执行时被删除**：执行完成，但任务不会重新调度
6. **数据库锁定**：SQLite 锁定错误时使用指数退避重试
7. **时区未找到**：拒绝任务创建并返回清晰的错误消息
8. **高频任务**（`* * * * *`）：如果间隔 < 1 分钟则警告，防止刷屏

---

**状态**：🟡 草稿
