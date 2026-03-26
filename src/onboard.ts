/**
 * Onboarding wizard — generates a config template at ~/.friclaw/config.json.
 *
 * Run with: bun onboard
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'

const DEFAULT_FRICLAW_HOME = join(homedir(), '.friclaw')
const DEFAULT_CONFIG_PATH = join(DEFAULT_FRICLAW_HOME, 'config.json')

let FRICLAW_HOME = DEFAULT_FRICLAW_HOME
let CONFIG_PATH = DEFAULT_CONFIG_PATH

// Allow tests to override the paths
export function setTestPaths(basePath: string): void {
  FRICLAW_HOME = basePath
  CONFIG_PATH = join(basePath, 'config.json')
}

export function resetPaths(): void {
  FRICLAW_HOME = DEFAULT_FRICLAW_HOME
  CONFIG_PATH = DEFAULT_CONFIG_PATH
}

const TEMPLATE = {
  agent: {
    model: 'claude-sonnet-4-6',
    summaryModel: 'claude-haiku-4-5',
    maxConcurrent: 5,
    timeout: 300_000,
  },
  memory: {
    dir: join(homedir(), '.friclaw', 'memory'),
    searchLimit: 10,
    vectorEnabled: false,
    vectorEndpoint: 'http://localhost:6333',
  },
  workspaces: {
    dir: join(homedir(), '.friclaw', 'workspaces'),
    maxSessions: 10,
    sessionTimeout: 3600,
  },
  dashboard: {
    enabled: true,
    port: 3000,
  },
  logging: {
    level: 'info',
    dir: join(homedir(), '.friclaw', 'logs'),
  },
  gateways: {
    feishu: {
      enabled: false,
      appId: 'YOUR_FEISHU_APP_ID',
      appSecret: 'YOUR_FEISHU_APP_SECRET',
      encryptKey: 'YOUR_FEISHU_ENCRYPT_KEY',
      verificationToken: 'YOUR_FEISHU_VERIFICATION_TOKEN',
    },
    wecom: {
      enabled: false,
      botId: 'YOUR_WECOM_BOT_ID',
      secret: 'YOUR_WECOM_SECRET',
    },
    weixin: {
      enabled: false,
      baseUrl: 'https://ilinkai.weixin.qq.com',
      cdnBaseUrl: 'https://cdn.weixin.qq.com',
      token: '',
    },
  },
}

export async function runOnboard(): Promise<void> {
  console.log('FriClaw Onboarding Wizard')
  console.log('='.repeat(50))
  console.log()

  if (!existsSync(FRICLAW_HOME)) {
    mkdirSync(FRICLAW_HOME, { recursive: true })
    console.log(`Created ${FRICLAW_HOME}`)
  }

  initConfig()
  initMemoryDir()
  initWorkspacesDir()
  initLogsDir()

  console.log()
  console.log('Next steps:')
  console.log('  1. Open the config file and configure your gateway:')
  console.log(`     ${CONFIG_PATH}`)
  console.log()
  console.log('  Feishu (飞书):')
  console.log('     feishu.enabled       — set to true')
  console.log('     feishu.appId         — from Feishu Open Platform')
  console.log('     feishu.appSecret     — from Feishu Open Platform')
  console.log('     feishu.encryptKey    — from Feishu Open Platform')
  console.log('     feishu.verificationToken — from Feishu Open Platform')
  console.log()
  console.log('  Wecom (企业微信):')
  console.log('     wecom.enabled        — set to true')
  console.log('     wecom.botId          — from Wework Bot Settings')
  console.log('     wecom.secret         — from Wework Bot Settings')
  console.log()
  console.log('  Weixin (微信):')
  console.log('     weixin.enabled       — set to true')
  console.log('     weixin.token         — run "bun weixin-login" to get token')
  console.log()
  console.log('  2. Start the daemon:')
  console.log('     bun start')
  console.log()
  console.log('  3. Optional: Enable vector search for better memory retrieval:')
  console.log('     a. Install and run Qdrant: docker run -p 6333:6333 qdrant/qdrant')
  console.log('     b. Set memory.vectorEnabled to true in config.json')
  console.log()
  console.log('  4. Send a message to your bot to test it!')
  console.log()
}

function initConfig(): void {
  if (existsSync(CONFIG_PATH)) {
    const existing = readFileSync(CONFIG_PATH, 'utf-8')
    let hasRealCredentials = false
    try {
      const cfg = JSON.parse(existing)
      const feishuOk =
        typeof cfg?.gateways?.feishu?.appId === 'string' &&
        cfg.gateways.feishu.appId !== '' &&
        !cfg.gateways.feishu.appId.startsWith('YOUR_')
      const wecomOk =
        typeof cfg?.gateways?.wecom?.botId === 'string' &&
        cfg.gateways.wecom.botId !== '' &&
        !cfg.gateways.wecom.botId.startsWith('YOUR_')
      const weixinOk =
        typeof cfg?.gateways?.weixin?.token === 'string' &&
        cfg.gateways.weixin.token !== ''
      hasRealCredentials = feishuOk || wecomOk || weixinOk
    } catch {
      /* parse error — overwrite */
    }

    if (hasRealCredentials) {
      console.log(`Config already exists at: ${CONFIG_PATH} (credentials configured, skipping)`)
      return
    }

    console.log(`Overwriting existing template at: ${CONFIG_PATH}`)
  }

  const content = JSON.stringify(TEMPLATE, null, 2)
  writeFileSync(CONFIG_PATH, content)
  chmodSync(CONFIG_PATH, 0o600) // Owner read/write only
  console.log(`Config template written to: ${CONFIG_PATH}`)
}

