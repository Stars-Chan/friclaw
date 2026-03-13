# FriClaw 调度器模块设计

> 基于 NeoClaw Dispatcher 架构，为 FriClaw 设计的详细调度器模块文档
>
> **版本**: 1.0.0
> **参考**: NeoClaw Dispatcher Implementation
> **日期**: 2026-03-13

---

## 📋 目录

- [1. 模块概述](#1-模块概述)
- [2. 核心类设计](#2-核心类设计)
- [3. 会话管理](#3-会话管理)
- [4. 消息队列与并发控制](#4-消息队列与并发控制)
- [5. 斜杠命令处理](#5-斜杠命令处理)
- [6. Agent 集成](#6-agent-集成)
- [7. 流式响应处理](#7-流式响应处理)
- [8. 会话历史记录](#8-会话历史记录)
- [9. 重启机制](#9-重启机制)

---

## 1. 模块概述

### 1.1 设计目标

调度器（Dispatcher）是 FriClaw 的核心组件，负责：

- **Agent 注册**: 管理可用的 AI Agent
- **Gateway 注册**: 管理消息网关
- **消息路由**: 将入站消息路由到合适的 Agent
- **会话隔离**: 为每个对话提供独立的上下文
- **并发控制**: 防止同一会话的并发消息处理
- **命令处理**: 处理内置的 `/` 命令

### 1.2 架构图

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    FriClaw 调度器架构                            │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                   │
│  ┌──────────────┐  ┌──────────────┐                      │
│  │   Gateway A  │  │   Gateway B  │  ...                   │
│  │  (feishu)  │  │  (wework)   │                        │
│  └──────┬───────┘  └──────┬───────┘                        │
│         │                    │                                    │
│         └─────────┬──────────┘                                  │
│                   ▼                                            │
│         ┌──────────────────┐                                    │
│         │   Dispatcher    │                                    │
│         └────────┬─────────┘                                    │
│                  │                                             │
│    ┌─────────────┼─────────────┐                             │
│    ▼             ▼             ▼                             │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐              │
│  │ Agent 1 │  │ Agent 2 │  │ Default  │              │
│  │  (claude)│  │  (glm)   │  │  Agent   │              │
│  └─────────┘  └─────────┘  └─────────┘              │
│                                                           │
│  ┌───────────────────────────────────────────────┐              │
│  │        Per-Session Queues               │              │
│  │  (Mutex for concurrency control)          │              │
│  └───────────────────────────────────────────────┘              │
│                                                           │
│  ┌───────────────────────────────────────────────┐              │
│  │    Conversation History                │              │
│  │    (per session .neoclaw/.history)    │              │
│  └───────────────────────────────────────────────┘              │
│                                                           │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 2. 核心类设计

### 2.1 Dispatcher 类

```typescript
/**
 * Dispatcher — 路由入站消息到活动 Agent
 *
 * 职责：
 * - 注册 Gateway 和 Agent
 * - 启动/停止所有网关
 * - 按会话串行化消息处理（防止竞态条件）
 * - 管理会话会话（多轮上下文的稳定会话 ID）
 * - 处理内置斜杠命令（/clear, /status, /restart, /help）
 */
export class Dispatcher {
  private _agents = new Map<string, Agent>();
  private _defaultAgentKind = 'claude_code';
  private _gateways: Gateway[] = [];

  /** 每会话串行队列，防止并发处理 */
  private _queues = new Map<string, Mutex>();

  private _workspacesDir: string | null = null;
  private _memoryManager: MemoryManager | null = null;
  private _onRestart: RestartCallback | null = null;

  // ── 注册方法 ──────────────────────────────────

  addAgent(agent: Agent): void {
    this._agents.set(agent.kind, agent);
    log.info(`Agent registered: "${agent.kind}"`);
  }

  addGateway(gateway: Gateway): void {
    this._gateways.push(gateway);
    log.info(`Gateway registered: "${gateway.kind}"`);
  }

  setDefaultAgent(kind: string): void {
    this._defaultAgentKind = kind;
  }

  setWorkspacesDir(dir: string): void;

  /** 注入内存管理器用于 /clear 和 /new 的会话摘要 */
  setMemoryManager(mgr: MemoryManager): void;

  /** 注册 /restart 命令被触发时的回调 */
  onRestart(cb: RestartCallback): void;

  // ── 生命周期方法 ────────────────────────────────

  async start(): Promise<void>;
  async stop(): Promise<void>;

  /** 主动发送消息到网关（如重启通知） */
  async sendTo(gatewayKind: string, chatId: string, response: RunResponse): Promise<void>;

  // ── 处理方法 ─────────────────────────────────

  readonly handle: MessageHandler = async (
    msg: InboundMessage,
    reply: ReplyFn,
    streamHandler?: StreamHandler
  ): Promise<void>;
}
```

### 2.2 重启回调类型

```typescript
/**
 * /restart 命令被触发时调用的回调
 */
export type RestartCallback = (info: {
  chatId: string;
  gatewayKind: string;
}) => void;
```

---

## 3. 会话管理

### 3.1 会话键生成

```typescript
/**
 * 会话键生成策略
 *
 * 每个对话需要一个稳定的标识符，用于：
 * - 上下文隔离
 * - 历史记录存储
 * - 内存管理
 */
class Dispatcher {
  /**
   * 生成会话键
   *
   * 规则：
   * - 话题消息获取隔离会话（避免污染主聊天上下文）
   * - 普通消息使用 chatId 作为会话键
   */
  private _conversationKey(msg: InboundMessage): string {
    // Thread messages get an isolated session
    if (msg.threadRootId) {
      return `${msg.chatId}_thread_${msg.threadRootId}`;
    }
    return msg.chatId;
  }
}
```

### 3.2 会话隔离策略

| 场景 | 会话键格式 | 说明 |
|------|------------|------|
| 私聊 | `oc_xxxxxx` | 直接使用用户的 open_id |
| 群聊 | `oc_xxxxxx_yyyyyyyy` | 使用群聊 ID |
| 话题消息 | `oc_xxxxxx_thread_zzzzz` | 为话题创建独立会话 |

---

## 4. 消息队列与并发控制

### 4.1 Mutex 实现

```typescript
/**
 * Mutex — 互斥锁实现
 *
 * 确保同一会话的消息串行处理，避免竞态条件
 */
export class Mutex {
  private _queue: Array<() => void> = [];
  private _locked = false;

  /**
   * 获取锁
   * 如果锁已被占用，将回调排队
   */
  async acquire(): Promise<void> {
    if (!this._locked) {
      this._locked = true;
      return;
    }

    return new Promise((resolve) => {
      this._queue.push(resolve);
    });
  }

  /**
   * 释放锁
   * 触发队列中的下一个回调
   */
  release(): void {
    if (!this._locked) return;

    this._locked = false;

    const next = this._queue.shift();
    if (next) {
      this._locked = true;
      next();
    }
  }

  /**
   * 检查锁是否被占用
   */
  isLocked(): boolean {
    return this._locked;
  }
}
```

### 4.2 队列管理

```typescript
class Dispatcher {
  /**
   * 获取或创建会话队列
   *
   * 每个会话有独立的 Mutex，防止并发处理
   */
  private _getQueue(key: string): Mutex {
    let q = this._queues.get(key);
    if (!q) {
      q = new Mutex();
      this._queues.set(key, q);
    }
    return q;
  }
}
```

### 4.3 并发控制流程

```
用户消息 1 ─┐
              ├── [获取锁] ─── [处理中] ─── [释放锁] ──► 回复 1
              │
用户消息 2 ─┤
              └─ [排队等待] ─────────────────────────── [获取锁] ──► 处理 2
                                                               │
用户消息 3 ────────────────────────────────────────────────────────► 回复 3
```

---

## 5. 斜杠命令处理

### 5.1 支持的命令

| 命令 | 功能 | 参数 |
|------|------|------|
| `/clear` 或 `/new` | 清除当前会话上下文 | 无 |
| `/status` | 显示当前状态 | 无 |
| `/restart` | 重启 FriClaw 守护进程 | 无 |
| `/help` | 显示帮助信息 | 无 |

### 5.2 命令解析

```typescript
class Dispatcher {
  private static readonly COMMANDS = new Set([
    'clear',
    'new',
    'status',
    'restart',
    'help'
  ]);

  /**
   * 尝试解析命令
   *
   * 格式：`/command [args]`
   */
  private _tryParseCommand(text: string): string | null {
    const trimmed = text.trim();
    if (!trimmed.startsWith('/')) return null;

    const end = trimmed.indexOf(' ');
    const name = (end === -1
      ? trimmed.slice(1)
      : trimmed.slice(1, end)
    ).toLowerCase();

    return Dispatcher.COMMANDS.has(name) ? name : null;
  }
}
```

### 5.3 命令执行

```typescript
class Dispatcher {
  private async _execCommand(
    name: string,
    msg: InboundMessage,
    key: string
  ): Promise<RunResponse> {
    const isThread = key !== msg.chatId;

    switch (name) {
      case 'clear':
      case 'new': {
        // 清除前生成会话摘要（尽力而为，失败不阻塞）
        if (this._memoryManager && this._workspacesDir) {
          await this._memoryManager
            .summarizeSession(key, this._workspacesDir)
            .catch((err) => log.warn(`Failed to summarize session: ${err}`));
        }
        const agent = this._getAgent();
        await agent.clearConversation(key);
        return { text: 'Context cleared, ready for a new conversation.' };
      }

      case 'restart': {
        if (this._onRestart) {
          // 延迟一点以便 reply() 在重启前被调用
          setTimeout(
            () => this._onRestart!({ chatId: msg.chatId, gatewayKind: msg.gatewayKind }),
            5_000
          );
        }
        return { text: 'Restarting FriClaw, please wait...' };
      }

      case 'status': {
        const agents = [...this._agents.keys()].join(', ');
        const gateways = this._gateways.map((g) => g.kind).join(', ');
        const lines = [
          '**FriClaw Status**',
          `- Context: ${isThread ? 'Thread (isolated)' : 'Main chat'}`,
          `- Agents: ${agents}`,
          `- Gateways: ${gateways}`,
        ];
        return { text: lines.join('\n') };
      }

      case 'help': {
        const lines = [
          '**Available Commands**',
          '- `/clear` or `/new` — Start a fresh conversation',
          '- `/status` — Show current session and system info',
          '- `/restart` — Restart FriClaw daemon',
          '- `/help` — Show this help message',
        ];
        return { text: lines.join('\n') };
      }

      default:
        return { text: `Unknown command: /${name}` };
    }
  }
}
```

---

## 6. Agent 集成

### 6.1 Agent 获取

```typescript
class Dispatcher {
  /**
   * 获取默认 Agent
   */
  private _getAgent(): Agent {
    const agent = this._agents.get(this._defaultAgentKind);
    if (!agent) {
      const available = [...this._agents.keys()].join(', ');
      throw new Error(
        `Agent "${this._defaultAgentKind}" not registered. Available: ${available}`
      );
    }
    return agent;
  }
}
```

### 6.2 请求构建

```typescript
class Dispatcher {
  /**
   * 构建 Agent 请求
   */
  private _buildAgentRequest(msg: InboundMessage): RunRequest {
    return {
      text: msg.text,
      conversationId: this._conversationKey(msg),
      chatId: msg.chatId,
      gatewayKind: msg.gatewayKind,
      attachments: msg.attachments,
      extra: {
        chatType: msg.chatType,
      },
    };
  }
}
```

### 6.3 响应处理流程

```
┌─────────────────────────────────────────────────────────────┐
│              消息处理流程                           │
├─────────────────────────────────────────────────────────────┤
│                                                       │
│  ┌─────────┐    ┌─────────┐                     │
│  │ Inbound  │ -> │ Parse    │                     │
│  │ Message  │    │ Command  │                     │
│  └────┬────┘    └────┬────┘                     │
│       │               │                              │
│       ▼               ▼                              │
│  ┌─────────┐    ┌─────────┐                     │
│  │ Command  │    │ Normal   │                     │
│  │ Handler  │    │ Handler  │                     │
│  └────┬────┘    └────┬────┘                     │
│       │               │                              │
│       ▼               ▼                              │
│  ┌──────────────────────┐                         │
│  │ Agent Call        │                         │
│  │ (run or stream)  │                         │
│  └────────┬───────────┘                         │
│          │                                      │
│          ▼                                      │
│  ┌─────────┐    ┌─────────┐                   │
│  │ Reply   │    │ Stream  │                   │
│  │ (done)  │    │ (delta) │                   │
│  └─────────┘    └─────────┘                   │
│          │            │                           │
│          └────┬────┘                           │
│               ▼                                │
│     Gateway Send                               │
└─────────────────────────────────────────────────────┘
```

---

## 7. 流式响应处理

### 7.1 流式处理选择

```typescript
class Dispatcher {
  readonly handle: MessageHandler = async (
    msg: InboundMessage,
    reply: ReplyFn,
    streamHandler?: StreamHandler
  ): Promise<void> => {
    const key = this._conversationKey(msg);
    log.info(`Handling message for conversation key: ${key}`);

    const queue = this._getQueue(key);
    await queue.acquire();

    try {
      let responseText = '';

      // 斜杠命令总是非流式
      const command = this._tryParseCommand(msg.text);
      if (command) {
        log.info(`Executing command: ${command}`);
        const response = await this._execCommand(command, msg, key);
        responseText = response.text;
        await reply(response);
      } else {
        const agent = this._getAgent();
        const request: RunRequest = {
          text: msg.text,
          conversationId: key,
          chatId: msg.chatId,
          gatewayKind: msg.gatewayKind,
          attachments: msg.attachments,
          extra: { chatType: msg.chatType },
        };

        if (streamHandler && agent.stream) {
          // 流式路径：网关渐进式渲染内容
          const agentStream = agent.stream(request);

          async function* tracked(): AsyncGenerator<AgentStreamEvent> {
            for await (const event of agentStream) {
              if (event.type === 'done') {
                responseText = event.response.text;
              }
              yield event;
            }
          }

          await streamHandler(tracked());
        } else {
          // 非流式回退
          const response = await agent.run(request);
          responseText = response.text;
          await reply(response);
        }
      }

      log.info(`Response text: "${responseText}"`);
      this._appendHistory(key, 'user', msg.text);
      this._appendHistory(key, 'friclaw', responseText);
    } finally {
      queue.release();
    }
  };
}
```

### 7.2 流式事件追踪

```typescript
/**
 * AgentStreamTracker — 流式事件追踪器
 *
 * 确保在完成时捕获完整的响应文本
 */
export class AgentStreamTracker {
  private _responseText = '';

  /**
   * 追踪流式事件
   */
  track(event: AgentStreamEvent): void {
    switch (event.type) {
      case 'text_delta':
        this._responseText += event.text;
        break;

      case 'done':
        // 最终响应可能包含完整文本
        if (event.response.text) {
          this._responseText = event.response.text;
        }
        break;

      case 'thinking_delta':
      case 'tool_use':
        // 这些事件不影响最终响应文本
        break;

      case 'ask_questions':
        // 问题交互不影响响应文本
        break;
    }
  }

  /**
   * 获取最终的响应文本
   */
  getResponseText(): string {
    return this._responseText;
  }
}
```

---

## 8. 会话历史记录

### 8.1 历史存储结构

```
~/.friclaw/workspaces/
├── {conversation_id}/
│   ├── .friclaw/
│   │   └── .history/
│   │       ├── 2026-03-13.txt
│   │       ├── 2026-03-14.txt
│   │       └── ...
│   └── memory/
└── ...
```

### 8.2 历史记录格式

```
[user] Hello, can you help me?

[friclaw] Of course! I'm here to help you.

[user] What's the weather today?

[friclaw] I don't have access to real-time weather data, but you can check weather.com for the latest information.
```

### 8.3 历史写入实现

```typescript
class Dispatcher {
  /**
   * 追加历史记录
   */
  private _appendHistory(
    conversationKey: string,
    role: 'user' | 'friclaw',
    text: string
  ): void {
    if (!this._workspacesDir) return;

    const sanitized = conversationKey.replace(/:/g, '_');
    const historyDir = join(this._workspacesDir, sanitized, '.friclaw', '.history');

    try {
      if (!existsSync(historyDir)) {
        mkdirSync(historyDir, { recursive: true });
      }

      const date = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
      const filePath = join(historyDir, `${date}.txt`);
      appendFileSync(filePath, `[${role}] ${text}\n\n`, 'utf-8');
    } catch (err) {
      log.warn(`Failed to write conversation history: ${err}`);
    }
  }
}
```

---

## 9. 重启机制

### 9.1 重启通知流程

```
┌─────────────────────────────────────────────────────────────┐
│              重启通知流程                               │
├─────────────────────────────────────────────────────────────┤
│                                                       │
│  ┌─────────┐                                          │
│  │  用户    │                                          │
│  │ /restart │                                          │
│  └────┬────┘                                          │
│       │                                                │
│       ▼                                                │
│  ┌─────────┐    ┌──────────────────┐                │
│  │ /restart │ -> │ 保存重启上下文     │                │
│  │ Handler   │    │ (chatId, gateway) │                │
│  └─────────┘    └────────┬───────────┘                │
│                       │                              │
│                       ▼                              │
│               ┌─────────────┐                        │
│               │ 触发重启   │                        │
│               │ Fork 新进程 │                        │
│               └──────┬──────┘                        │
│                      │                               │
│                      ▼                               │
│              ┌─────────────┐                          │
│              │ 停止当前   │                          │
│              │ 进程       │                          │
│              └─────────────┘                          │
│                       │                               │
│                      ▼                               │
│              ┌─────────────┐                          │
│              │ 读取通知   │                          │
│              │ 发送完成消息│                          │
│              └─────────────┘                          │
└─────────────────────────────────────────────────────────────┘
```

### 9.2 通知持久化

```typescript
/**
 * 重启通知路径
 */
const RESTART_NOTIFY_PATH = join(FRICLAW_HOME, 'cache', 'restart-notify.json');

/**
 * RestartNotifier — 重启通知管理器
 */
export class RestartNotifier {
  /**
   * 保存重启通知
   */
  static save(info: { chatId: string; gatewayKind: string }): void {
    const dir = dirname(RESTART_NOTIFY_PATH);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(RESTART_NOTIFY_PATH, JSON.stringify(info));
  }

  /**
   * 读取重启通知
   */
  static load(): { chatId: string; gatewayKind: string } | null {
    if (!existsSync(RESTART_NOTIFY_PATH)) {
      return null;
    }

    try {
      return JSON.parse(readFileSync(RESTART_NOTIFY_PATH, 'utf-8'));
    } catch {
      return null;
    }
  }

  /**
   * 清除重启通知
   */
  static clear(): void {
    try {
      unlinkSync(RESTART_NOTIFY_PATH);
    } catch {
      // ignore
    }
  }
}
```

### 9.3 启动通知

```typescript
class Dispatcher {
  /**
   * 发送启动通知
   *
   * 重启后发送"重启完成"消息到原始会话
   */
  async sendStartupNotification(): Promise<void> {
    const info = RestartNotifier.load();
    if (!info) return;

    RestartNotifier.clear();

    const response = { text: 'FriClaw restarted successfully!' };
    const maxAttempts = 3;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        await this.sendTo(info.gatewayKind, info.chatId, response);
        return;
      } catch (err) {
        log.warn(`Startup notification attempt ${attempt}/${maxAttempts} failed: ${err}`);
        if (attempt < maxAttempts) {
          await new Promise((resolve) => setTimeout(resolve, 3000));
        }
      }
    }

    log.error('Startup notification failed after all attempts.');
  }
}
```

---

## 附录

### A. 日志接口

```typescript
/**
 * DispatcherLogger — 调度器日志接口
 */
export interface DispatcherLogger {
  debug(message: string): void;
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}
```

### B. 性能监控

```typescript
/**
 * DispatcherMetrics — 调度器性能指标
 */
export class DispatcherMetrics {
  private _messageCount = 0;
  private _commandCount = 0;
  private _errorCount = 0;
  private _queueWaitTimes = new Map<string, number[]>();

  /**
   * 记录消息处理
   */
  recordMessage(conversationKey: string, queueWaitTime: number): void {
    this._messageCount++;
    this._recordQueueWait(conversationKey, queueWaitTime);
  }

  /**
   * 记录命令执行
   */
  recordCommand(command: string): void {
    this._commandCount++;
  }

  /**
   * 记录错误
   */
  recordError(error: Error): void {
    this._errorCount++;
  }

  /**
   * 获取统计信息
   */
  getStats(): {
    messageCount: number;
    commandCount: number;
    errorCount: number;
    avgQueueWaitTime: number;
  } {
    const allWaits = [...this._queueWaitTimes.values()].flat();
    const avgWait = allWaits.length > 0
      ? allWaits.reduce((a, b) => a + b, 0) / allWaits.length
      : 0;

    return {
      messageCount: this._messageCount,
      commandCount: this._commandCount,
      errorCount: this._errorCount,
      avgQueueWaitTime: avgWait,
    };
  }
}
```

---

**文档版本**: 1.0.0
**最后更新**: 2026-03-13
