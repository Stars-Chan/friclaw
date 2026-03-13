# 06. 内存系统模块

> FriClaw 三层内存系统详细实现文档
>
> **版本**: 1.0.0
> **作者**: Stars-Chan
> **日期**: 2026-03-13
> **状态**: 📋 待实现

---

## 1. 概述

### 1.1 模块职责

内存系统负责管理 AI 的三层记忆：身份层（Identity）、知识层（Knowledge）、会话层（Episode），提供持久化存储和全文搜索功能。

**核心功能**:
- 三层记忆架构（Identity/Knowledge/Episode）
- SQLite + FTS5 全文搜索
- 记忆的增删改查
- 语义相似度搜索
- 记忆自动注入到 LLM 上下文
- MCP 服务暴露内存操作

### 1.2 与其他模块的关系

```
内存系统
    ↑
    ├──> 配置系统（获取配置）
    ├──> 日志系统（输出日志）
    ↑
    ├──> Agent 层（获取上下文记忆）
    └──> MCP 框架（作为 MCP 服务）
```

---

## 2. 架构设计

### 2.1 三层记忆架构

```
┌─────────────────────────────────────────────────────────────┐
│                    FriClaw 内存系统                        │
├─────────────────────────────────────────────────────────────┤
│                                                           │
│  ┌───────────────────────────────────────────────────┐    │
│  │  Identity 层 (只读)                            │    │
│  │  - AI 身份、性格、价值观                         │    │
│  │  - SOUL.md                                     │    │
│  │  - 系统启动时加载                               │    │
│  │  - 用户不可修改                                 │    │
│  └───────────────────────────────────────────────────┘    │
│                           ↑                              │
│                           │ 自动注入到上下文              │
│                           ↓                              │
│  ┌───────────────────────────────────────────────────┐    │
│  │  Knowledge 层 (读写)                           │    │
│  │  - 用户知识、偏好、联系人                        │    │
│  │  - owner-profile.md                             │    │
│  │  - preferences.md                               │    │
│  │  - people.md                                    │    │
│  │  - projects.md                                  │    │
│  │  - notes.md                                     │    │
│  │  - 用户可读写                                   │    │
│  └───────────────────────────────────────────────────┘    │
│                           ↑                              │
│                           │ 检索并注入                  │
│                           ↓                              │
│  ┌───────────────────────────────────────────────────┐    │
│  │  Episode 层 (只读)                            │    │
│  │  - 会话摘要、历史记录                           │    │
│  │  - {YYYY-MM-DD}_episodes.md                     │    │
│  │  - 自动生成，定时更新                           │    │
│  │  - 用户不可修改                                 │    │
│  └───────────────────────────────────────────────────┘    │
│                           ↑                              │
│                           │ 语义搜索                     │
│                           ↓                              │
│  ┌───────────────────────────────────────────────────┐    │
│  │  SQLite + FTS5 全文搜索                      │    │
│  │  - memory 表                                   │    │
│  │  - memory_fts 全文索引                         │    │
│  │  - 支持 BM25 算法                              │    │
│  └───────────────────────────────────────────────────┘    │
│                                                           │
└─────────────────────────────────────────────────────────────┘
```

### 2.2 核心组件

