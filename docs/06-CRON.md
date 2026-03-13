# FriClaw 定时任务模块设计

> 基于 NeoClaw Cron 架构，为 FriClaw 设计的详细定时任务模块文档
>
> **版本**: 1.0.0
> **参考**: NeoClaw Cron Implementation
> **日期**: 2026-03-13

---

## 📋 目录

- [1. 模块概述](#1-模块概述)
- [2. Cron 表达式解析](#2-cron-表达式解析)
- [3. 任务存储](#3-任务存储)
- [4. 调度器实现](#4-调度器实现)
- [5. 任务执行](#5-任务执行)
- [6. 管理接口](#6-管理接口)

---

## 1. 模块概述

### 1.1 设计目标

定时任务模块为 FriClaw 提供定时任务能力：

- **一次性任务**: 指定具体时间执行一次
- **循环任务**: 使用 Cron 表达式定义周期
- **任务持久化**: 使用 JSON 文件存储任务
- **自动触发**: 定期轮询并触发到期任务
- **与 Agent 集成**: 通过 Dispatcher 执行任务

### 1.2 架构图

```
┌─────────────────────────────────────────────────────────────────────────┐
│                 FriClaw 定时任务架构                            │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                   │
│  ┌───────────────────────────────────────────────────────┐          │
│  │              CronScheduler               │          │
│  │  (每 30 秒轮询一次)              │          │
│  └────────────────────┬────────────────────────────────┘          │
│                       │                                     │
│         ┌─────────────┼─────────────┐                   │
│         ▼             ▼             ▼                   │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐           │
│  │Cron Matcher│  │Job Store   │  │Dispatcher  │           │
│  │(表达式匹配) │  │(JSON 存储) │  │(任务路由)   │           │
│  └─────┬─────┘  └─────┬─────┘  └─────┬─────┘           │
│        │                 │                 │                   │
│        ▼                 ▼                 ▼                   │
│  ┌─────────────────────────────────────┐                          │
│  │      Job Execution               │                          │
│  │  - 读取任务列表               │                          │
│  │  - 检查是否到期               │                          │
│  │  - 防止重复执行               │                          │
│  │  - 调用 Agent                │                          │
│  │  - 更新任务状态               │                          │
│  └─────────────────────────────────────┘                          │
│                                                           │
│  ┌─────────────────────────────────────────────┐                   │
│  │      Persistence                  │                   │
│  │  ~/.friclaw/cron/jobs.json       │                   │
│  └─────────────────────────────────────────────┘                   │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 2. Cron 表达式解析

### 2.1 Cron 表达式格式

```
* * * * *
│ │ │ │ │
│ │ │ │ └─── 星期几 (0-6, 0=周日)
│ │ │ └───── 月份 (1-12)
│ └────────── 日期 (1-31)
└──────────── 小时 (0-23)
```

### 2.2 字段值

| 字段 | 说明 | 允许值 |
|------|------|--------|
| 分钟 | 0-59 | `*`, `N`, `N-M`, `N/step`, `*/step`, `N,M,...` |
| 小时 | 0-23 | `*`, `N`, `N-M`, `N/step`, `*/step`, `N,M,...` |
| 日期 | 1-31 | `*`, `N`, `N-M`, `N/step`, `*/step`, `N,M,...` |
| 月份 | 1-12 | `*`, `N`, `N-M`, `N/step`, `*/step`, `N,M,...` |
| 星期 | 0-6 | `*`, `N`, `N-M`, `N/step`, `*/step`, `N,M,...` |

### 2.3 特殊值说明

| 符号 | 含义 | 示例 |
|------|------|------|
| `*` | 任意值 | `*` = 每分钟 |
| `N-M` | 范围（包含边界） | `1-5` = 1,2,3,4,5 |
| `N/step` | 步长 | `*/15` = 每 15 分钟 |
| `*/step` | 从 0 开始，步长 | `*/10` = 0,10,20,30,40,50 |
| `N,M,...` | 列表 | `1,3,5` = 1,3,5 |

### 2.4 Cron 表达式匹配实现

```typescript
/**
 * matchesCron — 检查时间是否匹配 Cron 表达式
 *
 * 返回 true 如果 `now` 匹配 5 字段 Cron 表达式且
 * 任务在最近 50 秒内未运行（防止 30s 轮询在同一分钟触发两次）
 */
function matchesCron(
  expr: string,
  now: Date,
  lastRunAt: Date | null
): boolean {
  // 防止在同一 cron 周期内双重触发
  if (lastRunAt && now.getTime() - lastRunAt.getTime() < 50_000) {
    return false;
  }

  const fields = expr.trim().split(/\s+/);
  if (fields.length < 5) return false;

  const [minF, hourF, domF, monF, dowF] = fields as [
    string,
    string,
    string,
    string,
    string,
  ];

  const matchField = (
    field: string,
    value: number,
    min: number,
    max: number
  ): boolean => {
    if (field === '*') return true;

    if (field.includes('/')) {
      const [rangeStr, stepStr] = field.split('/') as [string, string];
      const step = parseInt(stepStr, 10);

      if (isNaN(step) || step <= 0) return false;

      const start = rangeStr === '*' ? min : parseInt(rangeStr, 10);

      return (
        value >= start &&
        value <= max &&
        (value - start) % step === 0
      );
    }

    if (field.includes(',')) {
      return field
        .split(',')
        .some((part) => parseInt(part.trim(), 10) === value);
    }

    if (field.includes('-')) {
      const [loStr, hiStr] = field.split('-') as [string, string];

      return (
        value >= parseInt(loStr, 10) &&
        value <= parseInt(hiStr, 10)
      );
    }

    return parseInt(field, 10) === value;
  };

  return (
    matchField(minF, now.getMinutes(), 0, 59) &&
    matchField(hourF, now.getHours(), 0, 23) &&
    matchField(domF, now.getDate(), 1, 31) &&
    matchField(monF, now.getMonth() + 1, 1, 12) &&
    matchField(dowF, now.getDay(), 0, 6)
  );
}
```

### 2.5 常用 Cron 表达式

| 表达式 | 说明 | 例子 |
|--------|------|------|
| `0 9 * * 1-5` | 工作日每天早上 9 点 | 9:00 AM |
| `0 0 * * *` | 每天午夜 | 12:00 AM |
| `*/15 * * * *` | 每 15 分钟 | 每 15 分钟 |
| `0 */2 * * *` | 每 2 小时 | 每 2 小时 |
| `0 9 * * 1` | 每周一 9 点 | 9:00 AM (周一) |
| `30 9 * * 1,2,3,4,5` | 工作日 9:30 | 9:30 AM (周一至周五) |

---

## 3. 任务存储

### 3.1 任务类型

```typescript
/**
 * CronJob — 定时任务
 */
export interface CronJob {
  /** 唯一 ID */
  id: string;

  /** 任务标签（可选） */
  label?: string;

  /** 是否启用 */
  enabled: boolean;

  /** 一次性任务运行时间 (ISO 8601) */
  runAt?: string;

  /** 循环任务 Cron 表达式 */
  cronExpr?: string;

  /** 任务消息（发送给 AI 的提示词） */
  message: string;

  /** 关联的会话 ID */
  chatId: string;

  /** 网关类型 */
  gatewayKind: string;

  /** 上次运行时间 (ISO 8601) */
  lastRunAt?: string;

  /** 运行次数 */
  runCount: number;
}
```

### 3.2 存储接口

```typescript
/**
 * CronStore — 任务存储接口
 */
export interface CronStore {
  /**
   * 创建任务
   */
  create(job: Omit<CronJob, 'id' | 'lastRunAt' | 'runCount'>): string;

  /**
   * 更新任务
   */
  update(id: string, updates: Partial<CronJob>): void;

  /**
   * 获取任务
   */
  get(id: string): CronJob | null;

  /**
   * 列出所有任务
   */
  list(includeDisabled?: boolean): CronJob[];

  /**
   * 删除任务
   */
  delete(id: string): void;
}
```

### 3.3 JSON 文件存储实现

```typescript
/**
 * JSONCronStore — JSON 文件任务存储
 */
export class JSONCronStore implements CronStore {
  private _filePath: string;
  private _jobs: CronJob[] = [];

  constructor(cronDir: string) {
    this._filePath = join(cronDir, 'jobs.json');
    this._load();
  }

  private _load(): void {
    try {
      if (existsSync(this._filePath)) {
        const content = readFileSync(this._filePath, 'utf-8');
        this._jobs = JSON.parse(content);
      }
    } catch (err) {
      console.error(`Failed to load cron jobs:`, err);
      this._jobs = [];
    }
  }

  private _save(): void {
    try {
      const dir = dirname(this._filePath);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
      writeFileSync(this._filePath, JSON.stringify(this._jobs, null, 2), 'utf-8');
    } catch (err) {
      console.error(`Failed to save cron jobs:`, err);
    }
  }

  create(job: Omit<CronJob, 'id' | 'lastRunAt' | 'runCount'>): string {
    const id = generateJobId();
    const newJob: CronJob = {
      ...job,
      id,
      lastRunAt: undefined,
      runCount: 0,
    };
    this._jobs.push(newJob);
    this._save();
    return id;
  }

  update(id: string, updates: Partial<CronJob>): void {
    const index = this._jobs.findIndex((j) => j.id === id);

    if (index === -1) {
      throw new Error(`Job "${id}" not found`);
    }

    this._jobs[index] = { ...this._jobs[index], ...updates };
    this._save();
  }

  get(id: string): CronJob | null {
    return this._jobs.find((j) => j.id === id) || null;
  }

  list(includeDisabled = false): CronJob[] {
    return this._jobs.filter((j) => includeDisabled || j.enabled);
  }

  delete(id: string): void {
    this._jobs = this._jobs.filter((j) => j.id !== id);
    this._save();
  }
}

/**
 * generateJobId — 生成任务 ID
 */
function generateJobId(): string {
  return `job_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
}
```

---

## 4. 调度器实现

### 4.1 CronScheduler 类

```typescript
/**
 * CronScheduler — 定时任务调度器
 *
 * 每 30 秒轮询一次并触发到期的 Cron 任务
 *
 * 当任务触发时，它创建一个合成的 InboundMessage
 * 并调用 dispatcher.handle() 以便任务在正确的会话工作空间中运行
 * 并将结果回传到原始聊天
 */
export class CronScheduler {
  private readonly POLL_INTERVAL_MS = 30_000; // 30 秒

  private _timer: ReturnType<typeof setInterval> | null = null;
  private _inFlight = new Set<string>(); // 当前执行的任务 ID

  constructor(private readonly _dispatcher: Dispatcher) {}

  /**
   * 启动调度器
   */
  start(): void {
    if (this._timer) return;

    const store = new JSONCronStore(CRON_DIR);

    log.info(`Cron scheduler started (poll every ${this.POLL_INTERVAL_MS / 1000}s`);

    // 立即执行一次，以捕获守护进程离线时到期的任务
    void this._tick();

    this._timer = setInterval(() => void this._tick(), this.POLL_INTERVAL_MS);

    if (typeof this._timer.unref === 'function') {
      this._timer.unref();
    }
  }

  /**
   * 停止调度器
   */
  stop(): void {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }

    log.info('Cron scheduler stopped');
  }

  /**
   * 轮询循环
   */
  private async _tick(): Promise<void> {
    const now = new Date();
    let jobs: CronJob[];

    try {
      const store = new JSONCronStore(CRON_DIR);
      jobs = store.list();
    } catch (err) {
      log.warn(`Failed to list cron jobs: ${err}`);
      return;
    }

    for (const job of jobs) {
      if (this._inFlight.has(job.id)) continue;

      if (this._isDue(job, now)) {
        void this._fire(job, now);
      }
    }
  }

  /**
   * 检查任务是否到期
   */
  private _isDue(job: CronJob, now: Date): boolean {
    if (job.runAt) {
      return new Date(job.runAt) <= now;
    }

    if (job.cronExpr) {
      const lastRun = job.lastRunAt ? new Date(job.lastRunAt) : null;
      return matchesCron(job.cronExpr, now, lastRun);
    }

    return false;
  }

  /**
   * 触发任务
   */
  private async _fire(job: CronJob, now: Date): Promise<void> {
    this._inFlight.add(job.id);
    log.info(`Firing cron job "${job.label ?? job.id}"`);

    // 在调用 dispatcher 之前更新状态，防止慢任务双重触发
    job.lastRunAt = now.toISOString();

    if (job.runAt) {
      job.enabled = false; // 一次性任务：首次触发后禁用
    }

    try {
      const store = new JSONCronStore(CRON_DIR);
      store.update(job.id, job);
    } catch (err) {
      log.warn(`Failed to persist job state before firing "${job.id}": ${err}`);
    }

    try {
      const text =
        `[定时任务触发]\n\n` +
        `**任务名称：** ${job.label ?? '(未命名)'}\n` +
        `**触发时间：** ${now.toISOString()}\n\n` +
        `**任务详情：**\n${job.message}`;

      const msg: InboundMessage = {
        id: randomUUID(),
        text,
        chatId: job.chatId,
        authorId: 'cron',
        authorName: 'CronScheduler',
        gatewayKind: job.gatewayKind,
      };

      const replyFn = async (response: RunResponse): Promise<void> => {
        try {
          await this._dispatcher.sendTo(job.gatewayKind, job.chatId, response);
        } catch (err) {
          log.error(`Failed to deliver result for cron job "${job.id}": ${err}`);
        }
      };

      await this._dispatcher.handle(msg, replyFn);
      log.info(`Cron job "${job.label ?? job.id}" completed`);
    } catch (err) {
      log.error(`Cron job "${job.id}" execution failed: ${err}`);
    } finally {
      this._inFlight.delete(job.id);
    }
  }
}
```

---

## 5. 任务执行

### 5.1 合成消息创建

```typescript
/**
 * createSyntheticMessage — 创建合成消息
 *
 * 创建一个模拟用户消息的 InboundMessage，
 * 以便任务在正确的会话上下文中执行
 */
function createSyntheticMessage(
  job: CronJob,
  timestamp: Date
): InboundMessage {
  const text =
    `[定时任务触发]\n\n` +
    `**任务名称：** ${job.label ?? '(未命名)'}\n` +
    `**触发时间：** ${timestamp.toISOString()}\n\n` +
    `**任务详情：**\n${job.message}`;

  return {
    id: randomUUID(),
    text,
    chatId: job.chatId,
    authorId: 'cron',
    authorName: 'CronScheduler',
    gatewayKind: job.gatewayKind,
  };
}
```

### 5.2 执行状态机

```
┌─────────────────────────────────────────────────────────────┐
│              任务执行状态机                               │
├─────────────────────────────────────────────────────────────┤
│                                                       │
│  ┌──────────┐    ┌──────────┐    ┌──────────┐   │
│  │  Pending  │ -> │  Checking │ -> │  Firing    │   │
│  │  (等待)    │    │  (检查)     │    │  (执行)    │   │
│  └────┬─────┘    └────┬─────┘    └────┬─────┘   │
│       │                  │               │           │
│       ▼                  ▼               ▼           │
│  ┌──────────┐    ┌──────────┐                  │
│  │ In-Flight │    │  Completed │                 │
│  │  (执行中)  │    │  (完成)    │                 │
│  └────┬─────┘    └────┬─────┘                  │
│       │                  │                           │
│       ▼                  ▼                           │
│  ┌──────────────────────────┐                       │
│  │  Update Status        │                       │
│  │  (更新持久化)       │                       │
│  └──────────────────────────┘                       │
└─────────────────────────────────────────────────────────────┘
```

---

## 6. 管理接口

### 6.1 管理命令

```typescript
/**
 * CronManager — 定时任务管理接口
 */
export class CronManager {
  constructor(private readonly store: CronStore) {}

  /**
   * 创建任务
   */
  async create(options: {
    message: string;
    runAt?: Date;
    cronExpr?: string;
    label?: string;
    chatId: string;
    gatewayKind: string;
  }): Promise<string> {
    const id = this.store.create({
      message: options.message,
      runAt: options.runAt?.toISOString(),
      cronExpr: options.cronExpr,
      label: options.label,
      chatId: options.chatId,
      gatewayKind: options.gatewayKind,
      enabled: true,
    });

    log.info(`Cron job created: ${id} (${options.label || 'unnamed'})`);
    return id;
  }

  /**
   * 列出任务
   */
  list(includeDisabled = false): CronJob[] {
    const jobs = this.store.list(includeDisabled);
    log.info(`Listed ${jobs.length} cron jobs`);
    return jobs;
  }

  /**
   * 更新任务
   */
  update(id: string, updates: Partial<CronJob>): void {
    this.store.update(id, updates);
    log.info(`Cron job updated: ${id}`);
  }

  /**
   * 删除任务
   */
  delete(id: string): void {
    this.store.delete(id);
    log.info(`Cron job deleted: ${id}`);
  }
}
```

### 6.2 CLI 接口

```typescript
/**
 * CronCLI — 定时任务 CLI
 *
 * 提供命令行接口管理定时任务
 */
export class CronCLI {
  constructor(private readonly manager: CronManager) {}

  /**
   * 执行创建命令
   */
  async create(args: {
    message: string;
    runAt?: string;
    cronExpr?: string;
    label?: string;
  }): Promise<void> {
    const id = await this.manager.create({
      message: args.message,
      runAt: args.runAt ? new Date(args.runAt) : undefined,
      cronExpr: args.cronExpr,
      label: args.label,
      chatId: 'current', // 从上下文获取
      gatewayKind: 'default',
    });

    console.log(JSON.stringify({ jobId: id }, null, 2));
  }

  /**
   * 执行列表命令
   */
  async list(args: { includeDisabled?: boolean }): Promise<void> {
    const jobs = this.manager.list(args.includeDisabled);
    console.log(JSON.stringify({ jobs }, null, 2));
  }

  /**
   * 执行删除命令
   */
  async delete(args: { jobId: string }): Promise<void> {
    this.manager.delete(args.jobId);
    console.log(JSON.stringify({ success: true }, null, 2));
  }

  /**
   * 执行更新命令
   */
  async update(args: {
    jobId: string;
    label?: string;
    message?: string;
    enabled?: boolean;
    runAt?: string;
    cronExpr?: string;
  }): Promise<void> {
    this.manager.update(args.jobId, args);
    console.log(JSON.stringify({ success: true }, null, 2));
  }
}
```

---

## 附录

### A. 目录结构

```
~/.friclaw/
├── cron/
│   └── jobs.json              # 任务存储
├── workspaces/
│   └── {conversation_id}/
│       ├── .friclaw/
│       │   ├── .history/
│       │   └── ...
│       └── memory/
└── ...
```

### B. 配置常量

```typescript
/**
 * Cron 常量
 */
export const CRON_DIR = '~/.friclaw/cron';
export const POLL_INTERVAL_MS = 30_000; // 30 秒
export const MAX_CONCURRENT_JOBS = 5; // 最大并发任务数
```

---

**文档版本**: 1.0.0
**最后更新**: 2026-03-13
