import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { initDatabase, search, upsertIndex } from '../../../src/memory/database'
import type { Database } from 'bun:sqlite'

let tmpDir: string
let db: Database

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
    upsertIndex(db, 'knowledge/projects', 'knowledge', 'projects', 'friclaw AI 项目管理', ['ai', 'project'])
    upsertIndex(db, 'identity/SOUL', 'identity', 'SOUL', 'FriClaw 私人 AI 管家', ['identity'])
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
    const results = search(db, 'nonexistent_xyz_abc_qqq')
    expect(results).toEqual([])
  })

  it('respects limit', () => {
    const results = search(db, 'friclaw', undefined, 1)
    expect(results.length).toBeLessThanOrEqual(1)
  })
})
