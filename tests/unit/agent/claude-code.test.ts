// tests/unit/agent/claude-code.test.ts
import { describe, it, expect } from 'bun:test'
import { ClaudeCodeAgent } from '../../../src/agent/claude-code'
import type { Session } from '../../../src/session/types'
import type { Message } from '../../../src/types/message'

function makeFakeSpawn(lines: string[]) {
  const encoder = new TextEncoder()
  let controller!: ReadableStreamDefaultController<Uint8Array>
  const stdout = new ReadableStream<Uint8Array>({
    start(c) { controller = c },
  })
  Promise.resolve().then(() => {
    for (const line of lines) controller.enqueue(encoder.encode(line + '\n'))
    controller.close()
  })
  return {
    stdin: {
      written: [] as string[],
      write(data: string) { this.written.push(data) },
      flush() {},
    },
    stdout,
    stderr: new ReadableStream({ start(c) { c.close() } }),
    exitCode: null as number | null,
    kill() { this.exitCode = 1 },
  }
}

const makeSession = (overrides: Partial<Session> = {}): Session => ({
  id: 'feishu:ou_abc', userId: 'user1', chatId: 'ou_abc',
  platform: 'feishu', chatType: 'private', workspaceDir: '/tmp/ws',
  createdAt: Date.now(), lastActiveAt: Date.now(), ...overrides,
})

const makeMessage = (overrides: Partial<Message> = {}): Message => ({
  platform: 'feishu', chatId: 'ou_abc', userId: 'user1',
  type: 'text', content: 'hello', ...overrides,
})

describe('ClaudeCodeAgent', () => {
  it('handle() sends user message to stdin and resolves', async () => {
    const lines = [
      JSON.stringify({ type: 'system', subtype: 'init', session_id: 'sess_001' }),
      JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'Hi' }] } }),
      JSON.stringify({ type: 'result', subtype: 'success', result: 'Hi', session_id: 'sess_001' }),
    ]
    const fakeProc = makeFakeSpawn(lines)
    const agent = new ClaudeCodeAgent({ spawnFn: () => fakeProc as never })
    await expect(agent.handle(makeSession(), makeMessage())).resolves.toBeUndefined()
    const payload = JSON.parse(fakeProc.stdin.written[0])
    expect(payload.type).toBe('user')
    expect(payload.message.role).toBe('user')
  })

  it('stores session_id and uses --resume on next spawn', async () => {
    const lines = [
      JSON.stringify({ type: 'system', subtype: 'init', session_id: 'sess_resume' }),
      JSON.stringify({ type: 'result', subtype: 'success', result: 'ok', session_id: 'sess_resume' }),
    ]
    const spawnCalls: string[][] = []
    const spawnFn = (args: string[]) => { spawnCalls.push(args); return makeFakeSpawn(lines) as never }
    const agent = new ClaudeCodeAgent({ spawnFn })
    await agent.handle(makeSession(), makeMessage())
    expect(spawnCalls[0]).not.toContain('--resume')
    // simulate process exit
    ;(agent as never)['processes'].get('feishu:ou_abc').exitCode = 0
    await agent.handle(makeSession(), makeMessage())
    expect(spawnCalls[1]).toContain('--resume')
    expect(spawnCalls[1]).toContain('sess_resume')
  })

  it('reuses existing process when still alive', async () => {
    const lines = [
      JSON.stringify({ type: 'system', subtype: 'init', session_id: 'sess_x' }),
      JSON.stringify({ type: 'result', subtype: 'success', result: 'ok', session_id: 'sess_x' }),
    ]
    let spawnCount = 0
    const agent = new ClaudeCodeAgent({ spawnFn: () => { spawnCount++; return makeFakeSpawn(lines) as never } })
    await agent.handle(makeSession(), makeMessage())
    await agent.handle(makeSession(), makeMessage())
    expect(spawnCount).toBe(1)
  })

  it('dispose() kills all processes', async () => {
    const lines = [
      JSON.stringify({ type: 'system', subtype: 'init', session_id: 'sess_d' }),
      JSON.stringify({ type: 'result', subtype: 'success', result: 'ok', session_id: 'sess_d' }),
    ]
    const fakeProc = makeFakeSpawn(lines)
    const agent = new ClaudeCodeAgent({ spawnFn: () => fakeProc as never })
    await agent.handle(makeSession(), makeMessage())
    await agent.dispose()
    expect(fakeProc.exitCode).toBe(1)
  })

  it('injects --system-prompt when soulContent provided', async () => {
    const lines = [
      JSON.stringify({ type: 'system', subtype: 'init', session_id: 'sess_soul' }),
      JSON.stringify({ type: 'result', subtype: 'success', result: 'ok', session_id: 'sess_soul' }),
    ]
    const spawnCalls: string[][] = []
    const agent = new ClaudeCodeAgent({
      spawnFn: (args) => { spawnCalls.push(args); return makeFakeSpawn(lines) as never },
      soulContent: 'I am FriClaw',
    })
    await agent.handle(makeSession(), makeMessage())
    expect(spawnCalls[0]).toContain('--system-prompt')
    expect(spawnCalls[0]).toContain('I am FriClaw')
  })
})
