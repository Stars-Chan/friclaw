# Dispatcher Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 重构 Dispatcher，作为网关与会话层之间的中枢，将标准化消息路由到对应会话的 LaneQueue，并支持 `/clear`、`/new`、`/status` 命令短路处理。

**Architecture:** Dispatcher 接收标准化 `Message`，通过 `SessionManager.getOrCreate()` 获取会话，内部维护单个 `LaneQueue`（以 session.id 为 lane key，保证会话内串行、会话间并行）。命令消息在投入队列前短路处理。Agent 以接口形式注入，保持可测试性。注意：spec 17.1 将 `laneQueues` 作为构造参数，本实现将其内化为私有字段，是有意为之的封装改进。

**Tech Stack:** Bun, TypeScript, bun:test, LaneQueue (已有), SessionManager (已有)

---

## File Structure

| 文件 | 职责 |
|------|------|
| `src/types/message.ts` | 标准化 Message 类型（Task 2 测试即为其验证） |
| `src/dispatcher.ts` | Dispatcher 核心实现（替换 stub） |
| `src/index.ts` | 主入口集成更新 |
| `tests/unit/dispatcher.test.ts` | 单元测试 |

---

### Task 1: Message 类型定义

**Files:**
- Create: `src/types/message.ts`

注意：Task 2 的失败测试会 import 此文件，因此 Task 2 Step 1 同时充当本 Task 的 TDD 验证。

- [ ] **Step 1: 创建 Message 类型**

```typescript
// src/types/message.ts
export type MessageType = 'text' | 'command' | 'file' | 'image'

export interface Message {
  platform: 'feishu' | 'wecom' | 'dashboard'
  chatId: string
  userId: string
  type: MessageType
  content: string
  messageId?: string
}
```

- [ ] **Step 2: Commit**

```bash
cd /Users/chen/workspace/ai/friclaw && git add src/types/message.ts && git commit -m "feat(dispatcher): add Message type"
```

---

### Task 2: Dispatcher 核心实现

**Files:**
- Modify: `src/dispatcher.ts`
- Create: `tests/unit/dispatcher.test.ts`

- [ ] **Step 1: 写失败测试**

```typescript
// tests/unit/dispatcher.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { Dispatcher } from '../../src/dispatcher'
import { SessionManager } from '../../src/session/manager'
import type { Message } from '../../src/types/message'

let tmpDir: string
let sessionManager: SessionManager

const makeAgent = () => {
  const calls: Array<{ sessionId: string; content: string }> = []
  return {
    calls,
    handle: async (session: { id: string }, msg: Message) => {
      calls.push({ sessionId: session.id, content: msg.content })
    },
  }
}

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'friclaw-dispatcher-'))
  sessionManager = new SessionManager({ workspacesDir: tmpDir, timeoutMs: 60_000 })
})

afterEach(() => {
  sessionManager.stopCleanupTimer()
  rmSync(tmpDir, { recursive: true, force: true })
})

const msg = (overrides: Partial<Message> = {}): Message => ({
  platform: 'feishu',
  chatId: 'ou_abc',
  userId: 'user1',
  type: 'text',
  content: 'hello',
  ...overrides,
})

describe('Dispatcher', () => {
  it('dispatches message to agent via session', async () => {
    const agent = makeAgent()
    const dispatcher = new Dispatcher(sessionManager, agent)
    await dispatcher.dispatch(msg())
    expect(agent.calls).toHaveLength(1)
    expect(agent.calls[0].sessionId).toBe('feishu:ou_abc')
  })

  it('same session messages are serialized', async () => {
    const order: number[] = []
    let resolve1!: () => void
    const agent = {
      handle: async (_session: { id: string }, m: Message) => {
        if (m.content === 'first') {
          await new Promise<void>(r => { resolve1 = r })
          order.push(1)
        } else {
          order.push(2)
        }
      },
    }
    const dispatcher = new Dispatcher(sessionManager, agent)
    const p1 = dispatcher.dispatch(msg({ content: 'first' }))
    const p2 = dispatcher.dispatch(msg({ content: 'second' }))
    resolve1!()
    await Promise.all([p1, p2])
    expect(order).toEqual([1, 2])
  })

  it('different sessions run in parallel', async () => {
    const started: string[] = []
    let resolve1!: () => void
    const agent = {
      handle: async (session: { id: string }, _m: Message) => {
        started.push(session.id)
        if (session.id === 'feishu:ou_aaa') {
          await new Promise<void>(r => { resolve1 = r })
        }
      },
    }
    const dispatcher = new Dispatcher(sessionManager, agent)
    const p1 = dispatcher.dispatch(msg({ chatId: 'ou_aaa' }))
    const p2 = dispatcher.dispatch(msg({ chatId: 'ou_bbb' }))
    await p2
    expect(started).toContain('feishu:ou_bbb')
    resolve1!()
    await p1
  })

  it('/clear command short-circuits and calls clearSession', async () => {
    const agent = makeAgent()
    const cleared: string[] = []
    sessionManager.onSessionCleared = (id) => cleared.push(id)
    const dispatcher = new Dispatcher(sessionManager, agent)
    await dispatcher.dispatch(msg())
    await dispatcher.dispatch(msg({ type: 'command', content: '/clear' }))
    expect(agent.calls).toHaveLength(1)
    expect(cleared).toContain('feishu:ou_abc')
  })

  it('/new command short-circuits and creates new workspace', async () => {
    const agent = makeAgent()
    const dispatcher = new Dispatcher(sessionManager, agent)
    await dispatcher.dispatch(msg())
    const oldDir = sessionManager.get('feishu:ou_abc')?.workspaceDir
    await dispatcher.dispatch(msg({ type: 'command', content: '/new' }))
    expect(agent.calls).toHaveLength(1)
    const newDir = sessionManager.get('feishu:ou_abc')?.workspaceDir
    expect(newDir).toBeDefined()
    expect(newDir).not.toBe(oldDir)
  })

  it('/status command short-circuits and does not call agent', async () => {
    const agent = makeAgent()
    const dispatcher = new Dispatcher(sessionManager, agent)
    await dispatcher.dispatch(msg({ type: 'command', content: '/status' }))
    expect(agent.calls).toHaveLength(0)
  })

  it('unknown command does not call agent and does not throw', async () => {
    const agent = makeAgent()
    const dispatcher = new Dispatcher(sessionManager, agent)
    await expect(dispatcher.dispatch(msg({ type: 'command', content: '/unknown' }))).resolves.toBeUndefined()
    expect(agent.calls).toHaveLength(0)
  })

  it('stopAccepting rejects new dispatches', async () => {
    const agent = makeAgent()
    const dispatcher = new Dispatcher(sessionManager, agent)
    dispatcher.stopAccepting()
    await expect(dispatcher.dispatch(msg())).rejects.toThrow('not accepting')
  })

  it('drainQueues resolves when all lanes are empty', async () => {
    const agent = makeAgent()
    const dispatcher = new Dispatcher(sessionManager, agent)
    await dispatcher.dispatch(msg())
    await dispatcher.drainQueues()
    expect(dispatcher.activeLanes()).toBe(0)
  })
})
```

