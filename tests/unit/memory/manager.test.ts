import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, rmSync, existsSync } from 'fs'
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
  it('init() creates required directories and database', () => {
    expect(existsSync(join(tmpDir, 'knowledge'))).toBe(true)
    expect(existsSync(join(tmpDir, 'episodes'))).toBe(true)
    expect(existsSync(join(tmpDir, 'index.sqlite'))).toBe(true)
  })

  it('identity.read() returns default SOUL after init', () => {
    expect(manager.identity.read()).toContain('FriClaw')
  })

  it('knowledge.save() and read() work end-to-end', () => {
    manager.knowledge.save('preferences', 'likes Bun runtime')
    expect(manager.knowledge.read('preferences')).toContain('likes Bun runtime')
  })

  it('episode.save() and recent() work end-to-end', () => {
    manager.episode.save('completed memory system today')
    const episodes = manager.episode.recent()
    expect(episodes[0].summary).toContain('completed memory system today')
  })

  it('search() finds content across layers', () => {
    manager.knowledge.save('projects', 'friclaw project is progressing well')
    const results = manager.search('friclaw')
    expect(results.length).toBeGreaterThan(0)
  })

  it('shutdown() closes database without error', async () => {
    await expect(manager.shutdown()).resolves.toBeUndefined()
  })
})
