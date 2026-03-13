# 03. 网关层模块

> FriClaw 网关层详细实现文档
>
> **版本**: 1.0.0
> **作者**: Stars-Chan
> **日期**: 2026-03-13
> **状态**: 📋 待实现

---

## 1. 概述

### 1.1 模块职责

网关层负责与外部即时通讯平台对接，处理平台特定的消息格式、认证和事件分发。

**核心功能**:
- 多平台支持（飞书、企业微信、Slack）
- WebSocket 长连接管理
- 消息格式转换
- 事件订阅和处理
- 平台认证
- 消息发送

### 1.2 与其他模块的关系

```
网关层
    ↑
    ├──> 配置系统（获取配置）
    ├──> 日志系统（输出日志）
    ↑
    └──> 会话层（转发消息）
```

---

## 2. 架构设计

### 2.1 网关组件架构

```
┌─────────────────────────────────────────────────────────────┐
│                    网关层架构                            │
├─────────────────────────────────────────────────────────────┤
│                                                           │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐   │
│  │ 飞书网关     │  │ 企业微信网关  │  │ Slack网关  │   │
│  │ FeishuGW   │  │  WeComGW    │  │ SlackGW    │   │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘   │
│         │                 │                 │             │
│         └─────────────────┼─────────────────┘             │
│                           ▼                              │
│                  ┌───────────────┐                       │
│                  │  网关管理器     │                       │
│                  │ GatewayMgr    │                       │
│                  └───────┬───────┘                       │
│                          │                               │
│                          ▼                               │
│                  ┌───────────────┐                       │
│                  │  事件总线      │                       │
│                  │ Event Bus     │                       │
│                  └───────┬───────┘                       │
│                          │                               │
│                          ↓                               │
│                  ┌───────────────┐                       │
│                  │  会话管理器     │                       │
│                  │ SessionMgr    │                       │
│                  └───────────────┘                       │
│                                                           │
└─────────────────────────────────────────────────────────────┘
```

### 2.2 核心接口

```typescript
// 网关接口
interface IGateway {
  name: string;
  platform: string;

  // 连接管理
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  isConnected(): boolean;

  // 消息处理
  send(chatId: string, content: MessageContent): Promise<void>;
  onMessage(handler: MessageHandler): void;

  // 认证
  authenticate(): Promise<void>;

  // 元信息
  getPlatformInfo(): PlatformInfo;
}

// 消息处理器
type MessageHandler = (message: IncomingMessage) => void | Promise<void>;

// 内部消息
interface IncomingMessage {
  gateway: string;
  sessionId: string;

  // 发送者
  from: {
    userId: string;
    userName?: string;
    isBot: boolean;
  };

  // 接收者
  to: {
    chatId: string;
    chatType: 'private' | 'group' | 'topic';
  };

  // 消息内容
  type: MessageType;
  content: MessageContent;

  // 元数据
  timestamp: Date;
  messageId?: string;
  replyTo?: string;
}

// 消息类型
enum MessageType {
  TEXT = 'text',
  IMAGE = 'image',
  FILE = 'file',
  INTERACTIVE = 'interactive',
  COMMAND = 'command',
}

// 消息内容
interface MessageContent {
  text?: string;
  image?: { url: string; key: string };
  file?: { url: string; name: string; size: number };
  interactive?: InteractiveContent;
  command?: { name: string; args: Record<string, any> };
}

// 交互式内容
interface InteractiveContent {
  type: 'card' | 'button' | 'form';
  elements: InteractiveElement[];
}

interface InteractiveElement {
  type: string;
  text: string;
  value?: string;
  action?: string;
}

// 平台信息
interface PlatformInfo {
  platform: string;
  version: string;
  supportedFeatures: string[];
  limits: {
    maxMessageLength: number;
    maxFileSize: number;
    supportedImageFormats: string[];
  };
}

// 网关管理器
class GatewayManager {
  private gateways: Map<string, IGateway> = new Map();
  private eventBus: EventEmitter;
  private sessionManager: SessionManager;

  // 注册网关
  register(gateway: IGateway): void;

  // 注销网关
  unregister(name: string): void;

  // 启动所有网关
  async start(): Promise<void>;

  // 停止所有网关
  async stop(): Promise<void>;

  // 发送消息
  async send(platform: string, chatId: string, content: MessageContent): Promise<void>;

  // 广播消息
  async broadcast(content: MessageContent): Promise<void>;

  // 获取连接状态
  getStatus(): GatewayStatus[];
}

// 网关状态
interface GatewayStatus {
  name: string;
  platform: string;
  connected: boolean;
  lastError?: string;
  messageCount: number;
}
```

