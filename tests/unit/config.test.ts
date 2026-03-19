// tests/unit/config.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { unlinkSync } from 'fs'
import { loadConfig } from '../../src/config'

describe('loadConfig', () => {
  beforeEach(() => {
    // Point to nonexistent file so we always get defaults
    process.env.FRICLAW_CONFIG = '/tmp/friclaw-test-nonexistent.json'
  })

  afterEach(() => {
    delete process.env.FRICLAW_CONFIG
  })

  it('returns default agent config', async () => {
    const config = await loadConfig()
    expect(config.agent.model).toBe('claude-sonnet-4-6')
    expect(config.agent.summaryModel).toBe('claude-haiku-4-5')
    expect(config.agent.timeout).toBe(300000)
  })

  it('returns default dashboard config', async () => {
    const config = await loadConfig()
    expect(config.dashboard.enabled).toBe(true)
    expect(config.dashboard.port).toBe(3000)
  })

  it('returns default memory config', async () => {
    const config = await loadConfig()
    expect(config.memory.vectorEnabled).toBe(false)
    expect(config.memory.searchLimit).toBe(10)
  })

  it('merges partial config file with defaults', async () => {
    const tmpPath = '/tmp/friclaw-test-partial.json'
    await Bun.write(tmpPath, JSON.stringify({ dashboard: { port: 4000 } }))
    process.env.FRICLAW_CONFIG = tmpPath

    const config = await loadConfig()
    expect(config.dashboard.port).toBe(4000)
    expect(config.dashboard.enabled).toBe(true) // default preserved

    try { unlinkSync(tmpPath) } catch {}
  })

  it('throws on malformed JSON', async () => {
    const tmpPath = '/tmp/friclaw-test-malformed.json'
    await Bun.write(tmpPath, '{ invalid json }')
    process.env.FRICLAW_CONFIG = tmpPath
    await expect(loadConfig()).rejects.toThrow('Failed to parse config')
  })

  it('throws on invalid field type', async () => {
    const tmpPath = '/tmp/friclaw-test-invalid.json'
    await Bun.write(tmpPath, JSON.stringify({ dashboard: { port: 'not-a-number' } }))
    process.env.FRICLAW_CONFIG = tmpPath
    await expect(loadConfig()).rejects.toThrow('Invalid config')
  })
})
