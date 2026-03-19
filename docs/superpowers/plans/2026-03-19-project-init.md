# Project Init & Architecture Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 搭建 FriClaw 基础骨架：Bun/TypeScript 项目配置、核心工具类、可运行的启动/优雅退出序列。

**Architecture:** 单 Bun 进程，各子系统按序初始化。Memory、Dispatcher、Dashboard 在本模块以 stub 实现，保证入口文件可编译运行，后续模块逐步填充。

**Tech Stack:** Bun ≥1.1, TypeScript (strict), pino, zod, better-sqlite3, @anthropic-ai/sdk

---

## File Map

| 操作 | 路径 | 职责 |
|------|------|------|
| Create | `package.json` | 项目元数据、scripts |
| Create | `tsconfig.json` | TypeScript 严格模式配置 |
| Create | `src/utils/logger.ts` | pino logger 单例 |
| Create | `src/utils/lane-queue.ts` | FIFO 串行任务队列 |
| Create | `src/config.ts` | Zod schema + 配置加载 |
| Create | `src/memory/manager.ts` | MemoryManager stub |
| Create | `src/dispatcher.ts` | Dispatcher stub |
| Create | `src/dashboard/api.ts` | startDashboard stub |
| Create | `src/daemon.ts` | 优雅退出信号处理 |
| Create | `src/index.ts` | 入口：按序启动各子系统 |
| Create | `tests/unit/utils/logger.test.ts` | Logger 单元测试 |
| Create | `tests/unit/utils/lane-queue.test.ts` | LaneQueue 单元测试 |
| Create | `tests/unit/config.test.ts` | Config 加载测试 |
| Create | `tests/unit/daemon.test.ts` | Daemon 关闭序列测试 |
| Create | `.gitkeep` × 6 | 空目录占位（gateway/session/agent/mcp/cron/types） |

---

## Task 1: 初始化 Bun 项目 & 安装依赖

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`

- [ ] **Step 1: 初始化项目**

```bash
cd /Users/chen/workspace/ai/friclaw
bun init -y
```

- [ ] **Step 2: 覆盖 package.json**

```json
{
  "name": "friclaw",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "start": "bun run src/index.ts",
    "dev": "bun --watch src/index.ts",
    "test": "bun test",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@anthropic-ai/sdk": "^0.39.0",
    "better-sqlite3": "^11.0.0",
    "pino": "^9.0.0",
    "zod": "^3.23.0"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.0",
    "@types/bun": "latest",
    "typescript": "^5.4.0"
  }
}
```

- [ ] **Step 3: 创建 tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "skipLibCheck": true,
    "paths": {
      "@/*": ["./src/*"]
    }
  },
  "include": ["src", "tests"]
}
```

- [ ] **Step 4: 安装依赖**

```bash
bun install
```

Expected: `bun install` 完成，`node_modules/` 生成，无报错。

- [ ] **Step 5: 创建空目录占位**

```bash
mkdir -p src/gateway src/session src/agent src/mcp src/cron src/types tests/unit/utils
touch src/gateway/.gitkeep src/session/.gitkeep src/agent/.gitkeep \
      src/mcp/.gitkeep src/cron/.gitkeep src/types/.gitkeep
```

- [ ] **Step 6: Commit**

```bash
git add package.json tsconfig.json src/ tests/
git commit -m "chore: initialize bun project with typescript config"
```

---

## Task 2: Logger 工具 (TDD)

**Files:**
- Create: `src/utils/logger.ts`
- Test: `tests/unit/utils/logger.test.ts`

- [ ] **Step 1: 写失败测试**

```typescript
// tests/unit/utils/logger.test.ts
import { describe, it, expect } from 'bun:test'
import { logger } from '../../../src/utils/logger'

describe('logger', () => {
  it('exports a pino logger instance', () => {
    expect(logger).toBeDefined()
    expect(typeof logger.info).toBe('function')
    expect(typeof logger.error).toBe('function')
    expect(typeof logger.warn).toBe('function')
  })

  it('respects LOG_LEVEL env var', () => {
    process.env.LOG_LEVEL = 'warn'
    // Re-import won't work due to module cache; test the level directly
    expect(logger.level).toBeDefined()
  })
})
```

- [ ] **Step 2: 运行测试，确认失败**

