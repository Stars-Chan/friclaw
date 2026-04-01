// src/daemon.ts
import { logger } from './utils/logger'
import type { Dispatcher } from './dispatcher'

const SHUTDOWN_TIMEOUT_MS = 30_000
const log = logger('daemon')

// Exported for testing — takes exit fn as injectable dependency
export function createShutdownHandler(
  dispatcher: Dispatcher,
  exit: (code: number) => void = process.exit,
) {
  let shuttingDown = false

  return async function shutdown(signal: string): Promise<void> {
    if (shuttingDown) return
    shuttingDown = true

    log.info({ signal }, 'Graceful shutdown initiated')

    const timer = setTimeout(() => {
      log.error(`Shutdown timed out after ${SHUTDOWN_TIMEOUT_MS / 1000}s, forcing exit`)
      exit(1)
    }, SHUTDOWN_TIMEOUT_MS)

    try {
      await dispatcher.shutdown()
      clearTimeout(timer)
      log.info('Graceful shutdown complete')
      exit(0)
    } catch (err) {
      clearTimeout(timer)
      log.error({ err }, 'Error during shutdown')
      exit(1)
    }
  }
}

export function registerShutdownHandlers(dispatcher: Dispatcher): void {
  const shutdown = createShutdownHandler(dispatcher)
  process.on('SIGTERM', () => shutdown('SIGTERM'))
  process.on('SIGINT', () => shutdown('SIGINT'))
}
