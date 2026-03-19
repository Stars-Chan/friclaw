# Memory System Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现三层记忆系统（Identity / Knowledge / Episode），基于 SQLite + FTS5 全文检索，替换 `src/memory/manager.ts` 中的 stub 实现。

**Architecture:** 新增 `src/memory/database.ts` 初始化 SQLite + FTS5；`src/memory/identity.ts` / `knowledge.ts` / `episode.ts` 分别实现三层；`src/memory/manager.ts` 作为统一入口整合三层并暴露 `search()` 接口。MCP 工具封装留给 module 05。

**Tech Stack:** Bun, TypeScript, better-sqlite3, nanoid, bun:test

---

## 现状说明

`src/memory/manager.ts` 已有骨架，但仅为 stub：

| 现有内容 | 说明 |
|---------|------|
| `MemoryManager` class | 构造函数接收 `config.memory`，`init()` / `shutdown()` 为空实现 |
| `src/config.ts` memory schema | `dir` / `searchLimit` / `vectorEnabled` / `vectorEndpoint` 已定义 |
| `better-sqlite3` | 已在 node_modules，可直接使用 |

缺少：

| 缺失项 | 说明 |
|--------|------|
| `src/memory/database.ts` | SQLite 初始化 + FTS5 虚拟表 + search 函数 |
| `src/memory/identity.ts` | SOUL.md 读写 + FTS 同步 |
| `src/memory/knowledge.ts` | knowledge/*.md 读写 + FTS 同步 |
| `src/memory/episode.ts` | episodes/*.md 写入 + FTS 同步 + recent() |
| 完整 `MemoryManager` | 整合三层 + search() 入口 |
| 默认 SOUL.md 模板 | FriClaw 身份定义 |
| 单元测试 | 覆盖所有核心路径 |

---

## 设计偏差说明

| 规格定义 | 本计划实现 | 原因 |
|---------|-----------|------|
| `nanoid` 生成 episode id | 使用 `crypto.randomUUID().slice(0, 6)` | 避免引入额外依赖，Bun 内置 crypto |
| FTS5 `tokenize = 'unicode61'` | 保持不变 | 支持中文分词效果最佳 |
| MCP Server 暴露记忆工具 | 本模块不实现，留给 module 05 | 关注点分离，本模块只做存储层 |
| 会话摘要自动生成 | 本模块不实现，留给 session 模块 | 依赖 Claude API，不属于存储层职责 |

---

## File Structure

| 操作 | 路径 | 职责 |
|------|------|------|
| Create | `src/memory/database.ts` | SQLite init + FTS5 建表 + search 函数 |
| Create | `src/memory/identity.ts` | IdentityMemory：SOUL.md 读写 |
| Create | `src/memory/knowledge.ts` | KnowledgeMemory：knowledge/*.md 读写 |
| Create | `src/memory/episode.ts` | EpisodeMemory：episodes/*.md 写入 + recent() |
| Modify | `src/memory/manager.ts` | 替换 stub，整合三层 + search() |
| Create | `tests/unit/memory/database.test.ts` | FTS5 初始化 + search 测试 |
| Create | `tests/unit/memory/identity.test.ts` | IdentityMemory 读写测试 |
| Create | `tests/unit/memory/knowledge.test.ts` | KnowledgeMemory 读写 + list 测试 |
| Create | `tests/unit/memory/episode.test.ts` | EpisodeMemory save + recent 测试 |
| Create | `tests/unit/memory/manager.test.ts` | MemoryManager 集成测试 |

---

## Task 1: SQLite + FTS5 数据库层

**Files:**
- Create: `src/memory/database.ts`
- Create: `tests/unit/memory/database.test.ts`

- [ ] **Step 1: 写失败测试**

```typescript
// tests/unit/memory/database.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { initDatabase, search } from '../../../src/memory/database'
import type Database from 'better-sqlite3'

let tmpDir: string
let db: Database.Database

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'friclaw-test-'))
  db = initDatabase(join(tmpDir, 'index.sqlite'))
})

afterEach(() => {
  db.close()
  rmSync(tmpDir, { recursive: true })
})

describe('initDatabase', () => {
  it('creates memory_fts virtual table', () => {
    const row = db.prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='memory_fts'`
    ).get()
    expect(row).toBeTruthy()
  })

  it('enables WAL mode', () => {
    const row = db.prepare('PRAGMA journal_mode').get() as { journal_mode: string }
    expect(row.journal_mode).toBe('wal')
  })
})

describe('search', () => {
  beforeEach(() => {
    db.prepare(
      `INSERT INTO memory_fts(id, category, title, content, tags) VALUES (?, ?, ?, ?, ?)`
    ).run('knowledge/projects', 'knowledge', 'projects', 'friclaw AI 项目管理', 'ai,project')

    db.prepare(
      `INSERT INTO memory_fts(id, category, title, content, tags) VALUES (?, ?, ?, ?, ?)`
    ).run('identity/SOUL', 'identity', 'SOUL', 'FriClaw 私人 AI 管家', 'identity')
  })

  it('returns matching results', () => {
    const results = search(db, 'friclaw')
    expect(results.length).toBeGreaterThan(0)
  })

  it('filters by category', () => {
    const results = search(db, 'friclaw', 'knowledge')
    expect(results.every(r => r.category === 'knowledge')).toBe(true)
  })

  it('returns empty array for no match', () => {
    const results = search(db, 'nonexistent_xyz_abc')
    expect(results).toEqual([])
  })

  it('respects limit', () => {
    const results = search(db, 'friclaw', undefined, 1)
    expect(results.length).toBeLessThanOrEqual(1)
  })
})
```

- [ ] **Step 2: 实现 database.ts**

```typescript
// src/memory/database.ts
import Database from 'better-sqlite3'

export interface SearchResult {
  id: string
  category: string
  title: string
  content: string
  tags: string
}

export function initDatabase(dbPath: string): Database.Database {
  const db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.pragma('synchronous = NORMAL')

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

export function search(
  db: Database.Database,
  query: string,
  category?: string,
  limit = 10
): SearchResult[] {
  try {
    if (category) {
      return db.prepare(
        `SELECT id, category, title, content, tags
         FROM memory_fts
         WHERE memory_fts MATCH ? AND category = ?
         ORDER BY rank
         LIMIT ?`
      ).all(query, category, limit) as SearchResult[]
    }
    return db.prepare(
      `SELECT id, category, title, content, tags
       FROM memory_fts
       WHERE memory_fts MATCH ?
       ORDER BY rank
       LIMIT ?`
    ).all(query, limit) as SearchResult[]
  } catch {
    return []
  }
}

export function upsertIndex(
  db: Database.Database,
  id: string,
  category: string,
  title: string,
  content: string,
  tags: string[] = []
): void {
  db.prepare(`DELETE FROM memory_fts WHERE id = ?`).run(id)
  db.prepare(
    `INSERT INTO memory_fts(id, category, title, content, tags) VALUES (?, ?, ?, ?, ?)`
  ).run(id, category, title, content, tags.join(','))
}

export function deleteIndex(db: Database.Database, id: string): void {
  db.prepare(`DELETE FROM memory_fts WHERE id = ?`).run(id)
}
```

- [ ] **Step 3: 运行测试确认通过**

```bash
cd /Users/chen/workspace/ai/friclaw && bun test tests/unit/memory/database.test.ts
```

---

## Task 2: IdentityMemory

**Files:**
- Create: `src/memory/identity.ts`
- Create: `tests/unit/memory/identity.test.ts`

- [ ] **Step 1: 写失败测试**

```typescript
// tests/unit/memory/identity.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, rmSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { initDatabase } from '../../../src/memory/database'
import { IdentityMemory } from '../../../src/memory/identity'
import type Database from 'better-sqlite3'

let tmpDir: string
let db: Database.Database
let identity: IdentityMemory

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'friclaw-test-'))
  db = initDatabase(join(tmpDir, 'index.sqlite'))
  identity = new IdentityMemory(db, tmpDir)
})

afterEach(() => {
  db.close()
  rmSync(tmpDir, { recursive: true })
})

describe('IdentityMemory', () => {
  it('read() returns default SOUL when file does not exist', () => {
    const content = identity.read()
    expect(content).toContain('FriClaw')
  })

  it('update() writes SOUL.md to disk', () => {
    identity.update('# My Soul\nI am FriClaw.')
    expect(existsSync(join(tmpDir, 'SOUL.md'))).toBe(true)
  })

  it('read() returns updated content after update()', () => {
    identity.update('# Updated Soul')
    expect(identity.read()).toContain('Updated Soul')
  })

  it('update() syncs to FTS index', () => {
    identity.update('FriClaw 是一个智能管家')
    const { search } = await import('../../../src/memory/database')
    const results = search(db, '智能管家', 'identity')
    expect(results.length).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 2: 实现 identity.ts**

```typescript
// src/memory/identity.ts
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import type Database from 'better-sqlite3'
import { upsertIndex } from './database'

const DEFAULT_SOUL = `---
title: FriClaw Identity
date: ${new Date().toISOString().slice(0, 10)}
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
`

export class IdentityMemory {
  private soulPath: string

  constructor(private db: Database.Database, memoryDir: string) {
    this.soulPath = join(memoryDir, 'SOUL.md')
  }

  read(): string {
    return existsSync(this.soulPath)
      ? readFileSync(this.soulPath, 'utf-8')
      : DEFAULT_SOUL
  }

  update(content: string): void {
    writeFileSync(this.soulPath, content, 'utf-8')
    upsertIndex(this.db, 'identity/SOUL', 'identity', 'SOUL', content)
  }
}
```

- [ ] **Step 3: 运行测试确认通过**

```bash
bun test tests/unit/memory/identity.test.ts
```

---

## Task 3: KnowledgeMemory

**Files:**
- Create: `src/memory/knowledge.ts`
- Create: `tests/unit/memory/knowledge.test.ts`

- [ ] **Step 1: 写失败测试**

```typescript
// tests/unit/memory/knowledge.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, rmSync, mkdirSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { initDatabase } from '../../../src/memory/database'
import { KnowledgeMemory } from '../../../src/memory/knowledge'
import type Database from 'better-sqlite3'

let tmpDir: string
let db: Database.Database
let knowledge: KnowledgeMemory

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'friclaw-test-'))
  mkdirSync(join(tmpDir, 'knowledge'), { recursive: true })
  db = initDatabase(join(tmpDir, 'index.sqlite'))
  knowledge = new KnowledgeMemory(db, tmpDir)
})

afterEach(() => {
  db.close()
  rmSync(tmpDir, { recursive: true })
})

describe('KnowledgeMemory', () => {
  it('save() writes markdown file with frontmatter', () => {
    knowledge.save('preferences', '喜欢用 Bun 而不是 Node')
    const content = knowledge.read('preferences')
    expect(content).toContain('喜欢用 Bun')
    expect(content).toContain('---')
  })

  it('read() returns null for non-existent topic', () => {
    expect(knowledge.read('nonexistent')).toBeNull()
  })

  it('list() returns saved topics', () => {
    knowledge.save('preferences', '内容A')
    knowledge.save('projects', '内容B')
    const topics = knowledge.list()
    expect(topics).toContain('preferences')
    expect(topics).toContain('projects')
  })

  it('save() syncs to FTS index', () => {
    knowledge.save('owner-profile', '用户叫陈总，喜欢喝咖啡')
    const { search } = await import('../../../src/memory/database')
    const results = search(db, '咖啡', 'knowledge')
    expect(results.length).toBeGreaterThan(0)
  })

  it('save() overwrites existing topic', () => {
    knowledge.save('preferences', '旧内容')
    knowledge.save('preferences', '新内容')
    expect(knowledge.read('preferences')).toContain('新内容')
    expect(knowledge.read('preferences')).not.toContain('旧内容')
  })
})
```

- [ ] **Step 2: 实现 knowledge.ts**

```typescript
// src/memory/knowledge.ts
import { existsSync, readFileSync, writeFileSync, readdirSync } from 'fs'
import { join } from 'path'
import type Database from 'better-sqlite3'
import { upsertIndex } from './database'

export class KnowledgeMemory {
  private knowledgeDir: string

  constructor(private db: Database.Database, memoryDir: string) {
    this.knowledgeDir = join(memoryDir, 'knowledge')
  }

  save(topic: string, content: string, tags: string[] = []): void {
    const frontmatter = `---\ntitle: ${topic}\ndate: ${new Date().toISOString()}\ntags: [${tags.join(', ')}]\n---\n\n`
    const full = frontmatter + content
    writeFileSync(join(this.knowledgeDir, `${topic}.md`), full, 'utf-8')
    upsertIndex(this.db, `knowledge/${topic}`, 'knowledge', topic, content, tags)
  }

  read(topic: string): string | null {
    const filePath = join(this.knowledgeDir, `${topic}.md`)
    return existsSync(filePath) ? readFileSync(filePath, 'utf-8') : null
  }

  list(): string[] {
    return readdirSync(this.knowledgeDir)
      .filter(f => f.endsWith('.md'))
      .map(f => f.replace('.md', ''))
  }
}
```

- [ ] **Step 3: 运行测试确认通过**

```bash
bun test tests/unit/memory/knowledge.test.ts
```

---

## Task 4: EpisodeMemory

**Files:**
- Create: `src/memory/episode.ts`
- Create: `tests/unit/memory/episode.test.ts`

- [ ] **Step 1: 写失败测试**

```typescript
// tests/unit/memory/episode.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, rmSync, mkdirSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { initDatabase } from '../../../src/memory/database'
import { EpisodeMemory } from '../../../src/memory/episode'
import type Database from 'better-sqlite3'

let tmpDir: string
let db: Database.Database
let episode: EpisodeMemory

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'friclaw-test-'))
  mkdirSync(join(tmpDir, 'episodes'), { recursive: true })
  db = initDatabase(join(tmpDir, 'index.sqlite'))
  episode = new EpisodeMemory(db, tmpDir)
})

afterEach(() => {
  db.close()
  rmSync(tmpDir, { recursive: true })
})

describe('EpisodeMemory', () => {
  it('save() returns an id string', () => {
    const id = episode.save('用户询问了天气')
    expect(typeof id).toBe('string')
    expect(id.length).toBeGreaterThan(0)
  })

  it('save() writes markdown file to episodes dir', () => {
    const id = episode.save('用户询问了天气', ['weather'])
    const { readdirSync } = await import('fs')
    const files = readdirSync(join(tmpDir, 'episodes'))
    expect(files.some(f => f.includes(id))).toBe(true)
  })

  it('recent() returns saved episodes in reverse order', () => {
    episode.save('第一条摘要')
    episode.save('第二条摘要')
    const episodes = episode.recent(10)
    expect(episodes.length).toBe(2)
    // 最新的在前
    expect(episodes[0].summary).toContain('第二条摘要')
  })

  it('recent() respects limit', () => {
    episode.save('摘要1')
    episode.save('摘要2')
    episode.save('摘要3')
    expect(episode.recent(2).length).toBe(2)
  })

  it('save() syncs to FTS index', () => {
    episode.save('用户讨论了 PaddleOCR 训练任务', ['ocr', 'training'])
    const { search } = await import('../../../src/memory/database')
    const results = search(db, 'PaddleOCR', 'episode')
    expect(results.length).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 2: 实现 episode.ts**

```typescript
// src/memory/episode.ts
import { writeFileSync, readdirSync, readFileSync } from 'fs'
import { join } from 'path'
import type Database from 'better-sqlite3'
import { upsertIndex } from './database'

export interface Episode {
  id: string
  date: string
  tags: string[]
  summary: string
}

export class EpisodeMemory {
  private episodesDir: string

  constructor(private db: Database.Database, memoryDir: string) {
    this.episodesDir = join(memoryDir, 'episodes')
  }

  save(summary: string, tags: string[] = []): string {
    const date = new Date().toISOString().slice(0, 10)
    const shortId = crypto.randomUUID().replace(/-/g, '').slice(0, 6)
    const id = `${date}-${shortId}`
    const content = `---\ntitle: ${id}\ndate: ${date}\ntags: [${tags.join(', ')}]\n---\n\n${summary}`
    writeFileSync(join(this.episodesDir, `${id}.md`), content, 'utf-8')
    upsertIndex(this.db, `episode/${id}`, 'episode', id, summary, tags)
    return id
  }

  recent(limit = 10): Episode[] {
    return readdirSync(this.episodesDir)
      .filter(f => f.endsWith('.md'))
      .sort()
      .reverse()
      .slice(0, limit)
      .map(f => this.parse(f))
  }

  private parse(filename: string): Episode {
    const raw = readFileSync(join(this.episodesDir, filename), 'utf-8')
    const id = filename.replace('.md', '')
    const dateMatch = raw.match(/^date:\s*(.+)$/m)
    const tagsMatch = raw.match(/^tags:\s*\[(.*)]/m)
    const summary = raw.replace(/^---[\s\S]*?---\n\n/, '')
    return {
      id,
      date: dateMatch?.[1]?.trim() ?? '',
      tags: tagsMatch?.[1] ? tagsMatch[1].split(',').map(t => t.trim()).filter(Boolean) : [],
      summary,
    }
  }
}
```

- [ ] **Step 3: 运行测试确认通过**

```bash
bun test tests/unit/memory/episode.test.ts
```

---

## Task 5: MemoryManager 整合

**Files:**
- Modify: `src/memory/manager.ts`
- Create: `tests/unit/memory/manager.test.ts`

- [ ] **Step 1: 写失败测试**

```typescript
// tests/unit/memory/manager.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { MemoryManager } from '../../../src/memory/manager'

let tmpDir: string
let manager: MemoryManager

beforeEach(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), 'friclaw-test-'))
  manager = new MemoryManager({ dir: tmpDir, searchLimit: 10, vectorEnabled: false, vectorEndpoint: '' })
  await manager.init()
})

afterEach(async () => {
  await manager.shutdown()
  rmSync(tmpDir, { recursive: true })
})

describe('MemoryManager', () => {
  it('init() creates required directories', () => {
    const { existsSync } = require('fs')
    expect(existsSync(join(tmpDir, 'knowledge'))).toBe(true)
    expect(existsSync(join(tmpDir, 'episodes'))).toBe(true)
    expect(existsSync(join(tmpDir, 'index.sqlite'))).toBe(true)
  })

  it('identity.read() returns default SOUL after init', () => {
    expect(manager.identity.read()).toContain('FriClaw')
  })

  it('knowledge.save() and read() work end-to-end', () => {
    manager.knowledge.save('preferences', '喜欢用 Bun')
    expect(manager.knowledge.read('preferences')).toContain('喜欢用 Bun')
  })

  it('episode.save() and recent() work end-to-end', () => {
    manager.episode.save('今天完成了记忆系统')
    const episodes = manager.episode.recent()
    expect(episodes[0].summary).toContain('今天完成了记忆系统')
  })

  it('search() finds content across all layers', () => {
    manager.knowledge.save('projects', 'friclaw 项目进展顺利')
    const results = manager.search('friclaw')
    expect(results.length).toBeGreaterThan(0)
  })

  it('shutdown() closes database without error', async () => {
    await expect(manager.shutdown()).resolves.toBeUndefined()
  })
})
```

- [ ] **Step 2: 替换 manager.ts stub**

```typescript
// src/memory/manager.ts
import { mkdirSync } from 'fs'
import { join } from 'path'
import type Database from 'better-sqlite3'
import type { FriClawConfig } from '../config'
import { logger } from '../utils/logger'
import { initDatabase, search, type SearchResult } from './database'
import { IdentityMemory } from './identity'
import { KnowledgeMemory } from './knowledge'
import { EpisodeMemory } from './episode'

export class MemoryManager {
  identity!: IdentityMemory
  knowledge!: KnowledgeMemory
  episode!: EpisodeMemory
  private db!: Database.Database

  constructor(private config: FriClawConfig['memory']) {}

  async init(): Promise<void> {
    const { dir, searchLimit: _limit } = this.config
    mkdirSync(join(dir, 'knowledge'), { recursive: true })
    mkdirSync(join(dir, 'episodes'), { recursive: true })

    this.db = initDatabase(join(dir, 'index.sqlite'))
    this.identity = new IdentityMemory(this.db, dir)
    this.knowledge = new KnowledgeMemory(this.db, dir)
    this.episode = new EpisodeMemory(this.db, dir)

    logger.info({ dir }, 'Memory system initialized')
  }

  search(query: string, category?: string): SearchResult[] {
    return search(this.db, query, category, this.config.searchLimit)
  }

  async shutdown(): Promise<void> {
    this.db?.close()
    logger.info('Memory system shutdown')
  }
}
```

- [ ] **Step 3: 运行全部测试确认通过**

```bash
bun test tests/unit/memory/
```

---

## 验收标准

- [ ] 所有单元测试通过（`bun test tests/unit/memory/`）
- [ ] `~/.friclaw/memory/` 目录结构正确创建
- [ ] FTS5 搜索能跨三层返回相关结果
- [ ] `MemoryManager.shutdown()` 正确关闭数据库连接
- [ ] 无 TypeScript 类型错误（`bun tsc --noEmit`）
