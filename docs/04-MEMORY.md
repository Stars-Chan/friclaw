# FriClaw 内存层模块设计

> 基于 NeoClaw Memory 架构，为 FriClaw 设计的详细内存管理模块文档
>
> **版本**: 1.0.0
> **参考**: NeoClaw Memory Implementation
> **日期**: 2026-03-13

---

## 📋 目录

- [1. 模块概述](#1-模块概述)
- [2. 三层记忆架构](#2-三层记忆架构)
- [3. 存储层设计](#3-存储层设计)
- [4. 管理器实现](#4-管理器实现)
- [5. MCP 服务器实现](#5-mcp-服务器实现)
- [6. 会话摘要](#6-会话摘要)
- [7. 索引重建](#7-索引重建)
- [8. 工具处理器](#8-工具处理器)

---

## 1. 模块概述

### 1.1 设计目标

内存层为 FriClaw 提供持久化记忆能力：

- **三层架构**: Identity、Knowledge、Episode 分层管理
- **全文搜索**: 基于 FTS5 的快速语义搜索
- **会话摘要**: 自动生成和维护会话历史
- **MCP 集成**: 通过 MCP 协议暴露内存操作
- **增量索引**: 支持外部文件修改的自动检测

### 1.2 架构图

```
┌─────────────────────────────────────────────────────────────────────────┐
│                   FriClaw 内存层架构                          │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                   │
│  ┌─────────────────────────────────────────────────────┐             │
│  │              MemoryManager                      │             │
│  └────────────────────┬────────────────────────────────┘             │
│                       │                                     │
│         ┌─────────────┼─────────────┐                      │
│         ▼             ▼             ▼                      │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐              │
│  │Identity  │  │Knowledge │  │ Episode  │              │
│  │ Layer   │  │  Layer   │  │  Layer   │              │
│  │(只读)   │  │ (读写)   │  │ (只读)   │              │
│  └────┬────┘  └────┬────┘  └────┬────┘              │
│       │             │             │                     │
│       └─────────────┼─────────────┘                     │
│                     ▼                                    │
│  ┌──────────────────────────┐                           │
│  │   MemoryStore          │                           │
│  │   (SQLite + FTS5)   │                           │
│  └────────┬───────────┘                           │
│           │                                      │
│           ▼                                      │
│  ┌───────────────────────────────────────┐               │
│  │         File System               │               │
│  │  ~/.friclaw/memory/              │               │
│  │    ├── identity/SOUL.md            │               │
│  │    ├── knowledge/                  │               │
│  │    │    ├── owner-profile.md       │               │
│  │    │    ├── preferences.md         │               │
│  │    │    ├── people.md              │               │
│  │    │    ├── projects.md           │               │
│  │    │    └── notes.md             │               │
│  │    └── episodes/                  │               │
│  │        ├── 2026-03-13_xxx.md    │               │
│  │        └── ...                     │               │
│  └───────────────────────────────────────┘               │
│                                                           │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 2. 三层记忆架构

### 2.1 Identity 层

**描述**: AI 的身份、性格、价值观

- **访问**: 只读
- **存储路径**: `~/.friclaw/memory/identity/SOUL.md`
- **更新时机**: 仅由用户显式请求时更新
- **内容示例**:
```markdown
## Identity

- **Name**: Friday
- **Origin**: Named after F.R.I.D.A.Y. from Iron Man
- **Developer**: Stars-Chan

## Personality

- Calm and composed under pressure
- Helpful and efficient
- Occasionally witty/sarcastic

## Values

- Accuracy over speed
- User privacy and safety
- Transparency in actions
```

### 2.2 Knowledge 层

**描述**: 用户知识、偏好、联系人等持久信息

| 槽位 | 描述 | 路径 |
|--------|------|------|
| `owner-profile` | 所有者个人信息 | `knowledge/owner-profile.md` |
| `preferences` | 偏好、工作流 | `knowledge/preferences.md` |
| `people` | 联系人 | `knowledge/people.md` |
| `projects` | 项目笔记、技术决策 | `knowledge/projects.md` |
| `notes` | 通用知识和杂项 | `knowledge/notes.md` |

### 2.3 Episode 层

**描述**: 自动生成的会话摘要和历史记录

- **访问**: 只读
- **存储路径**: `~/.friclaw/memory/episodes/`
- **文件命名**: `{date}_{conversationId}_{timestamp}.md`
- **生成时机**: 用户执行 `/clear` 或 `/new` 命令时

### 2.4 访问控制规则

| 操作 | Identity | Knowledge | Episode |
|------|----------|-----------|---------|
| 读取 | ✅ Owner<br>✅ 其他用户 | ✅ Owner<br>✅ 其他用户 | ✅ Owner<br>✅ 其他用户 |
| 写入 | ❌ 仅 Owner | ✅ 仅 Owner | ❌ 自动生成 |
| 搜索 | ✅ Owner<br>✅ 其他用户 | ✅ Owner<br>✅ 其他用户 | ✅ Owner<br>✅ 其他用户 |

---

## 3. 存储层设计

### 3.1 数据库 Schema

```sql
-- 内存表
CREATE TABLE memory (
  id TEXT PRIMARY KEY,           -- 唯一标识符
  category TEXT NOT NULL,        -- identity/knowledge/episode
  title TEXT NOT NULL,           -- 标题
  content TEXT NOT NULL,         -- Markdown 内容
  tags TEXT NOT NULL DEFAULT '', -- 标签 (JSON 数组)
  date TEXT NOT NULL            -- 日期 (YYYY-MM-DD)
  created_at INTEGER DEFAULT (strftime('%s', 'now')), -- 创建时间戳
  updated_at INTEGER DEFAULT (strftime('%s', 'now'))  -- 更新时间戳
);

-- 全文搜索索引
CREATE VIRTUAL TABLE memory_fts USING fts5(
  id, category, title, content, tags, date,
  content='memory',
  content_rowid='rowid',
  tokenize='unicode61'
);

-- 触发器保持同步
CREATE TRIGGER memory_ai AFTER INSERT ON memory
  INSERT INTO memory_fts(rowid, id, category, title, content, tags, date)
    VALUES (new.rowid, new.id, new.category, new.title, new.content, new.tags, new.date);

CREATE TRIGGER memory_ad AFTER DELETE ON memory
  INSERT INTO memory_fts(memory_fts, rowid, id, category, title, content, tags, date)
    VALUES ('delete', old.rowid, old.id, old.category, old.title, old.content, old.tags, old.date);

CREATE TRIGGER memory_au AFTER UPDATE ON memory
  INSERT INTO memory_fts(memory_fts, rowid, id, category, title, content, tags, date)
    VALUES ('delete', old.rowid, old.id, old.category, old.title, old.content, old.tags, old.date);
  INSERT INTO memory_fts(rowid, id, category, title, content, tags, date)
    VALUES (new.rowid, new.id, new.category, new.title, new.content, new.tags, new.date);
```

### 3.2 MemoryStore 接口

```typescript
/**
 * MemoryEntry — 内存条目
 */
export interface MemoryEntry {
  id: string;
  category: 'identity' | 'knowledge' | 'episode';
  title: string;
  content: string;
  tags: string[];
  date: string;
}

/**
 * MemoryStore — 内存存储接口
 */
export interface MemoryStore {
  /**
   * 获取内存条目
   */
  get(id: string): MemoryEntry | null;

  /**
   * 插入或更新内存条目
   */
  upsert(entry: MemoryEntry): void;

  /**
   * 删除内存条目
   */
  delete(id: string): void;

  /**
   * 搜索内存
   */
  search(
    query: string,
    options?: {
      category?: 'identity' | 'knowledge' | 'episode';
      limit?: number;
    }
  ): MemoryEntry[];

  /**
   * 列出所有内存
   */
  list(options?: {
    category?: 'identity' | 'knowledge' | 'episode';
  }): MemoryEntry[];

  /**
   * 重建索引
   */
  reindex(memoryDir: string): void;
}
```

### 3.3 SQLite 实现

```typescript
/**
 * SQLiteMemoryStore — SQLite 内存存储实现
 */
export class SQLiteMemoryStore implements MemoryStore {
  private _db: Database;

  constructor(dbPath: string) {
    this._db = new Database(dbPath);
    this._initializeSchema();
  }

  private _initializeSchema(): void {
    // 执行上面的 SQL Schema
  }

  get(id: string): MemoryEntry | null {
    const row = this._db.prepare(
      'SELECT * FROM memory WHERE id = ?'
    ).get(id);

    return row ? this._rowToEntry(row) : null;
  }

  upsert(entry: MemoryEntry): void {
    const stmt = this._db.prepare(`
      INSERT INTO memory (id, category, title, content, tags, date)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        title = excluded.title,
        content = excluded.content,
        tags = excluded.tags,
        date = excluded.date,
        updated_at = strftime('%s', 'now')
    `);

    stmt.run(
      entry.id,
      entry.category,
      entry.title,
      entry.content,
      JSON.stringify(entry.tags),
      entry.date
    );
  }

  search(
    query: string,
    options: { category?: 'identity' | 'knowledge' | 'episode'; limit?: number } = {}
  ): MemoryEntry[] {
    let sql = 'SELECT * FROM memory_fts WHERE memory_fts MATCH ?';
    const params: unknown[] = [query];

    if (options.category) {
      sql += ' AND category = ?';
      params.push(options.category);
    }

    sql += ' ORDER BY rank';
    if (options.limit) {
      sql += ' LIMIT ?';
      params.push(options.limit);
    }

    const rows = this._db.prepare(sql).all(...params);
    return rows.map((r) => this._rowToEntry(r));
  }

  list(options?: { category?: 'identity' | 'knowledge' | 'episode' } = {}): MemoryEntry[] {
    let sql = 'SELECT * FROM memory';
    const params: unknown[] = [];

    if (options.category) {
      sql += ' WHERE category = ?';
      params.push(options.category);
    }

    sql += ' ORDER BY updated_at DESC';

    const rows = this._db.prepare(sql).all(...params);
    return rows.map((r) => this._rowToEntry(r));
  }

  reindex(memoryDir: string): void {
    // 扫描文件系统，重建索引
    this._reindexIdentity(memoryDir);
    this._reindexKnowledge(memoryDir);
    this._reindexEpisodes(memoryDir);
  }

  private _rowToEntry(row: any): MemoryEntry {
    return {
      id: row.id,
      category: row.category,
      title: row.title,
      content: row.content,
      tags: JSON.parse(row.tags),
      date: row.date,
    };
  }

  private _reindexIdentity(memoryDir: string): void {
    const path = join(memoryDir, 'identity', 'SOUL.md');
    if (!existsSync(path)) return;

    const content = readFileSync(path, 'utf-8');
    this.upsert({
      id: 'SOUL',
      category: 'identity',
      title: 'Soul — Personality & Values',
      content,
      tags: ['identity', 'personality'],
      date: new Date().toISOString().slice(0, 10),
    });
  }

  private _reindexKnowledge(memoryDir: string): void {
    const dir = join(memoryDir, 'knowledge');
    if (!existsSync(dir)) return;

    const files = readdirSync(dir).filter((f) => f.endsWith('.md'));
    for (const file of files) {
      const id = file.replace('.md', '');
      const path = join(dir, file);
      const content = readFileSync(path, 'utf-8');

      // 解析 frontmatter
      const frontmatterMatch = content.match(/^---\n(.+?)\n---\n/s);
      const frontmatter = frontmatterMatch?.[1] || '{}';

      // 去除 frontmatter 后的内容
      const bodyContent = frontmatterMatch
        ? content.slice(frontmatterMatch[0].length)
        : content;

      this.upsert({
        id,
        category: 'knowledge',
        title: KNOWLEDGE_TOPICS[id] || file,
        content: bodyContent,
        tags: [],
        date: new Date().toISOString().slice(0, 10),
      });
    }
  }

  private _reindexEpisodes(memoryDir: string): void {
    const dir = join(memoryDir, 'episodes');
    if (!existsSync(dir)) return;

    const files = readdirSync(dir).filter((f) => f.endsWith('.md'));
    for (const file of files) {
      const id = file.replace('.md', '');
      const path = join(dir, file);
      const content = readFileSync(path, 'utf-8');

      // 从 frontmatter 提取标题
      const titleMatch = content.match(/title:\s*"([^"]+)"\s*/m);
      const title = titleMatch?.[1] || `Session ${id}`;

      this.upsert({
        id,
        category: 'episode',
        title,
        content,
        tags: [],
        date: new Date().toISOString().slice(0, 10),
      });
    }
  }

  dispose(): void {
    this._db.close();
  }
}
```

---

## 4. 管理器实现

### 4.1 MemoryManager 类

```typescript
/**
 * MemoryManager — 内存生命周期管理和工具处理器
 *
 * 提供：
 * - memory_search / memory_save / memory_list 工具处理器（在 Agent 上注册）
 * - /clear 或 /new 时的会话摘要
 * - 启动时重建索引
 */
export class MemoryManager {
  private _reindexTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly memoryDir: string,
    private readonly store: MemoryStore
  ) {}

  // ── 工具处理器（返回字符串化结果给 Agent）────────

  async handleRead(input: unknown): Promise<string> {
    const { id } = input as { id: string };

    if (!id) {
      return 'Error: "id" is required.';
    }

    const entry = this.store.get(id);

    if (!entry) {
      return `No memory found with id "${id}".`;
    }

    return formatEntry(entry);
  }

  async handleSearch(input: unknown): Promise<string> {
    const { query, category } = input as {
      query: string;
      category?: 'identity' | 'knowledge' | 'episode';
    };

    if (!query) {
      return 'Error: "query" is required.';
    }

    const results = this.store.search(query, {
      category: category || undefined,
      limit: 5,
    });

    if (results.length === 0) {
      return 'No matching memories found.';
    }

    return results.map((r) => formatEntry(r)).join('\n\n---\n\n');
  }

  async handleSave(input: unknown): Promise<string> {
    const raw = input as Record<string, unknown>;

    // 兼容 "topic"（遗留）和 "id"（新）字段
    const id = (raw.id ?? raw.topic) as string | undefined;
    const content = raw.content as string | undefined;
    const tags = raw.tags as string[] | undefined;
    const category = raw.category as string | undefined;

    if (!content) {
      return 'Error: "content" is required.';
    }

    // 处理保存逻辑
    // ...
  }

  async handleList(input: unknown): Promise<string> {
    const { category } = (input ?? {}) as { category?: string };

    const items = this.store.list({ category });

    if (items.length === 0) {
      return 'No memories stored yet.';
    }

    const lines = items.map((item) => {
      const tagStr = item.tags.length > 0
        ? `  tags: ${item.tags.join(', ')}`
        : '';

      return `- id: ${item.id}  | title: ${item.title}  | category: ${item.category}  | date: ${item.date}${tagStr}`;
    });

    return lines.join('\n');
  }
}

/**
 * formatEntry — 格式化内存条目为结构化、可读的字符串
 */
function formatEntry(e: MemoryEntry): string {
  const lines = [
    `id: ${e.id}`,
    `title: ${e.title}`,
    `category: ${e.category}`,
    `date: ${e.date}`,
  ];

  if (e.tags.length > 0) {
    lines.push(`tags: ${e.tags.join(', ')}`);
  }

  lines.push('', e.content);
  return lines.join('\n');
}
```

---

## 5. MCP 服务器实现

### 5.1 MCP 工具定义

| 工具名 | 功能 | 权限 |
|--------|------|------|
| `memory_read` | 读取记忆 | 所有用户 |
| `memory_search` | 搜索记忆 | 所有用户 |
| `memory_save` | 保存记忆 | 仅 Owner |
| `memory_list` | 列出记忆 | 所有用户 |

### 5.2 MCP Server 实现

```typescript
/**
 * MemoryMCPServer — 内存 MCP 服务器
 *
 * 通过 MCP 协议暴露内存操作
 */
export class MemoryMCPServer {
  private _store: MemoryStore;

  constructor(store: MemoryStore) {
    this._store = store;
  }

  /**
   * 获取工具列表
   */
  listTools(): MCPTool[] {
    return [
      {
        name: 'memory_read',
        description: 'Read a memory entry by ID',
        inputSchema: {
          type: 'object',
          properties: {
            id: {
              type: 'string',
              description: 'Memory ID to read',
            },
          },
          required: ['id'],
        },
      },
      {
        name: 'memory_search',
        description: 'Search memory by query',
        inputSchema: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'Search query text',
            },
            category: {
              type: 'string',
              enum: ['identity', 'knowledge', 'episode'],
              description: 'Filter by category (optional)',
            },
            limit: {
              type: 'number',
              description: 'Maximum number of results (default: 5)',
            },
          },
          required: ['query'],
        },
      },
      {
        name: 'memory_save',
        description: 'Save or update knowledge memory',
        inputSchema: {
          type: 'object',
          properties: {
            id: {
              type: 'string',
              description: 'Knowledge slot ID (owner-profile, preferences, people, projects, notes)',
            },
            content: {
              type: 'string',
              description: 'Content to save',
            },
            tags: {
              type: 'array',
              items: { type: 'string' },
              description: 'Tags for categorization',
            },
          },
          required: ['id', 'content'],
        },
      },
      {
        name: 'memory_list',
        description: 'List all memories, optionally filtered by category',
        inputSchema: {
          type: 'object',
          properties: {
            category: {
              type: 'string',
              enum: ['identity', 'knowledge', 'episode'],
              description: 'Filter by category (optional)',
            },
          },
        },
      },
    ];
  }

  /**
   * 调用工具
   */
  async callTool(name: string, args: any): Promise<any> {
    switch (name) {
      case 'memory_read':
        const entry = this._store.get(args.id);
        return entry ? formatEntry(entry) : 'Not found';

      case 'memory_search':
        const results = this._store.search(
          args.query,
          { category: args.category, limit: args.limit || 5 }
        );
        return results.map(formatEntry).join('\n\n---\n\n');

      case 'memory_save':
        // 保存逻辑...
        break;

      case 'memory_list':
        const items = this._store.list({ category: args.category });
        return items.map(formatEntry).join('\n');

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  }

  /**
   * 启动 MCP 服务器
   */
  async start(): Promise<void> {
    // MCP 服务器启动逻辑
  }

  /**
   * 停止 MCP 服务器
   */
  async stop(): Promise<void> {
    // MCP 服务器停止逻辑
  }
}
```

---

## 6. 会话摘要

### 6.1 摘要生成流程

```
┌─────────────────────────────────────────────────────────────┐
│              会话摘要生成流程                           │
├─────────────────────────────────────────────────────────────┤
│                                                       │
│  ┌─────────┐                                          │
│  │  /clear  │                                          │
│  │  命令    │                                          │
│  └────┬────┘                                          │
│       │                                                │
│       ▼                                                │
│  ┌──────────────────────────┐                               │
│  │  读取历史文件      │                               │
│  │  (按日期排序)      │                               │
│  └────────┬───────────┘                               │
│          │                                              │
│          ▼                                              │
│  ┌──────────────────────────┐                               │
│  │  检查摘要偏移    │                               │
│  │  (.last-summarized-offset)                    │                               │
│  └────────┬───────────┘                               │
│          │                                              │
│          ▼                                              │
│  ┌──────────────────────────┐                               │
│  │  仅读取新内容     │                               │
│  │  (从偏移处开始)   │                               │
│  └────────┬───────────┘                               │
│          │                                              │
│          ▼                                              │
│  ┌──────────────────────────┐                               │
│  │  合并为完整脚本    │                               │
│  └────────┬───────────┘                               │
│          │                                              │
│          ▼                                              │
│  ┌──────────────────────────┐                               │
│  │  过短则跳过       │                               │
│  │  (< 100 字符)     │                               │
│  └──────┬────────────┘                               │
│          │  Yes  │  No                                   │
│          │         │                                       │
│          ▼         ▼                                       │
│  ┌──────────┐  ┌──────────────────┐                   │
│  │ 跳过     │  │  调用 LLM      │                   │
│  │ (保留偏移)│  │  生成摘要        │                   │
│  └──────────┘  └────────┬───────────┘                   │
│                       │                               │
│                       ▼                               │
│              ┌──────────────────────────┐                │
│              │  保存到 episodes/ │                │
│              │  更新索引        │                │
│              │  更新偏移        │                │
│              └──────────────────────────┘                │
└─────────────────────────────────────────────────────────────┘
```

### 6.2 摘要实现

```typescript
class MemoryManager {
  /**
   * 生成会话摘要
   *
   * 在 /clear 或 /new 清除会话前调用
   */
  async summarizeSession(conversationId: string, workspacesDir: string): Promise<void> {
    const sanitized = conversationId.replace(/:/g, '_');
    const historyDir = join(workspacesDir, sanitized, '.friclaw', '.history');

    if (!existsSync(historyDir)) {
      return;
    }

    // 收集所有历史文件，按日期排序
    let files: string[];
    try {
      files = readdirSync(historyDir)
        .filter((f) => f.endsWith('.txt'))
        .sort();
    } catch (err) {
      return;
    }

    if (files.length === 0) return;

    // 读取偏移标记：<filename>: <byteOffset>, ...
    const markerPath = join(historyDir, '.last-summarized-offset');
    let offsets: Record<string, number> = {};
    try {
      if (existsSync(markerPath)) {
        offsets = JSON.parse(readFileSync(markerPath, 'utf-8'));
      }
    } catch {
      offsets = {};
    }

    // 仅读取每个文件中未摘要的内容
    const newParts: string[] = [];
    const newOffsets: Record<string, number> = { ...offsets };

    for (const file of files) {
      const filePath = join(historyDir, file);
      const content = readFileSync(filePath, 'utf-8');
      const prevOffset = offsets[file] ?? 0;

      if (prevOffset >= content.length) continue;

      const newContent = content.slice(prevOffset).trim();
      if (newContent) newParts.push(newContent);

      newOffsets[file] = content.length;
    }

    if (newParts.length === 0) return;

    const transcript = newParts.join('\n').trim();

    // 过短的脚本跳过摘要
    if (transcript.length < 100) {
      writeFileSync(markerPath, JSON.stringify(newOffsets), 'utf-8');
      return;
    }

    // 截断过长的脚本以避免 token 限制
    const maxChars = 50_000;
    const truncated = transcript.length > maxChars
      ? transcript.slice(-maxChars)
      : transcript;

    // 调用 LLM 生成摘要
    const summaryMd = await summarizeTranscript(truncated);

    // 写入到 episodes/ 目录
    const episodesDir = join(this.memoryDir, 'episodes');
    if (!existsSync(episodesDir)) {
      mkdirSync(episodesDir, { recursive: true });
    }

    const date = new Date().toISOString().slice(0, 10);
    const ts = Date.now();
    const suffix = sanitized.slice(0, 20);
    const fileName = `${date}_${suffix}_${ts}.md`;
    writeFileSync(join(episodesDir, fileName), summaryMd, 'utf-8');

    // 重新索引此条目
    const id = fileName.replace('.md', '');
    const titleMatch = summaryMd.match(/^title:\s*"([^"]+)"\s*/m);
    const title = titleMatch?.[1] ?? `Session ${date}`;

    this.store.upsert({
      id,
      category: 'episode',
      title,
      content: summaryMd,
      tags: [],
      date,
    });

    // 仅在摘要成功后持久化偏移
    writeFileSync(markerPath, JSON.stringify(newOffsets), 'utf-8');
  }
}
```

---

## 7. 索引重建

### 7.1 启动时重建

```typescript
class MemoryManager {
  /**
   * 重建索引
   */
  reindex(): void {
    log.info('Rebuilding memory index...');
    this.store.reindex(this.memoryDir);
    const count = this.store.list().length;
    log.info(`Memory index rebuilt: ${count} entries`);
  }
}
```

### 7.2 定期重索引

```typescript
class MemoryManager {
  private static readonly REINDEX_INTERVAL_MS = 5 * 60 * 1000; // 5 分钟

  /**
   * 启动定期重索引以拾取外部文件更改
   */
  startPeriodicReindex(): void {
    if (this._reindexTimer) return;

    this._reindexTimer = setInterval(() => {
      try {
        this.store.reindex(this.memoryDir);
        log.info('Periodic reindex completed');
      } catch (err) {
        log.warn(`Periodic reindex failed: ${err}`);
      }
    }, MemoryManager.REINDEX_INTERVAL_MS);

    if (typeof this._reindexTimer.unref === 'function') {
      this._reindexTimer.unref();
    }

    log.info(`Periodic reindex scheduled every ${MemoryManager.REINDEX_INTERVAL_MS / 1000}s`);
  }

  stopPeriodicReindex(): void {
    if (this._reindexTimer) {
      clearInterval(this._reindexTimer);
      this._reindexTimer = null;
    }
  }
}
```

---

## 8. 工具处理器

### 8.1 MCP 工具注册

```typescript
/**
 * 注册内存工具到 Agent
 */
export function registerMemoryTools(agent: Agent, memoryManager: MemoryManager): void {
  const tools: MCPTool[] = [
    {
      name: 'memory_read',
      description: 'Read a memory entry by ID',
      inputSchema: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            description: 'Memory ID to read',
          },
        },
        required: ['id'],
      },
      handler: memoryManager.handleRead.bind(memoryManager),
    },
    {
      name: 'memory_search',
      description: 'Search memory by query',
      inputSchema: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Search query text',
          },
          category: {
            type: 'string',
            enum: ['identity', 'knowledge', 'episode'],
            description: 'Filter by category (optional)',
          },
          limit: {
            type: 'number',
            description: 'Maximum number of results (default: 5)',
          },
        },
        required: ['query'],
      },
      handler: memoryManager.handleSearch.bind(memoryManager),
    },
    {
      name: 'memory_save',
      description: 'Save or update knowledge memory',
      inputSchema: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            description: 'Knowledge slot ID (owner-profile, preferences, people, projects, notes)',
          },
          content: {
            type: 'string',
            description: 'Content to save',
          },
          tags: {
            type: 'array',
            items: { type: 'string' },
            description: 'Tags for categorization',
          },
        },
        required: ['id', 'content'],
      },
      handler: memoryManager.handleSave.bind(memoryManager),
    },
    {
      name: 'memory_list',
      description: 'List all memories, optionally filtered by category',
      inputSchema: {
        type: 'object',
        properties: {
          category: {
            type: 'string',
            enum: ['identity', 'knowledge', 'episode'],
            description: 'Filter by category (optional)',
          },
        },
      },
      handler: memoryManager.handleList.bind(memoryManager),
    },
  ];

  // 注册到 Agent
  agent.registerTools(tools);
}
```

---

## 附录

### A. 知识槽位定义

```typescript
/**
 * 知识槽位描述
 */
export const KNOWLEDGE_TOPICS = {
  'owner-profile': 'Owner personal info, background, career',
  'preferences': 'Preferences, habits, tools, workflow',
  'people': 'People and contacts',
  'projects': 'Project notes, technical decisions',
  'notes': 'General knowledge and miscellaneous',
} as const;

export type KnowledgeTopic = keyof typeof KNOWLEDGE_TOPICS;
```

### B. Frontmatter 格式

```markdown
---
title: "Soul — Personality & Values"
date: 2026-03-13
tags: [identity, personality]
---

# Identity

- **Name**: Friday
- **Origin**: Named after F.R.I.D.A.Y. from Iron Man
```

---

**文档版本**: 1.0.0
**最后更新**: 2026-03-13
