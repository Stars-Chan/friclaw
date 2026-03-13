# FriClaw 工作空间模块设计

> 基于 NeoClaw Workspace 架构，为 FriClaw 设计的详细工作空间模块文档
>
> **版本**: 1.0.0
> **参考**: NeoClaw Workspace Implementation
> **日期**: 2026-03-13

---

## 📋 目录

- [1. 模块概述](#1-模块概述)
- [2. 工作空间结构](#2-工作空间结构)
- [3. 管理器实现](#3-管理器实现)
- [4. 上下文管理](#4-上下文管理)
- [5. 历史记录](#5-历史记录)
- [6. 资源隔离](#6-资源隔离)
- [7. 清理策略](#7-清理策略)

---

## 1. 模块概述

### 1.1 设计目标

工作空间模块为 FriClaw 提供会话隔离能力：

- **独立上下文**: 每个对话有独立的文件系统和上下文
- **持久化存储**: 会话状态和历史的持久化
- **资源隔离**: 不同会话的资源互相隔离
- **安全边界**: 防止跨会话访问敏感信息

### 1.2 架构图

```
┌─────────────────────────────────────────────────────────────────────────┐
│                   FriClaw 工作空间架构                        │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                   │
│  ┌─────────────────────────────────────────────┐                  │
│  │          Workspace Manager              │                  │
│  └────────────────────┬────────────────────────┘                  │
│                       │                                     │
│         ┌─────────────┼─────────────┐                      │
│         ▼             ▼             ▼                      │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐              │
│  │Workspace 1│  │Workspace 2│  │Workspace 3│              │
│  │(私聊 A)   │  │(私聊 B)   │  │(群聊 C)   │              │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘              │
│       │             │             │                     │
│       └─────────────┼─────────────┘                     │
│                     ▼                                    │
│         ┌──────────────────────────┐                           │
│         │   Context Manager        │                           │
│         │   (对话上下文管理)      │                           │
│         └────────┬───────────┘                           │
│                  │                                     │
│    ┌─────────────┼─────────────┐                            │
│    ▼             ▼             ▼                            │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐                │
│  │Conversation│  │  Message   │  │  File      │                │
│  │  Context  │  │   History  │  │  System     │                │
│  └──────────┘  └──────────┘  └──────────┘                │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 2. 工作空间结构

### 2.1 目录结构

```
~/.friclaw/workspaces/
├── {workspace_id}/
│   ├── .friclaw/
│   │   ├── context.json          # 对话上下文
│   │   ├── .history/             # 历史记录
│   │   ├── memory/              # 会话记忆
│   │   └── temp/               # 临时文件
│   ├── .claude/                 # Claude Code 配置
│   └── cache/                  # 缓存文件
├── {workspace_id}/
│   └── ...
└── ...
```

### 2.2 文件说明

| 文件/目录 | 说明 |
|----------|------|
| `.friclaw/context.json` | 当前对话上下文（消息历史、状态） |
| `.friclaw/.history/` | 历史记录（按日期分文件） |
| `.friclaw/.history/.last-summarized-offset` | 摘要偏移标记 |
| `.friclaw/memory/` | 会话特定的记忆（文件） |
| `.friclaw/temp/` | 临时文件（执行期间创建，完成后清理） |
| `.claude/` | Claude Code 会话配置（自动生成） |
| `cache/` | 缓存文件（索引、元数据等） |

---

## 3. 管理器实现

### 3.1 WorkspaceManager 类

```typescript
/**
 * WorkspaceManager — 工作空间管理器
 *
 * 管理所有工作空间的创建、访问、清理
 */
export class WorkspaceManager {
  private readonly _workspacesDir: string;
  private readonly _activeWorkspaces = new Map<string, Workspace>();

  constructor(workspacesDir: string) {
    this._workspacesDir = workspacesDir;
  }

  /**
   * 获取或创建工作空间
   */
  async getWorkspace(conversationId: string): Promise<Workspace> {
    const workspaceId = this._sanitizeId(conversationId);

    let workspace = this._activeWorkspaces.get(workspaceId);

    if (!workspace) {
      workspace = await this._createWorkspace(workspaceId);
      this._activeWorkspaces.set(workspaceId, workspace);
    }

    workspace.lastAccessedAt = Date.now();
    return workspace;
  }

  /**
   * 创建新工作空间
   */
  private async _createWorkspace(id: string): Promise<Workspace> {
    const path = join(this._workspacesDir, id);

    if (!existsSync(path)) {
      await mkdirp(path);
    }

    return {
      id,
      path,
      context: this._createDefaultContext(),
      createdAt: Date.now(),
      lastAccessedAt: Date.now(),
    };
  }

  /**
   * 清除工作空间上下文
   */
  async clearWorkspace(conversationId: string): Promise<void> {
    const workspace = await this.getWorkspace(conversationId);
    workspace.context = this._createDefaultContext();
    await this._saveContext(workspace);
  }

  /**
   * 删除工作空间
   */
  async deleteWorkspace(conversationId: string): Promise<void> {
    const workspaceId = this._sanitizeId(conversationId);
    const path = join(this._workspacesDir, workspaceId);

    if (existsSync(path)) {
      await rimraf(path);
    }

    this._activeWorkspaces.delete(workspaceId);
  }

  /**
   * 列出所有工作空间
   */
  listWorkspaces(): Workspace[] {
    return [...this._activeWorkspaces.values()];
  }

  /**
   * 清理非活跃工作空间
   */
  async cleanupInactiveWorkspaces(maxAge: number = 7 * 24 * 60 * 1000): Promise<void> {
    const now = Date.now();
    const workspaces = this.listWorkspaces();

    for (const ws of workspaces) {
      if (now - ws.lastAccessedAt > maxAge) {
        await this.deleteWorkspace(ws.id);
      }
    }
  }

  private _sanitizeId(id: string): string {
    return id.replace(/:/g, '_').replace(/[^\w-]/g, '_');
  }

  private _createDefaultContext(): ConversationContext {
    return {
      messages: [],
      metadata: {},
      threadId: null,
    };
  }

  private async _saveContext(workspace: Workspace): Promise<void> {
    const contextPath = join(workspace.path, '.friclaw', 'context.json');
    await writeFile(contextPath, JSON.stringify(workspace.context));
  }
}

/**
 * Workspace — 工作空间
 */
export interface Workspace {
  /** 工作空间 ID（经清理的会话 ID） */
  id: string;

  /** 文件系统路径 */
  path: string;

  /** 对话上下文 */
  context: ConversationContext;

  /** 创建时间 */
  createdAt: number;

  /** 最后访问时间 */
  lastAccessedAt: number;
}

/**
 * ConversationContext — 对话上下文
 */
export interface ConversationContext {
  /** 消息历史 */
  messages: ChatMessage[];

  /** 元数据 */
  metadata: Record<string, unknown>;

  /** 话题 ID（如果有） */
  threadId?: string;
}

/**
 * ChatMessage — 聊天消息
 */
export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  toolCalls?: ToolCall[];
}
```

---

## 4. 上下文管理

### 4.1 ContextManager 类

```typescript
/**
 * ContextManager — 上下文管理器
 *
 * 管理对话上下文，包括消息历史、线程、元数据
 */
export class ContextManager {
  private _context: ConversationContext;

  constructor(contextPath: string) {
    this._context = this._loadContext(contextPath);
  }

  /**
   * 加载上下文
   */
  private _loadContext(contextPath: string): ConversationContext {
    try {
      if (existsSync(contextPath)) {
        const content = readFileSync(contextPath, 'utf-8');
        return JSON.parse(content);
      }
    } catch (err) {
      console.error(`Failed to load context:`, err);
      return this._createDefault();
    }

    return this._createDefault();
  }

  /**
   * 保存上下文
   */
  async saveContext(contextPath: string): Promise<void> {
    try {
      const dir = dirname(contextPath);
      if (!existsSync(dir)) {
        await mkdirp(dir);
      }
      await writeFile(contextPath, JSON.stringify(this._context));
    } catch (err) {
      console.error(`Failed to save context:`, err);
    }
  }

  /**
   * 添加消息
   */
  addMessage(message: ChatMessage): void {
    this._context.messages.push(message);

    // 限制上下文大小
    const MAX_MESSAGES = 100;
    if (this._context.messages.length > MAX_MESSAGES) {
      this._context.messages = this._context.messages.slice(-MAX_MESSAGES);
    }
  }

  /**
   * 获取消息
   */
  getMessages(limit?: number): ChatMessage[] {
    if (limit) {
      return this._context.messages.slice(-limit);
    }
    return this._context.messages;
  }

  /**
   * 清除上下文
   */
  clear(): void {
    this._context = this._createDefault();
  }

  /**
   * 设置线程 ID
   */
  setThreadRoot(threadId: string | null): void {
    this._context.threadId = threadId;
  }

  /**
   * 获取上下文
   */
  getContext(): ConversationContext {
    return this._context;
  }

  private _createDefault(): ConversationContext {
    return {
      messages: [],
      metadata: {},
      threadId: null,
    };
  }
}
```

### 4.2 上下文大小限制

```typescript
/**
 * ContextLimiter — 上下文限制器
 *
 * 根据模型配置动态调整上下文大小
 */
export class ContextLimiter {
  private readonly MAX_TOKENS = 200_000; // 200K tokens
  private readonly TOKENS_PER_MESSAGE = 100; // 平均每条消息 100 tokens

  /**
   * 计算可保留的最大消息数
   */
  calculateMaxMessages(currentTokenCount: number): number {
    const remainingTokens = this.MAX_TOKENS - currentTokenCount;
    return Math.floor(remainingTokens / this.TOKENS_PER_MESSAGE);
  }

  /**
   * 估算消息的 token 数量
   */
  estimateTokens(message: ChatMessage): number {
    const contentTokens = message.content.length * 0.25;
    const metaTokens = 20; // 元数据开销
    return contentTokens + metaTokens;
  }

  /**
   * 检查是否需要截断上下文
   */
  needsTruncation(messages: ChatMessage[]): boolean {
    let totalTokens = 0;
    for (const msg of messages) {
      totalTokens += this.estimateTokens(msg);
    }
    return totalTokens > this.MAX_TOKENS;
  }

  /**
   * 截断上下文
   */
  truncate(messages: ChatMessage[]): ChatMessage[] {
    const truncated: ChatMessage[] = [];
    let totalTokens = 0;

    for (const msg of messages) {
      const msgTokens = this.estimateTokens(msg);

      if (totalTokens + msgTokens > this.MAX_TOKENS) {
        // 添加截断标记
        truncated.push({
          ...msg,
          content: '[...上下文已截断...]',
        });
        break;
      }

      truncated.push(msg);
      totalTokens += msgTokens;
    }

    return truncated;
  }
}
```

---

## 5. 历史记录

### 5.1 HistoryManager 类

```typescript
/**
 * HistoryManager — 历史记录管理器
 *
 * 管理会话历史记录的持久化
 */
export class HistoryManager {
  private readonly _historyDir: string;
  private readonly _bufferSize = 100; // 缓冲 100 条记录

  constructor(workspacePath: string) {
    this._historyDir = join(workspacePath, '.friclaw', '.history');
  }

  /**
   * 添加历史记录
   */
  async append(role: 'user' | 'friclaw', text: string): Promise<void> {
    if (!existsSync(this._historyDir)) {
      await mkdirp(this._historyDir);
    }

    const date = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    const filePath = join(this._historyDir, `${date}.txt`);

    const entry = `[${role}] ${text}\n\n`;
    await appendFile(filePath, entry);
  }

  /**
   * 读取历史记录
   */
  async read(date: string): Promise<string> {
    const filePath = join(this._historyDir, `${date}.txt`);

    if (!existsSync(filePath)) {
      return '';
    }

    return await readFile(filePath, 'utf-8');
  }

  /**
   * 列出历史文件
   */
  listFiles(): string[] {
    if (!existsSync(this._historyDir)) {
      return [];
    }

    const files = readdirSync(this._historyDir)
      .filter((f) => f.endsWith('.txt'))
      .sort();

    return files;
  }

  /**
   * 删除历史
   */
  async delete(date: string): Promise<void> {
    const filePath = join(this._historyDir, `${date}.txt`);

    if (existsSync(filePath)) {
      await unlink(filePath);
    }
  }

  /**
   * 清理旧历史
   */
  async cleanupOldHistory(maxDays: number = 30): Promise<void> {
    const files = this.listFiles();
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - maxDays);

    for (const file of files) {
      const match = file.match(/(\d{4}-\d{2}-\d{2})\.txt/);

      if (match) {
        const fileDate = new Date(match[1]);
        if (fileDate < cutoffDate) {
          await this.delete(match[1]);
        }
      }
    }
  }
}
```

### 5.2 历史记录格式

```
[friclaw] Hello! How can I help you today?

[user] Can you tell me about Friday from Iron Man?

[friclaw] Friday (Female Replacement Intelligent Digital Assistant Youth) is an AI character in the Marvel Comics universe. She first appeared in *Iron Man (vol. 3)* #53, published in June 2002, and was created by writer Warren Ellis as the successor to J.A.R.V.I.S.

[friclaw] She serves as Tony Stark's personal assistant and provides information processing, tactical analysis, and support for his various projects and missions. Friday has a more direct and sometimes confrontational personality compared to J.A.R.V.I.S., while still maintaining a high level of efficiency and loyalty.

```

---

## 6. 资源隔离

### 6.1 IsolatedFileSystem 类

```typescript
/**
 * IsolatedFileSystem — 隔离文件系统
 *
 * 确保不同工作空间的资源互不干扰
 */
export class IsolatedFileSystem {
  private readonly _basePath: string;
  private readonly _allowedPaths: Set<string>;

  constructor(
    basePath: string,
    allowedPaths: string[] = ['/', 'tmp', 'home']
  ) {
    this._basePath = basePath;
    this._allowedPaths = new Set(allowedPaths);
  }

  /**
   * 规范化路径到工作空间内
   */
  normalize(path: string): string {
    // 相对路径解析为工作空间内的绝对路径
    if (!path.startsWith('/') && !path.startsWith('~')) {
      return join(this._basePath, path);
    }

    // 绝对路径检查是否在工作空间内
    const normalized = resolve(path);
    const workspaceRoot = resolve(this._basePath);

    if (normalized.startsWith(workspaceRoot)) {
      return normalized;
    }

    // 检查是否是允许的系统路径
    for (const allowed of this._allowedPaths) {
      if (normalized.startsWith(allowed)) {
        return normalized;
      }
    }

    // 不在工作空间内，拒绝访问
    throw new Error(
      `Access denied: "${path}" is outside the workspace. Only system directories are accessible.`
    );
  }

  /**
   * 创建临时目录
   */
  async createTempDir(prefix: string = ''): Promise<string> {
    const tempBase = join(this._basePath, '.friclaw', 'temp');
    const tempDir = join(tempBase, `${prefix}${Date.now()}_${Math.random().toString(36).substring(2, 15)}`);
    await mkdirp(tempDir);
    return tempDir;
  }

  /**
   * 清理临时目录
   */
  async cleanupTemp(): Promise<void> {
    const tempBase = join(this._basePath, '.friclaw', 'temp');

    if (!existsSync(tempBase)) {
      return;
    }

    const dirs = readdirSync(tempBase);
    const now = Date.now();
    const MAX_AGE = 24 * 60 * 1000; // 24 小时

    for (const dir of dirs) {
      const dirPath = join(tempBase, dir);
      const stat = statSync(dirPath);

      if (now - stat.mtimeMs > MAX_AGE) {
        await rimraf(dirPath);
      }
    }
  }
}
```

---

## 7. 清理策略

### 7.1 清理触发条件

| 触发条件 | 说明 |
|-----------|------|
| 工作空间非活跃 | 超过 7 天未访问 |
| 临时文件过期 | 超过 24 小时 |
| 历史文件过期 | 超过 30 天 |
| 缓存文件过期 | 超过 7 天 |

### 7.2 WorkspaceCleaner 类

```typescript
/**
 * WorkspaceCleaner — 工作空间清理器
 *
 * 定期清理非活跃和过期的资源
 */
export class WorkspaceCleaner {
  private readonly _manager: WorkspaceManager;
  private readonly _cleanupInterval = 24 * 60 * 60 * 1000; // 24 小时
  private _timer: ReturnType<typeof setInterval> | null = null;

  constructor(manager: WorkspaceManager) {
    this._manager = manager;
  }

  /**
   * 启动清理任务
   */
  start(): void {
    if (this._timer) return;

    // 立即执行一次清理
    void this._cleanup();

    // 定期执行清理
    this._timer = setInterval(() => void this._cleanup(), this._cleanupInterval);

    if (typeof this._timer.unref === 'function') {
      this._timer.unref();
    }
  }

  /**
   * 停止清理任务
   */
  stop(): void {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
  }

  /**
   * 执行清理
   */
  private async _cleanup(): Promise<void> {
    const stats = await this._cleanupInactiveWorkspaces();
    const tempStats = await this._cleanupTempFiles();
    const historyStats = await this._cleanupOldHistory();

    log.info('Workspace cleanup completed', {
      workspacesCleaned: stats.workspacesRemoved,
      tempFilesCleaned: tempStats.filesRemoved,
      historyFilesCleaned: historyStats.filesRemoved,
    });
  }

  private async _cleanupInactiveWorkspaces(): Promise<{
    workspacesRemoved: number;
  }> {
    const before = this._manager.listWorkspaces().length;

    await this._manager.cleanupInactiveWorkspaces();

    const after = this._manager.listWorkspaces().length;

    return { workspacesRemoved: before - after };
  }

  private async _cleanupTempFiles(): Promise<{
    filesRemoved: number;
  }> {
    const workspaces = this._manager.listWorkspaces();
    let totalRemoved = 0;

    for (const ws of workspaces) {
      const fs = new IsolatedFileSystem(ws.path);
      await fs.cleanupTemp();

      // 统计删除的文件数
      const tempDir = join(ws.path, '.friclaw', 'temp');
      if (existsSync(tempDir)) {
        const files = readdirSync(tempDir);
        totalRemoved += files.length;
      }
    }

    return { filesRemoved: totalRemoved };
  }

  private async _cleanupOldHistory(): Promise<{
    filesRemoved: number;
  }> {
    const workspaces = this._manager.listWorkspaces();
    let totalRemoved = 0;

    for (const ws of workspaces) {
      const historyManager = new HistoryManager(ws.path);
      await historyManager.cleanupOldHistory(30);

      const files = historyManager.listFiles();
      totalRemoved += files.length;
    }

    return { filesRemoved: totalRemoved };
  }
}
```

---

## 附录

### A. 环境变量

```typescript
/**
 * WorkspaceEnv — 工作空间环境变量
 */
export const WORKSPACE_ENV = {
  FRICLAW_HOME: '~/.friclaw',
  WORKSPACES_DIR: '~/.friclaw/workspaces',
  DEFAULT_MAX_CONTEXT_SIZE: 100,
  HISTORY_RETENTION_DAYS: 30,
  TEMP_FILE_MAX_AGE: 24 * 60 * 1000, // 24 小时
} as const;
```

### B. 错误类型

```typescript
/**
 * WorkspaceError — 工作空间错误类型
 */
export enum WorkspaceError {
  INVALID_PATH = 'INVALID_PATH',
  ACCESS_DENIED = 'ACCESS_DENIED',
  NOT_FOUND = 'NOT_FOUND',
  CREATION_FAILED = 'CREATION_FAILED',
  CLEANUP_FAILED = 'CLEANUP_FAILED',
}

/**
 * WorkspaceException — 工作空间异常
 */
export class WorkspaceException extends Error {
  constructor(
    public code: WorkspaceError,
    message: string,
    public cause?: Error
  ) {
    super(message);
    this.name = 'WorkspaceException';
  }
}
```

---

**文档版本**: 1.0.0
**最后更新**: 2026-03-13
