# 04. 会话层模块

> FriClaw 会话层详细实现文档
>
> **版本**: 1.0.0
> **作者**: Stars-Chan
> **日期**: 2026-03-13
> **状态**: 📋 待实现

---

## 1. 概述

### 1.1 模块职责

会话层负责管理用户会话的整个生命周期，包括会话创建、上下文维护、工作空间隔离和会话清理。

**核心功能**:
- 会话生命周期管理
- 对话上下文维护
- 工作空间隔离
- 会话超时处理
- 会话持久化
- 消息历史管理

### 1.2 与其他模块的关系

```
会话层
    ↑
    ├──> 配置系统（获取配置）
    ├──> 日志系统（输出日志）
    └──> 工作空间（管理目录）
    ↑
    ├──> 网关层（接收消息）
    └──> Agent 层（转发处理）
```

---

## 2. 架构设计

### 2.1 会话生命周期

```
┌──────────────┐    ┌──────────────┐    ┌──────────────┐    ┌──────────────┐
│  创建会话     │ →  │  活跃状态     │ →  │  挂起状态     │ →  │  关闭会话     │
└──────────────┘    └──────────────┘    └──────────────┘    └──────────────┘
     │                 │                 │                 │
     │                 │                 │                 │
     ▼                 ▼                 ▼                 ▼
 初始化工作空间      处理消息           超时未活动         清理资源
 加载内存上下文      更新上下文          保存快照           释放内存
 建立连接         发送到Agent
```

### 2.2 核心接口

