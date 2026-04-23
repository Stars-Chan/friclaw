import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, rmSync, readFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { Dispatcher } from '../../src/dispatcher'
import { SessionManager } from '../../src/session/manager'
import { getWorkspaceDailyHistoryFile } from '../../src/session/history-paths'
import type { Message } from '../../src/types/message'

let tmpDir: string
let sessionManager: SessionManager

const makeAgent = () => {
  const calls: Array<{ sessionId: string; content: string; threadId?: string }> = []
  const disposed: string[] = []
  return {
    calls,
    disposed,
    handle: async (session: { id: string; threadId?: string }, msg: Message) => {
      calls.push({ sessionId: session.id, content: msg.content, threadId: session.threadId })
    },
    dispose: async (sessionId: string) => {
      disposed.push(sessionId)
    },
  }
}

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'friclaw-dispatcher-'))
  sessionManager = new SessionManager({ workspacesDir: tmpDir, timeoutMs: 60_000 })
})

afterEach(() => {
  sessionManager.stopCleanupTimer()
  rmSync(tmpDir, { recursive: true, force: true })
})

const msg = (overrides: Partial<Message> = {}): Message => ({
  platform: 'feishu',
  chatId: 'ou_abc',
  userId: 'user1',
  type: 'text',
  content: 'hello',
  ...overrides,
})

describe('Dispatcher', () => {
  it('dispatches message to agent via session', async () => {
    const agent = makeAgent()
    const dispatcher = new Dispatcher(sessionManager, agent)
    await dispatcher.dispatch(msg())
    expect(agent.calls).toHaveLength(1)
    expect(agent.calls[0].sessionId).toBe('feishu:ou_abc')
  })

  it('injects runtime memory context and closes thread only after successful summary', async () => {
    const agent = makeAgent()
    const dispatcher = new Dispatcher(sessionManager, agent)
    const ensured: string[] = []
    const summarized: any[] = []
    const closed: string[] = []

    const memoryManager: any = {
      ensureThread: () => {
        const id = 'feishu:ou_abc:thread-1'
        ensured.push(id)
        return id
      },
      buildRuntimeContext: ({ session }: any) => ({
        knowledge: [],
        promptBlock: `[Memory Context]\nThread=${session.activeThreadId}`,
      }),
      summarizeSession: async (...args: any[]) => {
        summarized.push(args)
        return { id: 'ep-1', mode: 'summary' }
      },
      startBackgroundSummary: ({ sessionId, workspaceDir, threadId, chatKey }: any) => {
        memoryManager.summarizeSession(sessionId, workspaceDir, { threadId, chatKey, status: 'closed' }).then((result: any) => {
          if (threadId && result?.mode === 'summary') {
            memoryManager.closeThread(threadId)
          }
        })
      },
      closeThread: (id: string) => closed.push(id),
      pauseThread: () => {},
    }
    dispatcher.setMemoryManager(memoryManager)

    await dispatcher.dispatch(msg({ content: 'continue project' }))
    expect(ensured).toHaveLength(1)
    expect(agent.calls[0].content).toContain('Thread=feishu:ou_abc:thread-1')
    expect(agent.calls[0].threadId).toBe('feishu:ou_abc:thread-1')

    const firstSession = sessionManager.get('feishu:ou_abc')!
    const firstHistoryPath = getWorkspaceDailyHistoryFile(firstSession.workspaceDir, new Date().toISOString().slice(0, 10))
    const firstHistory = readFileSync(firstHistoryPath, 'utf-8')
    expect(firstHistory).not.toContain('[Memory Context]')

    await dispatcher.dispatch(msg({ type: 'command', content: '/new' }))
    await Promise.resolve()
    expect(closed).toContain('feishu:ou_abc:thread-1')
    expect(summarized.some(call => call[2]?.status === 'closed')).toBe(true)
    expect(agent.disposed).toContain('feishu:ou_abc')
  })

  it('starts session summary in background on /new', async () => {
    const agent = makeAgent()
    const dispatcher = new Dispatcher(sessionManager, agent)
    const closed: string[] = []
    let releaseSummary: (() => void) | null = null
    const summarizeCalls: any[] = []

    const memoryManager: any = {
      ensureThread: () => 'feishu:ou_abc:thread-1',
      buildRuntimeContext: () => ({ knowledge: [], promptBlock: '' }),
      summarizeSession: (...args: any[]) => {
        summarizeCalls.push(args)
        return new Promise((resolve) => {
          releaseSummary = () => resolve({ id: 'ep-1', mode: 'summary' })
        })
      },
      startBackgroundSummary: ({ sessionId, workspaceDir, threadId, chatKey }: any) => {
        memoryManager.summarizeSession(sessionId, workspaceDir, { threadId, chatKey, status: 'closed' }).then((result: any) => {
          if (threadId && result?.mode === 'summary') {
            memoryManager.closeThread(threadId)
          }
        })
      },
      closeThread: (id: string) => closed.push(id),
      pauseThread: () => {},
    }
    dispatcher.setMemoryManager(memoryManager)

    let replied = false
    await dispatcher.dispatch(msg())
    await dispatcher.dispatch(msg({ type: 'command', content: '/new' }), async (content) => {
      replied = true
      return content
    })

    expect(replied).toBe(true)
    expect(agent.disposed).toContain('feishu:ou_abc')
    expect(summarizeCalls).toHaveLength(1)
    expect(closed).toHaveLength(0)

    expect(releaseSummary).toBeTruthy()
    ;(releaseSummary as unknown as (() => void))()
    await dispatcher.drainQueues()
    expect(closed).toEqual(['feishu:ou_abc:thread-1'])
  })

  it('preserves failed summary thread state on /new fallback', async () => {
    const agent = makeAgent()
    const dispatcher = new Dispatcher(sessionManager, agent)
    const closed: string[] = []

    const memoryManager: any = {
      ensureThread: () => 'feishu:ou_abc:thread-1',
      buildRuntimeContext: () => ({ knowledge: [], promptBlock: '' }),
      summarizeSession: async () => ({ id: 'ep-fallback', mode: 'fallback' }),
      startBackgroundSummary: ({ sessionId, workspaceDir, threadId, chatKey }: any) => {
        memoryManager.summarizeSession(sessionId, workspaceDir, { threadId, chatKey, status: 'closed' }).then((result: any) => {
          if (threadId && result?.mode === 'summary') {
            memoryManager.closeThread(threadId)
          }
        })
      },
      closeThread: (id: string) => closed.push(id),
      pauseThread: () => {},
    }
    dispatcher.setMemoryManager(memoryManager)

    await dispatcher.dispatch(msg())
    await dispatcher.dispatch(msg({ type: 'command', content: '/new' }))
    await Promise.resolve()
    expect(closed).toHaveLength(0)
    expect(agent.disposed).toContain('feishu:ou_abc')
  })
}
)
