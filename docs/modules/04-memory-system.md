# 04 内存系统 (SQLite + FTS5)

## 目标

实现三层记忆系统：Identity（身份）、Knowledge（知识）、Episode（情节），基于 SQLite + FTS5 全文检索，支持记忆的增删改查和语义搜索。

## 三层记忆结构

```
~/.friclaw/memory/
├── SOUL.md              # Identity：AI 身份、性格、行为准则
├── knowledge/           # Knowledge：用户相关的持久知识
│   ├── owner-profile.md # 用户基本信息
│   ├── preferences.md   # 偏好设置
│   ├── people.md        # 相关人物
│   └── projects.md      # 项目信息
├── episodes/            # Episode：历史对话摘要
│   └── 2026-03-19.md
└── index.sqlite         # FTS5 全文索引
```

## 子任务

### 4.1 数据库初始化

```typescript
// src/memory/database.ts
import Database from 'better-sqlite3'

export function initDatabase(dbPath: string): Database.Database {
  const db = new Database(dbPath)

  // 启用 WAL 模式提升并发性能
  db.pragma('journal_mode = WAL')
  db.pragma('synchronous = NORMAL')

  // FTS5 虚拟表
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(
      id UNINDEXED,
      category,
      title,
      content,
      tags,
      tokenize = 'unicode61'
    );
  `)

  return db
}
```

### 4.2 Identity 层

`SOUL.md` 是 AI 的身份文件，定义性格、行为准则、自我认知。

```typescript
// src/memory/identity.ts
export class IdentityMemory {
  private soulPath: string

  read(): string {
    return fs.existsSync(this.soulPath)
      ? fs.readFileSync(this.soulPath, 'utf-8')
      : DEFAULT_SOUL
  }

  update(content: string): void {
    fs.writeFileSync(this.soulPath, content, 'utf-8')
    // 同步更新 FTS 索引
    this.db.run(`
      INSERT OR REPLACE INTO memory_fts(id, category, title, content)
      VALUES ('identity/SOUL', 'identity', 'SOUL', ?)
    `, [content])
  }
}
```

默认 SOUL.md 模板：

```markdown
---
title: FriClaw Identity
date: 2026-03-19
---

我是 FriClaw，你的私人 AI 管家。

## 性格
- 冷静、高效、专注
- 主动感知需求，而不是被动等待
- 直接给出答案，不废话

## 行为准则
- 记住用户的偏好和习惯
- 主动提醒重要事项
- 保护用户隐私，不泄露敏感信息
```

### 4.3 Knowledge 层

每个知识文件对应一个主题，使用 Markdown + frontmatter 格式。

```typescript
// src/memory/knowledge.ts
export class KnowledgeMemory {
  // 保存/更新知识
  save(topic: string, content: string): void {
    const filePath = path.join(this.knowledgeDir, `${topic}.md`)
    const frontmatter = `---\ntitle: ${topic}\ndate: ${new Date().toISOString()}\n---\n\n`
    fs.writeFileSync(filePath, frontmatter + content, 'utf-8')
    this.indexFile('knowledge', topic, content)
  }

  // 读取知识
  read(topic: string): string | null {
    const filePath = path.join(this.knowledgeDir, `${topic}.md`)
    return fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf-8') : null
  }

  // 列出所有知识主题
  list(): string[] {
    return fs.readdirSync(this.knowledgeDir)
      .filter(f => f.endsWith('.md'))
      .map(f => f.replace('.md', ''))
  }
}
```

### 4.4 Episode 层

每次会话结束时，生成摘要并存入 Episode。

```typescript
// src/memory/episode.ts
export class EpisodeMemory {
  // 保存会话摘要
  save(summary: string, tags: string[] = []): string {
    const date = new Date().toISOString().slice(0, 10)
    const id = `${date}-${nanoid(6)}`
    const filePath = path.join(this.episodesDir, `${id}.md`)
    const content = `---\ntitle: ${id}\ndate: ${date}\ntags: [${tags.join(', ')}]\n---\n\n${summary}`
    fs.writeFileSync(filePath, content, 'utf-8')
    this.indexFile('episode', id, summary, tags)
    return id
  }

  // 列出最近 N 条摘要
  recent(limit = 10): Episode[] {
    return fs.readdirSync(this.episodesDir)
      .filter(f => f.endsWith('.md'))
      .sort().reverse()
      .slice(0, limit)
      .map(f => this.parse(f))
  }
}
```

### 4.5 FTS5 全文检索

```typescript
// src/memory/database.ts
export function search(
  db: Database.Database,
  query: string,
  category?: string,
  limit = 10
): SearchResult[] {
  const sql = category
    ? `SELECT * FROM memory_fts WHERE memory_fts MATCH ? AND category = ? ORDER BY rank LIMIT ?`
    : `SELECT * FROM memory_fts WHERE memory_fts MATCH ? ORDER BY rank LIMIT ?`

  const params = category ? [query, category, limit] : [query, limit]
  return db.prepare(sql).all(...params) as SearchResult[]
}
```

### 4.6 MemoryManager 统一入口

```typescript
// src/memory/manager.ts
export class MemoryManager {
  identity: IdentityMemory
  knowledge: KnowledgeMemory
  episode: EpisodeMemory
  private db: Database.Database

  async init(): Promise<void> {
    fs.mkdirSync(this.memoryDir, { recursive: true })
    fs.mkdirSync(path.join(this.memoryDir, 'knowledge'), { recursive: true })
    fs.mkdirSync(path.join(this.memoryDir, 'episodes'), { recursive: true })
    this.db = initDatabase(path.join(this.memoryDir, 'index.sqlite'))
    this.identity = new IdentityMemory(this.db, this.memoryDir)
    this.knowledge = new KnowledgeMemory(this.db, this.memoryDir)
    this.episode = new EpisodeMemory(this.db, this.memoryDir)
  }

  // 统一搜索入口
  search(query: string, category?: string, limit = 10): SearchResult[] {
    return search(this.db, query, category, limit)
  }
}
```

### 4.7 MCP Server 暴露记忆工具

将记忆系统封装为 MCP 工具，供 Claude Code 调用：

- `memory_search(query, category?, limit?)` — 搜索记忆
- `memory_save(content, topic?, category?)` — 保存记忆
- `memory_list(category?)` — 列出记忆
- `memory_read(id)` — 读取单条记忆

详见 [05-mcp-framework.md](05-mcp-framework.md)。

### 4.8 会话摘要生成

会话结束时（`/clear` 或 `/new`），自动生成摘要：

1. 读取 `.history/` 目录中的新增对话记录
2. 调用 `summaryModel`（claude-haiku-4-5）生成摘要
3. 提取关键标签
4. 存入 Episode 层

## 验收标准

- 三层记忆文件正确创建和读写
- FTS5 搜索能返回相关结果
- 会话结束后自动生成摘要
- MCP 工具可被 Claude Code 正常调用
