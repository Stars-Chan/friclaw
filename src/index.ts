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
import {
  createPidRecord,
  daemonEnv,
  getDaemonStatus,
  registerShutdownHandlers,
  shouldDaemonize,
  spawnDaemonChild,
  stopManagedInstance,
  takeoverExistingProcess,
  writePidRecord,
  removePidRecord,
} from './daemon'
import { logger, initFileLogs, setLogLevel } from './utils/logger'
import { runOnboard } from './onboard'
import { FeishuGateway } from './gateway/feishu'
import { WecomGateway } from './gateway/wecom'
import { WeixinGateway } from './gateway/weixin'
import { loginWithQR } from './gateway/weixin-login'
import type { Gateway } from './gateway/types'

const command = process.argv[2] ?? 'start'

function createLifecycleTarget(config: Awaited<ReturnType<typeof loadConfig>>) {
  return {
    dashboardEnabled: config.dashboard.enabled,
    pidFile: config.daemon.pidFile,
    port: config.dashboard.port,
  }
}

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

    case 'stop': {
      await stopCommand()
      break
    }

    case 'status': {
      await statusCommand()
      break
    }

    case 'restart': {
      await restartCommand()
      break
    }

    case 'start':
    default: {
      await startCommand()
      break
    }
  }
}

async function stopCommand(): Promise<void> {
  const config = await loadConfig()
  const target = createLifecycleTarget(config)
  const pid = await stopManagedInstance(target)

  if (pid !== null) {
    console.log(`FriClaw stopped (pid=${pid}).`)
    return
  }

  const status = await getDaemonStatus(target)
  if (status.mode === 'port') {
    if (status.owner === 'other') {
      console.log(`FriClaw is not running. Port ${target.port} is occupied by another process.`)
      return
    }
    if (status.stalePid) {
      console.log(`FriClaw is not running. Found stale auxiliary pid file for port ${target.port}.`)
      return
    }
    console.log(`FriClaw is not running on port ${target.port}.`)
    return
  }

  if (status.stalePid && status.pid !== null) {
    console.log(`FriClaw is not running. Found stale pid file (pid=${status.pid}).`)
    return
  }

  console.log('FriClaw is not running.')
}

async function restartCommand(): Promise<void> {
  const config = await loadConfig()
  const target = createLifecycleTarget(config)
  await stopManagedInstance(target)
  const startArgv = [...process.argv.slice(0, 2), 'start']
  const childPid = spawnDaemonChild({ argv: startArgv })
  console.log(`FriClaw restarted in background (pid=${childPid}). Logs: ${config.logging.dir}`)
}

async function statusCommand(): Promise<void> {
  const config = await loadConfig()
  const target = createLifecycleTarget(config)
  const status = await getDaemonStatus(target)

  if (status.mode === 'port') {
    if (status.owner === 'friclaw' && status.pid !== null) {
      console.log(`FriClaw is running on port ${target.port} (pid=${status.pid}).`)
      return
    }
    if (status.owner === 'other') {
      console.log(`FriClaw is not running. Port ${target.port} is occupied by another process.`)
      return
    }
    if (status.stalePid && status.pid !== null) {
      console.log(`FriClaw is not running. Found stale auxiliary pid file (pid=${status.pid}) for port ${target.port}.`)
      return
    }
    console.log(`FriClaw is not running on port ${target.port}.`)
    return
  }

  if (status.pid === null) {
    console.log('FriClaw is not running. Dashboard is disabled, so status is using pid-only fallback.')
    return
  }

  if (status.running) {
    console.log(`FriClaw is running (pid=${status.pid}). Dashboard is disabled, so status is using pid-only fallback.`)
    return
  }

  console.log(`FriClaw is not running. Found stale pid file (pid=${status.pid}). Dashboard is disabled, so status is using pid-only fallback.`)
}

async function startCommand(): Promise<void> {
  const bootstrapLogsDir = join(homedir(), '.friclaw', 'logs')
  initFileLogs(bootstrapLogsDir)

  const config = await loadConfig()
  initFileLogs(config.logging.dir)
  setLogLevel(config.logging.level as 'debug' | 'info' | 'warn' | 'error')

  const log = logger('main')
  const daemonDecision = shouldDaemonize({
    command,
    daemon: config.daemon,
    env: process.env,
  })

  if (daemonDecision.shouldDaemonize) {
    await takeoverExistingProcess(createLifecycleTarget(config), config.daemon.takeover)
    const childPid = spawnDaemonChild()
    log.info({ childPid, pidFile: config.daemon.pidFile }, 'FriClaw daemon started in background')
    console.log(`FriClaw daemon started in background. Logs: ${config.logging.dir}`)
    process.exit(0)
  }

  await runServer(config)
}

async function runServer(config: Awaited<ReturnType<typeof loadConfig>>): Promise<void> {
  const log = logger('main')
  log.info('FriClaw starting...')
  log.info({ model: config.agent.model }, 'Config loaded')

  const memory = new MemoryManager(config.memory, {
    summaryModel: config.agent.summaryModel,
    summaryTimeout: config.agent.summaryTimeout,
  })
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
    await memory.drainBackgroundSummaries()
    await agent.dispose()
    await memory.shutdown()
  })

  sessionManager.onSessionCleared = (id) => {
    agent.dispose(id).catch((error) => {
      log.warn({ sessionId: id, error }, 'Failed to dispose agent after session clear')
    })
  }

  sessionManager.onSessionExpired = (id) => {
    agent.dispose(id).catch((error) => {
      log.warn({ sessionId: id, error }, 'Failed to dispose agent after session expiry')
    })
  }

  dispatcher.setMemoryManager(memory)

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

  const dbPath = join(config.workspaces.dir, 'cron.db')
  const cronScheduler = new CronScheduler(dbPath)

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
    dashboardPush = await startDashboard(
      config.dashboard.port,
      dispatcher,
      config.workspaces.dir,
      cronScheduler,
      memory,
      { startFrontendDevServer: process.env[daemonEnv.DAEMON_CHILD_ENV] !== '1' },
    )
  }

  await Promise.all(gateways.map(g => g.start(dispatcher)))
  log.info({ gateways: gateways.map(g => g.kind) }, '网关已启动')

  if (process.env[daemonEnv.DAEMON_CHILD_ENV] === '1') {
    writePidRecord(config.daemon.pidFile, createPidRecord())
  }

  registerShutdownHandlers(dispatcher, async () => {
    removePidRecord(config.daemon.pidFile)
  })

  log.info('FriClaw ready')
  await new Promise<void>(() => {})
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
