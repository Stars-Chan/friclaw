import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, rmSync, mkdirSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { Database } from 'bun:sqlite'
import { initDatabase, search } from '../../../src/memory/database'
import { KnowledgeMemory, toValidatedKnowledgeRecord } from '../../../src/memory/knowledge'

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

  it('mergeRecords() merges duplicate knowledge and archives merged sources', () => {
    knowledge.saveRecord({
      id: 'runtime-memory-primary',
      metadata: {
        title: 'runtime-memory',
        date: new Date().toISOString(),
        tags: ['memory', 'runtime'],
        status: 'active',
        confidence: 'high',
        source: 'manual:primary',
      },
      content: 'Runtime memory keeps current retrieval context stable.',
    })
    knowledge.saveRecord({
      id: 'runtime-memory-duplicate',
      metadata: {
        title: 'runtime-memory',
        date: new Date().toISOString(),
        tags: ['memory', 'runtime'],
        status: 'active',
        confidence: 'medium',
        source: 'manual:duplicate',
      },
      content: 'Runtime memory keeps current retrieval context stable.\n\nIt also preserves thread continuity.',
    })

    const result = knowledge.mergeRecords('runtime-memory-primary', ['runtime-memory-duplicate'])
    const target = knowledge.readRecord('runtime-memory-primary')
    const source = knowledge.readRecord('runtime-memory-duplicate')

    expect(result).toBeTruthy()
    expect(result?.mergedSourceIds).toEqual(['runtime-memory-duplicate'])
    expect(result?.lineage[0]?.relationType).toBe('merged_from')
    expect(result?.auditTrail[0]?.actionType).toBe('knowledge_merged')
    expect(target?.content).toContain('It also preserves thread continuity.')
    expect(target?.metadata.source).toContain('manual:primary')
    expect(target?.metadata.source).toContain('manual:duplicate')
    expect(source?.metadata.status).toBe('archived')
    expect(source?.metadata.source).toBe('merged-into:runtime-memory-primary')
  })

  it('toValidatedKnowledgeRecord() accepts canonical lifecycle statuses', () => {
    expect(toValidatedKnowledgeRecord('uncertain-note', {
      content: 'hello',
      metadata: {
        title: 'uncertain-note',
        date: new Date().toISOString(),
        tags: [],
        status: 'uncertain',
      },
    }).metadata.status).toBe('uncertain')

    expect(toValidatedKnowledgeRecord('archived-note', {
      content: 'hello',
      metadata: {
        title: 'archived-note',
        date: new Date().toISOString(),
        tags: [],
        status: 'archived',
      },
    }).metadata.status).toBe('archived')
  })

  it('toValidatedKnowledgeRecord() rejects legacy statuses', () => {
    expect(() => toValidatedKnowledgeRecord('legacy-draft', {
      content: 'hello',
      metadata: {
        title: 'legacy-draft',
        date: new Date().toISOString(),
        tags: [],
        status: 'draft' as any,
      },
    })).toThrow('Invalid knowledge status')

    expect(() => toValidatedKnowledgeRecord('legacy-deprecated', {
      content: 'hello',
      metadata: {
        title: 'legacy-deprecated',
        date: new Date().toISOString(),
        tags: [],
        status: 'deprecated' as any,
      },
    })).toThrow('Invalid knowledge status')
  })

  it('saveRecord() rejects empty content', () => {
    expect(() => knowledge.saveRecord({
      id: 'bad',
      metadata: {
        title: 'bad',
        date: new Date().toISOString(),
        tags: [],
      },
      content: '   ',
    })).toThrow('Knowledge content is required')
  })
})