```typescript
// 内存管理器
class MemoryManager {
  private db: Database;
  private config: MemoryConfig;
  private identity: IdentityMemory;
  private knowledge: KnowledgeMemory;
  private episodes: EpisodeMemory;

  // 初始化
  async initialize(config: MemoryConfig): Promise<void>;

  // Identity 层操作
  getIdentity(): string;
  loadIdentity(): Promise<void>;

  // Knowledge 层操作
  async getKnowledge(id: string): Promise<Memory | null>;
  async saveKnowledge(id: string, content: string, tags?: string[]): Promise<void>;
  async searchKnowledge(query: string, limit?: number): Promise<Memory[]>;
  async listKnowledge(): Promise<Memory[]>;

  // Episode 层操作
  async getEpisodes(date?: string): Promise<Memory[]>;
  async searchEpisodes(query: string, limit?: number): Promise<Memory[]>;

  // 全局搜索
  async search(query: string, options?: SearchOptions): Promise<Memory[]>;
  async list(category?: MemoryCategory): Promise<Memory[]>;

  // 数据库操作
  close(): void;
}

// Identity 层
class IdentityMemory {
  private content: string = '';
  private readonly filePath: string;

  load(): Promise<void>;
  get(): string;
}

// Knowledge 层
class KnowledgeMemory {
  private manager: MemoryManager;
  private readonly slots = [
    'owner-profile',
    'preferences',
    'people',
    'projects',
    'notes',
  ];

  get(id: string): Promise<Memory | null>;
  save(id: string, content: string, tags?: string[]): Promise<void>;
  search(query: string, limit?: number): Promise<Memory[]>;
  list(): Promise<Memory[]>;
}

// Episode 层
class EpisodeMemory {
  private manager: MemoryManager;

  get(date?: string): Promise<Memory[]>;
  search(query: string, limit?: number): Promise<Memory[]>;
  generate(date: string, conversations: Conversation[]): Promise<void>;
}
```

---

## 3. 详细设计

### 3.1 数据结构

```typescript
// 记忆类别
enum MemoryCategory {
  IDENTITY = 'identity',
  KNOWLEDGE = 'knowledge',
  EPISODE = 'episode',
}

// 记忆条目
interface Memory {
  id: string;
  category: MemoryCategory;
  title: string;
  content: string;
  tags: string[];
  date: string;  // YYYY-MM-DD
}

// 搜索选项
interface SearchOptions {
  category?: MemoryCategory;
  limit?: number;
  offset?: number;
  dateFrom?: string;
  dateTo?: string;
  tags?: string[];
}

// 搜索结果
interface SearchResult extends Memory {
  score: number;  // 相关性分数
}

// 记忆配置
interface MemoryConfig {
  dir: string;
  searchLimit: number;
  cacheSize?: number;
  autoPrune?: boolean;
}

// 对话（用于生成 Episode）
interface Conversation {
  id: string;
  userId: string;
  timestamp: Date;
  messages: Message[];
}

// 对话消息
interface Message {
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}
```

### 3.2 数据库 Schema

```sql
-- 记忆表
CREATE TABLE IF NOT EXISTS memory (
  id TEXT PRIMARY KEY,
  category TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  tags TEXT NOT NULL DEFAULT '',
  date TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 全文搜索索引
CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(
  id,
  category,
  title,
  content,
  tags,
  date,
  content='memory',
  content_rowid='rowid',
  tokenize='unicode61 remove_diacritics 1'
);

-- 创建索引
CREATE INDEX IF NOT EXISTS idx_memory_category ON memory(category);
CREATE INDEX IF NOT EXISTS idx_memory_date ON memory(date);
CREATE INDEX IF NOT EXISTS idx_memory_tags ON memory(tags);

-- 触发器：插入时同步到 FTS
CREATE TRIGGER IF NOT EXISTS memory_ai AFTER INSERT ON memory
BEGIN
  INSERT INTO memory_fts(rowid, id, category, title, content, tags, date)
    VALUES (new.rowid, new.id, new.category, new.title, new.content, new.tags, new.date);
END;

-- 触发器：删除时从 FTS 移除
CREATE TRIGGER IF NOT EXISTS memory_ad AFTER DELETE ON memory
BEGIN
  INSERT INTO memory_fts(memory_fts, rowid, id, category, title, content, tags, date)
    VALUES ('delete', old.rowid, old.id, old.category, old.title, old.content, old.tags, old.date);
END;

-- 触发器：更新时同步到 FTS
CREATE TRIGGER IF NOT EXISTS memory_au AFTER UPDATE ON memory
BEGIN
  INSERT INTO memory_fts(memory_fts, rowid, id, category, title, content, tags, date)
    VALUES ('delete', old.rowid, old.id, old.category, old.title, old.content, old.tags, old.date);
  INSERT INTO memory_fts(rowid, id, category, title, content, tags, date)
    VALUES (new.rowid, new.id, new.category, new.title, new.content, new.tags, new.date);
END;
```

