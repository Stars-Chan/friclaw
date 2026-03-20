# Feishu Gateway Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现飞书（Lark）平台网关，通过 WebSocket 长连接接收消息事件，解析并标准化为 `Message`，转发给 `Dispatcher`，并支持发送文本回复。群聊 @mention 过滤、话题群 threadId 处理、流式卡片输出（本期为 stub）。

**Architecture:** `FeishuGateway` 实现 `Gateway` 接口（`start(dispatcher) / stop()`），内部持有 `lark.Client`（发送）和 `lark.WSClient`（接收）。`parseMessage()` 将 lark 事件转换为标准 `Message`。群聊消息若无 @机器人 则静默丢弃。话题群以 `chatId:rootId` 作为 `chatId` 传入 Dispatcher，使每个话题独立路由到不同 session。流式卡片（spec 9.3）本期实现为 stub，发送普通文本。测试全程 mock lark SDK，不发起真实网络请求。

**Tech Stack:** Bun, TypeScript, bun:test, @larksuiteoapi/node-sdk

---

## File Structure

| 文件 | 职责 |
|------|------|
| `src/gateway/feishu.ts` | FeishuGateway 核心实现 |
| `src/gateway/types.ts` | Gateway 接口定义 |
| `tests/unit/gateway/feishu.test.ts` | 单元测试（mock lark SDK） |
| `src/index.ts` | 主入口集成 FeishuGateway |
| `package.json` | 添加 @larksuiteoapi/node-sdk 依赖 |

---

### Task 1: 安装依赖

**Files:**
- Modify: `package.json`

- [ ] **Step 1: 安装 lark SDK**

```bash
cd /Users/chen/workspace/ai/friclaw && bun add @larksuiteoapi/node-sdk
```

- [ ] **Step 2: Commit**

```bash
cd /Users/chen/workspace/ai/friclaw && git add package.json bun.lockb && git commit -m "chore(deps): add @larksuiteoapi/node-sdk"
```

---

### Task 2: Gateway 接口定义

**Files:**
- Create: `src/gateway/types.ts`

- [ ] **Step 1: 创建 Gateway 接口**

```typescript
// src/gateway/types.ts
import type { Dispatcher } from '../dispatcher'

export interface Gateway {
  start(dispatcher: Dispatcher): Promise<void>
  stop(): Promise<void>
}
```

- [ ] **Step 2: Commit**

```bash
cd /Users/chen/workspace/ai/friclaw && git add src/gateway/types.ts && git commit -m "feat(gateway): add Gateway interface"
```

---

### Task 3: FeishuGateway 核心实现

**Files:**
- Create: `src/gateway/feishu.ts`
- Create: `tests/unit/gateway/feishu.test.ts`

#### Step 1: 写失败测试

- [ ] **Step 1: 创建测试文件**

