import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { initDatabase, search, upsertIndex, upsertMeta, getMeta } from '../../../src/memory/database'
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

  it('creates memory_meta table', () => {
    const row = db.prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='memory_meta'`
    ).get()
    expect(row).toBeTruthy()
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

  it('stores and reads metadata', () => {
    upsertMeta(db, {
      id: 'knowledge/projects',
      category: 'knowledge',
      domain: 'project',
      entities: ['FriClaw'],
      status: 'active',
      confidence: 'high',
      updatedAt: new Date().toISOString(),
      source: 'manual',
    })

    const meta = getMeta(db, 'knowledge/projects')
    expect(meta?.domain).toBe('project')
    expect(meta?.confidence).toBe('high')
  })
})