### 3.3 Identity 层实现

```typescript
class IdentityMemory {
  private content: string = '';
  private readonly filePath: string;

  constructor(memoryDir: string) {
    this.filePath = path.join(memoryDir, 'SOUL.md');
  }

  /**
   * 加载 Identity
   */
  async load(): Promise<void> {
    try {
      const data = await fs.promises.readFile(this.filePath, 'utf-8');
      this.content = data;
    } catch (error) {
      // 文件不存在时使用默认 Identity
      this.content = this.getDefaultIdentity();
      await this.save();
    }
  }

  /**
   * 获取 Identity
   */
  get(): string {
    return this.content;
  }

  /**
   * 保存 Identity（系统内部使用）
   */
  private async save(): Promise<void> {
    await fs.promises.mkdir(path.dirname(this.filePath), { recursive: true });
    await fs.promises.writeFile(this.filePath, this.content, 'utf-8');
  }

  /**
   * 默认 Identity
   */
  private getDefaultIdentity(): string {
    return `# FriClaw 身份定义

你是 FriClaw，一个由 Stars-Chan 开发的 AI 智能助手。

## 核心特点

- **专业**: 提供准确、可靠的帮助
- **友好**: 使用简洁明了的语言
- **高效**: 快速响应并解决问题
- **学习**: 从互动中不断改进

## 工作原则

1. 始终以用户需求为中心
2. 诚实面对不确定的情况
3. 保护用户隐私和数据安全
4. 提供可操作的建议

## 禁止事项

- 不要泄露用户的敏感信息
- 不要臆造不存在的信息
- 不要执行非法或有害的操作
`;
  }
}
```

### 3.4 Knowledge 层实现

```typescript
class KnowledgeMemory {
  private manager: MemoryManager;
  private readonly slots = [
    'owner-profile',
    'preferences',
    'people',
    'projects',
    'notes',
  ];

  constructor(manager: MemoryManager) {
    this.manager = manager;
  }

  /**
   * 获取知识条目
   */
  async get(id: string): Promise<Memory | null> {
    if (!this.slots.includes(id)) {
      throw new Error(`Invalid knowledge slot: ${id}`);
    }

    const memory = await this.manager.getMemory(id);
    return memory;
  }

  /**
   * 保存知识条目
   */
  async save(id: string, content: string, tags: string[] = []): Promise<void> {
    if (!this.slots.includes(id)) {
      throw new Error(`Invalid knowledge slot: ${id}`);
    }

    // 读取现有内容（如果是更新）
    const existing = await this.get(id);
    const memory: Memory = {
      id,
      category: MemoryCategory.KNOWLEDGE,
      title: this.getSlotTitle(id),
      content,
      tags,
      date: existing?.date || new Date().toISOString().split('T')[0],
    };

    await this.manager.saveMemory(memory);

    // 同步保存到文件
    await this.saveToFile(id, content);
  }

  /**
   * 搜索知识
   */
  async search(query: string, limit: number = 5): Promise<Memory[]> {
    return await this.manager.search(query, {
      category: MemoryCategory.KNOWLEDGE,
      limit,
    });
  }

  /**
   * 列出所有知识
   */
  async list(): Promise<Memory[]> {
    return await this.manager.list(MemoryCategory.KNOWLEDGE);
  }

  /**
   * 获取槽位标题
   */
  private getSlotTitle(id: string): string {
    const titles: Record<string, string> = {
      'owner-profile': 'Owner Profile',
      'preferences': 'Preferences',
      'people': 'People',
      'projects': 'Projects',
      'notes': 'Notes',
    };
    return titles[id] || id;
  }

  /**
   * 保存到文件
   */
  private async saveToFile(id: string, content: string): Promise<void> {
    const dir = this.manager.getConfig().dir;
    const filePath = path.join(dir, 'knowledge', `${id}.md`);

    await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
    await fs.promises.writeFile(filePath, content, 'utf-8');
  }
}
```

