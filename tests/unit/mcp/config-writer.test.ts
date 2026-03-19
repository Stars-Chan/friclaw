import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { writeMcpConfig } from '../../../src/mcp/config-writer'

let tmpDir: string

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'friclaw-test-'))
})

afterEach(() => {
  rmSync(tmpDir, { recursive: true })
})

describe('writeMcpConfig', () => {
  it('creates .mcp.json in workspace dir', () => {
    writeMcpConfig(tmpDir, {
      'friclaw-memory': { type: 'stdio', command: 'bun', args: ['run', '/path/to/entry.ts'] },
    })
    expect(existsSync(join(tmpDir, '.mcp.json'))).toBe(true)
  })

  it('writes correct mcpServers structure for stdio', () => {
    writeMcpConfig(tmpDir, {
      'friclaw-memory': { type: 'stdio', command: 'bun', args: ['run', '/path/to/entry.ts'] },
    })
    const config = JSON.parse(readFileSync(join(tmpDir, '.mcp.json'), 'utf-8'))
    expect(config.mcpServers['friclaw-memory'].command).toBe('bun')
    expect(config.mcpServers['friclaw-memory'].args).toEqual(['run', '/path/to/entry.ts'])
  })

  it('supports http type servers', () => {
    writeMcpConfig(tmpDir, {
      'external-svc': { type: 'http', url: 'https://example.com/mcp' },
    })
    const config = JSON.parse(readFileSync(join(tmpDir, '.mcp.json'), 'utf-8'))
    expect(config.mcpServers['external-svc'].url).toBe('https://example.com/mcp')
  })

  it('overwrites existing .mcp.json', () => {
    writeMcpConfig(tmpDir, { 'svc-a': { type: 'stdio', command: 'a', args: [] } })
    writeMcpConfig(tmpDir, { 'svc-b': { type: 'stdio', command: 'b', args: [] } })
    const config = JSON.parse(readFileSync(join(tmpDir, '.mcp.json'), 'utf-8'))
    expect(config.mcpServers['svc-a']).toBeUndefined()
    expect(config.mcpServers['svc-b'].command).toBe('b')
  })
})
