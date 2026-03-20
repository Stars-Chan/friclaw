// tests/unit/gateway/feishu.test.ts
import { describe, it, expect, mock, beforeEach } from 'bun:test'

const mockWSClientStart = mock(async () => {})
let capturedEventHandler: ((event: unknown) => Promise<void>) | null = null

mock.module('@larksuiteoapi/node-sdk', () => {
  class EventDispatcher {
    private handlers: Record<string, (e: unknown) => Promise<void>> = {}
    register(map: Record<string, (e: unknown) => Promise<void>>) {
      Object.assign(this.handlers, map)
      return this
    }
    async dispatch(eventType: string, event: unknown) {
      await this.handlers[eventType]?.(event)
    }
  }
  class WSClient {
    private dispatcher: EventDispatcher
    constructor(opts: { eventDispatcher: EventDispatcher }) {
      this.dispatcher = opts.eventDispatcher
      capturedEventHandler = (event: unknown) =>
        this.dispatcher.dispatch('im.message.receive_v1', event)
    }
    start = mockWSClientStart
  }
  const mockMessageCreate = mock(async () => ({ data: { message_id: 'msg_created' } }))
  const mockMessageUpdate = mock(async () => {})
  const mockMessageResourceGet = mock(async () => 'fake_image_buffer')
  class Client {
    im = {
      message: {
        create: mockMessageCreate,
        update: mockMessageUpdate,
      },
      messageResource: {
        get: mockMessageResourceGet,
      },
    }
  }
  return { default: { Client, WSClient, EventDispatcher } }
})

import { FeishuGateway } from '../../../src/gateway/feishu'
import type { Message } from '../../../src/types/message'

const makeConfig = () => ({
  appId: 'app_001',
  appSecret: 'secret_001',
  encryptKey: '',
  verificationToken: '',
})

const makeDispatcher = () => {
  const dispatched: Message[] = []
  const replies: string[] = []
  return {
    dispatched,
    replies,
    dispatch: async (msg: Message, reply?: (content: string) => Promise<string>, _streamHandler?: unknown) => {
      dispatched.push(msg)
      if (reply) replies.push('Reply called')
    },
  }
}

const makeEvent = (overrides: Record<string, unknown> = {}) => ({
  message: {
    message_id: 'msg_001',
    message_type: 'text',
    chat_id: 'oc_room1',
    chat_type: 'p2p',
    root_id: null,
    content: JSON.stringify({ text: 'hello' }),
    ...overrides,
  },
  sender: {
    sender_id: { user_id: 'user_001' },
  },
})

describe('FeishuGateway', () => {
  beforeEach(() => {
    mockWSClientStart.mockClear()
    capturedEventHandler = null
  })

  it('start() connects WSClient', async () => {
    const gw = new FeishuGateway(makeConfig())
    await gw.start(makeDispatcher() as never)
    expect(mockWSClientStart).toHaveBeenCalledTimes(1)
  })

  it('private message dispatched correctly', async () => {
    const dispatcher = makeDispatcher()
    const gw = new FeishuGateway(makeConfig())
    await gw.start(dispatcher as never)
    await capturedEventHandler!(makeEvent({ chat_type: 'p2p' }))
    expect(dispatcher.dispatched).toHaveLength(1)
    const msg = dispatcher.dispatched[0]
    expect(msg.platform).toBe('feishu')
    expect(msg.chatId).toBe('oc_room1')
    expect(msg.userId).toBe('user_001')
    expect(msg.type).toBe('text')
    expect(msg.content).toBe('hello')
    expect(msg.chatType).toBe('private')
  })

  it('group message without @mention is ignored', async () => {
    const dispatcher = makeDispatcher()
    const gw = new FeishuGateway(makeConfig())
    await gw.start(dispatcher as never)
    await capturedEventHandler!(makeEvent({
      chat_type: 'group',
      content: JSON.stringify({ text: 'hello', mentions: [] }),
    }))
    expect(dispatcher.dispatched).toHaveLength(0)
  })

  it('group message with @mention is dispatched', async () => {
    const dispatcher = makeDispatcher()
    const gw = new FeishuGateway(makeConfig())
    await gw.start(dispatcher as never)
    await capturedEventHandler!(makeEvent({
      chat_type: 'group',
      content: JSON.stringify({ text: '@bot hello', mentions: [{ key: '@_user_1' }] }),
    }))
    expect(dispatcher.dispatched).toHaveLength(1)
    const msg = dispatcher.dispatched[0]
    expect(msg.chatType).toBe('group')
  })

  it('thread message uses chatId:rootId as chatId', async () => {
    const dispatcher = makeDispatcher()
    const gw = new FeishuGateway(makeConfig())
    await gw.start(dispatcher as never)
    await capturedEventHandler!(makeEvent({ chat_type: 'p2p', root_id: 'root_msg_001' }))
    expect(dispatcher.dispatched[0].chatId).toBe('oc_room1:root_msg_001')
  })

  it('non-text message type is ignored', async () => {
    const dispatcher = makeDispatcher()
    const gw = new FeishuGateway(makeConfig())
    await gw.start(dispatcher as never)
    await capturedEventHandler!(makeEvent({ message_type: 'sticker' }))
    expect(dispatcher.dispatched).toHaveLength(0)
  })

  it('/command content sets message type to command', async () => {
    const dispatcher = makeDispatcher()
    const gw = new FeishuGateway(makeConfig())
    await gw.start(dispatcher as never)
    await capturedEventHandler!(makeEvent({ content: JSON.stringify({ text: '/clear' }) }))
    expect(dispatcher.dispatched[0].type).toBe('command')
    expect(dispatcher.dispatched[0].content).toBe('/clear')
  })

  it('image message is dispatched with correct type', async () => {
    const dispatcher = makeDispatcher()
    const gw = new FeishuGateway(makeConfig())
    await gw.start(dispatcher as never)
    const event = {
      message: {
        message_id: 'msg_001',
        message_type: 'image',
        chat_id: 'oc_room1',
        chat_type: 'p2p',
        root_id: null,
        content: JSON.stringify({ image_key: 'img_v2_abc' }),
      },
      sender: {
        sender_id: { user_id: 'user_001' },
      },
    }
    await capturedEventHandler!(event)
    expect(dispatcher.dispatched).toHaveLength(1)
    const msg = dispatcher.dispatched[0]
    expect(msg.type).toBe('image')
    expect(msg.content).toBe('')
    expect(msg.messageId).toBe('msg_001')
    expect(msg.platform).toBe('feishu')
  })

  it('send() creates message', async () => {
    const gw = new FeishuGateway(makeConfig())
    await gw.start(makeDispatcher() as never)
    const messageId = await gw.send('oc_room1', 'Hello')
    expect(messageId).toBe('msg_created')
  })
})