- [ ] **Step 2: 运行测试，确认失败**

```bash
cd /Users/chen/workspace/ai/friclaw && bun test tests/unit/dispatcher.test.ts 2>&1 | tail -10
```

Expected: FAIL

- [ ] **Step 3: 重写 Dispatcher**

```typescript
// src/dispatcher.ts
import { LaneQueue } from './utils/lane-queue'
import { logger } from './utils/logger'
import type { SessionManager } from './session/manager'
import type { Session } from './session/types'
import type { Message } from './types/message'

export interface Agent {
  handle(session: Session, message: Message): Promise<void>
}

export class Dispatcher {
  private laneQueue = new LaneQueue()
  private accepting = true

  constructor(
    private sessionManager: SessionManager,
    private agent: Agent,
  ) {}

  async dispatch(message: Message): Promise<void> {
    if (!this.accepting) throw new Error('Dispatcher is not accepting new messages')

    if (message.type === 'command') {
      await this.handleCommand(message)
      return
    }

    const session = this.sessionManager.getOrCreate(
      message.platform,
      message.chatId,
      message.userId,
    )

    await this.laneQueue.enqueue(session.id, () => this.agent.handle(session, message))
  }

  stopAccepting(): void {
    this.accepting = false
    logger.info('Dispatcher stopped accepting new messages')
  }

  async drainQueues(): Promise<void> {
    // Poll until all lanes are drained. LaneQueue deletes lane entries on completion,
    // so activeLanes() reaching 0 is the correct termination condition.
    while (this.laneQueue.activeLanes() > 0) {
      await new Promise(r => setTimeout(r, 10))
    }
    logger.info('Lane queues drained')
  }

  activeLanes(): number {
    return this.laneQueue.activeLanes()
  }

  async shutdown(): Promise<void> {
    this.stopAccepting()
    await this.drainQueues()
    logger.info('Dispatcher shutdown complete')
  }

  private async handleCommand(message: Message): Promise<void> {
    // Use SessionManager.get() to avoid reconstructing the session ID independently
    const sessionId = `${message.platform}:${message.chatId}`
    switch (message.content) {
      case '/clear':
        this.sessionManager.clearSession(sessionId)
        logger.info({ sessionId }, 'Session cleared via /clear')
        break
      case '/new':
        this.sessionManager.newSession(message.platform, message.chatId, message.userId)
        logger.info({ sessionId }, 'New session created via /new')
        break
      case '/status':
        logger.info({ stats: this.sessionManager.stats() }, '/status requested')
        break
      default:
        logger.warn({ content: message.content }, 'Unknown command, ignoring')
    }
  }
}
```

