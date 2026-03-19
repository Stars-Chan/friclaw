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

  it('save() overwrites existing topic', () => {
    knowledge.save('preferences', 'old content')
    knowledge.save('preferences', 'new content')
    expect(knowledge.read('preferences')).toContain('new content')
    expect(knowledge.read('preferences')).not.toContain('old content')
  })
})
