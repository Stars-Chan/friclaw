import type { FriClawConfig } from '../config'
import type { MemoryManager } from '../memory/manager'
import type { ProactiveInsight, ProactivePreference } from '../memory/types'
import { logger } from '../utils/logger'

const log = logger('proactive')
const DEFAULT_USER_ID = 'dashboard_user'
const MAX_INSIGHTS = 100

export type ProactiveConfig = FriClawConfig['proactive']

export class ProactiveService {
  private timer: ReturnType<typeof setInterval> | null = null
  private cycleRunning = false
  private insights: ProactiveInsight[] = []
  private preferences = new Map<string, ProactivePreference>()
  private lastReminderAt = new Map<string, number>()
  private lastDailySummaryKey = new Map<string, string>()
  private lastPatternKey = new Map<string, string>()

  constructor(
    private config: ProactiveConfig,
    private memoryManager: MemoryManager,
  ) {}

  start(): void {
    if (!this.config.enabled) return
    if (this.timer) return

    this.timer = setInterval(() => {
      this.runCycle().catch((error) => {
        log.warn({ error }, 'Proactive cycle failed')
      })
    }, 60_000)

    void this.runCycle()
    log.info({ enabled: this.config.enabled }, '主动服务已启动')
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  getPreference(userId = DEFAULT_USER_ID): ProactivePreference {
    return this.preferences.get(userId) ?? this.defaultPreference()
  }

  updatePreference(userId = DEFAULT_USER_ID, patch: Partial<ProactivePreference>): ProactivePreference {
    const next = {
      ...this.getPreference(userId),
      ...patch,
    }
    this.preferences.set(userId, next)
    return next
  }

  listInsights(userId = DEFAULT_USER_ID): ProactiveInsight[] {
    return this.insights.filter(item => item.userId === userId)
  }

  async runCycle(userId = DEFAULT_USER_ID): Promise<void> {
    if (this.cycleRunning) return
    this.cycleRunning = true
    try {
      const preference = this.getPreference(userId)
      if (!preference.enabled) return
      if (!this.isQuietHour(userId)) {
        await this.maybeCreateReminder(userId)
      }
      await this.sendDailySummary(userId)
      await this.detectPatterns(userId)
    } finally {
      this.cycleRunning = false
    }
  }

  async detectPatterns(userId = DEFAULT_USER_ID): Promise<void> {
    const preference = this.getPreference(userId)
    if (!preference.patternSuggestionsEnabled) return

    const candidates = this.memoryManager.listCandidates('knowledge')
      .filter(candidate => candidate.status === 'proposed')
    if (candidates.length < 2) return

    const tagCounts = new Map<string, number>()
    for (const candidate of candidates) {
      for (const tag of candidate.tags ?? []) {
        tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1)
      }
    }

    const repeated = Array.from(tagCounts.entries())
      .filter(([, count]) => count >= 2)
      .sort((a, b) => b[1] - a[1])[0]
    if (!repeated) return

    const insightKey = `${repeated[0]}:${repeated[1]}`
    if (this.lastPatternKey.get(userId) === insightKey) return
    this.lastPatternKey.set(userId, insightKey)

    this.pushInsight({
      id: `pattern-${Date.now()}`,
      kind: 'pattern',
      title: `检测到重复模式：${repeated[0]}`,
      content: `最近有 ${repeated[1]} 条待治理 candidate 带有标签 ${repeated[0]}，建议合并或沉淀为稳定 knowledge。`,
      userId,
      createdAt: new Date().toISOString(),
      sourceCandidateIds: candidates.slice(0, 5).map(candidate => candidate.id!).filter(Boolean),
      metadata: {
        repeatedTag: repeated[0],
        candidateCount: repeated[1],
      },
    })
  }

  async sendDailySummary(userId = DEFAULT_USER_ID): Promise<void> {
    const preference = this.getPreference(userId)
    if (!preference.dailySummaryEnabled) return

    const now = new Date()
    if (now.getHours() !== preference.dailySummaryHour) return

    const summaryKey = `${now.toISOString().slice(0, 10)}:${preference.dailySummaryHour}`
    if (this.lastDailySummaryKey.get(userId) === summaryKey) return

    const threads = this.memoryManager.listThreadPreviews(5)
    if (threads.length === 0) return

    this.lastDailySummaryKey.set(userId, summaryKey)
    this.pushInsight({
      id: `daily-${Date.now()}`,
      kind: 'daily_summary',
      title: '今日记忆复盘',
      content: threads
        .map(thread => `- ${thread.title || thread.threadId}: ${thread.nextStep || thread.summaryPreview || '无摘要'}`)
        .join('\n'),
      userId,
      createdAt: now.toISOString(),
      sourceThreadIds: threads.map(thread => thread.threadId),
    })
  }

  isQuietHour(userId = DEFAULT_USER_ID): boolean {
    const quietHours = this.getPreference(userId).quietHours
    if (!quietHours) return false
    const hour = new Date().getHours()
    const { start, end } = quietHours
    if (start < end) return hour >= start && hour < end
    return hour >= start || hour < end
  }

  private defaultPreference(): ProactivePreference {
    return {
      enabled: this.config.enabled,
      remindersEnabled: this.config.remindersEnabled,
      dailySummaryEnabled: this.config.dailySummaryEnabled,
      patternSuggestionsEnabled: this.config.patternSuggestionsEnabled,
      reminderIntervalMinutes: this.config.reminderIntervalMinutes,
      dailySummaryHour: this.config.dailySummaryHour,
      quietHours: this.config.quietHours,
    }
  }

  private async maybeCreateReminder(userId: string): Promise<void> {
    const preference = this.getPreference(userId)
    if (!preference.remindersEnabled) return

    const lastReminder = this.lastReminderAt.get(userId) ?? 0
    const intervalMs = preference.reminderIntervalMinutes * 60_000
    if (Date.now() - lastReminder < intervalMs) return

    const staleThread = this.memoryManager.listThreadPreviews(20)
      .find(thread => (thread.status === 'active' || thread.status === 'dormant') && thread.nextStep)
    if (!staleThread) return

    this.lastReminderAt.set(userId, Date.now())
    this.pushInsight({
      id: `reminder-${Date.now()}`,
      kind: 'reminder',
      title: '检测到可继续推进的线程',
      content: `${staleThread.title || staleThread.threadId} 仍有待办：${staleThread.nextStep}`,
      userId,
      createdAt: new Date().toISOString(),
      sourceThreadIds: [staleThread.threadId],
      metadata: {
        status: staleThread.status,
      },
    })
  }

  private pushInsight(insight: ProactiveInsight): void {
    if (this.insights.some(item => item.id === insight.id)) return
    this.insights = [insight, ...this.insights].slice(0, MAX_INSIGHTS)
    log.info({ kind: insight.kind, insightId: insight.id }, 'Generated proactive insight')
  }
}
