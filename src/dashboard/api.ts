// src/dashboard/api.ts
import type { Dispatcher } from '../dispatcher'
import { logger } from '../utils/logger'

export async function startDashboard(
  port: number,
  _dispatcher: Dispatcher,
): Promise<void> {
  logger.info({ port }, 'Dashboard started (stub)')
  // TODO: implement in module 07 (WebSocket server)
}
