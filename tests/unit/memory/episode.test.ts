import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, rmSync, mkdirSync, readdirSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { Database } from 'bun:sqlite'
import { initDatabase, search } from '../../../src/memory/database'
import { EpisodeMemory } from '../../../src/memory/episode'

let tmpDir: string
let db: Database
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
    const id = episode.save('user asked about weather')
    expect(typeof id).toBe('string')
    expect(id.length).toBeGreaterThan(0)
  })

  it('save() writes markdown file to episodes dir', () => {
    const id = episode.save('user asked about weather', ['weather'])
    const files = readdirSync(join(tmpDir, 'episodes'))
    expect(files.some(f => f.includes(id))).toBe(true)
  })

  it('recent() returns saved episodes in reverse order', () => {
    episode.save('first summary')
    episode.save('second summary')
    const episodes = episode.recent(10)
    expect(episodes.length).toBe(2)
    expect(episodes[0].summary).toContain('second summary')
  })

  it('recent() respects limit', () => {
    episode.save('summary 1')
    episode.save('summary 2')
    episode.save('summary 3')
    expect(episode.recent(2).length).toBe(2)
  })

  it('save() syncs to FTS index', () => {
    episode.save('user discussed PaddleOCR training task', ['ocr', 'training'])
    const results = search(db, 'PaddleOCR', 'episode')
    expect(results.length).toBeGreaterThan(0)
  })
})