```typescript
// tests/unit/gateway/feishu.test.ts
import { describe, it, expect, mock, beforeEach } from 'bun:test'
import type { Message } from '../../../src/types/message'

// --- Mock @larksuiteoapi/node-sdk ---
// We capture the event handler registered for 'im.message.receive_v1'
// so tests can fire synthetic events without a real WebSocket.

let registeredHandler: ((event: unknown) => Promise<void>) | null = null
let wsStarted = false
let wsStopped = false
let sentMessages: Array<{ chatId: string; text: string }> = []

const mockEventDispatcher = {
  register: mock((handlers: Record<string, (e: unknown) => Promise<void>>) => {
    registeredHandler = handlers['im.message.receive_v1'] ?? null
    return mockEventDispatcher
  }),
}

const mockClient = {
  im: {
    message: {
      create: mock(async (params: { data: { receive_id: string; content: string } }) => {
        const body = JSON.parse(params.data.content)
        sentMessages.push({ chatId: params.data.receive_id, text: body.text })
      }),
    },
  },
}

mock.module('@larksuiteoapi/node-sdk', () => ({
  Client: mock(() => mockClient),
  WSClient: mock((_opts: unknown) => ({
    start: mock(async () => { wsStarted = true }),
    stop: mock(async () => { wsStopped = true }),
  })),
  EventDispatcher: mock(() => mockEventDispatcher),
}))

// Import AFTER mock.module
const { FeishuGateway } = await import('../../../src/gateway/feishu')

// --- Helpers ---

const makeDispatcher = () => {
  const received: Message[] = []
  return {
    received,
    dispatch: mock(async (msg: Message) => { received.push(msg) }),
  }
}

const makeEvent = (overrides: {
  chatType?: string
  messageType?: string
  content?: string
  rootId?: string
  mentions?: Array<{ key: string }>
  messageId?: string
  chatId?: string
  userId?: string
} = {}) => ({
  message: {
    message_id: overrides.messageId ?? 'om_001',
    chat_id: overrides.chatId ?? 'oc_chat1',
    chat_type: overrides.chatType ?? 'p2p',
    message_type: overrides.messageType ?? 'text',
    content: overrides.content ?? JSON.stringify({ text: 'hello' }),
    root_id: overrides.rootId ?? '',
  },
  sender: {
    sender_id: { user_id: overrides.userId ?? 'ou_user1' },
  },
})

const makeGroupEvent = (text: string, mentioned = true) => makeEvent({
  chatType: 'group',
  content: JSON.stringify({
    text,
    mentions: mentioned ? [{ key: '@_user_1' }] : [],
  }),
})

// --- Tests ---

beforeEach(() => {
  registeredHandler = null
  wsStarted = false
  wsStopped = false
  sentMessages = []
})

describe('FeishuGateway', () => {
  it('start() connects WSClient', async () => {
    const gw = new FeishuGateway({ appId: 'app1', appSecret: 'sec1' })
    const dispatcher = makeDispatcher()
    await gw.start(dispatcher as any)
    expect(wsStarted).toBe(true)
  })

  it('stop() disconnects WSClient', async () => {
    const gw = new FeishuGateway({ appId: 'app1', appSecret: 'sec1' })
    const dispatcher = makeDispatcher()
    await gw.start(dispatcher as any)
    await gw.stop()
    expect(wsStopped).toBe(true)
  })

  it('p2p text message is dispatched', async () => {
    const gw = new FeishuGateway({ appId: 'app1', appSecret: 'sec1' })
    const dispatcher = makeDispatcher()
    await gw.start(dispatcher as any)
    await registeredHandler!(makeEvent())
    expect(dispatcher.received).toHaveLength(1)
    const msg = dispatcher.received[0]
    expect(msg.platform).toBe('feishu')
    expect(msg.type).toBe('text')
    expect(msg.content).toBe('hello')
    expect(msg.chatId).toBe('oc_chat1')
    expect(msg.userId).toBe('ou_user1')
    expect(msg.messageId).toBe('om_001')
  })

  it('group message with @mention is dispatched', async () => {
    const gw = new FeishuGateway({ appId: 'app1', appSecret: 'sec1' })
    const dispatcher = makeDispatcher()
    await gw.start(dispatcher as any)
    await registeredHandler!(makeGroupEvent('hi bot'))
    expect(dispatcher.received).toHaveLength(1)
  })

  it('group message without @mention is silently dropped', async () => {
    const gw = new FeishuGateway({ appId: 'app1', appSecret: 'sec1' })
    const dispatcher = makeDispatcher()
    await gw.start(dispatcher as any)
    await registeredHandler!(makeGroupEvent('hi bot', false))
    expect(dispatcher.received).toHaveLength(0)
  })

  it('non-text message type is dropped', async () => {
    const gw = new FeishuGateway({ appId: 'app1', appSecret: 'sec1' })
    const dispatcher = makeDispatcher()
    await gw.start(dispatcher as any)
    await registeredHandler!(makeEvent({ messageType: 'file' }))
    expect(dispatcher.received).toHaveLength(0)
  })

  it('thread message uses chatId:rootId as chatId', async () => {
    const gw = new FeishuGateway({ appId: 'app1', appSecret: 'sec1' })
    const dispatcher = makeDispatcher()
    await gw.start(dispatcher as any)
    await registeredHandler!(makeEvent({ rootId: 'om_root1' }))
    expect(dispatcher.received[0].chatId).toBe('oc_chat1:om_root1')
  })

  it('/clear text is dispatched as command type', async () => {
    const gw = new FeishuGateway({ appId: 'app1', appSecret: 'sec1' })
    const dispatcher = makeDispatcher()
    await gw.start(dispatcher as any)
    await registeredHandler!(makeEvent({ content: JSON.stringify({ text: '/clear' }) }))
    expect(dispatcher.received[0].type).toBe('command')
    expect(dispatcher.received[0].content).toBe('/clear')
  })

  it('/new text is dispatched as command type', async () => {
    const gw = new FeishuGateway({ appId: 'app1', appSecret: 'sec1' })
    const dispatcher = makeDispatcher()
    await gw.start(dispatcher as any)
    await registeredHandler!(makeEvent({ content: JSON.stringify({ text: '/new' }) }))
    expect(dispatcher.received[0].type).toBe('command')
  })
})
```

