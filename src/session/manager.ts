// src/session/manager.ts
import { mkdirSync } from 'fs'
import { join } from 'path'
import type { Session, SessionStats } from './types'

interface SessionManagerOptions {
  workspacesDir: string
  timeoutMs?: number          // default 3600_000 (1h)
  cleanupIntervalMs?: number  // default 60_000 (1min)
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

  /** /new: clear old session, create new workspace with timestamp suffix */
  newSession(platform: string, chatId: string, userId: string): Session {
    const id = `${platform}:${chatId}`
    this.sessions.delete(id)
    return this.createSession(id, platform, chatId, userId, Date.now())
  }

  /** /clear: remove session from memory, trigger summary callback */
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
    mkdirSync(join(workspaceDir, '.claude'), { recursive: true })
    mkdirSync(join(workspaceDir, '.firclaw', '.history'), { recursive: true })
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
