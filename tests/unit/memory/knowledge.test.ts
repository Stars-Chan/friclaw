import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, rmSync, mkdirSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { Database } from 'bun:sqlite'
import { initDatabase, search } from '../../../src/memory/database'
import { KnowledgeMemory } from '../../../src/memory/knowledge'

let tmpDir: string
let db: Database
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
    knowledge.save('preferences', 'likes Bun over Node')
    const content = knowledge.read('preferences')
    expect(content).toContain('likes Bun over Node')
    expect(content).toContain('---')
  })

  it('read() returns null for non-existent topic', () => {
    expect(knowledge.read('nonexistent')).toBeNull()
  })

  it('list() returns saved topics', () => {
    knowledge.save('preferences', 'content A')
    knowledge.save('projects', 'content B')
    const topics = knowledge.list()
    expect(topics).toContain('preferences')
    expect(topics).toContain('projects')
  })

  it('save() syncs to FTS index', () => {
    knowledge.save('owner-profile', 'user likes coffee and coding')
    const results = search(db, 'coffee', 'knowledge')
    expect(results.length).toBeGreaterThan(0)
  })

  it('saveRecord() stores structured metadata', () => {
    knowledge.saveRecord({
      id: 'memory-system',
      metadata: {
        title: 'memory-system',
        date: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        tags: ['memory'],
        domain: 'project',
        entities: ['FriClaw', 'MemoryManager'],
        status: 'active',
        confidence: 'high',
        source: 'manual_edit',
      },
      content: 'Runtime memory system background',
    })

    const record = knowledge.readRecord('memory-system')
    expect(record?.metadata.domain).toBe('project')
    expect(record?.metadata.entities).toContain('FriClaw')
    expect(record?.metadata.confidence).toBe('high')
  })

  it('savePromotion() is source-aware and idempotent', () => {
    const firstId = knowledge.savePromotion({
      title: 'same title',
      content: 'content A',
      source: 'promotion:episode/ep-1',
    })
    const secondId = knowledge.savePromotion({
      title: 'same title',
      content: 'content B',
      source: 'promotion:episode/ep-2',
    })
    const repeatId = knowledge.savePromotion({
      title: 'same title',
      content: 'content C',
      source: 'promotion:episode/ep-1',
    })

    expect(firstId).not.toBe(secondId)
    expect(repeatId).toBe(firstId)
    expect(knowledge.read(firstId)).toContain('content C')
    expect(knowledge.read(secondId)).toContain('content B')
  })
})
