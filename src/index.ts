// src/index.ts
import { loadConfig } from './config'
import { MemoryManager } from './memory/manager'
import { SessionManager } from './session/manager'
import { ClaudeCodeAgent } from './agent/claude-code'
import { Dispatcher } from './dispatcher'
import { startDashboard } from './dashboard/api'
import { registerShutdownHandlers } from './daemon'
import { logger } from './utils/logger'
import { runOnboard } from './onboard'
import { FeishuGateway } from './gateway/feishu'
import { WecomGateway } from './gateway/wecom'
import type { Gateway } from './gateway/types'

const command = process.argv[2] ?? 'start'

async function main(): Promise<void> {
  switch (command) {
    case 'onboard': {
      await runOnboard()
      break
    }

    case 'start':
    default: {
      await startDaemon()
      break
    }
  }
}

async function startDaemon(): Promise<void> {
  logger.info('FriClaw starting...')

  const config = await loadConfig()
  logger.info({ model: config.agent.model }, 'Config loaded')

  const memory = new MemoryManager(config.memory)
  await memory.init()

  const sessionManager = new SessionManager({
    workspacesDir: config.workspaces.dir,
    timeoutMs: config.workspaces.sessionTimeout * 1000,
  })

  const agent = new ClaudeCodeAgent({
    model: config.agent.model,
    allowedTools: config.agent.allowedTools,
    soulContent: memory.identity.read(),
  })

  const dispatcher = new Dispatcher(sessionManager, agent, async () => {
    await agent.dispose()
    await memory.shutdown()
  })

  if (config.dashboard.enabled) {
    // Start dashboard in background, don't block gateway startup
    startDashboard(config.dashboard.port, dispatcher, config.workspaces.dir).catch((err) => {
      logger.error({ err }, 'Dashboard startup failed')
    })
  }

  const gateways: Gateway[] = []

  if (config.gateways.feishu.enabled) {
    const { appId, appSecret, encryptKey, verificationToken } = config.gateways.feishu
    if (!appId || !appSecret) throw new Error('飞书网关缺少 appId 或 appSecret')
    gateways.push(new FeishuGateway({ appId, appSecret, encryptKey, verificationToken }))
  }

  if (config.gateways.wecom.enabled) {
    const { botId, secret } = config.gateways.wecom
    if (!botId || !secret) throw new Error('企业微信网关缺少 botId 或 secret')
    gateways.push(new WecomGateway({ botId, secret }))
  }

  await Promise.all(gateways.map(g => g.start(dispatcher)))
  logger.info({ gateways: gateways.map(g => g.kind) }, '网关已启动')

  registerShutdownHandlers(dispatcher)

  logger.info('FriClaw ready')
}

main().catch((err) => {
  logger.error({ err }, 'Fatal startup error')
  process.exit(1)
})
