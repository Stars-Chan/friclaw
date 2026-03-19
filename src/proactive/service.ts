// src/proactive/service.ts
// P2 — Proactive service stub. Full implementation in phase 4.
// Provides the interface and no-op implementations for proactive reminders and pattern detection.

import { logger } from '../utils/logger'
import type { Dispatcher } from '../dispatcher'

export interface ProactiveConfig {
  enabled: boolean
  dailySummaryHour?: number   // 0-23, default 9
  quietHours?: { start: number; end: number }
}

export class ProactiveService {
  private timer: ReturnType<typeof setInterval> | null = null

  constructor(
    private config: ProactiveConfig,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    private _dispatcher: Dispatcher,
  ) {}

  start(): void {
    if (!this.config.enabled) return
    // TODO: start hourly context-aware check
    // TODO: start daily pattern analysis
    logger.info('主动服务已启动（stub）')
  }

  stop(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null }
  }

  // TODO: analyze recent episodes and detect recurring patterns
  async detectPatterns(_userId: string): Promise<void> {}

  // TODO: send daily summary to user
  async sendDailySummary(_userId: string): Promise<void> {}

  // TODO: check if current time is within quiet hours
  isQuietHour(): boolean {
    if (!this.config.quietHours) return false
    const hour = new Date().getHours()
    const { start, end } = this.config.quietHours
    if (start < end) return hour >= start && hour < end
    return hour >= start || hour < end
  }
}