```typescript
// 会话接口
interface ISession {
  id: string;
  userId: string;
  chatId: string;
  platform: string;

  // 上下文
  context: ConversationContext;

  // 工作空间
  workspace: Workspace;

  // 状态
  isActive(): boolean;
  lastActivity: Date;

  // 操作
  async addMessage(message: Message): Promise<void>;
  async getHistory(limit?: number): Promise<Message[]>;
  async updateContext(updates: Partial<ConversationContext>): Promise<void>;
  async close(): Promise<void>;
}

// 对话上下文
interface ConversationContext {
  // 用户信息
  userId: string;
  userName?: string;

  // 聊天信息
  chatId: string;
  chatType: 'private' | 'group' | 'topic';

  // 平台信息
  platform: string;

  // 记忆注入
  memoryContext?: string;

  // 自定义数据
  metadata: Record<string, any>;

  // 消息计数
  messageCount: number;
  lastMessageTime?: Date;
}

// 消息
interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: Date;
  metadata?: Record<string, any>;
}

// 会话管理器
interface ISessionManager {
  // 会话操作
  createSession(userId: string, chatId: string, platform: string): Promise<ISession>;
  getSession(sessionId: string): ISession | null;
  getOrCreateSession(userId: string, chatId: string, platform: string): Promise<string>;
  closeSession(sessionId: string): Promise<void>;

  // 查询
  listSessions(userId?: string): ISession[];
  getActiveSessions(): ISession[];
  getSessionByChat(userId: string, chatId: string): ISession | null;

  // 清理
  cleanupInactiveSessions(): Promise<void>;
  cleanupExpiredSessions(): Promise<void>;
}

// 会话实现
class Session implements ISession {
  id: string;
  userId: string;
  chatId: string;
  platform: string;
  context: ConversationContext;
  workspace: Workspace;
  lastActivity: Date;
  private messages: Message[] = [];
  private agent: Agent;

  constructor(
    id: string,
    userId: string,
    chatId: string,
    platform: string,
    private logger: Logger
  ) {
    this.id = id;
    this.userId = userId;
    this.chatId = chatId;
    this.platform = platform;
    this.lastActivity = new Date();
  }

  async initialize(): Promise<void> {
    // 初始化工作空间
    this.workspace = await WorkspaceManager.getInstance().create(this.id);

    // 初始化上下文
    this.context = {
      userId: this.userId,
      chatId: this.chatId,
      platform: this.platform,
      chatType: 'private', // 默认
      metadata: {},
      messageCount: 0,
    };

    // 创建 Agent
    this.agent = await AgentManager.getInstance().createAgent(this);

    this.logger.debug(`Session initialized: ${this.id}`);
  }

  isActive(): boolean {
    const config = WorkspaceManager.getInstance().getConfig();
    const timeout = config.sessionTimeout * 1000;
    return Date.now() - this.lastActivity.getTime() < timeout;
  }

  async addMessage(message: Message): Promise<void> {
    this.messages.push(message);
    this.context.messageCount++;
    this.context.lastMessageTime = new Date();
    this.lastActivity = new Date();

    // 保存到工作空间
    await this.workspace.saveMessage(message);

    this.logger.debug(`Message added to session ${this.id}`);
  }

  async getHistory(limit?: number): Promise<Message[]> {
    if (limit) {
      return this.messages.slice(-limit);
    }
    return this.messages;
  }

  async updateContext(updates: Partial<ConversationContext>): Promise<void> {
    this.context = { ...this.context, ...updates };
    await this.workspace.saveContext(this.context);
  }

  async close(): Promise<void> {
    // 保存会话数据
    await this.workspace.save();

    // 清理 Agent
    await this.agent.dispose();

    this.logger.debug(`Session closed: ${this.id}`);
  }
}

// 会话管理器实现
class SessionManager implements ISessionManager {
  private sessions: Map<string, ISession> = new Map();
  private config: WorkspaceConfig;
  private logger: Logger;

  constructor(private gatewayManager: GatewayManager) {
    this.config = WorkspaceManager.getInstance().getConfig();
    this.logger = LoggerManager.getInstance().getLogger('session');
  }

  /**
   * 创建会话
   */
  async createSession(userId: string, chatId: string, platform: string): Promise<ISession> {
    const sessionId = this.generateSessionId(userId, chatId, platform);

    // 检查是否已存在
    const existing = this.getSession(sessionId);
    if (existing) {
      return existing;
    }

    // 创建新会话
    const session = new Session(
      sessionId,
      userId,
      chatId,
      platform,
      this.logger
    );

    await session.initialize();

    // 注册会话
    this.sessions.set(sessionId, session);

    // 设置消息处理器
    this.gatewayManager.onMessage(async (message) => {
      if (message.sessionId === sessionId) {
        await this.handleMessage(session, message);
      }
    });

    this.logger.info(`Session created: ${sessionId}`);
    return session;
  }

  /**
   * 获取或创建会话
   */
  async getOrCreateSession(userId: string, chatId: string, platform: string): Promise<string> {
    const sessionId = this.generateSessionId(userId, chatId, platform);
    let session = this.getSession(sessionId);

    if (!session) {
      session = await this.createSession(userId, chatId, platform);
    }

    return sessionId;
  }

  /**
   * 生成会话 ID
   */
  private generateSessionId(userId: string, chatId: string, platform: string): string {
    return `${platform}:${userId}:${chatId}`;
  }

  /**
   * 获取会话
   */
  getSession(sessionId: string): ISession | null {
    return this.sessions.get(sessionId) || null;
  }

  /**
   * 通过聊天获取会话
   */
  getSessionByChat(userId: string, chatId: string): ISession | null {
    for (const session of this.sessions.values()) {
      if (session.userId === userId && session.chatId === chatId) {
        return session;
      }
    }
    return null;
  }

  /**
   * 列出会话
   */
  listSessions(userId?: string): ISession[] {
    const all = Array.from(this.sessions.values());
    if (userId) {
      return all.filter(s => s.userId === userId);
    }
    return all;
  }

  /**
   * 获取活跃会话
   */
  getActiveSessions(): ISession[] {
    return Array.from(this.sessions.values()).filter(s => s.isActive());
  }

  /**
   * 关闭会话
   */
  async closeSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (session) {
      await session.close();
      this.sessions.delete(sessionId);
      this.logger.info(`Session closed: ${sessionId}`);
    }
  }

  /**
   * 处理消息
   */
  private async handleMessage(session: ISession, message: IncomingMessage): Promise<void> {
    // 添加到会话
    await session.addMessage({
      id: message.messageId || this.generateMessageId(),
      role: 'user',
      content: message.content.text || '',
      timestamp: message.timestamp,
      metadata: {
        platform: message.gateway,
        chatType: message.to.chatType,
      },
    });

    // 发送到 Agent 处理
    const agent = session['agent'];
    const response = await agent.process(message);

    // 发送回复
    await this.gatewayManager.send(
      message.gateway,
      message.to.chatId,
      { text: response.content }
    );

    // 添加助手回复到会话
    await session.addMessage({
      id: this.generateMessageId(),
      role: 'assistant',
      content: response.content,
      timestamp: new Date(),
    });
  }

  /**
   * 生成消息 ID
   */
  private generateMessageId(): string {
    return `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * 清理不活跃会话
   */
  async cleanupInactiveSessions(): Promise<void> {
    const now = Date.now();
    const timeoutMs = this.config.sessionTimeout * 1000;

    for (const [sessionId, session] of this.sessions.entries()) {
      const inactiveTime = now - session.lastActivity.getTime();
      if (inactiveTime > timeoutMs) {
        this.logger.info(`Cleaning up inactive session: ${sessionId}`);
        await this.closeSession(sessionId);
      }
    }
  }

  /**
   * 清理过期会话
   */
  async cleanupExpiredSessions(): Promise<void> {
    const maxAge = this.config.maxAge || (7 * 24 * 3600 * 1000); // 7天
    const now = Date.now();

    // 检查工作空间中的会话
    const workspaceManager = WorkspaceManager.getInstance();
    const workspaces = await workspaceManager.list();

    for (const ws of workspaces) {
      const stats = await fs.promises.stat(ws.path);
      const age = now - stats.mtimeMs;

      if (age > maxAge) {
        await workspaceManager.delete(ws.sessionId);
        this.sessions.delete(ws.sessionId);
        this.logger.info(`Deleted expired session: ${ws.sessionId}`);
      }
    }
  }
}
```

---

## 3. 工作空间设计

### 3.1 工作空间目录结构

```
~/.friclaw/workspaces/
├── {session_id}/
│   ├── .friclaw/
│   │   ├── session.json      # 会话元数据
│   │   ├── context.json      # 对话上下文
│   │   └── tools.json      # 可用工具配置
│   ├── memory/
│   │   └── {conversation_id}.md  # 会话记录
│   ├── temp/
│   │   └── {task_id}/        # 临时文件
│   └── cache/
│       └── {key}/            # 缓存数据
```

### 3.2 工作空间接口

```typescript
// 工作空间接口
interface IWorkspace {
  sessionId: string;
  path: string;

