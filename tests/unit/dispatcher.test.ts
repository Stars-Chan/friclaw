import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, rmSync, readFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { Dispatcher } from '../../src/dispatcher'
import { SessionManager } from '../../src/session/manager'
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

  it('injects runtime memory context and attaches thread info', async () => {
    const agent = makeAgent()
    const dispatcher = new Dispatcher(sessionManager, agent)
    const ensured: string[] = []
    const summarized: any[] = []
    const closed: string[] = []
    const paused: string[] = []

    dispatcher.setMemoryManager({
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
        return null
      },
      closeThread: (id: string) => closed.push(id),
      pauseThread: (id: string) => paused.push(id),
    } as any)

    await dispatcher.dispatch(msg({ content: 'continue project' }))
    expect(ensured).toHaveLength(1)
    expect(agent.calls[0].content).toContain('Thread=feishu:ou_abc:thread-1')
    expect(agent.calls[0].threadId).toBe('feishu:ou_abc:thread-1')

    const firstSession = sessionManager.get('feishu:ou_abc')!
    const firstHistoryPath = join(firstSession.workspaceDir, '.friclaw', '.history', `${new Date().toISOString().slice(0, 10)}.txt`)
    const firstHistory = readFileSync(firstHistoryPath, 'utf-8')
    expect(firstHistory).not.toContain('[Memory Context]')

    await dispatcher.dispatch(msg({ type: 'command', content: '/clear' }))
    expect(paused).toContain('feishu:ou_abc:thread-1')
    expect(summarized[0][2].status).toBe('paused')
    expect(agent.disposed).toContain('feishu:ou_abc')

    await dispatcher.dispatch(msg())
    const secondSession = sessionManager.get('feishu:ou_abc')!
    const secondHistoryPath = join(secondSession.workspaceDir, '.friclaw', '.history', `${new Date().toISOString().slice(0, 10)}.txt`)
    const secondHistory = readFileSync(secondHistoryPath, 'utf-8')
    expect(secondHistory).not.toContain('[Memory Context]')

    await dispatcher.dispatch(msg({ type: 'command', content: '/new' }))
    expect(closed.length).toBeGreaterThan(0)
    expect(summarized.some(call => call[2]?.status === 'closed')).toBe(true)
    expect(agent.disposed.filter(id => id === 'feishu:ou_abc').length).toBeGreaterThanOrEqual(2)
  })
}
)