### 3.5 Episode 层实现

```typescript
class EpisodeMemory {
  private manager: MemoryManager;

  constructor(manager: MemoryManager) {
    this.manager = manager;
  }

  /**
   * 获取日期的 Episode
   */
  async get(date?: string): Promise<Memory[]> {
    const targetDate = date || new Date().toISOString().split('T')[0];

    const result = this.manager.getDb().prepare(`
      SELECT * FROM memory
      WHERE category = ? AND date = ?
      ORDER BY created_at DESC
    `).all(MemoryCategory.EPISODE, targetDate);

    return result.map(row => this.rowToMemory(row));
  }

  /**
   * 搜索 Episode
   */
  async search(query: string, limit: number = 5): Promise<Memory[]> {
    return await this.manager.search(query, {
      category: MemoryCategory.EPISODE,
      limit,
    });
  }

  /**
   * 生成 Episode
   */
  async generate(date: string, conversations: Conversation[]): Promise<void> {
    // 1. 汇总所有对话
    const allMessages = conversations.flatMap(conv => conv.messages);

    if (allMessages.length === 0) {
      return;
    }

    // 2. 生成摘要
    const summary = await this.generateSummary(allMessages);

    // 3. 保存为 Episode
    const memory: Memory = {
      id: `${date}_episodes`,
      category: MemoryCategory.EPISODE,
      title: `Episodes for ${date}`,
      content: summary,
      tags: ['auto-generated'],
      date,
    };

    await this.manager.saveMemory(memory);

    // 4. 保存到文件
    await this.saveToFile(date, summary);
  }

  /**
   * 生成摘要
   */
  private async generateSummary(messages: Message[]): Promise<string> {
    // TODO: 调用 LLM 生成摘要
    // 这里简化实现
    const summary: string[] = [];

    for (const msg of messages.slice(-50)) {  // 只取最近 50 条
      const role = msg.role === 'user' ? 'User' : 'Assistant';
      summary.push(`**${role}**: ${msg.content}`);
    }

    return summary.join('\n\n');
  }

  /**
   * 保存到文件
   */
  private async saveToFile(date: string, content: string): Promise<void> {
    const dir = this.manager.getConfig().dir;
    const filePath = path.join(dir, 'episodes', `${date}_episodes.md`);

    await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
    await fs.promises.writeFile(filePath, content, 'utf-8');
  }
}
```

### 3.6 全文搜索实现

