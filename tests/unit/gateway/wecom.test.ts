// tests/unit/gateway/wecom.test.ts
import { describe, it, expect, mock, beforeEach } from 'bun:test'
import type { Message } from '../../../src/types/message'

// Mock ws module
const mockWsSend = mock((_data: string) => {})
let capturedMessageHandler: ((data: Buffer) => Promise<void>) | null = null
let capturedOpenHandler: (() => void) | null = null
let capturedCloseHandler: (() => void) | null = null

mock.module('ws', () => {
  class WebSocket {
    static OPEN = 1
    readyState = 1
    send = mockWsSend
    on(event: string, handler: (...args: unknown[]) => void) {
      if (event === 'message') capturedMessageHandler = handler as never
      if (event === 'open') capturedOpenHandler = handler as never
      if (event === 'close') capturedCloseHandler = handler as never
      if (event === 'error') {} // ignore
      return this
    }
  }
  return { default: WebSocket, WebSocket }
})

// Mock fetch for access token + ws endpoint
const mockFetch = mock(async (url: string) => {
  if (String(url).includes('gettoken')) {
    return { json: async () => ({ access_token: 'fake_token', expires_in: 7200 }) }
  }
  if (String(url).includes('get_ws_url')) {
    return { json: async () => ({ url: 'ws://fake-wecom-ws' }) }
  }
  if (String(url).includes('message/send')) {
    return { json: async () => ({ errcode: 0, msgid: 'msg_wecom_001' }) }
  }
  return { json: async () => ({}) }
})
global.fetch = mockFetch as never

import { WecomGateway } from '../../../src/gateway/wecom'

const makeConfig = () => ({
  corpId: 'corp_001',
  agentId: 1000001,
  secret: 'secret_001',
})

const makeDispatcher = () => {
  const dispatched: Message[] = []
  return {
    dispatched,
    dispatch: async (msg: Message) => { dispatched.push(msg) },
  }
}

const makeTextEvent = (overrides: Record<string, unknown> = {}) => JSON.stringify({
  MsgType: 'text',
  MsgId: 'msg_001',
  Content: 'hello',
  FromUserName: 'user_001',
  ...overrides,
})

describe('WecomGateway', () => {
  beforeEach(() => {
    mockWsSend.mockClear()
    mockFetch.mockClear()
    capturedMessageHandler = null
    capturedOpenHandler = null
    capturedCloseHandler = null
  })

  it('start() fetches ws endpoint and connects', async () => {
    const gw = new WecomGateway(makeConfig())
    await gw.start(makeDispatcher() as never)
    expect(mockFetch).toHaveBeenCalled()
  })

  it('text message dispatched correctly', async () => {
    const dispatcher = makeDispatcher()
    const gw = new WecomGateway(makeConfig())
    await gw.start(dispatcher as never)
    await capturedMessageHandler!(Buffer.from(makeTextEvent()))
    expect(dispatcher.dispatched).toHaveLength(1)
    const msg = dispatcher.dispatched[0]
    expect(msg.platform).toBe('wecom')
    expect(msg.chatId).toBe('user_001')
    expect(msg.userId).toBe('user_001')
    expect(msg.type).toBe('text')
    expect(msg.content).toBe('hello')
  })

  it('heartbeat message is responded to, not dispatched', async () => {
    const dispatcher = makeDispatcher()
    const gw = new WecomGateway(makeConfig())
    await gw.start(dispatcher as never)
    await capturedMessageHandler!(Buffer.from(JSON.stringify({ MsgType: 'heartbeat' })))
    expect(dispatcher.dispatched).toHaveLength(0)
    expect(mockWsSend).toHaveBeenCalledWith(JSON.stringify({ MsgType: 'heartbeat_response' }))
  })

  it('/command sets message type to command', async () => {
    const dispatcher = makeDispatcher()
    const gw = new WecomGateway(makeConfig())
    await gw.start(dispatcher as never)
    await capturedMessageHandler!(Buffer.from(makeTextEvent({ Content: '/clear' })))
    expect(dispatcher.dispatched[0].type).toBe('command')
    expect(dispatcher.dispatched[0].content).toBe('/clear')
  })

  it('non-text message type is ignored', async () => {
    const dispatcher = makeDispatcher()
    const gw = new WecomGateway(makeConfig())
    await gw.start(dispatcher as never)
    await capturedMessageHandler!(Buffer.from(JSON.stringify({ MsgType: 'voice', MsgId: 'x', FromUserName: 'u' })))
    expect(dispatcher.dispatched).toHaveLength(0)
  })

  it('stop() clears reconnect timer', async () => {
    const gw = new WecomGateway(makeConfig())
    await gw.start(makeDispatcher() as never)
    await expect(gw.stop()).resolves.toBeUndefined()
  })
})