---

## 3. 详细设计

### 3.1 飞书网关实现

```typescript
class FeishuGateway implements IGateway {
  name = 'feishu';
  platform = 'feishu';

  private ws: WebSocket | null = null;
  private config: FeishuConfig;
  private accessToken: string = '';
  private logger: Logger;
  private messageHandler: MessageHandler | null = null;

  constructor(
    private gatewayManager: GatewayManager,
    config: FeishuConfig
  ) {
    this.config = config;
    this.logger = LoggerManager.getInstance().getLogger('gateway:feishu');
  }

  /**
   * 连接
   */
  async connect(): Promise<void> {
    this.logger.info('Connecting to Feishu');

    try {
      // 1. 获取访问令牌
      await this.authenticate();

      // 2. 建立 WebSocket 连接
      await this.connectWebSocket();

      this.logger.info('Feishu gateway connected');
    } catch (error) {
      this.logger.error('Failed to connect to Feishu', error);
      throw error;
    }
  }

  /**
   * 认证
   */
  async authenticate(): Promise<void> {
    const url = `https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal`;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        app_id: this.config.appId,
        app_secret: this.config.appSecret,
      }),
    });

    const data = await response.json();
    if (data.code !== 0) {
      throw new Error(`Authentication failed: ${data.msg}`);
    }

    this.accessToken = data.tenant_access_token;
    this.logger.debug('Access token obtained');
  }

  /**
   * 连接 WebSocket
   */
  private async connectWebSocket(): Promise<void> {
    // 获取 WebSocket URL
    const wsUrl = await this.getWebSocketUrl();

    // 建立 WebSocket 连接
    this.ws = new WebSocket(wsUrl);

    this.ws.on('open', () => {
      this.logger.info('WebSocket connected');
    });

    this.ws.on('message', (data: Buffer) => {
      this.handleMessage(data.toString());
    });

    this.ws.on('error', (error) => {
      this.logger.error('WebSocket error', error);
    });

    this.ws.on('close', () => {
      this.logger.warn('WebSocket closed, reconnecting...');
      setTimeout(() => this.connect(), 5000);
    });
  }

  /**
   * 获取 WebSocket URL
   */
  private async getWebSocketUrl(): Promise<string> {
    const url = `https://open.feishu.cn/open-apis/im/v1/chats/get_user_chat_url`;

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${this.accessToken}`,
      },
    });

    const data = await response.json();
    if (data.code !== 0) {
      throw new Error(`Failed to get chat URL: ${data.msg}`);
    }

    return data.data.wss_url;
  }

  /**
   * 处理消息
   */
  private handleMessage(data: string): void {
    try {
      const message = JSON.parse(data);

      switch (message.type) {
        case 'event':
          this.handleEvent(message.event);
          break;
        case 'conversation':
          this.handleConversation(message.conversation);
          break;
        default:
          this.logger.debug('Unknown message type', message.type);
      }
    } catch (error) {
      this.logger.error('Failed to parse message', error);
    }
  }

  /**
   * 处理事件
   */
  private async handleEvent(event: FeishuEvent): Promise<void> {
    switch (event.type) {
      case 'message':
        if (this.messageHandler) {
          const incoming = await this.parseMessage(event);
          await this.messageHandler(incoming);
        }
        break;
      default:
        this.logger.debug('Unhandled event type', event.type);
    }
  }

  /**
   * 解析消息
   */
  private async parseMessage(event: FeishuEvent): Promise<IncomingMessage> {
    const content = event.content;

    return {
      gateway: this.name,
      sessionId: await this.getOrCreateSession(event.sender.user_id, event.chat_id),

      from: {
        userId: event.sender.user_id,
        userName: event.sender.name,
        isBot: false,
      },

      to: {
        chatId: event.chat_id,
        chatType: event.chat_type === 'p2p' ? 'private' : 'group',
      },

      type: this.getMessageType(content),
      content: this.parseContent(content),

      timestamp: new Date(event.create_time),
      messageId: event.message_id,
    };
  }

  /**
   * 获取或创建会话
   */
  private async getOrCreateSession(userId: string, chatId: string): Promise<string> {
    return await this.gatewayManager.getSessionManager().getOrCreate(userId, chatId, this.platform);
  }

  /**
   * 发送消息
   */
  async send(chatId: string, content: MessageContent): Promise<void> {
    const url = 'https://open.feishu.cn/open-apis/im/v1/messages/send';

    const body: any = {
      receive_id_type: 'chat_id',
      receive_id: chatId,
      msg_type: 'text',
      content: JSON.stringify({ text: content.text }),
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    const data = await response.json();
    if (data.code !== 0) {
      throw new Error(`Send message failed: ${data.msg}`);
    }

    this.logger.debug('Message sent', { chatId });
  }

  /**
   * 断开连接
   */
  async disconnect(): Promise<void> {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.logger.info('Feishu gateway disconnected');
  }

  /**
   * 设置消息处理器
   */
  onMessage(handler: MessageHandler): void {
    this.messageHandler = handler;
  }

  /**
   * 获取平台信息
   */
  getPlatformInfo(): PlatformInfo {
    return {
      platform: 'feishu',
      version: '1.0',
      supportedFeatures: ['text', 'image', 'card', 'button'],
      limits: {
        maxMessageLength: 20000,
        maxFileSize: 50 * 1024 * 1024, // 50MB
        supportedImageFormats: ['jpg', 'jpeg', 'png', 'gif', 'webp'],
      },
    };
  }

  /**
   * 是否已连接
   */
  isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }
}
```

