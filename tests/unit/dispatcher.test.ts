// tests/unit/dispatcher.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { Dispatcher } from '../../src/dispatcher'
import { SessionManager } from '../../src/session/manager'
import type { Message } from '../../src/types/message'

let tmpDir: string
let sessionManager: SessionManager

const makeAgent = () => {
  const calls: Array<{ sessionId: string; content: string }> = []
  return {
    calls,
    handle: async (session: { id: string }, msg: Message) => {
      calls.push({ sessionId: session.id, content: msg.content })
    },
    dispose: async () => {},
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

  it('same session messages are serialized', async () => {
    const order: number[] = []
    let resolve1!: () => void
    const agent = {
      handle: async (_session: { id: string }, m: Message) => {
        if (m.content === 'first') {
          await new Promise<void>(r => { resolve1 = r })
          order.push(1)
        } else {
          order.push(2)
        }
      },
      dispose: async () => {},
    }
    const dispatcher = new Dispatcher(sessionManager, agent)
    const p1 = dispatcher.dispatch(msg({ content: 'first' }))
    const p2 = dispatcher.dispatch(msg({ content: 'second' }))
    resolve1!()
    await Promise.all([p1, p2])
    expect(order).toEqual([1, 2])
  })

  it('different sessions run in parallel', async () => {
    const started: string[] = []
    let resolve1!: () => void
    const agent = {
      handle: async (session: { id: string }, _m: Message) => {
        started.push(session.id)
        if (session.id === 'feishu:ou_aaa') {
          await new Promise<void>(r => { resolve1 = r })
        }
      },
      dispose: async () => {},
    }
    const dispatcher = new Dispatcher(sessionManager, agent)
    const p1 = dispatcher.dispatch(msg({ chatId: 'ou_aaa' }))
    const p2 = dispatcher.dispatch(msg({ chatId: 'ou_bbb' }))
    await p2
    expect(started).toContain('feishu:ou_bbb')
    resolve1!()
    await p1
  })

  it('/clear command short-circuits and calls clearSession', async () => {
    const agent = makeAgent()
    const cleared: string[] = []
    sessionManager.onSessionCleared = (id) => cleared.push(id)
    const dispatcher = new Dispatcher(sessionManager, agent)
    await dispatcher.dispatch(msg())
    await dispatcher.dispatch(msg({ type: 'command', content: '/clear' }))
    expect(agent.calls).toHaveLength(1)
    expect(cleared).toContain('feishu:ou_abc')
  })

  it('/new command short-circuits and creates new workspace', async () => {
    const agent = makeAgent()
    const dispatcher = new Dispatcher(sessionManager, agent)
    await dispatcher.dispatch(msg())
    const oldDir = sessionManager.get('feishu:ou_abc')?.workspaceDir
    await dispatcher.dispatch(msg({ type: 'command', content: '/new' }))
    expect(agent.calls).toHaveLength(1)
    const newDir = sessionManager.get('feishu:ou_abc')?.workspaceDir
    expect(newDir).toBeDefined()
    expect(newDir).not.toBe(oldDir)
  })

  it('/status command short-circuits and does not call agent', async () => {
    const agent = makeAgent()
    const dispatcher = new Dispatcher(sessionManager, agent)
    await dispatcher.dispatch(msg({ type: 'command', content: '/status' }))
    expect(agent.calls).toHaveLength(0)
  })

  it('unknown command passes to agent for Claude skills support', async () => {
    const agent = makeAgent()
    const dispatcher = new Dispatcher(sessionManager, agent)
    await dispatcher.dispatch(msg({ type: 'command', content: '/unknown' }))
    expect(agent.calls).toHaveLength(1)
    expect(agent.calls[0].content).toBe('/unknown')
  })

  it('stopAccepting rejects new dispatches', async () => {
    const agent = makeAgent()
    const dispatcher = new Dispatcher(sessionManager, agent)
    dispatcher.stopAccepting()
    await expect(dispatcher.dispatch(msg())).rejects.toThrow('not accepting')
  })

  it('drainQueues resolves when all lanes are empty', async () => {
    const agent = makeAgent()
    const dispatcher = new Dispatcher(sessionManager, agent)
    await dispatcher.dispatch(msg())
    await dispatcher.drainQueues()
    expect(dispatcher.activeLanes()).toBe(0)
  })
})
