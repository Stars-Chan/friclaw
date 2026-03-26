// src/cron/scheduler.ts
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'
import { randomUUID } from 'crypto'
import type { Dispatcher } from '../dispatcher'
import type { Message } from '../types/message'

export interface CronJob {
  id: string
  name: string
  /** ISO datetime string (one-shot) or cron expression (recurring) */
  schedule: string
  message: string
  chatId: string
  platform: 'feishu' | 'wecom' | 'weixin' | 'dashboard'
  userId: string
  enabled: boolean
  createdAt: string
}

type CreateJobInput = Omit<CronJob, 'id' | 'createdAt'>

export class CronScheduler {
  private jobs: Map<string, CronJob> = new Map()
  private timers: Map<string, ReturnType<typeof setTimeout | typeof setInterval>> = new Map()
  private dbPath: string

  constructor(
    private dataDir: string,
    private dispatcher: Dispatcher,
  ) {
    this.dbPath = join(dataDir, 'cron-jobs.json')
    this.load()
  }

  async start(): Promise<void> {
    for (const job of this.jobs.values()) {
      if (job.enabled) this.schedule(job)
    }
  }

  async stop(): Promise<void> {
    for (const [id, timer] of this.timers) {
      clearTimeout(timer as ReturnType<typeof setTimeout>)
      clearInterval(timer as ReturnType<typeof setInterval>)
      this.timers.delete(id)
    }
  }

  create(input: CreateJobInput): CronJob {
    const job: CronJob = {
      ...input,
      id: randomUUID(),
      createdAt: new Date().toISOString(),
    }
    this.jobs.set(job.id, job)
    this.save()
    if (job.enabled) this.schedule(job)
    return job
  }

  list(): CronJob[] {
    return Array.from(this.jobs.values())
  }

  delete(id: string): void {
    this.cancel(id)
    this.jobs.delete(id)
    this.save()
  }

  update(id: string, patch: Partial<Omit<CronJob, 'id' | 'createdAt'>>): CronJob | undefined {
    const job = this.jobs.get(id)
    if (!job) return undefined
    const updated = { ...job, ...patch }
    this.jobs.set(id, updated)
    this.save()
    this.cancel(id)
    if (updated.enabled) this.schedule(updated)
    return updated
  }

  isCronExpression(schedule: string): boolean {
    // cron expressions have 5 space-separated fields
    return /^(\S+\s+){4}\S+$/.test(schedule.trim())
  }

  private schedule(job: CronJob): void {
    if (this.isCronExpression(job.schedule)) {
      this.scheduleCron(job)
    } else {
      this.scheduleOneShot(job)
    }
  }

  private scheduleOneShot(job: CronJob): void {
    const runAt = new Date(job.schedule).getTime()
    const delay = runAt - Date.now()
    if (delay < 0) return // already past

    const timer = setTimeout(async () => {
      this.timers.delete(job.id)
      await this.fire(job)
      // disable after execution
      const current = this.jobs.get(job.id)
      if (current) {
        const disabled = { ...current, enabled: false }
        this.jobs.set(job.id, disabled)
        this.save()
      }
    }, delay)

    this.timers.set(job.id, timer)
  }

  private scheduleCron(job: CronJob): void {
    // Simple polling: check every minute if the cron expression matches now
    const timer = setInterval(async () => {
      if (this.matchesCron(job.schedule, new Date())) {
        await this.fire(job)
      }
    }, 60_000)

    this.timers.set(job.id, timer)
  }

  private async fire(job: CronJob): Promise<void> {
    const message: Message = {
      platform: job.platform,
      chatId: job.chatId,
      userId: job.userId,
      type: 'text',
      content: job.message,
    }
    await this.dispatcher.dispatch(message)
  }

  private cancel(id: string): void {
    const timer = this.timers.get(id)
    if (timer !== undefined) {
      clearTimeout(timer as ReturnType<typeof setTimeout>)
      clearInterval(timer as ReturnType<typeof setInterval>)
      this.timers.delete(id)
    }
  }

  private load(): void {
    if (!existsSync(this.dbPath)) return
    try {
      const raw = readFileSync(this.dbPath, 'utf-8')
      const jobs: CronJob[] = JSON.parse(raw)
      for (const job of jobs) this.jobs.set(job.id, job)
    } catch {
      // corrupt file — start fresh
    }
  }

  private save(): void {
    writeFileSync(this.dbPath, JSON.stringify(Array.from(this.jobs.values()), null, 2))
  }

  /** Minimal cron matcher: checks minute and hour fields against current time */
  private matchesCron(expr: string, now: Date): boolean {
    const [min, hour, dom, month, dow] = expr.trim().split(/\s+/)
    const match = (field: string, value: number): boolean => {
      if (field === '*') return true
      if (field.includes('-')) {
        const [lo, hi] = field.split('-').map(Number)
        return value >= lo && value <= hi
      }
      if (field.includes(',')) return field.split(',').map(Number).includes(value)
      return Number(field) === value
    }
    return (
      match(min, now.getMinutes()) &&
      match(hour, now.getHours()) &&
      match(dom, now.getDate()) &&
      match(month, now.getMonth() + 1) &&
      match(dow, now.getDay())
    )
  }
}