  // 初始化
  async initialize(): Promise<void>;

  // 会话操作
  saveSession(session: ISession): Promise<void>;
  loadSession(): Promise<ISession | null>;

  // 上下文操作
  saveContext(context: ConversationContext): Promise<void>;
  loadContext(): Promise<ConversationContext>;

  // 消息操作
  saveMessage(message: Message): Promise<void>;
  loadMessages(): Promise<Message[]>;

  // 文件操作
  async createTempDir(taskId?: string): Promise<string>;
  async getCache(key: string): Promise<any>;
  async setCache(key: string, value: any): Promise<void>;

  // 清理
  async cleanup(): Promise<void>;
}

// 工作空间实现
class Workspace implements IWorkspace {
  sessionId: string;
  path: string;

  constructor(sessionId: string, basePath: string) {
    this.sessionId = sessionId;
    this.path = path.join(basePath, sessionId);
  }

  async initialize(): Promise<void> {
    // 创建目录结构
    const dirs = [
      '.friclaw',
      'memory',
      'temp',
      'cache',
    ];

    for (const dir of dirs) {
      await fs.promises.mkdir(path.join(this.path, dir), { recursive: true });
    }

    // 创建初始文件
    const sessionData: any = {
      sessionId: this.sessionId,
      createdAt: new Date().toISOString(),
    };
    await this.saveJson('.friclaw/session.json', sessionData);
  }

  async saveSession(session: ISession): Promise<void> {
    const data = {
      id: session.id,
      userId: session.userId,
      chatId: session.chatId,
      platform: session.platform,
      lastActivity: session.lastActivity.toISOString(),
    };
    await this.saveJson('.friclaw/session.json', data);
  }

  async loadSession(): Promise<ISession | null> {
    try {
      const data = await this.loadJson('.friclaw/session.json');
      return data;
    } catch {
      return null;
    }
  }

  async saveContext(context: ConversationContext): Promise<void> {
    await this.saveJson('.friclaw/context.json', context);
  }

  async loadContext(): Promise<ConversationContext> {
    try {
      return await this.loadJson('.friclaw/context.json');
    } catch {
      return {
        userId: '',
        chatId: '',
        platform: '',
        chatType: 'private',
        metadata: {},
        messageCount: 0,
      };
    }
  }

  async saveMessage(message: Message): Promise<void> {
    const today = new Date().toISOString().split('T')[0];
    const fileName = `memory/${today}.md`;

    let content = '';
    try {
      content = await fs.promises.readFile(
        path.join(this.path, fileName),
        'utf-8'
      );
    } catch {}

    // 追加新消息
    const role = message.role === 'user' ? 'User' : 'Assistant';
    content += `\n\n## [${role}] ${message.timestamp.toISOString()}\n\n`;
    content += message.content;
    content += '\n';

    await fs.promises.writeFile(
      path.join(this.path, fileName),
      content,
      'utf-8'
    );
  }

  async createTempDir(taskId?: string): Promise<string> {
    const dirName = taskId || this.generateId();
    const dirPath = path.join(this.path, 'temp', dirName);
    await fs.promises.mkdir(dirPath, { recursive: true });
    return dirPath;
  }