### 3.2 企业微信网关实现

```typescript
class WeComGateway implements IGateway {
  name = 'wecom';
  platform = 'wecom';

  private ws: WebSocket | null = null;
  private config: WeComConfig;
  private logger: Logger;
  private messageHandler: MessageHandler | null = null;

  constructor(
    private gatewayManager: GatewayManager,
    config: WeComConfig
  ) {
    this.config = config;
    this.logger = LoggerManager.getInstance().getLogger('gateway:wecom');
  }

  /**
   * 连接
   */
  async connect(): Promise<void> {
    this.logger.info('Connecting to WeCom');

    // 企业微信 WebSocket 地址
    const wsUrl = 'wss://qyapi.weixin.qq.com/cgi-bin/webhook/ai-bot-msg';

    this.ws = new WebSocket(wsUrl);

    this.ws.on('open', () => {
      this.logger.info('WeCom WebSocket connected');
      this.subscribe();
    });

    this.ws.on('message', (data: Buffer) => {
      this.handleMessage(data.toString());
    });

    this.ws.on('error', (error) => {
      this.logger.error('WebSocket error', error);
    });

    this.ws.on('close', () => {
      this.logger.warn('WebSocket closed, reconnecting...');
      setTimeout(() => this.connect(), 5000);
    });
  }

  /**
   * 订阅消息
   */
  private subscribe(): void {
    const subscribeMsg = {
      cmd: 'aibot_subscribe',
      headers: {
        req_id: this.generateRequestId(),
      },
      body: {
        bot_id: this.config.botId,
        secret: this.config.secret,
      },
    };

    this.ws?.send(JSON.stringify(subscribeMsg));
    this.logger.debug('Subscribed to WeCom messages');
  }

  /**
   * 处理消息
   */
  private async handleMessage(data: string): Promise<void> {
    try {
      const message = JSON.parse(data);

      if (message.cmd === 'msg_recv') {
        if (this.messageHandler) {
          const incoming = await this.parseMessage(message.body);
          await this.messageHandler(incoming);
        }
      }
    } catch (error) {
      this.logger.error('Failed to parse message', error);
    }
  }

  /**
   * 解析消息
   */
  private async parseMessage(body: any): Promise<IncomingMessage> {
    return {
      gateway: this.name,
      sessionId: await this.getOrCreateSession(body.from_user, body.chat_id),

      from: {
        userId: body.from_user,
        isBot: false,
      },

      to: {
        chatId: body.chat_id || body.from_user,
        chatType: body.chat_id ? 'group' : 'private',
      },

      type: this.getMessageType(body),
      content: this.parseContent(body),

      timestamp: new Date(body.timestamp),
      messageId: body.msgid,
    };
  }

  /**
   * 发送消息
   */
  async send(chatId: string, content: MessageContent): Promise<void> {
    const sendMsg = {
      cmd: 'msg_send',
      headers: {
        req_id: this.generateRequestId(),
      },
      body: {
        bot_id: this.config.botId,
        to_user: chatId,
        msg: content.text,
      },
    };

    this.ws?.send(JSON.stringify(sendMsg));
    this.logger.debug('Message sent', { chatId });
  }

  /**
   * 生成请求 ID
   */
  private generateRequestId(): string {
    return `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  // ... 其他方法类似飞书网关
}
```

---

## 4. 接口规范

### 4.1 公共 API

```typescript
interface IGatewayManager {
  /**
   * 注册网关
   */
  register(gateway: IGateway): void;

