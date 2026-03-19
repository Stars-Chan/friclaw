// tests/unit/agent/router.test.ts
import { describe, it, expect, mock } from 'bun:test'
import { Router } from '../../../src/agent/router'
import type { Agent } from '../../../src/dispatcher'
import type { Session } from '../../../src/session/types'
import type { Message } from '../../../src/types/message'

const makeSession = (overrides: Partial<Session> = {}): Session => ({
  id: 'feishu:chat_001',
  userId: 'user_001',
  chatId: 'chat_001',
  platform: 'feishu',
  chatType: 'private',
  workspaceDir: '/tmp/ws',
  createdAt: Date.now(),
  lastActiveAt: Date.now(),
  ...overrides,
})

const makeMsg = (overrides: Partial<Message> = {}): Message => ({
  platform: 'feishu',
  chatId: 'chat_001',
  userId: 'user_001',
  type: 'text',
  content: 'hello',
  ...overrides,
})

const makeAgent = () => {
  const calls: Array<{ session: Session; message: Message }> = []
  const agent: Agent = { handle: async (s, m) => { calls.push({ session: s, message: m }) } }
  return { agent, calls }
}

describe('Router', () => {
  it('routes text message to default agent', async () => {
    const { agent, calls } = makeAgent()
    const router = new Router({ default: agent })
    await router.handle(makeSession(), makeMsg())
    expect(calls).toHaveLength(1)
  })

  it('routes image message to image agent when registered', async () => {
    const { agent: defaultAgent, calls: defaultCalls } = makeAgent()
    const { agent: imageAgent, calls: imageCalls } = makeAgent()
    const router = new Router({ default: defaultAgent, image: imageAgent })
    await router.handle(makeSession(), makeMsg({ type: 'image', content: 'base64data' }))
    expect(imageCalls).toHaveLength(1)
    expect(defaultCalls).toHaveLength(0)
  })

  it('falls back to default agent for image when no image agent registered', async () => {
    const { agent, calls } = makeAgent()
    const router = new Router({ default: agent })
    await router.handle(makeSession(), makeMsg({ type: 'image' }))
    expect(calls).toHaveLength(1)
  })

  it('routes file message to file agent when registered', async () => {
    const { agent: defaultAgent } = makeAgent()
    const { agent: fileAgent, calls: fileCalls } = makeAgent()
    const router = new Router({ default: defaultAgent, file: fileAgent })
    await router.handle(makeSession(), makeMsg({ type: 'file', content: '/tmp/test.txt' }))
    expect(fileCalls).toHaveLength(1)
  })

  it('group chat messages route to group agent when registered', async () => {
    const { agent: defaultAgent, calls: defaultCalls } = makeAgent()
    const { agent: groupAgent, calls: groupCalls } = makeAgent()
    const router = new Router({ default: defaultAgent, group: groupAgent })
    const session = makeSession({ chatType: 'group' })
    await router.handle(session, makeMsg())
    expect(groupCalls).toHaveLength(1)
    expect(defaultCalls).toHaveLength(0)
  })

  it('platform-specific agent takes priority over type-based routing', async () => {
    const { agent: defaultAgent } = makeAgent()
    const { agent: wecomAgent, calls: wecomCalls } = makeAgent()
    const router = new Router({ default: defaultAgent, wecom: wecomAgent })
    await router.handle(makeSession({ platform: 'wecom' }), makeMsg({ platform: 'wecom' }))
    expect(wecomCalls).toHaveLength(1)
  })

  it('middleware runs before routing', async () => {
    const { agent, calls } = makeAgent()
    const log: string[] = []
    const router = new Router({ default: agent })
    router.use(async (_s, _m, next) => { log.push('before'); await next(); log.push('after') })
    await router.handle(makeSession(), makeMsg())
    expect(log).toEqual(['before', 'after'])
    expect(calls).toHaveLength(1)
  })

  it('middleware can short-circuit routing', async () => {
    const { agent, calls } = makeAgent()
    const router = new Router({ default: agent })
    router.use(async (_s, _m, _next) => { /* don't call next */ })
    await router.handle(makeSession(), makeMsg())
    expect(calls).toHaveLength(0)
  })

  it('multiple middleware run in order', async () => {
    const { agent } = makeAgent()
    const log: string[] = []
    const router = new Router({ default: agent })
    router.use(async (_s, _m, next) => { log.push('mw1'); await next() })
    router.use(async (_s, _m, next) => { log.push('mw2'); await next() })
    await router.handle(makeSession(), makeMsg())
    expect(log).toEqual(['mw1', 'mw2'])
  })
})
