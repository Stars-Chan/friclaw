// src/index.ts
import { loadConfig } from './config'
import { homedir } from 'os'
import { join } from 'path'
import { MemoryManager } from './memory/manager'
import { SessionManager } from './session/manager'
import { ClaudeCodeAgent } from './agent/claude-code'
import { Dispatcher } from './dispatcher'
import { CronScheduler } from './cron/scheduler'
import { startDashboard } from './dashboard/api'
import { registerShutdownHandlers } from './daemon'
import { logger, initFileLogs } from './utils/logger'
import { runOnboard } from './onboard'
import { FeishuGateway } from './gateway/feishu'
import { WecomGateway } from './gateway/wecom'
import { WeixinGateway } from './gateway/weixin'
import { loginWithQR } from './gateway/weixin-login'
import type { Gateway } from './gateway/types'

const command = process.argv[2] ?? 'start'

async function main(): Promise<void> {
  switch (command) {
    case 'onboard': {
      await runOnboard()
      break
    }

    case 'weixin-login': {
      const baseUrl = process.env.WEIXIN_BASE_URL || 'https://ilinkai.weixin.qq.com'
      const token = await loginWithQR(baseUrl)

      const configPath = process.env.FRICLAW_CONFIG ?? join(homedir(), '.friclaw', 'config.json')
      const configFile = Bun.file(configPath)

      let config: Record<string, unknown> = {}
      if (await configFile.exists()) {
        config = await configFile.json() as Record<string, unknown>
      }

      config.gateways = config.gateways || {}
      ;(config.gateways as Record<string, unknown>).weixin = {
        enabled: true,
        token,
      }

      await Bun.write(configPath, JSON.stringify(config, null, 2))

      console.log('\n✅ 登录成功！')
      console.log(`Bot Token: ${token}`)
      console.log(`已保存到配置文件: ${configPath}\n`)
      process.exit(0)
    }

    case 'start':
    default: {
      await startDaemon()
      break
    }
  }
}

async function startDaemon(): Promise<void> {
  const logsDir = join(homedir(), '.friclaw', 'logs')
  initFileLogs(logsDir)

  const log = logger('main')
  log.info('FriClaw starting...')

  const config = await loadConfig()
  log.info({ model: config.agent.model }, 'Config loaded')

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

  const gateways: Gateway[] = []
  let dashboardPush: ((sessionId: string, content: string) => Promise<void>) | null = null

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

  if (config.gateways.weixin.enabled) {
    const { baseUrl, cdnBaseUrl, token } = config.gateways.weixin
    if (!token) throw new Error('微信网关缺少 token')
    gateways.push(new WeixinGateway({ baseUrl, cdnBaseUrl, token }))
  }

  // 启动定时任务调度器
  const dbPath = join(config.workspaces.dir, 'cron.db')
  const cronScheduler = new CronScheduler(dbPath)

  // 监听任务执行事件（必须在 start() 之前注册）
  cronScheduler.on('job:execute', (event) => {
    log.info({ jobId: event.jobId, platform: event.job.platform, chatId: event.job.chatId }, 'Cron job executing')

    const message = {
      platform: event.job.platform as 'dashboard' | 'feishu' | 'wecom' | 'weixin',
      chatId: event.job.chatId,
      userId: event.job.userId,
      type: 'text' as const,
      content: event.job.prompt,
      messageId: `cron_${event.jobId}_${Date.now()}`,
      attachments: [],
    }

    const logResult = (jobId: string) => ({
      onSuccess: () => log.info({ jobId }, 'Cron job dispatched'),
      onError: (error: any) => log.error({ err: error, jobId }, 'Cron job failed'),
    })

    // Dashboard 平台使用推送函数
    if (event.job.platform === 'dashboard') {
      if (!dashboardPush) {
        log.error('Dashboard push function not available')
        return
      }
      const push = dashboardPush
      const { onSuccess, onError } = logResult(event.jobId)
      dispatcher.dispatch(message, async (content: string) => {
        await push(event.job.chatId, content)
        return content
      }).then(onSuccess).catch(onError)
      return
    }

    const gateway = gateways.find(g => g.kind === event.job.platform)
    if (!gateway) {
      log.error({ platform: event.job.platform }, 'Gateway not found for cron job')
      return
    }

    const { onSuccess, onError } = logResult(event.jobId)
    dispatcher.dispatch(message, async (content: string) => {
      await gateway.send(event.job.chatId, content, event.job.chatType)
      return content
    }).then(onSuccess).catch(onError)
  })

  await cronScheduler.start()
  log.info('Cron scheduler started')

  if (config.dashboard.enabled) {
    dashboardPush = await startDashboard(config.dashboard.port, dispatcher, config.workspaces.dir, cronScheduler)
  }

  await Promise.all(gateways.map(g => g.start(dispatcher)))
  log.info({ gateways: gateways.map(g => g.kind) }, '网关已启动')

  registerShutdownHandlers(dispatcher)

  log.info('FriClaw ready')
}

main().catch((err) => {
  const log = logger('main')
  log.error({
    message: err?.message || String(err),
    stack: err?.stack,
    err
  }, 'Fatal startup error')
  console.error('Fatal error:', err)
  process.exit(1)
})
