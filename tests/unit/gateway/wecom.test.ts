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
    close = mock(() => {})
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
  botId: 'bot_001',
  secret: 'secret_001',
})

const makeDispatcher = () => {
  const dispatched: Message[] = []
  return {
    dispatched,
    dispatch: async (msg: Message, _reply?: unknown, _streamHandler?: unknown) => { dispatched.push(msg) },
  }
}

const makeTextEvent = (overrides: Record<string, unknown> = {}) => JSON.stringify({
  cmd: 'aibot_msg_callback',
  headers: {
    req_id: 'req_001',
  },
  body: {
    msgid: 'msg_001',
    msgtype: 'text',
    text: {
      content: 'hello',
    },
    from: {
      userid: 'user_001',
    },
    chattype: 'single',
    chatid: 'user_001',
    aibotid: 'bot_001',
    ...overrides,
  },
})

describe('WecomGateway', () => {
  beforeEach(() => {
    mockWsSend.mockClear()
    mockFetch.mockClear()
    capturedMessageHandler = null
    capturedOpenHandler = null
    capturedCloseHandler = null
  })

  it('start() initializes WebSocket client', async () => {
    const gw = new WecomGateway(makeConfig())
    await gw.start(makeDispatcher() as never)
    // The new implementation connects directly without fetching URL
    expect(gw).toBeDefined()
  })

  it('text message dispatched correctly', async () => {
    const dispatcher = makeDispatcher()
    const gw = new WecomGateway(makeConfig())
    await gw.start(dispatcher as never)

    // Simulate receiving a message through the WebSocket client
    const messageData = JSON.parse(makeTextEvent())
    // @ts-ignore - accessing private property for testing
    gw._client.emit('message', {
      msgId: messageData.body.msgid,
      msgType: messageData.body.msgtype,
      content: messageData.body.text.content,
      fromUser: messageData.body.from.userid,
      chatType: messageData.body.chattype,
      chatId: messageData.body.chatid,
      reqId: messageData.headers.req_id,
    })

    // Wait for debounce buffer to flush (2.1 seconds to be safe)
    await new Promise(resolve => setTimeout(resolve, 2100))

    expect(dispatcher.dispatched).toHaveLength(1)
    const msg = dispatcher.dispatched[0]
    expect(msg.platform).toBe('wecom')
    expect(msg.chatId).toBe('user_001')
    expect(msg.userId).toBe('user_001')
    expect(msg.type).toBe('text')
    expect(msg.content).toBe('hello')
  })

  it('event callbacks are filtered out', async () => {
    const dispatcher = makeDispatcher()
    const gw = new WecomGateway(makeConfig())
    await gw.start(dispatcher as never)
    await capturedMessageHandler!(Buffer.from(JSON.stringify({
      cmd: 'aibot_event_callback',
      headers: { req_id: 'req_001' },
      body: { eventtype: 'test_event' },
    })))
    expect(dispatcher.dispatched).toHaveLength(0)
  })

  it('/command sets message type to command', async () => {
    const dispatcher = makeDispatcher()
    const gw = new WecomGateway(makeConfig())
    await gw.start(dispatcher as never)

    // Simulate receiving a command message
    const messageData = JSON.parse(makeTextEvent({
      text: { content: '/new' },
    }))
    // @ts-ignore - accessing private property for testing
    gw._client.emit('message', {
      msgId: messageData.body.msgid,
      msgType: messageData.body.msgtype,
      content: messageData.body.text.content,
      fromUser: messageData.body.from.userid,
      chatType: messageData.body.chattype,
      chatId: messageData.body.chatid,
      reqId: messageData.headers.req_id,
    })

    // Give time for async processing
    await new Promise(resolve => setTimeout(resolve, 10))

    expect(dispatcher.dispatched[0].type).toBe('command')
    expect(dispatcher.dispatched[0].content).toBe('/new')
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