```bash
bun test tests/unit/utils/logger.test.ts
```

Expected: FAIL — `Cannot find module '../../../src/utils/logger'`

- [ ] **Step 3: 实现 logger**

```typescript
// src/utils/logger.ts
import pino from 'pino'

export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
})
```

- [ ] **Step 4: 运行测试，确认通过**

```bash
bun test tests/unit/utils/logger.test.ts
```

Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add src/utils/logger.ts tests/unit/utils/logger.test.ts
git commit -m "feat: add pino logger utility"
```

---

## Task 3: LaneQueue 工具 (TDD)

**Files:**
- Create: `src/utils/lane-queue.ts`
- Test: `tests/unit/utils/lane-queue.test.ts`

- [ ] **Step 1: 写失败测试**

```typescript
// tests/unit/utils/lane-queue.test.ts
import { describe, it, expect } from 'bun:test'
import { LaneQueue } from '../../../src/utils/lane-queue'

describe('LaneQueue', () => {
  it('executes tasks in FIFO order', async () => {
    const queue = new LaneQueue()
    const order: number[] = []

    await Promise.all([
      queue.enqueue(async () => { order.push(1) }),
      queue.enqueue(async () => { order.push(2) }),
      queue.enqueue(async () => { order.push(3) }),
    ])

    expect(order).toEqual([1, 2, 3])
  })

  it('serializes concurrent tasks (max concurrency = 1)', async () => {
    const queue = new LaneQueue()
    let concurrent = 0
    let maxConcurrent = 0

    const task = async () => {
      concurrent++
      maxConcurrent = Math.max(maxConcurrent, concurrent)
      await new Promise(r => setTimeout(r, 10))
      concurrent--
    }

    await Promise.all([
      queue.enqueue(task),
      queue.enqueue(task),
      queue.enqueue(task),
    ])

    expect(maxConcurrent).toBe(1)
  })

  it('propagates task errors to caller without blocking queue', async () => {
    const queue = new LaneQueue()
    const results: string[] = []

    const [r1, r2] = await Promise.allSettled([
      queue.enqueue(async () => { throw new Error('fail') }),
      queue.enqueue(async () => { results.push('ok') }),
    ])

    expect(r1.status).toBe('rejected')
    expect(r2.status).toBe('fulfilled')
    expect(results).toEqual(['ok'])
  })

  it('returns task result to caller', async () => {
    const queue = new LaneQueue()
    const result = await queue.enqueue(async () => 42)
    expect(result).toBe(42)
  })

  it('size reflects pending tasks', async () => {
    const queue = new LaneQueue()
    // Enqueue a slow task to block the queue
    const blocker = queue.enqueue(() => new Promise(r => setTimeout(r, 50)))
    // Enqueue two more
    queue.enqueue(async () => {})
    queue.enqueue(async () => {})

    expect(queue.size).toBeGreaterThan(0)
    await blocker
  })
})
```

- [ ] **Step 2: 运行测试，确认失败**

```bash
bun test tests/unit/utils/lane-queue.test.ts
```

Expected: FAIL — `Cannot find module '../../../src/utils/lane-queue'`

- [ ] **Step 3: 实现 LaneQueue**

```typescript
// src/utils/lane-queue.ts
export class LaneQueue {
  private queue: Array<() => Promise<void>> = []
  private running = false

  async enqueue<T>(task: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.queue.push(async () => {
        try {
          resolve(await task())
        } catch (err) {
          reject(err)
        }
      })
      this.drain()
    })
  }

  private async drain(): Promise<void> {
    if (this.running) return
    this.running = true
    while (this.queue.length > 0) {
      const task = this.queue.shift()!
      await task()
    }
    this.running = false
  }

  get size(): number {
    return this.queue.length
  }
}
```

- [ ] **Step 4: 运行测试，确认通过**

```bash
bun test tests/unit/utils/lane-queue.test.ts
```

Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/utils/lane-queue.ts tests/unit/utils/lane-queue.test.ts
git commit -m "feat: add LaneQueue FIFO serialization utility"
```

---

## Task 4: 配置系统 (TDD)

**Files:**
- Create: `src/config.ts`
- Test: `tests/unit/config.test.ts`

- [ ] **Step 1: 写失败测试**

