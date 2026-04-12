import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, rmSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { MemoryManager } from '../../../src/memory/manager'

let tmpDir: string
let manager: MemoryManager

beforeEach(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), 'friclaw-test-'))
  manager = new MemoryManager({ dir: tmpDir, searchLimit: 10, vectorEnabled: false, vectorEndpoint: '' })
  await manager.init()
})

afterEach(async () => {
  await manager.shutdown()
  rmSync(tmpDir, { recursive: true })
})

describe('MemoryManager', () => {
  it('init() creates required directories and database', () => {
    expect(existsSync(join(tmpDir, 'knowledge'))).toBe(true)
    expect(existsSync(join(tmpDir, 'episodes'))).toBe(true)
    expect(existsSync(join(tmpDir, 'index.sqlite'))).toBe(true)
  })

  it('ensureThread() creates a thread id', () => {
    const threadId = manager.ensureThread({
      sessionId: 'feishu:ou_abc',
      platform: 'feishu',
      chatId: 'ou_abc',
      workspaceDir: '/tmp/workspace',
    })
    expect(threadId).toContain('feishu:ou_abc:')
  })

  it('buildRuntimeContext() returns empty prompt for blank input', () => {
    const context = manager.buildRuntimeContext('   ')
    expect(context.promptBlock).toBe('')
    expect(context.knowledge).toHaveLength(0)
  })

  it('buildRuntimeContext() assembles relevant memory when available', () => {
    const threadId = manager.ensureThread({
      sessionId: 'feishu:ou_abc',
      platform: 'feishu',
      chatId: 'ou_abc',
      workspaceDir: '/tmp/workspace',
    })
    manager.knowledge.saveRecord({
      id: 'projects',
      metadata: {
        title: 'projects',
        date: new Date().toISOString(),
        tags: ['memory'],
        domain: 'project',
        entities: ['friclaw'],
        status: 'active',
        confidence: 'high',
      },
      content: 'friclaw runtime memory work is active',
    })
    manager.episode.save('We discussed friclaw runtime memory in the previous session', ['memory'], {
      threadId,
      chatKey: 'feishu:ou_abc',
      nextStep: 'Implement retrieval',
    })

    const context = manager.buildRuntimeContext({
      messageText: '继续 friclaw runtime memory',
      session: {
        sessionId: 'feishu:ou_abc',
        platform: 'feishu',
        chatId: 'ou_abc',
        workspaceDir: '/tmp/workspace',
        activeThreadId: threadId,
      },
    })
    expect(context.promptBlock).toContain('[Memory Context]')
    expect(context.promptBlock).toContain('[Relevant Episode]')
  })

  it('collectPromotionCandidates() returns identity and knowledge candidates', () => {
    manager.knowledge.saveRecord({
      id: 'owner-profile',
      metadata: {
        title: 'owner-profile',
        date: new Date().toISOString(),
        tags: ['profile'],
        status: 'active',
        confidence: 'high',
      },
      content: 'Boss prefers concise updates',
    })
    manager.episode.save('Need to continue memory implementation', ['memory'], {
      nextStep: 'Finish metadata-aware retrieval',
    })

    const candidates = manager.collectPromotionCandidates()
    expect(candidates.some(candidate => candidate.targetCategory === 'identity')).toBe(true)
    expect(candidates.some(candidate => candidate.targetCategory === 'knowledge')).toBe(true)
  })

  it('collectPromotionCandidates() limits knowledge promotion scan when episode ids are provided', () => {
    manager.knowledge.saveRecord({
      id: 'owner-profile',
      metadata: {
        title: 'owner-profile',
        date: new Date().toISOString(),
        tags: ['profile'],
        status: 'active',
        confidence: 'high',
      },
      content: 'Boss prefers concise updates',
    })
    const episodeId = manager.episode.save('Need to continue memory implementation', ['memory'], {
      nextStep: 'Finish metadata-aware retrieval',
    })

    const candidates = manager.collectPromotionCandidates([episodeId])
    expect(candidates.every(candidate => candidate.sourceCategory === 'episode')).toBe(true)
    expect(candidates.some(candidate => candidate.targetCategory === 'knowledge')).toBe(true)
  })

  it('applyPromotionCandidates() keeps same source idempotent and separates different sources', () => {
    const first = manager.applyPromotionCandidates([
      {
        sourceCategory: 'episode',
        sourceId: 'ep-1',
        targetCategory: 'knowledge',
        reason: 'promote',
        title: 'same title',
        content: 'content A',
        tags: ['memory'],
      },
      {
        sourceCategory: 'episode',
        sourceId: 'ep-2',
        targetCategory: 'knowledge',
        reason: 'promote',
        title: 'same title',
        content: 'content B',
        tags: ['memory'],
      },
    ])

    const second = manager.applyPromotionCandidates([
      {
        sourceCategory: 'episode',
        sourceId: 'ep-1',
        targetCategory: 'knowledge',
        reason: 'promote',
        title: 'same title',
        content: 'content C',
        tags: ['memory'],
      },
    ])

    const firstId = first[0].appliedTargetId
    const secondId = first[1].appliedTargetId
    expect(firstId).toBeTruthy()
    expect(secondId).toBeTruthy()
    expect(firstId).not.toBe(secondId)
    expect(second[0].appliedTargetId).toBe(firstId)
    expect(manager.knowledge.read(firstId!)).toContain('content C')
    expect(manager.knowledge.read(secondId!)).toContain('content B')
  })
})