```typescript
class MemoryManager {
  /**
   * 全文搜索
   */
  async search(query: string, options: SearchOptions = {}): Promise<Memory[]> {
    const {
      category,
      limit = this.config.searchLimit,
      offset = 0,
      dateFrom,
      dateTo,
      tags,
    } = options;

    // 构建 FTS 查询
    const conditions: string[] = ['memory_fts MATCH ?'];
    const params: any[] = [this.buildFtsQuery(query)];

    // 类别过滤
    if (category) {
      conditions.push('category = ?');
      params.push(category);
    }

    // 日期范围过滤
    if (dateFrom) {
      conditions.push('date >= ?');
      params.push(dateFrom);
    }
    if (dateTo) {
      conditions.push('date <= ?');
      params.push(dateTo);
    }

    // 标签过滤
    if (tags && tags.length > 0) {
      const tagConditions = tags.map(() => 'tags LIKE ?').join(' OR ');
      conditions.push(`(${tagConditions})`);
      params.push(...tags.map(tag => `%"${tag}"%`));
    }

    // 执行查询
    const sql = `
      SELECT
        memory.id,
        memory.category,
        memory.title,
        memory.content,
        memory.tags,
        memory.date,
        bm25(memory_fts) as score
      FROM memory
      INNER JOIN memory_fts ON memory.id = memory_fts.id
      WHERE ${conditions.join(' AND ')}
      ORDER BY score ASC
      LIMIT ? OFFSET ?
    `;

    params.push(limit, offset);

    const results = this.db.prepare(sql).all(...params);

    return results.map(row => ({
      id: row.id,
      category: row.category,
      title: row.title,
      content: row.content,
      tags: JSON.parse(row.tags || '[]'),
      date: row.date,
      score: row.score,
    }));
  }

  /**
   * 构建 FTS 查询
   */
  private buildFtsQuery(query: string): string {
    // 移除特殊字符
    const cleaned = query.replace(/[^\p{L}\p{N}\s-]/gu, ' ').trim();

    // 分词
    const terms = cleaned.split(/\s+/).filter(t => t.length > 0);

    if (terms.length === 0) {
      return '*';
    }

    // 构建 OR 查询
    return terms.map(term => {
      if (term.includes(' ')) {
        // 短语用引号包裹
        return `"${term}"`;
      }
      return term;
    }).join(' OR ');
  }
}
```

---

## 4. 接口规范

### 4.1 公共 API

```typescript
interface IMemoryManager {
  /**
   * 初始化内存系统
   */
  initialize(config: MemoryConfig): Promise<void>;

  /**
   * 获取 Identity
   */
  getIdentity(): string;

  /**
   * 获取记忆条目
   */
  getMemory(id: string): Promise<Memory | null>;

  /**
   * 保存记忆条目
   */
  saveMemory(memory: Memory): Promise<void>;

  /**
   * 删除记忆条目
   */
  deleteMemory(id: string): Promise<void>;

  /**
   * 搜索记忆
   */
  search(query: string, options?: SearchOptions): Promise<Memory[]>;

  /**
   * 列出记忆
   */
  list(category?: MemoryCategory): Promise<Memory[]>;

  /**
   * 关闭数据库
   */
  close(): void;
}

interface IKnowledgeMemory {
  /**
   * 获取知识条目
   */
  get(id: string): Promise<Memory | null>;

  /**
   * 保存知识条目
   */
  save(id: string, content: string, tags?: string[]): Promise<void>;

  /**
   * 搜索知识
   */
  search(query: string, limit?: number): Promise<Memory[]>;

  /**
   * 列出所有知识
   */
  list(): Promise<Memory[]>;
}

interface IEpisodeMemory {
  /**
   * 获取 Episode
   */
  get(date?: string): Promise<Memory[]>;

  /**
   * 搜索 Episode
   */
  search(query: string, limit?: number): Promise<Memory[]>;

  /**
   * 生成 Episode
   */
  generate(date: string, conversations: Conversation[]): Promise<void>;
}
```

### 4.2 MCP 工具定义

```typescript
// 内存 MCP 服务的工具
const MEMORY_TOOLS: MCPTool[] = [
  {
    name: 'memory_list',
    description: '列出所有存储的记忆条目',
    inputSchema: {
      type: 'object',
      properties: {
        category: {
          type: 'string',
          enum: ['identity', 'knowledge', 'episode'],
          description: '记忆类别',
        },
      },
    },
  },

  {
    name: 'memory_read',
    description: '读取特定的记忆条目',
    inputSchema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: '记忆 ID',
        },
      },
      required: ['id'],
    },
  },

  {
    name: 'memory_search',
    description: '搜索记忆条目',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: '搜索查询',
        },
        category: {
          type: 'string',
          enum: ['identity', 'knowledge', 'episode'],
          description: '记忆类别',
        },
        limit: {
          type: 'number',
          description: '返回结果数量限制',
          default: 5,
        },
      },
      required: ['query'],
    },
  },

  {
    name: 'memory_save',
    description: '保存知识记忆（仅 Knowledge 层）',
    inputSchema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          enum: ['owner-profile', 'preferences', 'people', 'projects', 'notes'],
          description: '知识槽位 ID',
        },
        content: {
          type: 'string',
          description: 'Markdown 格式的内容',
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: '标签列表',
        },
      },
      required: ['id', 'content'],
    },
  },
];
```

