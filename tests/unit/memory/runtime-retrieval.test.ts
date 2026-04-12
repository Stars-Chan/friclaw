import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { MemoryManager } from '../../../src/memory/manager'

let tmpDir: string
let manager: MemoryManager

beforeEach(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), 'friclaw-runtime-memory-'))
  manager = new MemoryManager({ dir: tmpDir, searchLimit: 10, vectorEnabled: false, vectorEndpoint: '' })
  await manager.init()
})

afterEach(async () => {
  await manager.shutdown()
  rmSync(tmpDir, { recursive: true, force: true })
})

describe('runtime memory retrieval', () => {
  it('builds runtime context from metadata-rich knowledge', () => {
    manager.knowledge.saveRecord({
      id: 'memory-system',
      metadata: {
        title: 'memory-system',
        date: new Date().toISOString(),
        tags: ['memory'],
        domain: 'project',
        entities: ['FriClaw', 'MemoryManager'],
        status: 'active',
        confidence: 'high',
      },
      content: 'FriClaw memory system uses knowledge retrieval for runtime context',
    })
    const context = manager.buildRuntimeContext('请继续 memory system 的实现')

    expect(context.knowledge.length).toBeGreaterThan(0)
    expect(context.knowledge[0].domain).toBe('project')
    expect(context.promptBlock).toContain('[Relevant Knowledge]')
  })

  it('prefers same-thread episode for continue-like requests', () => {
    const threadId = manager.ensureThread({
      sessionId: 'feishu:ou_abc',
      platform: 'feishu',
      chatId: 'ou_abc',
      workspaceDir: '/tmp/workspace',
    })
    manager.episode.save('We previously decided to continue the runtime memory implementation for FriClaw.', ['memory'], {
      threadId,
      chatKey: 'feishu:ou_abc',
      nextStep: 'Finish thread retriever',
    })
    manager.episode.save('An unrelated summary', ['other'], {
      threadId: 'other-thread',
      chatKey: 'feishu:other',
    })

    const context = manager.buildRuntimeContext({
      messageText: '继续 runtime memory implementation',
      session: {
        sessionId: 'feishu:ou_abc',
        platform: 'feishu',
        chatId: 'ou_abc',
        workspaceDir: '/tmp/workspace',
        activeThreadId: threadId,
      },
    })

    expect(context.episode).toBeDefined()
    expect(context.episode?.threadId).toBe(threadId)
    expect(context.promptBlock).toContain('[Relevant Episode]')
  })
})