- [ ] **Step 4: 运行测试，确认通过**

```bash
cd /Users/chen/workspace/ai/friclaw && bun test tests/unit/dispatcher.test.ts 2>&1 | tail -10
```

Expected: all pass

- [ ] **Step 5: Commit**

```bash
cd /Users/chen/workspace/ai/friclaw && git add src/dispatcher.ts tests/unit/dispatcher.test.ts && git commit -m "feat(dispatcher): implement message routing with LaneQueue and command short-circuit"
```

---

### Task 3: 更新 src/index.ts 集成

**Files:**
- Modify: `src/index.ts`

注意：移除旧的 `await dispatcher.start()` 调用（新 Dispatcher 无此方法）。`memory.shutdown()` 通过独立的 process signal handler 调用，不再由 Dispatcher 持有。

- [ ] **Step 1: 更新 index.ts**

```typescript
// src/index.ts
import { loadConfig } from './config'
import { MemoryManager } from './memory/manager'
import { SessionManager } from './session/manager'
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

  const sessionManager = new SessionManager({
    workspacesDir: config.workspaces.dir,
    timeoutMs: config.workspaces.sessionTimeout * 1000,
  })

  // Agent stub — will be replaced in module 08
  const agent = {
    handle: async (_session: unknown, _msg: unknown) => {
      logger.info('Agent stub: message received (not yet implemented)')
    },
  }

  const dispatcher = new Dispatcher(sessionManager, agent)

  if (config.dashboard.enabled) {
    await startDashboard(config.dashboard.port, dispatcher)
  }

  // memory.shutdown() is called here so Dispatcher does not need to hold a reference
  registerShutdownHandlers({
    shutdown: async () => {
      await dispatcher.shutdown()
      await memory.shutdown()
    },
  } as unknown as import('./dispatcher').Dispatcher)

  logger.info('FriClaw ready')
}

main().catch((err) => {
  logger.error({ err }, 'Fatal startup error')
  process.exit(1)
})
```

Wait — `registerShutdownHandlers` expects a `Dispatcher` instance. Check its signature in `src/daemon.ts`:

```typescript
export function registerShutdownHandlers(dispatcher: Dispatcher): void {
  const shutdown = createShutdownHandler(dispatcher)
  ...
}
```

And `createShutdownHandler` calls `dispatcher.shutdown()`. So the cleanest fix is to have `Dispatcher.shutdown()` also call `memory.shutdown()` by accepting it as an optional callback:

```typescript
// src/index.ts
import { loadConfig } from './config'
import { MemoryManager } from './memory/manager'
import { SessionManager } from './session/manager'
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

  const sessionManager = new SessionManager({
    workspacesDir: config.workspaces.dir,
    timeoutMs: config.workspaces.sessionTimeout * 1000,
  })

  // Agent stub — will be replaced in module 08
  const agent = {
    handle: async (_session: unknown, _msg: unknown) => {
      logger.info('Agent stub: message received (not yet implemented)')
    },
  }

  const dispatcher = new Dispatcher(sessionManager, agent, () => memory.shutdown())

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

And update `Dispatcher` constructor and `shutdown()` to accept an optional `onShutdown` callback:

```typescript
constructor(
  private sessionManager: SessionManager,
  private agent: Agent,
  private onShutdown?: () => Promise<void>,
) {}

async shutdown(): Promise<void> {
  this.stopAccepting()
  await this.drainQueues()
  await this.onShutdown?.()
  logger.info('Dispatcher shutdown complete')
}
```

Also update the dispatcher test — the existing tests don't pass `onShutdown`, so they remain valid (optional parameter).

- [ ] **Step 2: Apply the onShutdown callback to Dispatcher**

Edit `src/dispatcher.ts` constructor and `shutdown()` as shown above.

- [ ] **Step 3: Commit**

```bash
cd /Users/chen/workspace/ai/friclaw && git add src/index.ts src/dispatcher.ts && git commit -m "feat(dispatcher): wire SessionManager, memory shutdown, and agent stub in main entry"
```

---

### Task 4: 全量测试验证

- [ ] **Step 1: 运行全量测试**

```bash
cd /Users/chen/workspace/ai/friclaw && bun test tests/unit/ 2>&1 | tail -5
```

Expected: all pass，0 fail

- [ ] **Step 2: Push**

```bash
cd /Users/chen/workspace/ai/friclaw && git push origin main
```
