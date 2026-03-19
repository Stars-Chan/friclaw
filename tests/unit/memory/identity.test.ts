import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, rmSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { Database } from 'bun:sqlite'
import { initDatabase, search } from '../../../src/memory/database'
import { IdentityMemory } from '../../../src/memory/identity'

let tmpDir: string
let db: Database
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
    identity.update('FriClaw is a smart assistant')
    const results = search(db, 'smart', 'identity')
    expect(results.length).toBeGreaterThan(0)
  })
})