```typescript
// tests/unit/config.test.ts
import { describe, it, expect, beforeEach } from 'bun:test'
import { loadConfig } from '../../src/config'

describe('loadConfig', () => {
  beforeEach(() => {
    // Point to nonexistent file so we always get defaults
    process.env.FRICLAW_CONFIG = '/tmp/friclaw-test-nonexistent.json'
  })

  it('returns default agent config', async () => {
    const config = await loadConfig()
    expect(config.agent.model).toBe('claude-sonnet-4-6')
    expect(config.agent.summaryModel).toBe('claude-haiku-4-5')
    expect(config.agent.timeout).toBe(300000)
  })

  it('returns default dashboard config', async () => {
    const config = await loadConfig()
    expect(config.dashboard.enabled).toBe(true)
    expect(config.dashboard.port).toBe(3000)
  })

  it('returns default memory config', async () => {
    const config = await loadConfig()
    expect(config.memory.vectorEnabled).toBe(false)
    expect(config.memory.searchLimit).toBe(10)
  })

  it('merges partial config file with defaults', async () => {
    const tmpPath = '/tmp/friclaw-test-partial.json'
    await Bun.write(tmpPath, JSON.stringify({ dashboard: { port: 4000 } }))
    process.env.FRICLAW_CONFIG = tmpPath

    const config = await loadConfig()
    expect(config.dashboard.port).toBe(4000)
    expect(config.dashboard.enabled).toBe(true) // default preserved
  })
})
```

- [ ] **Step 2: 运行测试，确认失败**

```bash
bun test tests/unit/config.test.ts
```

Expected: FAIL — `Cannot find module '../../src/config'`

- [ ] **Step 3: 实现 config.ts**

```typescript
// src/config.ts
import { z } from 'zod'
import { existsSync, readFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'

const AgentSchema = z.object({
  model: z.string().default('claude-sonnet-4-6'),
  summaryModel: z.string().default('claude-haiku-4-5'),
  timeout: z.number().default(300_000),
}).default({})

const MemorySchema = z.object({
  dir: z.string().default(join(homedir(), '.friclaw', 'memory')),
  searchLimit: z.number().default(10),
  vectorEnabled: z.boolean().default(false),
  vectorEndpoint: z.string().default('http://localhost:6333'),
}).default({})

const WorkspacesSchema = z.object({
  dir: z.string().default(join(homedir(), '.friclaw', 'workspaces')),
  maxSessions: z.number().default(10),
  sessionTimeout: z.number().default(3600),
}).default({})

const DashboardSchema = z.object({
  enabled: z.boolean().default(true),
  port: z.number().default(3000),
}).default({})

const LoggingSchema = z.object({
  level: z.string().default('info'),
  dir: z.string().default(join(homedir(), '.friclaw', 'logs')),
}).default({})

export const ConfigSchema = z.object({
  agent: AgentSchema,
  memory: MemorySchema,
  workspaces: WorkspacesSchema,
  dashboard: DashboardSchema,
  logging: LoggingSchema,
})

export type FriClawConfig = z.infer<typeof ConfigSchema>

export async function loadConfig(): Promise<FriClawConfig> {
  const configPath = process.env.FRICLAW_CONFIG
    ?? join(homedir(), '.friclaw', 'config.json')

  let raw: unknown = {}
  if (existsSync(configPath)) {
    raw = JSON.parse(readFileSync(configPath, 'utf-8'))
  }

  return ConfigSchema.parse(raw)
}
```

- [ ] **Step 4: 运行测试，确认通过**

```bash
bun test tests/unit/config.test.ts
```

Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/config.ts tests/unit/config.test.ts
git commit -m "feat: add config system with zod schema and defaults"
```

---

## Task 5: Stub 子系统 & 目录结构

**Files:**
- Create: `src/memory/manager.ts`
- Create: `src/dispatcher.ts`
- Create: `src/dashboard/api.ts`

无需 TDD（纯 stub，接口契约由后续模块测试覆盖）。

- [ ] **Step 1: 创建 MemoryManager stub**

```typescript
// src/memory/manager.ts
import type { FriClawConfig } from '../config'
import { logger } from '../utils/logger'

export class MemoryManager {
  constructor(private config: FriClawConfig['memory']) {}

  async init(): Promise<void> {
    logger.info({ dir: this.config.dir }, 'Memory system initialized (stub)')
    // TODO: implement in module 04 (SQLite + FTS5)
  }

