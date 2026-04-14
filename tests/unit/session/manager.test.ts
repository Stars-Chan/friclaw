// tests/unit/session/manager.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, rmSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { SessionManager } from '../../../src/session/manager'
import { getWorkspaceHistoryDir } from '../../../src/session/history-paths'

let tmpDir: string
let manager: SessionManager

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'friclaw-session-'))
  manager = new SessionManager({ workspacesDir: tmpDir, timeoutMs: 1000, cleanupIntervalMs: 200 })
})

afterEach(() => {
  manager.stopCleanupTimer()
  rmSync(tmpDir, { recursive: true, force: true })
})

describe('SessionManager', () => {
  it('getOrCreate creates a new session', () => {
    const s = manager.getOrCreate('feishu', 'ou_abc', 'user1')
    expect(s.id).toBe('feishu:ou_abc')
    expect(s.platform).toBe('feishu')
    expect(s.chatType).toBe('private')
    expect(s.workspaceDir).toContain('feishu_ou_abc')
    expect(existsSync(s.workspaceDir)).toBe(true)
  })

  it('workspace scaffold is created on session init', () => {
    const s = manager.getOrCreate('feishu', 'ou_abc', 'user1')
    expect(existsSync(join(s.workspaceDir, '.claude'))).toBe(true)
    expect(existsSync(getWorkspaceHistoryDir(s.workspaceDir))).toBe(true)
  })

  it('getOrCreate reuses existing session', () => {
    const s1 = manager.getOrCreate('feishu', 'ou_abc', 'user1')
    const s2 = manager.getOrCreate('feishu', 'ou_abc', 'user1')
    expect(s1.createdAt).toBe(s2.createdAt)
  })

  it('group chat detected by oc_ prefix', () => {
    const s = manager.getOrCreate('feishu', 'oc_room1', 'user1')
    expect(s.chatType).toBe('group')
  })

  it('clear removes session from memory', () => {
    manager.getOrCreate('feishu', 'ou_abc', 'user1')
    manager.clear('feishu:ou_abc')
    expect(manager.get('feishu:ou_abc')).toBeUndefined()
  })

  it('clear on non-existent id is a no-op', () => {
    expect(() => manager.clear('feishu:nonexistent')).not.toThrow()
  })

  it('stats returns correct counts', () => {
    manager.getOrCreate('feishu', 'ou_abc', 'user1')
    manager.getOrCreate('feishu', 'oc_room', 'user2')
    manager.getOrCreate('wecom', 'wc_001', 'user3')
    const stats = manager.stats()
    expect(stats.total).toBe(3)
    expect(stats.byPlatform['feishu']).toBe(2)
    expect(stats.byPlatform['wecom']).toBe(1)
  })

  it('stats on empty manager returns oldest: null', () => {
    const stats = manager.stats()
    expect(stats.total).toBe(0)
    expect(stats.oldest).toBeNull()
  })

  it('expired sessions are cleaned up', async () => {
    manager.getOrCreate('feishu', 'ou_abc', 'user1')
    await new Promise(r => setTimeout(r, 1300))
    expect(manager.get('feishu:ou_abc')).toBeUndefined()
  })

  it('onSessionExpired callback is called on timeout', async () => {
    const expired: string[] = []
    manager.onSessionExpired = (id) => expired.push(id)
    manager.getOrCreate('feishu', 'ou_abc', 'user1')
    await new Promise(r => setTimeout(r, 1300))
    expect(expired).toContain('feishu:ou_abc')
  })

  it('clearSession triggers onSessionCleared callback', () => {
    const cleared: string[] = []
    manager.onSessionCleared = (id) => cleared.push(id)
    manager.getOrCreate('feishu', 'ou_abc', 'user1')
    manager.clearSession('feishu:ou_abc')
    expect(manager.get('feishu:ou_abc')).toBeUndefined()
    expect(cleared).toContain('feishu:ou_abc')
  })

  it('newSession creates a new workspace dir distinct from old one', () => {
    const s1 = manager.getOrCreate('feishu', 'ou_abc', 'user1')
    const oldDir = s1.workspaceDir
    const s2 = manager.newSession('feishu', 'ou_abc', 'user1')
    expect(s2.workspaceDir).not.toBe(oldDir)
    expect(existsSync(s2.workspaceDir)).toBe(true)
  })
})