---

## 5. 实现细节

### 5.1 记忆注入到上下文

```typescript
/**
 * 为对话准备记忆上下文
 */
async function prepareMemoryContext(
  query: string,
  userMessage: string
): Promise<string> {
  const manager = MemoryManager.getInstance();

  // 1. 获取 Identity
  const identity = manager.getIdentity();

  // 2. 搜索相关 Knowledge
  const knowledgeResults = await manager.search(
    `${query} ${userMessage}`,
    {
      category: MemoryCategory.KNOWLEDGE,
      limit: 3,
    }
  );

  // 3. 搜索相关 Episode
  const episodeResults = await manager.search(
    userMessage,
    {
      category: MemoryCategory.EPISODE,
      limit: 2,
    }
  );

  // 4. 组装上下文
  const context: string[] = [];

  context.push('## Your Identity\n');
  context.push(identity);
  context.push('\n');

  if (knowledgeResults.length > 0) {
    context.push('## Relevant Knowledge\n');
    for (const mem of knowledgeResults) {
      context.push(`### ${mem.title}\n`);
      context.push(mem.content);
      context.push('\n');
    }
  }

  if (episodeResults.length > 0) {
    context.push('## Relevant Episodes\n');
    for (const mem of episodeResults) {
      context.push(`### ${mem.title}\n`);
      context.push(mem.content);
      context.push('\n');
    }
  }

  return context.join('');
}
```

### 5.2 记忆同步

```typescript
/**
 * 将文件系统中的记忆同步到数据库
 */
async function syncMemoriesFromFiles(memoryDir: string): Promise<void> {
  const manager = MemoryManager.getInstance();

  // 同步 Knowledge
  const knowledgeDir = path.join(memoryDir, 'knowledge');
  const files = await fs.promises.readdir(knowledgeDir);

  for (const file of files) {
    if (file.endsWith('.md')) {
      const id = file.replace('.md', '');
      const filePath = path.join(knowledgeDir, file);
      const content = await fs.promises.readFile(filePath, 'utf-8');

      await manager.saveMemory({
        id,
        category: MemoryCategory.KNOWLEDGE,
        title: id,
        content,
        tags: [],
        date: new Date().toISOString().split('T')[0],
      });
    }
  }

  // 同步 Episodes
  const episodesDir = path.join(memoryDir, 'episodes');
  // ... 类似逻辑
}
```

### 5.3 记忆清理

```typescript
/**
 * 清理过期记忆
 */
async function pruneOldMemories(): Promise<void> {
  const manager = MemoryManager.getInstance();
  const config = manager.getConfig();

  if (!config.autoPrune) {
    return;
  }

  const maxAge = config.maxAge || (7 * 24 * 3600); // 7天
  const cutoffDate = new Date(Date.now() - maxAge * 1000)
    .toISOString()
    .split('T')[0];

  // 清理过期的 Episode
  const db = manager.getDb();
  db.prepare(`
    DELETE FROM memory
    WHERE category = ?
      AND date < ?
  `).run(MemoryCategory.EPISODE, cutoffDate);

  // 清理对应的文件
  const episodesDir = path.join(config.dir, 'episodes');
  const files = await fs.promises.readdir(episodesDir);

  for (const file of files) {
    if (file.endsWith('.md')) {
      const date = file.split('_')[0];
      if (date < cutoffDate) {
        await fs.promises
          .unlink(path.join(episodesDir, file))
          .catch(() => {});
      }
    }
  }
}
```

---

## 6. 测试策略

### 6.1 单元测试范围

```typescript
describe('MemoryManager', () => {
  describe('search()', () => {
    it('should return relevant results');
    it('should filter by category');
    it('should respect limit');
    it('should handle empty query');
    it('should handle special characters');
  });

  describe('saveMemory()', () => {
    it('should insert new memory');
    it('should update existing memory');
    it('should update FTS index');
  });

  describe('deleteMemory()', () => {
    it('should delete memory');
    it('should update FTS index');
  });
});