function initMemoryDir(): void {
  const memoryDir = join(FRICLAW_HOME, 'memory')
  if (!existsSync(memoryDir)) {
    mkdirSync(memoryDir, { recursive: true })
    console.log(`Created memory directory: ${memoryDir}`)
  }

  const subdirs = ['knowledge', 'episodes']
  for (const sub of subdirs) {
    const dir = join(memoryDir, sub)
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
      console.log(`Created memory subdirectory: ${dir}`)
    }
  }

  const soulDest = join(memoryDir, 'SOUL.md')
  if (!existsSync(soulDest)) {
    const soulContent = `---
title: FriClaw Identity
date: ${new Date().toISOString().slice(0, 10)}
---

我是 FriClaw，你的私人 AI 管家。

## 性格
- 冷静、高效、专注
- 主动感知需求，而不是被动等待
- 直接给出答案，不废话

## 行为准则
- 记住用户的偏好和习惯
- 主动提醒重要事项
- 保护用户隐私，不泄露敏感信息
`
    writeFileSync(soulDest, soulContent)
    console.log(`Memory template written to: ${soulDest}`)
  } else {
    console.log(`Memory file already exists, skipping: ${soulDest}`)
  }

  const knowledgeTopics = ['owner-profile', 'preferences', 'people', 'projects', 'notes']
  for (const topic of knowledgeTopics) {
    const dest = join(memoryDir, 'knowledge', `${topic}.md`)
    if (!existsSync(dest)) {
      const content = `---
title: ${topic}
date: ${new Date().toISOString()}
tags: [knowledge]
---

# ${topic}

在此处添加相关信息。
`
      writeFileSync(dest, content)
      console.log(`Memory template written to: ${dest}`)
    } else {
      console.log(`Memory file already exists, skipping: ${dest}`)
    }
  }
}

function initWorkspacesDir(): void {
  const workspacesDir = join(FRICLAW_HOME, 'workspaces')
  if (!existsSync(workspacesDir)) {
    mkdirSync(workspacesDir, { recursive: true })
    console.log(`Created workspaces directory: ${workspacesDir}`)
  } else {
    console.log(`Workspaces directory already exists: ${workspacesDir}`)
  }
}

function initLogsDir(): void {
  const logsDir = join(FRICLAW_HOME, 'logs')
  if (!existsSync(logsDir)) {
    mkdirSync(logsDir, { recursive: true })
    console.log(`Created logs directory: ${logsDir}`)
  } else {
    console.log(`Logs directory already exists: ${logsDir}`)
  }
}
