# 17 消息路由器 (Dispatcher)

## 目标

作为网关层与会话层之间的中枢，将各平台网关收到的标准化消息路由到对应会话的 Lane Queue，实现平台解耦。

## 核心概念

```
飞书网关  ──┐
            ├──→  Dispatcher  ──→  SessionManager.getOrCreate()
企业微信  ──┘                  └──→  session.laneQueue.enqueue(task)
Dashboard ──┘
```

Dispatcher 不持有业务逻辑，只做三件事：
1. 接收标准化 `Message`
2. 通过 `SessionManager` 获取或创建会话
3. 将处理任务投入该会话的 `LaneQueue`

## 子任务

### 17.1 Dispatcher 实现

```typescript
// src/dispatcher.ts
export class Dispatcher {
  constructor(
    private sessionManager: SessionManager,
    private agent: ClaudeCodeAgent,
    private laneQueues: Map<string, LaneQueue>,
  ) {}

  async dispatch(message: Message): Promise<void> {
    const session = this.sessionManager.getOrCreate(
      message.platform,
      message.chatId,
      message.userId,
    )

    // 每个会话独立的 LaneQueue，保证会话内串行
    if (!this.laneQueues.has(session.id)) {
      this.laneQueues.set(session.id, new LaneQueue())
    }
    const queue = this.laneQueues.get(session.id)!

    await queue.enqueue(() => this.agent.handle(session, message))
  }
}
```

### 17.2 命令消息预处理

在投入队列前识别系统命令，短路处理：

```typescript
private async preprocess(message: Message): Promise<boolean> {
  if (message.type !== 'command') return false

  switch (message.content) {
    case '/clear':
      await this.sessionManager.clear(message.chatId)
      return true
    case '/status':
      // 直接回复，不走 Agent
      return true
  }
  return false
}
```

### 17.3 与主入口集成

```typescript
// src/index.ts
const laneQueues = new Map<string, LaneQueue>()
const dispatcher = new Dispatcher(sessionManager, agent, laneQueues)

feishuGateway.onMessage(msg => dispatcher.dispatch(msg))
wecomGateway.onMessage(msg => dispatcher.dispatch(msg))
dashboardServer.onMessage(msg => dispatcher.dispatch(msg))
```

## 验收标准

- 同一会话的并发消息严格串行执行
- 不同会话的消息完全并行，互不阻塞
- `/clear` 等命令在 Dispatcher 层短路，不进入 Agent