  async getCache(key: string): Promise<any> {
    try {
      const data = await this.loadJson(`cache/${key}.json`);
      return data.value;
    } catch {
      return null;
    }
  }

  async setCache(key: string, value: any): Promise<void> {
    const data = { value, timestamp: Date.now() };
    await this.saveJson(`cache/${key}.json`, data);
  }

  async cleanup(): Promise<void> {
    // 清理临时目录
    const tempDir = path.join(this.path, 'temp');
    const files = await fs.promises.readdir(tempDir);
    for (const file of files) {
      await fs.promises.rm(path.join(tempDir, file), { recursive: true });
    }

    // 清理过期缓存
    const cacheDir = path.join(this.path, 'cache');
    const cacheFiles = await fs.promises.readdir(cacheDir);
    const now = Date.now();
    const cacheExpiry = 24 * 60 * 60 * 1000; // 24小时

    for (const file of cacheFiles) {
      const filePath = path.join(cacheDir, file);
      const stats = await fs.promises.stat(filePath);
      if (now - stats.mtimeMs > cacheExpiry) {
        await fs.promises.unlink(filePath);
      }
    }
  }

  private async saveJson(filePath: string, data: any): Promise<void> {
    await fs.promises.writeFile(
      path.join(this.path, filePath),
      JSON.stringify(data, null, 2),
      'utf-8'
    );
  }

  private async loadJson(filePath: string): Promise<any> {
    const content = await fs.promises.readFile(
      path.join(this.path, filePath),
      'utf-8'
    );
    return JSON.parse(content);
  }

  private generateId(): string {
    return `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}

// 工作空间管理器
class WorkspaceManager {
  private static instance: WorkspaceManager;
  private config: WorkspaceConfig;
  private workspaces: Map<string, Workspace> = new Map();

  static getInstance(): WorkspaceManager {
    if (!WorkspaceManager.instance) {
      WorkspaceManager.instance = new WorkspaceManager();
    }
    return WorkspaceManager.instance;
  }

  async initialize(config: WorkspaceConfig): Promise<void> {
    this.config = config;
    await fs.promises.mkdir(config.dir, { recursive: true });
  }

  async create(sessionId: string): Promise<Workspace> {
    let workspace = this.workspaces.get(sessionId);

    if (!workspace) {
      workspace = new Workspace(sessionId, this.config.dir);
      await workspace.initialize();
      this.workspaces.set(sessionId, workspace);
    }

    return workspace;
  }

  async delete(sessionId: string): Promise<void> {
    const workspace = this.workspaces.get(sessionId);
    if (workspace) {
      await fs.promises.rm(workspace.path, { recursive: true });
      this.workspaces.delete(sessionId);
    }
  }

  async list(): Promise<{ sessionId: string; path: string }[]> {
    const entries = await fs.promises.readdir(this.config.dir);
    const sessions: { sessionId: string; path: string }[] = [];

    for (const entry of entries) {
      const sessionPath = path.join(this.config.dir, entry);
      const stats = await fs.promises.stat(sessionPath);
      if (stats.isDirectory()) {
        sessions.push({ sessionId: entry, path: sessionPath });
      }
    }

    return sessions;
  }

  getConfig(): WorkspaceConfig {
    return this.config;
  }
}
```

---

## 4. 测试策略

### 4.1 单元测试范围

```typescript
describe('Session', () => {
  it('should initialize with context');
  it('should add messages');
  it('should maintain history');
  it('should detect inactive state');
  it('should close and save');
});

describe('SessionManager', () => {
  it('should create new session');
  it('should reuse existing session');
  it('should handle concurrent sessions');
  it('should cleanup inactive sessions');
});

describe('Workspace', () => {
  it('should initialize directory structure');
  it('should save and load context');
  it('should handle message persistence');
  it('should cleanup temp files');
});
```

---

## 5. 配置项

### 5.1 会话配置

```json
{
  "workspaces": {
    "dir": "~/.friclaw/workspaces",
    "maxSessions": 1000,
    "sessionTimeout": 3600,
    "autoCleanup": true,
    "maxAge": 604800
  }
}
```

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `dir` | string | `~/.friclaw/workspaces` | 工作空间目录 |
| `maxSessions` | number | `1000` | 最大会话数 |
| `sessionTimeout` | number | `3600` | 会话超时（秒） |
| `autoCleanup` | boolean | `true` | 自动清理 |
| `maxAge` | number | `604800` | 最大保留时间（秒）|

---

**文档版本**: 1.0.0
**最后更新**: 2026-03-13
