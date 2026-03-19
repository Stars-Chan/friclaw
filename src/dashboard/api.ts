// src/dashboard/api.ts
import type { Dispatcher } from '../dispatcher'
import { logger } from '../utils/logger'

const startTime = Date.now()

export async function startDashboard(
  port: number,
  _dispatcher: Dispatcher,
): Promise<void> {
  Bun.serve({
    port,
    fetch(req) {
      const url = new URL(req.url)
      if (url.pathname === '/health') {
        return Response.json({ status: 'ok', uptime: Math.floor((Date.now() - startTime) / 1000) })
      }
      return new Response('FriClaw Dashboard (coming soon)', { status: 200 })
    },
  })
  logger.info({ port }, 'Dashboard started')
}