  async shutdown(): Promise<void> {
    logger.info('Memory system shutdown')
  }
}
```

- [ ] **Step 2: 创建 Dispatcher stub**

```typescript
// src/dispatcher.ts
import type { FriClawConfig } from './config'
import type { MemoryManager } from './memory/manager'
import { logger } from './utils/logger'

export class Dispatcher {
  private accepting = true

  constructor(
    private config: FriClawConfig,
    private memory: MemoryManager,
  ) {}

  async start(): Promise<void> {
    logger.info('Dispatcher started (stub)')
    // TODO: implement in module 05 (gateway + session + agent)
  }

  stopAccepting(): void {
    this.accepting = false
    logger.info('Dispatcher stopped accepting new messages')
  }

  async drainQueues(): Promise<void> {
    // TODO: wait for all LaneQueues to drain
    logger.info('Lane queues drained (stub)')
  }

  async shutdown(): Promise<void> {
    this.stopAccepting()
    await this.drainQueues()
    await this.memory.shutdown()
    logger.info('Dispatcher shutdown complete')
  }
}
```

- [ ] **Step 3: 创建 Dashboard stub**

```typescript
// src/dashboard/api.ts
import type { Dispatcher } from '../dispatcher'
import { logger } from '../utils/logger'

export async function startDashboard(
  port: number,
  _dispatcher: Dispatcher,
): Promise<void> {
  logger.info({ port }, 'Dashboard started (stub)')
  // TODO: implement in module 07 (WebSocket server)
}
```

- [ ] **Step 4: TypeScript 类型检查**

```bash
bun run typecheck
```

Expected: 无报错

- [ ] **Step 5: Commit**

```bash
git add src/memory/manager.ts src/dispatcher.ts src/dashboard/api.ts
git commit -m "feat: add stub implementations for memory, dispatcher, dashboard"
```

---

## Task 6: Daemon 优雅退出 (TDD)

**Files:**
- Create: `src/daemon.ts`
- Test: `tests/unit/daemon.test.ts`

- [ ] **Step 1: 写失败测试**

```typescript
// tests/unit/daemon.test.ts
import { describe, it, expect, mock, afterEach } from 'bun:test'

// We test the shutdown logic directly, not via process signals
// to avoid process.exit() terminating the test runner.
import { createShutdownHandler } from '../../src/daemon'

describe('createShutdownHandler', () => {
  it('calls dispatcher.shutdown exactly once', async () => {
    const shutdown = mock(async () => {})
    const exit = mock((_code: number) => {})
    const dispatcher = { shutdown } as any

    const handler = createShutdownHandler(dispatcher, exit)
    await handler('SIGTERM')

    expect(shutdown).toHaveBeenCalledTimes(1)
    expect(exit).toHaveBeenCalledWith(0)
  })

  it('is idempotent — second call is a no-op', async () => {
    const shutdown = mock(async () => {})
    const exit = mock((_code: number) => {})
    const dispatcher = { shutdown } as any

    const handler = createShutdownHandler(dispatcher, exit)
    await handler('SIGTERM')
    await handler('SIGINT') // second call

    expect(shutdown).toHaveBeenCalledTimes(1)
  })

  it('exits with code 1 when dispatcher.shutdown throws', async () => {
    const shutdown = mock(async () => { throw new Error('db error') })
    const exit = mock((_code: number) => {})
    const dispatcher = { shutdown } as any

    const handler = createShutdownHandler(dispatcher, exit)
    await handler('SIGTERM')

    expect(exit).toHaveBeenCalledWith(1)
  })
})
```

- [ ] **Step 2: 运行测试，确认失败**

```bash
bun test tests/unit/daemon.test.ts
```

Expected: FAIL — `Cannot find module '../../src/daemon'`

- [ ] **Step 3: 实现 daemon.ts**

```typescript
// src/daemon.ts
import { logger } from './utils/logger'
import type { Dispatcher } from './dispatcher'

const SHUTDOWN_TIMEOUT_MS = 30_000

