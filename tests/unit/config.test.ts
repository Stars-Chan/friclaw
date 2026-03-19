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
    await expect(loadConfig()).rejects.toThrow('配置错误')
    try { unlinkSync(tmpPath) } catch {}
  })

  it('error message includes field path', async () => {
    const tmpPath = '/tmp/friclaw-test-path.json'
    await Bun.write(tmpPath, JSON.stringify({ dashboard: { port: 'bad' } }))
    process.env.FRICLAW_CONFIG = tmpPath
    await expect(loadConfig()).rejects.toThrow('dashboard.port')
    try { unlinkSync(tmpPath) } catch {}
  })

  it('returns default agent maxConcurrent', async () => {
    const config = await loadConfig()
    expect(config.agent.maxConcurrent).toBe(5)
  })

  it('returns default gateways config', async () => {
    const config = await loadConfig()
    expect(config.gateways.feishu.enabled).toBe(false)
    expect(config.gateways.wecom.enabled).toBe(false)
  })

  it('merges partial gateway config from file', async () => {
    const tmpPath = '/tmp/friclaw-test-gateway.json'
    await Bun.write(tmpPath, JSON.stringify({
      gateways: { feishu: { enabled: true, appId: 'test-id' } }
    }))
    process.env.FRICLAW_CONFIG = tmpPath
    const config = await loadConfig()
    expect(config.gateways.feishu.enabled).toBe(true)
    expect(config.gateways.feishu.appId).toBe('test-id')
    expect(config.gateways.wecom.enabled).toBe(false) // default preserved
    try { unlinkSync(tmpPath) } catch {}
  })

  describe('env var overrides', () => {
    afterEach(() => {
      delete process.env.PORT
      delete process.env.LOG_LEVEL
      delete process.env.FEISHU_APP_ID
      delete process.env.FEISHU_APP_SECRET
      delete process.env.WECOM_BOT_ID
      delete process.env.WECOM_SECRET
      delete process.env.FRICLAW_VECTOR_ENABLED
      delete process.env.FRICLAW_VECTOR_ENDPOINT
      delete process.env.FRICLAW_CONFIG  // 清理内部测试设置的临时路径
    })

    it('PORT overrides dashboard.port', async () => {
      process.env.PORT = '8080'
      const config = await loadConfig()
      expect(config.dashboard.port).toBe(8080)
    })

    it('LOG_LEVEL overrides logging.level', async () => {
      process.env.LOG_LEVEL = 'debug'
      const config = await loadConfig()
      expect(config.logging.level).toBe('debug')
    })

    it('FEISHU_APP_ID overrides gateways.feishu.appId', async () => {
      process.env.FEISHU_APP_ID = 'cli_abc123'
      const config = await loadConfig()
      expect(config.gateways.feishu.appId).toBe('cli_abc123')
    })

    it('FEISHU_APP_SECRET overrides gateways.feishu.appSecret', async () => {
      process.env.FEISHU_APP_SECRET = 'secret_xyz'
      const config = await loadConfig()
      expect(config.gateways.feishu.appSecret).toBe('secret_xyz')
    })

    it('WECOM_BOT_ID overrides gateways.wecom.botId', async () => {
      process.env.WECOM_BOT_ID = 'bot_001'
      const config = await loadConfig()
      expect(config.gateways.wecom.botId).toBe('bot_001')
    })

    it('FRICLAW_VECTOR_ENABLED=true sets memory.vectorEnabled', async () => {
      process.env.FRICLAW_VECTOR_ENABLED = 'true'
      const config = await loadConfig()
      expect(config.memory.vectorEnabled).toBe(true)
    })

    it('FRICLAW_VECTOR_ENABLED=false overrides file config true', async () => {
      const tmpPath = '/tmp/friclaw-test-vector.json'
      await Bun.write(tmpPath, JSON.stringify({ memory: { vectorEnabled: true } }))
      process.env.FRICLAW_CONFIG = tmpPath
      process.env.FRICLAW_VECTOR_ENABLED = 'false'
      const config = await loadConfig()
      expect(config.memory.vectorEnabled).toBe(false)
      try { unlinkSync(tmpPath) } catch {}
    })

    it('env vars override file config values', async () => {
      const tmpPath = '/tmp/friclaw-test-env-override.json'
      await Bun.write(tmpPath, JSON.stringify({ dashboard: { port: 4000 } }))
      process.env.FRICLAW_CONFIG = tmpPath
      process.env.PORT = '9000'
      const config = await loadConfig()
      expect(config.dashboard.port).toBe(9000)
      try { unlinkSync(tmpPath) } catch {}
    })
  })
})
