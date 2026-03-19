// src/index.ts
import { loadConfig } from './config'
import { MemoryManager } from './memory/manager'
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

  const dispatcher = new Dispatcher(config, memory)
  await dispatcher.start()

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