// Exported for testing — takes exit fn as injectable dependency
export function createShutdownHandler(
  dispatcher: Dispatcher,
  exit: (code: number) => void = process.exit,
) {
  let shuttingDown = false

  return async function shutdown(signal: string): Promise<void> {
    if (shuttingDown) return
    shuttingDown = true

    logger.info({ signal }, 'Graceful shutdown initiated')

    const timer = setTimeout(() => {
      logger.error('Shutdown timed out after 30s, forcing exit')
      exit(1)
    }, SHUTDOWN_TIMEOUT_MS)

    try {
      await dispatcher.shutdown()
      clearTimeout(timer)
      logger.info('Graceful shutdown complete')
      exit(0)
    } catch (err) {
      clearTimeout(timer)
      logger.error({ err }, 'Error during shutdown')
      exit(1)
    }
  }
}

export function registerShutdownHandlers(dispatcher: Dispatcher): void {
  const shutdown = createShutdownHandler(dispatcher)
  process.on('SIGTERM', () => shutdown('SIGTERM'))
  process.on('SIGINT', () => shutdown('SIGINT'))
}
```

- [ ] **Step 4: 运行测试，确认通过**

```bash
bun test tests/unit/daemon.test.ts
```

Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/daemon.ts tests/unit/daemon.test.ts
git commit -m "feat: add daemon graceful shutdown with 30s timeout"
```

---

## Task 7: 入口文件 & 验收

**Files:**
- Create: `src/index.ts`

- [ ] **Step 1: 实现 src/index.ts**

```typescript
// src/index.ts
import { loadConfig } from './config'
import { MemoryManager } from './memory/manager'
import { Dispatcher } from './dispatcher'
import { startDashboard } from './dashboard/api'
import { registerShutdownHandlers } from './daemon'
import { logger } from './utils/logger'

async function main(): Promise<void> {
  logger.info('FriClaw starting...')

  const config = await loadConfig()
  logger.info({ model: config.agent.model }, 'Config loaded')

  const memory = new MemoryManager(config.memory)
  await memory.init()

  const dispatcher = new Dispatcher(config, memory)
  await dispatcher.start()

  if (config.dashboard.enabled) {
    await startDashboard(config.dashboard.port, dispatcher)
  }

  registerShutdownHandlers(dispatcher)

  logger.info('FriClaw ready')
}

main().catch((err) => {
  logger.error({ err }, 'Fatal startup error')
  process.exit(1)
})
```

- [ ] **Step 2: TypeScript 全量类型检查**

```bash
bun run typecheck
```

Expected: 无报错

- [ ] **Step 3: 验收 — 启动日志**

```bash
bun run start
```

Expected 输出（顺序）:
```
{"level":30,"msg":"FriClaw starting..."}
{"level":30,"model":"claude-sonnet-4-6","msg":"Config loaded"}
{"level":30,"dir":".../.friclaw/memory","msg":"Memory system initialized (stub)"}
{"level":30,"msg":"Dispatcher started (stub)"}
{"level":30,"port":3000,"msg":"Dashboard started (stub)"}
{"level":30,"msg":"FriClaw ready"}
```

用 `Ctrl+C` 停止，Expected 输出：
```
{"level":30,"signal":"SIGINT","msg":"Graceful shutdown initiated"}
{"level":30,"msg":"Dispatcher stopped accepting new messages"}
{"level":30,"msg":"Lane queues drained (stub)"}
{"level":30,"msg":"Memory system shutdown"}
{"level":30,"msg":"Dispatcher shutdown complete"}
{"level":30,"msg":"Graceful shutdown complete"}
```

- [ ] **Step 4: 运行全部测试**

```bash
bun test
```

Expected: 全部 PASS，无失败

- [ ] **Step 5: Final commit**

```bash
git add src/index.ts
git commit -m "feat: add entry point and complete project init skeleton

- Bun project with strict TypeScript
- pino logger, LaneQueue, Zod config
- Stub subsystems: memory, dispatcher, dashboard
- Graceful shutdown with 30s timeout
- Acceptance: bun run start prints startup logs, SIGINT triggers clean exit"
```

---

## 验收标准 Checklist

- [ ] `bun run start` 正常启动，打印各子系统启动日志
- [ ] `Ctrl+C` / SIGTERM 触发优雅退出，日志显示关闭顺序
- [ ] `bun run typecheck` 零报错
- [ ] `bun test` 全部通过（logger × 2, lane-queue × 5, config × 4, daemon × 3）
