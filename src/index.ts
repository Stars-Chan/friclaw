// src/index.ts
import { loadConfig } from './config'
import { MemoryManager } from './memory/manager'
import { SessionManager } from './session/manager'
import { Dispatcher } from './dispatcher'
import { startDashboard } from './dashboard/api'
import { registerShutdownHandlers } from './daemon'
import { logger } from './utils/logger'

async function main(): Promise<void> {
  logger.info('FriClaw starting...')

  const config = await loadConfig()
  logger.info({ model: config.agent.model }, 'Config loaded')

  const memory = new MemoryManager(config.memory)
  await memory.init()

  const sessionManager = new SessionManager({
    workspacesDir: config.workspaces.dir,
    timeoutMs: config.workspaces.sessionTimeout * 1000,
  })

  // Agent stub — will be replaced in module 08
  const agent = {
    handle: async (_session: unknown, _msg: unknown) => {
      logger.info('Agent stub: message received (not yet implemented)')
    },
  }

  const dispatcher = new Dispatcher(sessionManager, agent, () => memory.shutdown())

  if (config.dashboard.enabled) {
    await startDashboard(config.dashboard.port, dispatcher)
  }

  registerShutdownHandlers(dispatcher)

  logger.info('FriClaw ready')
}

main().catch((err) => {
  logger.error({ err }, 'Fatal startup error')
  process.exit(1)
})
