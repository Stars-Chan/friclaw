import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, rmSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { MemoryManager } from '../../../src/memory/manager'

let tmpDir: string
let manager: MemoryManager

beforeEach(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), 'friclaw-test-'))
  manager = new MemoryManager({
    dir: tmpDir,
    searchLimit: 10,
    vectorEnabled: false,
    vectorEndpoint: '',
    retrieval: {
      knowledgeItems: 3,
      knowledgeChars: 320,
      recentEpisodes: 5,
      threadEpisodes: 3,
      episodeChars: 700,
      promptChars: 1800,
      diagnosticsEnabled: true,
    },
  })
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
    const identityCandidate = candidates.find(candidate => candidate.targetCategory === 'identity')
    expect(identityCandidate).toBeTruthy()
    expect(identityCandidate?.id).toBeTruthy()
    expect(manager.knowledge.readIdentityCandidate(identityCandidate!.id!)).toMatchObject({
      id: identityCandidate?.id,
      sourceId: 'owner-profile',
      targetCategory: 'identity',
      status: 'proposed',
    })
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

  it('listKnowledgeSummaries() returns metadata-only summaries', () => {
    manager.knowledge.saveRecord({
      id: 'user-style',
      metadata: {
        title: 'user-style',
        date: new Date().toISOString(),
        tags: ['profile'],
        domain: 'preference',
        status: 'active',
        confidence: 'high',
      },
      content: 'User prefers concise updates',
    })

    const summaries = manager.listKnowledgeSummaries()
    expect(summaries).toMatchObject([
      {
        id: 'user-style',
        title: 'user-style',
        domain: 'preference',
        status: 'active',
      },
    ])
  })

  it('listThreadPreviews() and readThread() expose thread-first read model', () => {
    const threadId = manager.ensureThread({
      sessionId: 'feishu:ou_abc',
      platform: 'feishu',
      chatId: 'ou_abc',
      workspaceDir: '/tmp/workspace',
    })
    manager.episode.save('Thread summary for preview', ['memory'], {
      threadId,
      chatKey: 'feishu:ou_abc',
      nextStep: 'Continue tomorrow',
    })

    const previews = manager.listThreadPreviews()
    expect(previews.some(item => item.threadId === threadId)).toBe(true)

    const thread = manager.readThread(threadId)
    expect(thread?.thread.threadId).toBe(threadId)
    expect(thread?.episodes).toHaveLength(1)
  })

  it('updateKnowledgeLifecycle() and updateThreadLifecycle() persist lifecycle changes', () => {
    manager.knowledge.saveRecord({
      id: 'user-style',
      metadata: {
        title: 'user-style',
        date: new Date().toISOString(),
        tags: ['profile'],
        domain: 'preference',
        status: 'active',
        confidence: 'high',
      },
      content: 'User prefers concise updates',
    })

    const threadId = manager.ensureThread({
      sessionId: 'feishu:ou_abc',
      platform: 'feishu',
      chatId: 'ou_abc',
      workspaceDir: '/tmp/workspace',
    })

    const knowledge = manager.updateKnowledgeLifecycle('user-style', 'archived')
    const thread = manager.updateThreadLifecycle(threadId, 'archived')

    expect(knowledge?.metadata.status).toBe('archived')
    expect(thread?.status).toBe('archived')
  })

  it('collectPromotionCandidates() only promotes allowlisted active knowledge to identity', () => {
    manager.knowledge.saveRecord({
      id: 'user-style',
      metadata: {
        title: 'user-style',
        date: new Date().toISOString(),
        tags: ['profile'],
        domain: 'preference',
        status: 'active',
        confidence: 'high',
      },
      content: 'User prefers concise updates',
    })
    manager.knowledge.saveRecord({
      id: 'migration-plan',
      metadata: {
        title: 'migration-plan',
        date: new Date().toISOString(),
        tags: ['project'],
        domain: 'project',
        status: 'active',
        confidence: 'high',
      },
      content: 'Migrate memory stack this week',
    })
    manager.knowledge.saveRecord({
      id: 'uncertain-preference',
      metadata: {
        title: 'uncertain-preference',
        date: new Date().toISOString(),
        tags: ['profile'],
        domain: 'preference',
        status: 'uncertain',
        confidence: 'high',
      },
      content: 'User might prefer shorter summaries',
    })

    const candidates = manager.collectPromotionCandidates()
    expect(candidates.some(candidate => candidate.sourceId === 'user-style' && candidate.targetCategory === 'identity')).toBe(true)
    expect(candidates.some(candidate => candidate.sourceId === 'migration-plan' && candidate.targetCategory === 'identity')).toBe(false)
    expect(candidates.some(candidate => candidate.sourceId === 'uncertain-preference' && candidate.targetCategory === 'identity')).toBe(false)
  })

  it('reviewIdentityCandidate() only writes back to SOUL on approve', () => {
    manager.knowledge.saveRecord({
      id: 'user-style',
      metadata: {
        title: 'user-style',
        date: new Date().toISOString(),
        tags: ['profile'],
        domain: 'preference',
        status: 'active',
        confidence: 'high',
      },
      content: 'User prefers concise updates',
    })

    const candidate = manager.collectPromotionCandidates().find(item => item.targetCategory === 'identity')!
    const before = manager.identity.read()

    const deferred = manager.reviewIdentityCandidate(candidate.id!, { decision: 'defer', rationale: 'wait for confirmation' })
    expect(deferred?.status).toBe('deferred')
    expect(manager.identity.read()).toBe(before)

    const approved = manager.reviewIdentityCandidate(candidate.id!, { decision: 'approve', rationale: 'stable preference' })
    expect(approved?.status).toBe('approved')
    expect(approved?.applied).toBe(true)
    expect(manager.identity.read()).toContain('User prefers concise updates')
  })

  it('rollbackIdentity() restores previous SOUL version and records versions', () => {
    manager.knowledge.saveRecord({
      id: 'user-style',
      metadata: {
        title: 'user-style',
        date: new Date().toISOString(),
        tags: ['profile'],
        domain: 'preference',
        status: 'active',
        confidence: 'high',
      },
      content: 'User prefers concise updates',
    })

    const before = manager.identity.read()
    const candidate = manager.collectPromotionCandidates().find(item => item.targetCategory === 'identity')!
    manager.reviewIdentityCandidate(candidate.id!, { decision: 'approve', rationale: 'stable preference' })

    const afterApprove = manager.identity.read()
    expect(afterApprove).not.toBe(before)
    expect(manager.identity.listVersions().length).toBeGreaterThan(0)

    const rolledBack = manager.rollbackIdentity()
    expect(rolledBack).toBeTruthy()
    expect(manager.identity.read().trim()).toBe(before.trim())
  })

  it('mergeKnowledge() merges duplicates through manager', () => {
    manager.knowledge.saveRecord({
      id: 'runtime-memory-primary',
      metadata: {
        title: 'runtime-memory',
        date: new Date().toISOString(),
        tags: ['memory', 'runtime'],
        status: 'active',
        confidence: 'high',
        source: 'manual:primary',
      },
      content: 'Runtime memory keeps current retrieval context stable.',
    })
    manager.knowledge.saveRecord({
      id: 'runtime-memory-duplicate',
      metadata: {
        title: 'runtime-memory',
        date: new Date().toISOString(),
        tags: ['memory', 'runtime'],
        status: 'active',
        confidence: 'medium',
        source: 'manual:duplicate',
      },
      content: 'Runtime memory keeps current retrieval context stable.\n\nIt also preserves thread continuity.',
    })

    const merged = manager.mergeKnowledge('runtime-memory-primary', ['runtime-memory-duplicate'])

    expect(merged?.mergedSourceIds).toEqual(['runtime-memory-duplicate'])
    expect(manager.knowledge.readRecord('runtime-memory-primary')?.content).toContain('thread continuity')
    expect(manager.knowledge.readRecord('runtime-memory-duplicate')?.metadata.status).toBe('archived')
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
