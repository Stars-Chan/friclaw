# FriClaw 网关层模块设计

> 基于 NeoClaw 网关架构，为 FriClaw 设计的详细网关层模块文档
>
> **版本**: 1.0.0
> **参考**: NeoClaw Gateway Implementation
> **日期**: 2026-03-13

---

## 📋 目录

- [1. 模块概述](#1-模块概述)
- [2. 核心接口设计](#2-核心接口设计)
- [3. 飞书网关实现](#3-飞书网关实现)
- [4. 企业微信网关实现](#4-企业微信网关实现)
- [5. Slack 网关实现（新增）](#5-slack-网关实现新增)
- [6. 通用组件](#6-通用组件)
- [7. 错误处理与重试](#7-错误处理与重试)
- [8. 流式响应设计](#8-流式响应设计)
- [9. 消息去重与防抖](#9-消息去重与防抖)

---

## 1. 模块概述

### 1.1 设计目标

网关层负责将外部消息平台（飞书、企业微信、Slack 等）与 FriClaw 核心系统连接起来：

- **平台适配**: 处理不同平台的协议差异
- **消息解析**: 将平台特定消息转换为统一的 `InboundMessage`
- **响应渲染**: 将统一响应转换回平台特定格式
- **连接管理**: 维护与平台的 WebSocket/HTTP 连接
- **流式输出**: 支持实时推送 AI 生成的内容

### 1.2 架构图

```
┌─────────────────────────────────────────────────────────────────────────┐
│                      FriClaw 网关层架构                            │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                   │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │   飞书网关   │  │  企业微信网关  │  │  Slack 网关   │      │
│  │ FeishuGateway │  │ WeworkGateway │  │ SlackGateway │      │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘      │
│         │                    │                     │                │
│         └────────────────────┼─────────────────────┘                │
│                              ▼                                  │
│                    ┌──────────────────┐                      │
│                    │ Gateway Interface│                      │
│                    │  (抽象层)      │                      │
│                    └────────┬─────────┘                      │
│                             │                                 │
│                             ▼                                 │
│                   ┌──────────────────┐                     │
│                   │   Dispatcher    │                     │
│                   └──────────────────┘                     │
│                                                             │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 2. 核心接口设计

### 2.1 Gateway 接口

```typescript
/**
 * Gateway — 统一的消息平台适配器接口
 *
 * 职责：
 * - 监听入站消息
 * - 发送回复到原始会话
 * - 处理平台特定的协议细节（格式化、去重、防抖等）
 * - 支持流式响应
 */
export interface Gateway {
  /**
   * 网关类型的短标识符（如 "feishu"）
   * 跨重启必须保持稳定
   */
  readonly kind: string;

  /**
   * 开始监听消息。仅在 stop() 被调用后 resolve
   * handler 会在每次收到消息时被调用
   */
  start(handler: MessageHandler): Promise<void>;

  /**
   * 优雅地停止监听
   */
  stop(): Promise<void>;

  /**
   * 主动向会话发送消息（如重启通知）
   * 与 reply() 不同，这不会绑定到入站消息
   */
  send(chatId: string, response: RunResponse): Promise<void>;
}
```

### 2.2 入站消息类型

```typescript
/**
 * InboundMessage — 统一的入站消息格式
 *
 * 负责将平台特定消息转换为 FriClaw 内部格式
 */
export interface InboundMessage {
  /** 平台特定的唯一消息 ID（用于去重） */
  id: string;

  /** 消息的文本内容 */
  text: string;

  /** 聊天室/会话标识符 */
  chatId: string;

  /**
   * 对于话题聊天，根消息 ID
   * Dispatcher 使用此 ID 创建隔离的会话
   */
  threadRootId?: string;

  /** 作者的平台用户 ID */
  authorId?: string;

  /** 作者的显示名称（尽力而为） */
  authorName?: string;

  /** 产生此消息的网关类型（匹配 Gateway.kind） */
  gatewayKind: string;

  /** 二进制附件（图片、文件等） */
  attachments?: Attachment[];

  /** 平台特定的元数据 */
  meta?: Record<string, unknown>;

  /** 聊天类型：'private' 用于直接消息，'group' 用于群聊 */
  chatType?: 'private' | 'group';
}

/**
 * Attachment — 二进制附件
 */
export interface Attachment {
  /** 原始二进制内容 */
  buffer: Buffer;

  /**
   * 从源平台推断的媒体类别
   * （如 'image', 'file', 'audio', 'video', 'sticker'）
   */
  mediaType: string;

  /** 原始文件名（如果可用） */
  fileName?: string;
}
```

### 2.3 处理器类型

```typescript
/**
 * RunResponse — AI 生成的响应
 */
export interface RunResponse {
  text: string;
  thinking?: string | null;
  sessionId?: string | null;
  costUsd?: number | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  elapsedMs?: number | null;
  model?: string | null;
}

/**
 * AgentStreamEvent — 流式响应事件
 */
export type AgentStreamEvent =
  | { type: 'thinking_delta'; text: string }
  | { type: 'tool_use'; name: string; input: unknown }
  | { type: 'text_delta'; text: string }
  | { type: 'ask_questions'; questions: AskQuestion[]; conversationId: string }
  | { type: 'done'; response: RunResponse };

/**
 * ReplyFn — 发送回复到此消息来源的会话
 *
 * 由 Gateway 创建，已绑定协议上下文（chatId, replyToMessageId 等）
 */
export type ReplyFn = (response: RunResponse) => Promise<void>;

/**
 * StreamHandler — ReplyFn 的流式变体
 *
 * 接收 agent 流事件的异步可迭代对象，并渐进式渲染它们
 * （如通过飞书流式卡片）。Gateway 使用协议上下文创建此处理器。
 */
export type StreamHandler = (stream: AsyncIterable<AgentStreamEvent>) => Promise<void>;

/**
 * MessageHandler — Gateway 为每个入站消息调用的处理器
 *
 * 处理器负责分发消息并必须调用 reply()（或提供 streamHandler 时调用 streamHandler）
 * 并返回结果。
 */
export type MessageHandler = (
  msg: InboundMessage,
  reply: ReplyFn,
  streamHandler?: StreamHandler
) => Promise<void>;
```

---

## 3. 飞书网关实现

### 3.1 配置接口

```typescript
export interface FeishuConfig {
  appId: string;
  appSecret: string;
  verificationToken?: string;
  encryptKey?: string;
  /** "feishu"（默认）、"lark" 或自定义基础 URL */
  domain?: string;
  /** bot 应该在不被 @提及时回复的聊天 ID 列表 */
  groupAutoReply?: string[];
}
```

### 3.2 类设计

```typescript
/**
 * FeishuGateway — 飞书/Lark 消息网关适配器
 *
 * 通过 WebSocket 连接到飞书，解析入站消息，
 * 并以交互卡片形式传递响应。
 *
 * 此处处理的协议级关注点：
 * - WebSocket 生命周期
 * - 消息去重
 * - 反应表情符号（处理时为 ⏳，完成后移除）
 * - 回复消息线程
 * - 错误回传给用户
 * - 通过飞书 cardkit API 流式更新卡片（JSON 2.0）
 */
export class FeishuGateway implements Gateway {
  readonly kind = 'feishu';

  private _stopped = false;
  private _handler: MessageHandler | null = null;
  private _config: FeishuConfig;

  constructor(private readonly _config: FeishuConfig) {}

  async start(handler: MessageHandler): Promise<void> {
    if (!this._config.appId || !this._config.appSecret) {
      throw new Error('Feishu gateway: appId and appSecret are required');
    }
    this._handler = handler;
    this._startWebSocket();

    // start() 必须在 stop() 被调用前一直 resolve
    return new Promise<void>(() => {});
  }

  async stop(): Promise<void> {
    this._stopped = true;
    this._handler = null;
  }

  async send(chatId: string, response: RunResponse): Promise<void> {
    const client = this._httpClient();
    const stats = formatStats(response);
    await sendCard(
      client,
      chatId,
      buildCard({ text: response.text, thinking: response.thinking, stats })
    );
  }

  private _startWebSocket(): void {
    // 实现细节...
  }
}
```

### 3.3 流式卡片设计

飞书使用 JSON 2.0 卡片协议实现流式响应：

```
┌─────────────────────────────────────────────────────────────┐
│  [🤖 Working on it (N steps)]           │
│  ┌─────────────────────────────────────────────┐   │
│  │ ⚙️ Read file: src/config.ts     │   │
│  └─────────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────────┐   │
│  │ 🤖 Thinking...                    │   │
│  └─────────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────────┐   │
│  │ 🤖 Processing...                   │   │
│  └─────────────────────────────────────────────┘   │
│                                                     │
│  [AI Response Text...]                            │
│                                                     │
│  *model · 3.2s · 1.2K in · 2.3K out*   │
└─────────────────────────────────────────────────────────────┘
```

### 3.4 事件处理

| 事件类型 | 处理方式 |
|---------|---------|
| `im.message.receive_v1` | 解析消息，转发给 Dispatcher |
| `im.message.message_read_v1` | 忽略 |
| `im.chat.member.bot.added_v1` | 记录日志 |
| `im.chat.member.bot.deleted_v1` | 记录日志 |
| `card.action.trigger` | 处理交互表单提交（问题回答） |

---

## 4. 企业微信网关实现

### 4.1 配置接口

```typescript
export interface WeworkConfig {
  /** Bot ID - 企业微信智能机器人 ID */
  botId: string;
  /** Secret - 企业微信智能机器人密钥 */
  secret: string;
  /** WebSocket URL（可选，默认 wss://openws.work.weixin.qq.com） */
  websocketUrl?: string;
  /** 自动回复的群聊 ID 列表 */
  groupAutoReply?: string[];
}
```

### 4.2 WebSocket 连接协议

```typescript
/**
 * 订阅请求
 */
interface WeComSubscribe {
  cmd: 'aibot_subscribe';
  headers: {
    req_id: string;
  };
  body: {
    bot_id: string;
    secret: string;
  };
}

/**
 * 订阅响应
 */
interface WeComSubscribeResponse {
  errcode: number;
  errmsg: string;
  headers: {
    req_id: string;
  };
}

/**
 * WebSocket 消息
 */
interface WeComMessage {
  msgtype: 'text' | 'image' | 'file';
  text?: { content: string };
  image?: { media_id: string };
  from_user: string;  // 私聊
  chat_id?: string;  // 群聊
  timestamp: number;
  req_id: string;
}
```

### 4.3 防抖与消息合并

企业微信网关实现消息缓冲机制，合并短时间内连续发送的消息：

```typescript
/**
 * 消息缓冲区（用于防抖）
 */
interface MessageBuffer {
  messages: MessageCallback[];
  timestamp: number;
  timer: ReturnType<typeof setTimeout>;
}

class WeworkWsGateway implements Gateway {
  private readonly DEBOUNCE_MS = 2000;
  private readonly messageBuffers = new Map<string, MessageBuffer>();

  private _handleInboundMessage(wsMsg: MessageCallback): Promise<void> {
    const streamKey = this._getStreamKey(wsMsg);
    const isCommand = msgType === 'text' && wsMsg.content.trim().startsWith('/');

    // 命令绕过防抖 - 立即处理
    if (isCommand) {
      this._processMessage(wsMsg, streamKey);
    } else {
      // 防抖：缓冲非命令消息
      const existing = this.messageBuffers.get(streamKey);
      if (existing) {
        // 合并这条消息
        existing.messages.push(wsMsg);
        clearTimeout(existing.timer);
        existing.timer = setTimeout(
          () => this._flushMessageBuffer(streamKey),
          this.DEBOUNCE_MS
        );
      } else {
        // 第一条消息 - 启动新的缓冲
        const buffer: MessageBuffer = {
          messages: [wsMsg],
          timestamp: Date.now(),
          timer: setTimeout(() => this._flushMessageBuffer(streamKey), this.DEBOUNCE_MS),
        };
        this.messageBuffers.set(streamKey, buffer);
      }
    }
  }

  private _flushMessageBuffer(streamKey: string): void {
    const buffer = this.messageBuffers.get(streamKey);
    if (!buffer) return;

    this.messageBuffers.delete(streamKey);

    // 合并所有缓冲消息的内容
    const mergedContent = buffer.messages
      .map((m) => m.content || '')
      .filter(Boolean)
      .join('\n');

    // 处理合并的消息
    this._processMessage({ ...buffer.messages[0], content: mergedContent }, streamKey);
  }
}
```

### 4.4 流式响应实现

企业微信不支持飞书那样的卡片 API，使用分块文本更新：

```typescript
private async _streamingReply(
  stream: AsyncIterable<AgentStreamEvent>
): Promise<void> {
  let accumulatedThinking = '';
  let accumulatedText = '';

  for await (const evt of stream) {
    if (evt.type === 'thinking_delta') {
      accumulatedThinking += evt.text;
      // 发送流式更新，显示思考内容
      this._client.sendStream({
        reqId: wsMsg.reqId,
        streamId,
        content: `💭 思考过程：\n\n${accumulatedThinking}`,
        finish: false,
      });
    } else if (evt.type === 'text_delta') {
      accumulatedText += evt.text;
      // 发送流式更新，显示当前文本
      this._client.sendStream({
        reqId: wsMsg.reqId,
        streamId,
        content: accumulatedText,
        finish: false,
      });
    } else if (evt.type === 'done') {
      const response = evt.response;
      const stats = formatStats(response);

      // 构建最终消息内容
      let finalMessage = '';
      if (accumulatedThinking) {
        finalMessage += `💭 思考过程：\n\n${accumulatedThinking}\n\n---\n\n`;
      }
      finalMessage += accumulatedText;
      if (stats) {
        finalMessage += `\n\n---\n\n*${stats}*`;
      }

      this._client.sendStream({
        reqId: wsMsg.reqId,
        streamId,
        content: finalMessage,
        finish: true,
      });
    }
  }
}
```

---

## 5. Slack 网关实现（新增）

### 5.1 配置接口

```typescript
export interface SlackConfig {
  botToken: string;
  signingSecret?: string;
  appLevelToken?: string;
  /** 自动回复的频道 ID 列表 */
  autoReplyChannels?: string[];
}
```

### 5.2 Slack RTM API

```typescript
/**
 * Slack Gateway — Slack 消息网关适配器
 *
 * 使用 Slack Real Time Messaging (RTM) API 或 Socket Mode
 * 支持消息解析、响应、附件、线程等
 */
export class SlackGateway implements Gateway {
  readonly kind = 'slack';

  private _rtmClient?: RTMClient;
  private _webClient?: WebClient;

  async start(handler: MessageHandler): Promise<void> {
    const client = new RTMClient({
      token: this._config.botToken,
    });

    this._rtmClient = client;
    this._webClient = new WebClient(this._config.botToken);

    client.on('message', async (msg) => {
      const inbound = this._parseMessage(msg);
      if (inbound) {
        await handler(inbound, this._reply.bind(this, msg));
      }
    });

    await client.start();
  }

  private _parseMessage(msg: SlackMessage): InboundMessage | null {
    // 解析 Slack 消息为统一格式
  }

  private async _reply(originalMsg: SlackMessage, response: RunResponse): Promise<void> {
    await this._webClient!.chat.postMessage({
      channel: originalMsg.channel,
      text: response.text,
      thread_ts: originalMsg.thread_ts,
    });
  }
}
```

---

## 6. 通用组件

### 6.1 消息去重

```typescript
/**
 * DeduplicationManager — 消息去重管理器
 *
 * 防止重复处理相同消息（如 WebSocket 重连、事件重复发送等）
 */
export class DeduplicationManager {
  private readonly seenMsgIds = new Set<string>();
  private readonly MAX_SEEN_MSG_IDS = 10000;

  hasSeen(msgId: string): boolean {
    if (this.seenMsgIds.has(msgId)) {
      return true;
    }
    this.seenMsgIds.add(msgId);

    // 防止缓存无限增长
    if (this.seenMsgIds.size > this.MAX_SEEN_MSG_IDS) {
      const first = this.seenMsgIds.values().next().value;
      if (first) this.seenMsgIds.delete(first);
    }
    return false;
  }

  clear(): void {
    this.seenMsgIds.clear();
  }
}
```

### 6.2 响应格式化

```typescript
/**
 * formatStats — 格式化响应统计信息
 */
function formatStats(response: RunResponse): string | null {
  const parts: string[] = [];
  if (response.model) parts.push(response.model);
  if (response.elapsedMs != null) parts.push(`${(response.elapsedMs / 1000).toFixed(1)}s`);
  if (response.inputTokens != null) parts.push(`${response.inputTokens} in`);
  if (response.outputTokens != null) parts.push(`${response.outputTokens} out`);
  if (response.costUsd != null) parts.push(`$${response.costUsd.toFixed(4)}`);
  return parts.length > 0 ? parts.join(' · ') : null;
}
```

---

## 7. 错误处理与重试

### 7.1 错误处理策略

| 错误类型 | 处理方式 |
|---------|---------|
| 网络连接失败 | 指数退避重试（1s, 2s, 4s, 8s, 16s） |
| 消息发送失败 | 记录日志，尝试重试最多 3 次 |
| 解析错误 | 记录错误详情，跳过该消息 |
| 认证失败 | 停止网关，通知管理员 |

### 7.2 重试实现

```typescript
/**
 * RetryHelper — 重试辅助类
 */
export class RetryHelper {
  static async retry<T>(
    fn: () => Promise<T>,
    options: {
      maxAttempts?: number;
      baseDelay?: number;
      maxDelay?: number;
      shouldRetry?: (error: Error) => boolean;
    } = {}
  ): Promise<T> {
    const {
      maxAttempts = 3,
      baseDelay = 1000,
      maxDelay = 30000,
      shouldRetry = () => true,
    } = options;

    let lastError: Error | undefined;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await fn();
      } catch (err) {
        lastError = err as Error;
        if (!shouldRetry(err) || attempt === maxAttempts) {
          throw err;
        }

        const delay = Math.min(baseDelay * 2 ** (attempt - 1), maxDelay);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }

    throw lastError!;
  }
}
```

---

## 8. 流式响应设计

### 8.1 流式事件处理

```typescript
interface StreamingGateway {
  /**
   * 处理流式响应
   * @param stream - Agent 流事件
   * @param context - 渲染上下文
   */
  async handleStream(
    stream: AsyncIterable<AgentStreamEvent>,
    context: StreamingContext
  ): Promise<void>;
}

interface StreamingContext {
  chatId: string;
  replyToMessageId?: string;
  cardId?: string;        // 飞书卡片 ID
  streamId?: string;       // 企业微信流 ID
  lastStepId?: string;    // 最后插入的步骤 ID
}
```

### 8.2 渲染状态机

```
┌─────────────────────────────────────────────────────────────┐
│                  流式渲染状态机                    │
├─────────────────────────────────────────────────────────────┤
│                                                           │
│  ┌─────────┐    ┌─────────┐    ┌─────────┐   │
│  │ 初始   │ -> │  卡片中  │ -> │  更新中  │   │
│  │ Idle    │    │ Card    │    │ Updating │   │
│  └────┬────┘    └────┬────┘    └────┬────┘   │
│       │              │                 │            │         │
│       ▼              ▼                 ▼            ▼         │
│  ┌─────────┐    ┌─────────┐    ┌─────────┐   │
│  │ 发送中  │ -> │  完成    │ -> │  已完成   │   │
│  │ Sending │    │ Done     │    │ Finished │   │
│  └─────────┘    └─────────┘    └─────────┘   │
│                                                           │
└─────────────────────────────────────────────────────────────┘
```

---

## 9. 消息去重与防抖

### 9.1 去重策略

1. **基于消息 ID 去重**
   - 使用平台提供的唯一消息 ID
   - 维护最近 10000 条消息的缓存
   - 超过期的自动删除

2. **基于时间窗口去重**
   - 相同内容在短时间内的消息视为重复
   - 默认时间窗口 5 秒

### 9.2 防抖策略

| 场景 | 策略 | 延迟 |
|------|------|------|
| 普通消息 | 合并缓冲 | 2 秒 |
| `/` 命令 | 立即处理 | 0 秒 |
| 图片/文件 | 立即处理 | 0 秒 |

### 9.3 实现示例

```typescript
export class MessageBuffer {
  private readonly buffer = new Map<string, MessageQueue>();
  private readonly COMMAND_PREFIX = '/';

  add(message: InboundMessage): void {
    const key = this._getBufferKey(message);

    // 命令不缓冲
    if (message.text.trim().startsWith(this.COMMAND_PREFIX)) {
      this._flush(key);
      return;
    }

    // 添加到缓冲
    const existing = this.buffer.get(key);
    if (existing) {
      existing.messages.push(message);
      // 重置计时器
      clearTimeout(existing.timer);
      existing.timer = setTimeout(() => this._flush(key), this.DEBOUNCE_MS);
    } else {
      this.buffer.set(key, {
        messages: [message],
        timestamp: Date.now(),
        timer: setTimeout(() => this._flush(key), this.DEBOUNCE_MS),
      });
    }
  }

  private _flush(key: string): void {
    const queue = this.buffer.get(key);
    if (!queue) return;

    this.buffer.delete(key);

    // 合并消息内容
    const merged = this._mergeMessages(queue.messages);
    // 触发处理回调
    queue.callback(merged);
  }

  private _mergeMessages(messages: InboundMessage[]): InboundMessage {
    const primary = messages[0];
    const mergedContent = messages
      .map((m) => m.text)
      .filter(Boolean)
      .join('\n');

    return {
      ...primary,
      text: mergedContent,
    };
  }
}
```

---

## 附录

### A. 网关事件类型

```typescript
/**
 * GatewayEvent — 网关内部事件
 */
export type GatewayEvent =
  | { type: 'connected'; gateway: string }
  | { type: 'disconnected'; gateway: string; reason?: string }
  | { type: 'message_received'; gateway: string; messageId: string }
  | { type: 'message_sent'; gateway: string; messageId: string }
  | { type: 'error'; gateway: string; error: Error };
```

### B. 配置验证

```typescript
/**
 * validateGatewayConfig — 验证网关配置
 */
export function validateGatewayConfig(
  kind: string,
  config: Record<string, unknown>
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  switch (kind) {
    case 'feishu':
      if (!config.appId) errors.push('appId is required');
      if (!config.appSecret) errors.push('appSecret is required');
      break;

    case 'wework':
      if (!config.botId) errors.push('botId is required');
      if (!config.secret) errors.push('secret is required');
      break;

    case 'slack':
      if (!config.botToken) errors.push('botToken is required');
      break;
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
```

---

**文档版本**: 1.0.0
**最后更新**: 2026-03-13
