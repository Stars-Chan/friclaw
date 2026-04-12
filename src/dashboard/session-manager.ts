// src/dashboard/session-manager.ts

import { mkdirSync, readdirSync, existsSync, statSync } from 'fs'
import { join } from 'path'
import type { SessionInfo } from './types.js'
import { MessageHistory, type ChatMessage } from './message-history.js'

export class DashboardSessionManager {
  private _sessions = new Map<string, SessionInfo>()
  private _histories = new Map<string, MessageHistory>()
  private _workspacesDir: string

  constructor(workspacesDir: string) {
    this._workspacesDir = workspacesDir
    this._loadExistingSessions()
  }

  /**
   * Load existing sessions from disk on startup
   */
  private _loadExistingSessions(): void {
    if (!existsSync(this._workspacesDir)) return

    const dirs = readdirSync(this._workspacesDir)
    for (const dir of dirs) {
      if (!dir.startsWith('dashboard_')) continue

      const sessionId = dir.replace('dashboard_', '')
      const workspaceDir = join(this._workspacesDir, dir)
      const historyFile = join(workspaceDir, '.friclaw', '.history', 'messages.jsonl')

      if (!existsSync(historyFile)) continue

      const history = new MessageHistory(workspaceDir)
      const messages = history.loadSync() // 使用同步版本初始化
      if (messages.length === 0) continue

      const stats = statSync(historyFile)
      const firstMessage = messages[0]

      this._sessions.set(sessionId, {
        id: sessionId,
        title: this._generateTitle(firstMessage.content),
        createdAt: stats.birthtimeMs,
        updatedAt: stats.mtimeMs,
        messageCount: messages.length,
      })
      this._histories.set(sessionId, history)
    }
  }

  /**
   * Create a new session or update an existing one
   */
  createOrUpdate(sessionId: string, firstMessage: string): SessionInfo {
    let session = this._sessions.get(sessionId)

    if (!session) {
      const workspaceDir = join(this._workspacesDir, `dashboard_${sessionId}`)
      mkdirSync(workspaceDir, { recursive: true })

      const history = new MessageHistory(workspaceDir)
      // 异步初始化，但不等待
      history.clear().catch(err => {
        console.error(`Failed to initialize history for session ${sessionId}:`, err)
      })

      session = {
        id: sessionId,
        title: this._generateTitle(firstMessage),
        createdAt: Date.now(),
        updatedAt: Date.now(),
        messageCount: 1,
      }
      this._sessions.set(sessionId, session)
      this._histories.set(sessionId, history)
    } else {
      session.updatedAt = Date.now()
      session.messageCount++
    }

    return session
  }

  /**
   * Save a message to history (async)
   */
  async saveMessage(sessionId: string, message: ChatMessage): Promise<void> {
    const history = this._histories.get(sessionId)
    if (history) {
      await history.append(message)
    }
  }

  /**
   * Save a message to history (sync fallback)
   */
  saveMessageSync(sessionId: string, message: ChatMessage): void {
    const history = this._histories.get(sessionId)
    if (history) {
      history.appendSync(message)
    }
  }

  /**
   * Load message history for a session (async)
   */
  async loadHistory(sessionId: string): Promise<ChatMessage[]> {
    let history = this._histories.get(sessionId)

    // If history not loaded yet, try to load from disk
    if (!history) {
      const workspaceDir = join(this._workspacesDir, `dashboard_${sessionId}`)
      history = new MessageHistory(workspaceDir)
      this._histories.set(sessionId, history)
    }

    return await history.load()
  }

  /**
   * Load message history for a session (sync fallback)
   */
  loadHistorySync(sessionId: string): ChatMessage[] {
    let history = this._histories.get(sessionId)

    // If history not loaded yet, try to load from disk
    if (!history) {
      const workspaceDir = join(this._workspacesDir, `dashboard_${sessionId}`)
      history = new MessageHistory(workspaceDir)
      this._histories.set(sessionId, history)
    }

    return history.loadSync()
  }

  /**
   * Get a session by ID
   */
  get(sessionId: string): SessionInfo | undefined {
    return this._sessions.get(sessionId)
  }

  /**
   * List all sessions sorted by update time (newest first)
   */
  listAll(): SessionInfo[] {
    return Array.from(this._sessions.values()).sort((a, b) => b.updatedAt - a.updatedAt)
  }

  /**
   * Delete a session by ID
   */
  delete(sessionId: string): void {
    this._sessions.delete(sessionId)
  }

  /**
   * Clear message history for a session (async)
   */
  async clearHistory(sessionId: string): Promise<void> {
    const history = this._histories.get(sessionId)
    if (history) {
      await history.clear()
    }
    const session = this._sessions.get(sessionId)
    if (session) {
      session.messageCount = 0
      session.updatedAt = Date.now()
    }
  }

  /**
   * Mark a session as disconnected (for WebSocket disconnection tracking)
   */
  disconnect(sessionId: string): void {
    // Currently a no-op, but can be extended to track connection state
  }

  /**
   * Generate a title from the first message
   */
  private _generateTitle(firstMessage: string): string {
    // Use the first 30 characters of the first message as the title
    const trimmed = firstMessage.trim()
    return trimmed.length > 30 ? trimmed.slice(0, 30) + '...' : trimmed || 'New Chat'
  }
}
