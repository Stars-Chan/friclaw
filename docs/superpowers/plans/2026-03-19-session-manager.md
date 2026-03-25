# Session Manager Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现会话生命周期管理，包括创建、复用、超时清理、工作空间隔离，以及 `/clear` 和 `/new` 命令支持。

**Architecture:** SessionManager 以 Map 维护内存中的会话状态，每个会话对应一个独立的工作空间目录（含 `.mcp.json`、`.claude/`、`.firclaw/.history/` 子结构）。定时器每分钟扫描超时会话并释放内存（保留文件）。`/clear` 触发 `onSessionCleared` 回调（用于摘要生成），`/new` 创建带时间戳后缀的新工作空间目录。

**Tech Stack:** Bun, TypeScript, bun:test, Node.js fs/path/os

---

## File Structure

| 文件 | 职责 |
|------|------|
| `src/session/types.ts` | Session / SessionStats 类型定义 |
| `src/session/manager.ts` | SessionManager 核心实现 |
| `tests/unit/session/manager.test.ts` | 单元测试 |

---

### Task 1: 类型定义

**Files:**
- Create: `src/session/types.ts`

- [ ] **Step 1: 创建类型文件**

```typescript
// src/session/types.ts
export interface Session {
  id: string              // `${platform}:${chatId}`
  userId: string
  chatId: string
  platform: 'feishu' | 'wecom' | 'dashboard'
  chatType: 'private' | 'group'
  workspaceDir: string
  createdAt: number
  lastActiveAt: number
  agentSessionId?: string
}

export interface SessionStats {
  total: number
  byPlatform: Record<string, number>
  oldest: number | null
}
```

- [ ] **Step 2: Commit**

```bash
cd /Users/chen/workspace/ai/friclaw && git add src/session/types.ts && git commit -m "feat(session): add Session and SessionStats types"
```

---

### Task 2: SessionManager 核心实现

**Files:**
- Create: `src/session/manager.ts`
- Create: `tests/unit/session/manager.test.ts`

- [ ] **Step 1: 写失败测试**

```typescript
// tests/unit/session/manager.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, rmSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { SessionManager } from '../../../src/session/manager'

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
    expect(existsSync(join(s.workspaceDir, '.mcp.json'))).toBe(false) // scaffold dirs only
    expect(existsSync(join(s.workspaceDir, '.claude'))).toBe(true)
    expect(existsSync(join(s.workspaceDir, '.neoclaw', '.history'))).toBe(true)
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
```

- [ ] **Step 2: 运行测试，确认失败**

```bash
cd /Users/chen/workspace/ai/friclaw && bun test tests/unit/session/manager.test.ts 2>&1 | tail -10
```

Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现 SessionManager**

```typescript
// src/session/manager.ts
import { mkdirSync } from 'fs'
import { join } from 'path'
import type { Session, SessionStats } from './types'

interface SessionManagerOptions {
  workspacesDir: string
  timeoutMs?: number          // 默认 3600_000 (1h)
  cleanupIntervalMs?: number  // 默认 60_000 (1min)
}

export class SessionManager {
  private sessions = new Map<string, Session>()
  private timer: ReturnType<typeof setInterval> | null = null
  private workspacesDir: string
  private timeoutMs: number

  onSessionExpired?: (id: string) => void
  onSessionCleared?: (id: string) => void

  constructor(opts: SessionManagerOptions) {
    this.workspacesDir = opts.workspacesDir
    this.timeoutMs = opts.timeoutMs ?? 3_600_000
    const interval = opts.cleanupIntervalMs ?? 60_000
    this.timer = setInterval(() => this.cleanup(), interval)
    if (this.timer.unref) this.timer.unref()
  }

  getOrCreate(platform: string, chatId: string, userId: string): Session {
    const id = `${platform}:${chatId}`
    let session = this.sessions.get(id)
    if (!session) {
      session = this.createSession(id, platform, chatId, userId)
    } else {
      session.lastActiveAt = Date.now()
    }
    return session
  }

  /** /new: 清除旧会话，创建带时间戳的新工作空间 */
  newSession(platform: string, chatId: string, userId: string): Session {
    const id = `${platform}:${chatId}`
    this.sessions.delete(id)
    return this.createSession(id, platform, chatId, userId, Date.now())
  }

  /** /clear: 清除会话上下文，触发摘要生成回调 */
  clearSession(id: string): void {
    this.sessions.delete(id)
    this.onSessionCleared?.(id)
  }

  get(id: string): Session | undefined {
    return this.sessions.get(id)
  }

  clear(id: string): void {
    this.sessions.delete(id)
  }

  stats(): SessionStats {
    const values = [...this.sessions.values()]
    const byPlatform: Record<string, number> = {}
    for (const s of values) {
      byPlatform[s.platform] = (byPlatform[s.platform] ?? 0) + 1
    }
    const createdAts = values.map(s => s.createdAt)
    return {
      total: this.sessions.size,
      byPlatform,
      oldest: createdAts.length ? Math.min(...createdAts) : null,
    }
  }

  stopCleanupTimer(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  private createSession(
    id: string,
    platform: string,
    chatId: string,
    userId: string,
    ts?: number,
  ): Session {
    const suffix = ts ? `-${ts}` : ''
    const dirName = `${id.replace(':', '_')}${suffix}`
    const workspaceDir = join(this.workspacesDir, dirName)
    // scaffold workspace subdirectories
    mkdirSync(join(workspaceDir, '.claude'), { recursive: true })
    mkdirSync(join(workspaceDir, '.neoclaw', '.history'), { recursive: true })
    const session: Session = {
      id,
      userId,
      chatId,
      platform: platform as Session['platform'],
      chatType: chatId.startsWith('oc_') ? 'group' : 'private',
      workspaceDir,
      createdAt: Date.now(),
      lastActiveAt: Date.now(),
    }
    this.sessions.set(id, session)
    return session
  }

  private cleanup(): void {
    const now = Date.now()
    for (const [id, session] of this.sessions) {
      if (now - session.lastActiveAt > this.timeoutMs) {
        this.sessions.delete(id)
        this.onSessionExpired?.(id)
      }
    }
  }
}
```

- [ ] **Step 4: 运行测试，确认通过**

```bash
cd /Users/chen/workspace/ai/friclaw && bun test tests/unit/session/manager.test.ts 2>&1 | tail -10
```

Expected: all pass

- [ ] **Step 5: Commit**

```bash
cd /Users/chen/workspace/ai/friclaw && git add src/session/manager.ts tests/unit/session/manager.test.ts && git commit -m "feat(session): implement SessionManager with workspace scaffold and /clear /new support"
```

---

### Task 3: 全量测试验证

**Files:** 无新增

- [ ] **Step 1: 运行全量测试**

```bash
cd /Users/chen/workspace/ai/friclaw && bun test tests/unit/ 2>&1 | tail -5
```

Expected: all pass，0 fail

- [ ] **Step 2: Commit（如有修复）**

```bash
cd /Users/chen/workspace/ai/friclaw && git add -A && git commit -m "fix: resolve any regressions from session module"
```

- [ ] **Step 3: Push**

```bash
cd /Users/chen/workspace/ai/friclaw && git push origin main
```
