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
      const historyFile = join(workspaceDir, '.firclaw', '.history', 'messages.jsonl')

      if (!existsSync(historyFile)) continue

      const history = new MessageHistory(workspaceDir)
      const messages = history.load()
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
      history.clear() // Ensure empty history file exists

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
   * Save a message to history
   */
  saveMessage(sessionId: string, message: ChatMessage): void {
    const history = this._histories.get(sessionId)
    if (history) {
      history.append(message)
    }
  }

  /**
   * Load message history for a session
   */
  loadHistory(sessionId: string): ChatMessage[] {
    let history = this._histories.get(sessionId)

    // If history not loaded yet, try to load from disk
    if (!history) {
      const workspaceDir = join(this._workspacesDir, `dashboard_${sessionId}`)
      history = new MessageHistory(workspaceDir)
      this._histories.set(sessionId, history)
    }

    return history.load()
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
   * Clear message history for a session
   */
  clearHistory(sessionId: string): void {
    const history = this._histories.get(sessionId)
    if (history) {
      history.clear()
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
