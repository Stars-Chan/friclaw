import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { handleWebSocketMessage } from '../../src/dashboard/api'
import { DashboardSessionManager } from '../../src/dashboard/session-manager'
import { TokenStatsManager } from '../../src/dashboard/token-stats'

let workspacesDir: string
let sessionManager: DashboardSessionManager
let tokenStats: TokenStatsManager

beforeEach(() => {
  workspacesDir = mkdtempSync(join(tmpdir(), 'friclaw-dashboard-new-'))
  sessionManager = new DashboardSessionManager(workspacesDir)
  tokenStats = new TokenStatsManager(workspacesDir)
})

afterEach(() => {
  rmSync(workspacesDir, { recursive: true, force: true })
})

describe('dashboard /new', () => {
  it('switches session before background summary completes', async () => {
    const messages: any[] = []
    const ws = {
      data: { clientId: 'client-1', sessionId: 'default' },
      readyState: 1,
      send: (data: string) => messages.push(JSON.parse(data)),
    }

    sessionManager.createOrUpdate('default', 'hello')

    let releaseSummary: (() => void) | null = null
    const summarizeSession = mock(() => new Promise((resolve) => {
      releaseSummary = () => resolve({ id: 'ep-1', mode: 'summary' })
    }))
    const memoryManager: any = {
      ensureThread: () => 'dashboard:default:thread-1',
      startBackgroundSummary: mock((options: any) => {
        ;(summarizeSession as any)(options.sessionId, options.workspaceDir, {
          threadId: options.threadId,
          chatKey: options.chatKey,
          status: 'closed',
        }).then((result: any) => {
          if (options.threadId && result?.mode === 'summary') {
            memoryManager.closeThread(options.threadId)
          }
        })
      }),
      summarizeSession,
      closeThread: mock(() => {}),
    }

    await handleWebSocketMessage(
      ws as any,
      JSON.stringify({ type: 'message', sessionId: 'default', content: '/new' }),
      {} as any,
      sessionManager,
      new Map(),
      tokenStats,
      workspacesDir,
      memoryManager,
    )

    expect(memoryManager.summarizeSession).toHaveBeenCalledTimes(1)
    expect(messages.some((message) => message.type === 'switch_session')).toBe(true)
    expect(messages.some((message) => message.type === 'history' && Array.isArray(message.data.messages) && message.data.messages.length === 0)).toBe(true)
    expect(memoryManager.closeThread).not.toHaveBeenCalled()

    const resolveSummary = releaseSummary as (() => void) | null
    expect(resolveSummary).not.toBeNull()
    ;(resolveSummary as () => void)()
    await Promise.resolve()
    await Promise.resolve()

    expect(memoryManager.summarizeSession).toHaveBeenCalledWith(
      'dashboard:default',
      join(workspacesDir, 'dashboard_default'),
      {
        threadId: undefined,
        chatKey: 'dashboard:default',
        status: 'closed',
      },
    )
    expect(memoryManager.closeThread).not.toHaveBeenCalled()
  })

  it('summarizes existing session without creating a previous thread', async () => {
    const ws = {
      data: { clientId: 'client-3', sessionId: 'default' },
      readyState: 1,
      send: () => {},
    }

    sessionManager.createOrUpdate('default', 'hello')

    const summarizeSession = mock(async () => ({ id: 'ep-1', mode: 'summary' }))
    const memoryManager: any = {
      ensureThread: mock(() => 'dashboard:new-session-thread'),
      startBackgroundSummary: mock((options: any) => {
        ;(summarizeSession as any)(options.sessionId, options.workspaceDir, {
          threadId: options.threadId,
          chatKey: options.chatKey,
          status: 'closed',
        }).then((result: any) => {
          if (options.threadId && result?.mode === 'summary') {
            memoryManager.closeThread(options.threadId)
          }
        })
      }),
      summarizeSession,
      closeThread: mock(() => {}),
    }

    await handleWebSocketMessage(
      ws as any,
      JSON.stringify({ type: 'message', sessionId: 'default', content: '/new' }),
      {} as any,
      sessionManager,
      new Map(),
      tokenStats,
      workspacesDir,
      memoryManager,
    )

    expect(memoryManager.ensureThread).toHaveBeenCalledTimes(1)
    expect(memoryManager.summarizeSession).toHaveBeenCalledTimes(1)
    expect(memoryManager.summarizeSession).toHaveBeenCalledWith(
      'dashboard:default',
      join(workspacesDir, 'dashboard_default'),
      {
        threadId: undefined,
        chatKey: 'dashboard:default',
        status: 'closed',
      },
    )
    expect(memoryManager.closeThread).not.toHaveBeenCalled()
  })
})
