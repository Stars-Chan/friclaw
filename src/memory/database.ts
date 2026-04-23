import { Database } from 'bun:sqlite'

export interface SearchResult {
  id: string
  category: string
  title: string
  content: string
  tags: string
}

export interface MemoryMetaRecord {
  id: string
  category: string
  threadId: string | null
  chatKey: string | null
  domain: string | null
  entities: string
  status: string | null
  confidence: string | null
  updatedAt: string | null
  source: string | null
}

export function initDatabase(dbPath: string): Database {
  const db = new Database(dbPath)
  db.run('PRAGMA journal_mode = WAL')
  db.run('PRAGMA synchronous = NORMAL')

  db.run(`
    CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(
      id UNINDEXED,
      category,
      title,
      content,
      tags,
      tokenize = 'unicode61'
    );
  `)

  db.run(`
    CREATE TABLE IF NOT EXISTS memory_meta (
      id TEXT PRIMARY KEY,
      category TEXT NOT NULL,
      thread_id TEXT,
      chat_key TEXT,
      domain TEXT,
      entities TEXT,
      status TEXT,
      confidence TEXT,
      updated_at TEXT,
      source TEXT
    )
  `)

  return db
}

export function search(
  db: Database,
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
  db: Database,
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

export function upsertMeta(
  db: Database,
  record: {
    id: string
    category: string
    threadId?: string
    chatKey?: string
    domain?: string
    entities?: string[]
    status?: string
    confidence?: string
    updatedAt?: string
    source?: string
  }
): void {
  db.prepare(
    `INSERT INTO memory_meta(id, category, thread_id, chat_key, domain, entities, status, confidence, updated_at, source)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       category = excluded.category,
       thread_id = excluded.thread_id,
       chat_key = excluded.chat_key,
       domain = excluded.domain,
       entities = excluded.entities,
       status = excluded.status,
       confidence = excluded.confidence,
       updated_at = excluded.updated_at,
       source = excluded.source`
  ).run(
    record.id,
    record.category,
    record.threadId ?? null,
    record.chatKey ?? null,
    record.domain ?? null,
    (record.entities ?? []).join(','),
    record.status ?? null,
    record.confidence ?? null,
    record.updatedAt ?? null,
    record.source ?? null,
  )
}

export function getMeta(db: Database, id: string): MemoryMetaRecord | null {
  return db.prepare(
    `SELECT id, category, thread_id as threadId, chat_key as chatKey, domain, entities, status, confidence, updated_at as updatedAt, source
     FROM memory_meta
     WHERE id = ?`
  ).get(id) as MemoryMetaRecord | null
}

export function getMetaByThread(
  db: Database,
  threadId: string,
  category = 'episode',
  limit = 5
): MemoryMetaRecord[] {
  return db.prepare(
    `SELECT id, category, thread_id as threadId, chat_key as chatKey, domain, entities, status, confidence, updated_at as updatedAt, source
     FROM memory_meta
     WHERE thread_id = ? AND category = ?
     ORDER BY updated_at DESC
     LIMIT ?`
  ).all(threadId, category, limit) as MemoryMetaRecord[]
}

export function listMetaByCategory(
  db: Database,
  category: string,
  limit = 100
): MemoryMetaRecord[] {
  return db.prepare(
    `SELECT id, category, thread_id as threadId, chat_key as chatKey, domain, entities, status, confidence, updated_at as updatedAt, source
     FROM memory_meta
     WHERE category = ?
     ORDER BY updated_at DESC
     LIMIT ?`
  ).all(category, limit) as MemoryMetaRecord[]
}

export function deleteIndex(db: Database, id: string): void {
  db.prepare(`DELETE FROM memory_fts WHERE id = ?`).run(id)
  db.prepare(`DELETE FROM memory_meta WHERE id = ?`).run(id)
}