- [ ] **Step 2: 运行测试，确认失败**

```bash
cd /Users/chen/workspace/ai/friclaw && bun test tests/unit/gateway/feishu.test.ts 2>&1 | tail -15
```

Expected: FAIL (module not found)

#### Step 3: 实现 FeishuGateway

- [ ] **Step 3: 创建 src/gateway/feishu.ts**

```typescript
// src/gateway/feishu.ts
import * as lark from '@larksuiteoapi/node-sdk'
import { logger } from '../utils/logger'
import type { Dispatcher } from '../dispatcher'
import type { Gateway } from './types'
import type { Message, MessageType } from '../types/message'

export interface FeishuConfig {
  appId: string
  appSecret: string
  encryptKey?: string
  verificationToken?: string
}

const COMMAND_PREFIXES = ['/', '/clear', '/new', '/status']

function isCommand(text: string): boolean {
  return text.startsWith('/')
}

export class FeishuGateway implements Gateway {
  readonly kind = 'feishu'
  private client!: lark.Client
  private wsClient!: lark.WSClient

  constructor(private config: FeishuConfig) {}

  async start(dispatcher: Dispatcher): Promise<void> {
    this.client = new lark.Client({
      appId: this.config.appId,
      appSecret: this.config.appSecret,
    })

    const eventDispatcher = new lark.EventDispatcher({
      encryptKey: this.config.encryptKey,
      verificationToken: this.config.verificationToken,
    } as any).register({
      'im.message.receive_v1': async (event: any) => {
        const msg = this.parseMessage(event)
        if (!msg) return
        await dispatcher.dispatch(msg)
      },
    })

    this.wsClient = new lark.WSClient({
      appId: this.config.appId,
      appSecret: this.config.appSecret,
      eventDispatcher,
    } as any)

    await this.wsClient.start()
    logger.info('飞书网关已连接')
  }

  async stop(): Promise<void> {
    await (this.wsClient as any)?.stop?.()
    logger.info('飞书网关已断开')
  }

  // Send a plain text reply (stream card is a future task)
  async send(chatId: string, text: string): Promise<void> {
    await this.client.im.message.create({
      receive_id_type: 'chat_id',
      data: {
        receive_id: chatId,
        msg_type: 'text',
        content: JSON.stringify({ text }),
      },
    } as any)
  }

  private parseMessage(event: any): Message | null {
    const { message, sender } = event

    // Only handle text and image
    if (!['text', 'image'].includes(message.message_type)) return null

    // Group chat: require @mention
    if (message.chat_type === 'group') {
      try {
        const body = JSON.parse(message.content)
        const hasMention = body.mentions?.some((m: any) => m.key === '@_user_1')
        if (!hasMention) return null
      } catch {
        return null
      }
    }

    const text = this.extractText(message)

    // Thread: use chatId:rootId so each thread routes to its own session
    const chatId = message.root_id
      ? `${message.chat_id}:${message.root_id}`
      : message.chat_id

    const type: MessageType = isCommand(text) ? 'command' : 'text'

    return {
      platform: 'feishu',
      chatId,
      userId: sender.sender_id.user_id,
      type,
      content: text,
      messageId: message.message_id,
    }
  }

  private extractText(message: any): string {
    try {
      const body = JSON.parse(message.content)
      return (body.text ?? '').trim()
    } catch {
      return ''
    }
  }
}
```

