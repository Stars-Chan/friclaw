// tests/unit/onboard.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { rmSync, existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { runOnboard, setTestPaths, resetPaths } from '../../src/onboard'

// Use a temporary directory for testing instead of user's home directory
let TEST_FRICLAW_HOME = ''

describe('runOnboard', () => {
  beforeEach(() => {
    // Create a unique temp directory for each test
    TEST_FRICLAW_HOME = join(tmpdir(), `.friclaw-test-${Date.now()}-${Math.random().toString(36).substring(7)}`)
    setTestPaths(TEST_FRICLAW_HOME)

    // Clean up test directories before each test
    try {
      if (existsSync(TEST_FRICLAW_HOME)) {
        rmSync(TEST_FRICLAW_HOME, { recursive: true, force: true })
      }
    } catch {}
  })

  afterEach(() => {
    // Clean up test directories after each test
    try {
      if (existsSync(TEST_FRICLAW_HOME)) {
        rmSync(TEST_FRICLAW_HOME, { recursive: true, force: true })
      }
    } catch {}
    // Reset paths to default
    resetPaths()
  })

  it('creates .friclaw directory', async () => {
    await runOnboard()
    expect(existsSync(TEST_FRICLAW_HOME)).toBe(true)
  })

  it('creates config.json with template', async () => {
    await runOnboard()
    const configPath = join(TEST_FRICLAW_HOME, 'config.json')
    expect(existsSync(configPath)).toBe(true)

    const config = JSON.parse(readFileSync(configPath, 'utf-8'))
    expect(config.agent).toBeDefined()
    expect(config.memory).toBeDefined()
    expect(config.workspaces).toBeDefined()
    expect(config.dashboard).toBeDefined()
    expect(config.logging).toBeDefined()
    expect(config.gateways).toBeDefined()
  })

  it('config.json includes placeholder credentials', async () => {
    await runOnboard()
    const configPath = join(TEST_FRICLAW_HOME, 'config.json')
    const config = JSON.parse(readFileSync(configPath, 'utf-8'))

    expect(config.gateways.feishu.appId).toBe('YOUR_FEISHU_APP_ID')
    expect(config.gateways.feishu.appSecret).toBe('YOUR_FEISHU_APP_SECRET')
    expect(config.gateways.wecom.botId).toBe('YOUR_WECOM_BOT_ID')
    expect(config.gateways.wecom.secret).toBe('YOUR_WECOM_SECRET')
  })

  it('creates memory directory', async () => {
    await runOnboard()
    const memoryDir = join(TEST_FRICLAW_HOME, 'memory')
    expect(existsSync(memoryDir)).toBe(true)
  })

  it('creates memory subdirectories', async () => {
    await runOnboard()
    const memoryDir = join(TEST_FRICLAW_HOME, 'memory')
    expect(existsSync(join(memoryDir, 'knowledge'))).toBe(true)
    expect(existsSync(join(memoryDir, 'episodes'))).toBe(true)
  })

  it('creates SOUL.md template', async () => {
    await runOnboard()
    const soulPath = join(TEST_FRICLAW_HOME, 'memory', 'SOUL.md')
    expect(existsSync(soulPath)).toBe(true)

    const content = readFileSync(soulPath, 'utf-8')
    expect(content).toContain('FriClaw Identity')
    expect(content).toContain('私人 AI 管家')
  })

  it('creates knowledge topic templates', async () => {
    await runOnboard()
    const knowledgeDir = join(TEST_FRICLAW_HOME, 'memory', 'knowledge')

    const topics = ['owner-profile', 'preferences', 'people', 'projects', 'notes']
    for (const topic of topics) {
      const filePath = join(knowledgeDir, `${topic}.md`)
      expect(existsSync(filePath)).toBe(true)

      const content = readFileSync(filePath, 'utf-8')
      expect(content).toContain(`title: ${topic}`)
    }
  })

  it('creates workspaces directory', async () => {
    await runOnboard()
    const workspacesDir = join(TEST_FRICLAW_HOME, 'workspaces')
    expect(existsSync(workspacesDir)).toBe(true)
  })

  it('creates logs directory', async () => {
    await runOnboard()
    const logsDir = join(TEST_FRICLAW_HOME, 'logs')
    expect(existsSync(logsDir)).toBe(true)
  })

  it('does not overwrite existing files when credentials are configured', async () => {
    // Run once to create files
    await runOnboard()

    // Modify config with real credentials
    const configPath = join(TEST_FRICLAW_HOME, 'config.json')
    const config = JSON.parse(readFileSync(configPath, 'utf-8'))
    config.gateways.feishu.appId = 'real_app_id'
    config.gateways.feishu.appSecret = 'real_secret'
    writeFileSync(configPath, JSON.stringify(config, null, 2))

    // Run again
    await runOnboard()

    // Credentials should still be the real ones
    const updatedConfig = JSON.parse(readFileSync(configPath, 'utf-8'))
    expect(updatedConfig.gateways.feishu.appId).toBe('real_app_id')
    expect(updatedConfig.gateways.feishu.appSecret).toBe('real_secret')
  })

  it('overwrites config when credentials are still placeholders', async () => {
    // Run once to create files
    await runOnboard()

    // Modify some non-credential field
    const configPath = join(TEST_FRICLAW_HOME, 'config.json')
    const config = JSON.parse(readFileSync(configPath, 'utf-8'))
    config.dashboard.port = 4000
    writeFileSync(configPath, JSON.stringify(config, null, 2))

    // Run again
    await runOnboard()

    // Config should be overwritten (back to default port)
    const updatedConfig = JSON.parse(readFileSync(configPath, 'utf-8'))
    expect(updatedConfig.dashboard.port).toBe(3000)
  })

  it('skips creating existing memory files', async () => {
    // Run once
    await runOnboard()

    // Modify SOUL.md
    const soulPath = join(TEST_FRICLAW_HOME, 'memory', 'SOUL.md')
    const originalContent = readFileSync(soulPath, 'utf-8')
    const modifiedContent = originalContent + '\n## Custom Addition\n'
    writeFileSync(soulPath, modifiedContent)

    // Run again
    await runOnboard()

    // Content should remain modified
    const finalContent = readFileSync(soulPath, 'utf-8')
    expect(finalContent).toBe(modifiedContent)
  })
})
