import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, rmSync, existsSync, writeFileSync } from 'fs'
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

  it('update() records before and after content in version history', () => {
    const before = identity.read()
    const after = `${before}\n\n## New Rule\n- Keep answers concise`

    identity.update(after)

    const latest = identity.listVersions()[0]
    expect(latest?.content.trim()).toBe(before.trim())
    expect(latest?.beforeContent?.trim()).toBe(before.trim())
    expect(latest?.afterContent?.trim()).toBe(after.trim())
  })

  it('rollbackLatest() restores previous content using version history', () => {
    const before = identity.read()
    const after = `${before}\n\n## Temporary Rule\n- Mention every detail`

    identity.update(after)
    const rolledBack = identity.rollbackLatest()

    expect(rolledBack?.beforeContent?.trim()).toBe(before.trim())
    expect(identity.read().trim()).toBe(before.trim())
  })

  it('readVersion() remains compatible with legacy version files', () => {
    const before = identity.read()
    const versionsDir = join(tmpDir, 'identity', 'versions')
    const versionPath = join(versionsDir, 'legacy.md')
    const legacyContent = `---\nid: legacy\ncreatedAt: 2026-04-20T00:00:00.000Z\nsource: manual_update\n---\n${before}`

    writeFileSync(versionPath, legacyContent)

    const latest = identity.listVersions().find((version) => version.id === 'legacy')
    expect(latest?.content.trim()).toBe(before.trim())
    expect(latest?.beforeContent?.trim()).toBe(before.trim())
    expect(latest?.afterContent).toBeUndefined()
  })
})