- [ ] **Step 4: 运行测试，确认通过**

```bash
cd /Users/chen/workspace/ai/friclaw && bun test tests/unit/gateway/feishu.test.ts 2>&1 | tail -15
```

Expected: all pass

- [ ] **Step 5: Commit**

```bash
cd /Users/chen/workspace/ai/friclaw && git add src/gateway/feishu.ts src/gateway/types.ts tests/unit/gateway/feishu.test.ts && git commit -m "feat(gateway): implement FeishuGateway with WSClient, parseMessage, @mention filter, thread routing"
```

---

### Task 4: 集成到 src/index.ts

**Files:**
- Modify: `src/index.ts`

- [ ] **Step 1: 更新 index.ts，条件启动 FeishuGateway**

```typescript
// src/index.ts  (relevant additions — merge with existing file)
import { loadConfig } from './config'
import { MemoryManager } from './memory/manager'
import { SessionManager } from './session/manager'
import { Dispatcher } from './dispatcher'
import { startDashboard } from './dashboard/api'
import { registerShutdownHandlers } from './daemon'
import { FeishuGateway } from './gateway/feishu'
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

  const agent = {
    handle: async (_session: unknown, _msg: unknown) => {
      logger.info('Agent stub: message received (not yet implemented)')
    },
  }

  const gateways: Array<{ stop(): Promise<void> }> = []

  const dispatcher = new Dispatcher(sessionManager, agent, async () => {
    await Promise.all(gateways.map(g => g.stop()))
    await memory.shutdown()
  })

  if (config.dashboard.enabled) {
    await startDashboard(config.dashboard.port, dispatcher)
  }

  if (config.gateways.feishu.enabled) {
    const { appId, appSecret, encryptKey, verificationToken } = config.gateways.feishu
    if (!appId || !appSecret) throw new Error('飞书网关缺少 appId / appSecret')
    const feishu = new FeishuGateway({ appId, appSecret, encryptKey, verificationToken })
    await feishu.start(dispatcher)
    gateways.push(feishu)
    logger.info('飞书网关已启动')
  }

  registerShutdownHandlers(dispatcher)

  logger.info('FriClaw ready')
}

main().catch((err) => {
  logger.error({ err }, 'Fatal startup error')
  process.exit(1)
})
```

- [ ] **Step 2: Commit**

```bash
cd /Users/chen/workspace/ai/friclaw && git add src/index.ts && git commit -m "feat(gateway): wire FeishuGateway into main entry with conditional startup"
```

---

### Task 5: 全量测试验证

- [ ] **Step 1: 运行全量测试**

```bash
cd /Users/chen/workspace/ai/friclaw && bun test tests/unit/ 2>&1 | tail -10
```

Expected: all pass, 0 fail

- [ ] **Step 2: 类型检查**

```bash
cd /Users/chen/workspace/ai/friclaw && bun run typecheck 2>&1 | tail -10
```

Expected: no errors

- [ ] **Step 3: Push**

```bash
cd /Users/chen/workspace/ai/friclaw && git push origin main
```

---

## 设计说明

**群聊 @mention 过滤:** lark 事件中 `content.mentions` 数组，机器人自身的 key 固定为 `@_user_1`。无 mention 则 `parseMessage` 返回 `null`，事件静默丢弃。

**话题群路由:** `message.root_id` 非空时，`chatId` 拼接为 `chatId:rootId`。Dispatcher 以此为 lane key，不同话题天然隔离到不同 session，无需额外逻辑。

**命令识别:** 文本以 `/` 开头即视为 command，`type` 字段设为 `'command'`，Dispatcher 已有命令短路处理逻辑。

**流式卡片 (stub):** spec 9.3 的流式卡片更新为未来工作。本期 `send()` 直接发送 `msg_type: text`，接口签名保持兼容，后续替换实现不影响调用方。

**测试策略:** `mock.module('@larksuiteoapi/node-sdk', ...)` 在模块加载前替换整个 SDK。通过捕获 `EventDispatcher.register()` 注册的 handler，测试可直接调用 `registeredHandler(event)` 触发解析逻辑，完全无网络依赖。
