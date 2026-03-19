import { Database } from 'bun:sqlite'

export interface SearchResult {
  id: string
  category: string
  title: string
  content: string
  tags: string
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

export function deleteIndex(db: Database, id: string): void {
  db.prepare(`DELETE FROM memory_fts WHERE id = ?`).run(id)
}
