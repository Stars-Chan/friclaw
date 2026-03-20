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
  it('getTools() returns 4 tools', () => {
    const tools = mcpServer.tools()
    expect(tools).toHaveLength(4)
    expect(tools.map(t => t.name)).toEqual([
      'memory_search', 'memory_save', 'memory_list', 'memory_read'
    ])
  })

  it('memory_save + memory_read roundtrip', async () => {
    const saveResult = await mcpServer.call('memory_save', {
      content: 'user prefers dark mode',
      id: 'preferences',
      category: 'knowledge',
    })
    expect(saveResult.isError).toBeFalsy()

    const readResult = await mcpServer.call('memory_read', { id: 'preferences' })
    expect((readResult.content[0] as { type: 'text'; text: string }).text).toContain('user prefers dark mode')
  })

  it('memory_search returns matching results', async () => {
    await mcpServer.call('memory_save', {
      content: 'friclaw project is awesome',
      id: 'projects',
      category: 'knowledge',
    })
    const result = await mcpServer.call('memory_search', { query: 'friclaw' })
    expect((result.content[0] as { type: 'text'; text: string }).text).toContain('friclaw')
  })

  it('memory_list returns saved topics', async () => {
    await mcpServer.call('memory_save', { content: 'A', id: 'preferences', category: 'knowledge' })
    await mcpServer.call('memory_save', { content: 'B', id: 'projects', category: 'knowledge' })
    const result = await mcpServer.call('memory_list', { category: 'knowledge' })
    const textContent = result.content[0] as { type: 'text'; text: string }
    expect(textContent.text).toContain('preferences')
    expect(textContent.text).toContain('projects')
  })

  it('memory_read returns error for unknown id', async () => {
    const result = await mcpServer.call('memory_read', { id: 'nonexistent' })
    expect(result.isError).toBe(true)
  })

  it('handleToolCall returns error for unknown tool', async () => {
    const result = await mcpServer.call('unknown_tool', {})
    expect(result.isError).toBe(true)
  })
})
