import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { MemoryManager } from '../../../src/memory/manager'
import { MemoryMcpServer } from '../../../src/memory/mcp-server'

let tmpDir: string
let manager: MemoryManager
let mcpServer: MemoryMcpServer

beforeEach(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), 'friclaw-test-'))
  manager = new MemoryManager({
    dir: tmpDir,
    searchLimit: 10,
    vectorEnabled: false,
    vectorEndpoint: '',
  })
  await manager.init()
  mcpServer = new MemoryMcpServer(manager)
})

afterEach(async () => {
  await manager.shutdown()
  rmSync(tmpDir, { recursive: true })
})

describe('MemoryMcpServer tools', () => {
  it('getTools() returns 5 tools', () => {
    const tools = mcpServer.tools()
    expect(tools).toHaveLength(5)
  })

  it('memory_save + memory_read roundtrip for knowledge returns structured record', async () => {
    const saveResult = await mcpServer.call('memory_save', {
      content: 'user prefers dark mode',
      id: 'preferences',
      category: 'knowledge',
      metadata: { domain: 'preference', confidence: 'high' },
    })
    expect(saveResult.isError).toBeFalsy()

    const readResult = await mcpServer.call('memory_read', { id: 'preferences' })
    expect((readResult.content[0] as { type: 'text'; text: string }).text).toContain('user prefers dark mode')
    expect((readResult.content[0] as { type: 'text'; text: string }).text).toContain('"domain": "preference"')
  })

  it('memory_read can read structured episode record and thread state', async () => {
    const saveResult = await mcpServer.call('memory_save', {
      content: 'continue runtime memory implementation',
      category: 'episode',
      metadata: { threadId: 'feishu:ou_abc:1', chatKey: 'feishu:ou_abc' },
    })
    const text = (saveResult.content[0] as { type: 'text'; text: string }).text
    const id = text.split(': ').pop()!
    const readResult = await mcpServer.call('memory_read', { id, category: 'episode' })
    expect((readResult.content[0] as { type: 'text'; text: string }).text).toContain('threadId')

    manager.episode.saveThreadState({
      threadId: 'feishu:ou_abc:1',
      chatKey: 'feishu:ou_abc',
      status: 'active',
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })
    const threadRead = await mcpServer.call('memory_read', { id: 'thread:feishu:ou_abc:1', category: 'episode' })
    expect((threadRead.content[0] as { type: 'text'; text: string }).text).toContain('"threadId": "feishu:ou_abc:1"')
  })

  it('memory_list supports detailed output', async () => {
    manager.knowledge.saveRecord({
      id: 'prefs',
      metadata: { title: 'prefs', date: new Date().toISOString(), tags: ['user'], confidence: 'high' },
      content: 'Boss likes concise updates',
    })
    const result = await mcpServer.call('memory_list', { category: 'knowledge', detailed: true })
    expect((result.content[0] as { type: 'text'; text: string }).text).toContain('Boss likes concise updates')
  })

  it('memory_save rejects invalid knowledge metadata', async () => {
    const result = await mcpServer.call('memory_save', {
      content: 'bad metadata',
      id: 'broken',
      category: 'knowledge',
      metadata: {
        title: 'broken',
        date: new Date().toISOString(),
        tags: [],
        status: 'broken',
      },
    })
    expect(result.isError).toBeTruthy()
  })

  it('identity_candidate_review approves candidate and writes to SOUL only after review', async () => {
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
    const deferred = await mcpServer.call('identity_candidate_review', {
      id: candidate.id,
      decision: 'defer',
      rationale: 'wait',
    })
    expect(deferred.isError).toBeFalsy()
    expect(manager.identity.read()).toBe(before)

    const approved = await mcpServer.call('identity_candidate_review', {
      id: candidate.id,
      decision: 'approve',
      rationale: 'confirmed',
    })
    expect(approved.isError).toBeFalsy()
    expect(manager.identity.read()).toContain('User prefers concise updates')
  })
})