  /**
   * 注销网关
   */
  unregister(name: string): void;

  /**
   * 启动所有网关
   */
  start(): Promise<void>;

  /**
   * 停止所有网关
   */
  stop(): Promise<void>;

  /**
   * 发送消息到指定平台
   */
  send(platform: string, chatId: string, content: MessageContent): Promise<void>;

  /**
   * 广播消息到所有平台
   */
  broadcast(content: MessageContent): Promise<void>;

  /**
   * 获取网关状态
   */
  getStatus(): GatewayStatus[];
}
```

---

## 5. 实现细节

### 5.1 消息格式转换

```typescript
/**
 * 平台消息到内部消息的转换器
 */
class MessageConverter {
  /**
   * 转换飞书消息
   */
  static fromFeishu(message: FeishuMessage): MessageContent {
    const content = message.content;

    switch (message.msg_type) {
      case 'text':
        return { text: content.text };

      case 'image':
        return { image: { url: content.image_key, key: content.image_key } };

      case 'post':
        return { text: this.extractPostText(content.post) };

      default:
        return { text: '[Unsupported message type]' };
    }
  }

  /**
   * 转换到飞书消息
   */
  static toFeishu(content: MessageContent): FeishuMessage {
    if (content.text) {
      return {
        msg_type: 'text',
        content: { text: content.text },
      };
    }

    // ... 其他类型
    throw new Error('Unsupported content type');
  }

  /**
   * 提取富文本内容
   */
  private static extractPostText(post: any): string {
    // 提取富文本中的纯文本
    // ...
  }
}
```

### 5.2 重连策略

```typescript
/**
 * 重连管理器
 */
class ReconnectManager {
  private maxRetries = 10;
  private baseDelay = 1000; // 1秒
  private maxDelay = 30000; // 30秒

  async connectWithRetry(
    connectFn: () => Promise<void>,
    gatewayName: string
  ): Promise<void> {
    let retryCount = 0;

    while (retryCount < this.maxRetries) {
      try {
        await connectFn();
        return; // 成功连接
      } catch (error) {
        retryCount++;
        const delay = this.calculateDelay(retryCount);

        LoggerManager.getInstance()
          .getLogger('reconnect')
          .warn(`Connection failed for ${gatewayName}, retry ${retryCount}/${this.maxRetries} in ${delay}ms`);

        await this.sleep(delay);
      }
    }

    throw new Error(`Failed to connect after ${this.maxRetries} retries`);
  }

  /**
   * 计算延迟
   */
  private calculateDelay(retryCount: number): number {
    const delay = this.baseDelay * Math.pow(2, retryCount - 1);
    return Math.min(delay, this.maxDelay);
  }

  /**
   * 延迟
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
```

---

## 6. 测试策略

### 6.1 单元测试范围

```typescript
describe('FeishuGateway', () => {
  describe('connect()', () => {
    it('should authenticate and connect');
    it('should handle connection errors');
  });

  describe('send()', () => {
    it('should send text message');
    it('should handle send errors');
  });

  describe('parseMessage()', () => {
    it('should parse text message');
    it('should parse image message');
    it('should create session if not exists');
  });
});

describe('WeComGateway', () => {
  // 类似测试
});

describe('GatewayManager', () => {
  describe('register()', () => {
    it('should register gateway');
    it('should throw if duplicate name');
  });

  describe('send()', () => {
    it('should route to correct gateway');
    it('should throw for unknown platform');
  });
});
```

---

## 7. 依赖关系

### 7.1 外部依赖

```json
{
  "dependencies": {
    "ws": "^8.16.0",
    "eventemitter3": "^5.0.0"
  }
}
```

---

## 8. 配置项

### 8.1 网关配置

```json
{
  "gateways": {
    "feishu": {
      "appId": "${FEISHU_APP_ID}",
      "appSecret": "${FEISHU_APP_SECRET}",
      "encryptKey": "${FEISHU_ENCRYPT_KEY}",
      "verificationToken": "${FEISHU_VERIFICATION_TOKEN}",
      "events": ["message", "im.message.receive_v1"]
    },
    "wecom": {
      "botId": "${WECOM_BOT_ID}",
      "secret": "${WECOM_SECRET}"
    },
    "slack": {
      "botToken": "${SLACK_BOT_TOKEN}",
      "appToken": "${SLACK_APP_TOKEN}",
      "signingSecret": "${SLACK_SIGNING_SECRET}"
    }
  }
}
```

---

**文档版本**: 1.0.0
**最后更新**: 2026-03-13