describe('IdentityMemory', () => {
  it('should load from file');
  it('should use default if file missing');
  it('should return content');
});

describe('KnowledgeMemory', () => {
  it('should validate slot IDs');
  it('should save and retrieve');
  it('should search within knowledge');
});

describe('EpisodeMemory', () => {
  it('should generate summary');
  it('should save to file');
  it('should retrieve by date');
});
```

### 6.2 集成测试场景

1. 完整的记忆生命周期
2. 跨文件和数据库的同步
3. FTS 搜索准确性
4. 记忆注入到 LLM 上下文

### 6.3 性能测试指标

- 搜索响应时间: < 50ms (1000 条记录)
- 插入响应时间: < 10ms
- Identity 加载时间: < 5ms

---

## 7. 依赖关系

### 7.1 外部依赖

```json
{
  "dependencies": {
    "better-sqlite3": "^10.0.0"
  }
}
```

### 7.2 内部模块依赖

```
内存系统
    ↑
    ├──> 配置系统（获取配置）
    ├──> 日志系统（输出日志）
    └──> Agent 层（提供上下文）
```

### 7.3 启动顺序

```
1. 配置系统
2. 日志系统
3. 内存系统 ← 第三个启动
4. 其他模块...
```

---

## 8. 配置项

### 8.1 可配置参数

| 路径 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `memory.dir` | string | `~/.friclaw/memory` | 内存目录 |
| `memory.searchLimit` | number | `5` | 搜索结果限制 |
| `memory.cacheSize` | number | `1000` | 缓存大小 |
| `memory.autoPrune` | boolean | `true` | 自动清理过期记忆 |

### 8.2 目录结构

```
~/.friclaw/memory/
├── SOUL.md                    # Identity 层
├── memory.db                 # SQLite 数据库
├── knowledge/                 # Knowledge 层
│   ├── owner-profile.md
│   ├── preferences.md
│   ├── people.md
│   ├── projects.md
│   └── notes.md
└── episodes/                 # Episode 层
    ├── 2026-03-10_episodes.md
    ├── 2026-03-11_episodes.md
    └── 2026-03-12_episodes.md
```

---

## 9. 监控和日志

### 9.1 关键指标

- 记忆总数（按类别）
- 搜索查询数量
- 平均搜索响应时间
- FTS 索引大小

### 9.2 日志级别

| 级别 | 用途 |
|------|------|
| `debug` | 详细查询信息 |
| `info` | 记忆保存/删除 |
| `warn` | 搜索结果为空 |
| `error` | 数据库错误 |

---

## 10. 安全考虑

### 10.1 文件权限

```typescript
/**
 * 设置内存目录权限
 */
async function secureMemoryDir(dir: string): Promise<void> {
  await fs.promises.mkdir(dir, { recursive: true });
  await fs.promises.chmod(dir, 0o700);
}
```

### 10.2 SQL 注入防护

使用参数化查询，避免字符串拼接。

### 10.3 敏感信息过滤

```typescript
/**
 * 过滤记忆内容中的敏感信息
 */
function sanitizeMemory(content: string): string {
  // TODO: 实现 PII 检测和过滤
  return content;
}
```

---

**文档版本**: 1.0.0
**最后更新**: 2026-03-13
