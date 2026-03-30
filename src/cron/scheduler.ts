import { EventEmitter } from 'events'
import { Cron } from 'croner'
import { CronStorage, type CronJob } from './storage'
import { DateTime } from 'luxon'
import { logger } from '../utils/logger'

const log = logger('scheduler')

export interface JobExecuteEvent {
  jobId: string
  job: CronJob
  scheduledTime: Date
}

type SchedulerEntry = Cron | Timer

export class CronScheduler extends EventEmitter {
  private storage: CronStorage
  private schedulers: Map<string, SchedulerEntry> = new Map()
  private inFlight: Set<string> = new Set()
  private checkInterval?: Timer
  private lastDataVersion = 0
  private checkIntervalMs: number

  constructor(dbPath: string, checkIntervalMs = 5000) {
    super()
    this.storage = new CronStorage(dbPath)
    this.checkIntervalMs = checkIntervalMs
  }

  async start(): Promise<void> {
    const jobs = this.storage.listJobs()
    for (const job of jobs) {
      if (job.enabled) this.schedule(job)
    }
    this.lastDataVersion = this.storage.getDataVersion()

    this.checkInterval = setInterval(() => this.checkForChanges(), this.checkIntervalMs)
  }

  private checkForChanges(): void {
    try {
      const currentVersion = this.storage.getDataVersion()
      if (currentVersion !== this.lastDataVersion) {
        log.debug('Database changed, reloading cron jobs')
        this.lastDataVersion = currentVersion
        this.reload()
      }
    } catch (error) {
      log.error({ err: error }, 'Error checking for cron changes')
    }
  }

  async reload(): Promise<void> {
    // 停止所有现有任务
    for (const scheduler of this.schedulers.values()) {
      this.stopScheduler(scheduler)
    }
    this.schedulers.clear()

    // 重新加载并调度
    const jobs = this.storage.listJobs()
    for (const job of jobs) {
      if (job.enabled) this.schedule(job)
    }
    this.lastDataVersion = this.storage.getDataVersion()
  }

  async stop(): Promise<void> {
    if (this.checkInterval) {
      clearInterval(this.checkInterval)
    }
    for (const scheduler of this.schedulers.values()) {
      this.stopScheduler(scheduler)
    }
    this.schedulers.clear()
    this.storage.close()
  }

  create(input: Omit<CronJob, 'id' | 'createdAt' | 'updatedAt'>): CronJob {
    const job = this.storage.createJob(input)
    if (job.enabled) this.schedule(job)
    return job
  }

  list(): CronJob[] {
    return this.storage.listJobs()
  }

  get(id: string): CronJob | undefined {
    return this.storage.getJob(id)
  }

  update(id: string, patch: Partial<Omit<CronJob, 'id' | 'createdAt' | 'updatedAt'>>): CronJob | undefined {
    const updated = this.storage.updateJob(id, patch)
    if (!updated) return undefined
    this.cancel(id)
    if (updated.enabled) this.schedule(updated)
    return updated
  }

  delete(id: string): void {
    this.cancel(id)
    this.storage.deleteJob(id)
  }

  getExecutionHistory(jobId: string, limit = 50) {
    return this.storage.getExecutionHistory(jobId, limit)
  }

  private schedule(job: CronJob): void {
    // 检查是否为 ISO 时间字符串（一次性任务）
    if (this.isISODateTime(job.cronExpression)) {
      this.scheduleOneShot(job)
      return
    }

    // croner 使用 6 字段格式（秒 分 时 日 月 周），标准 cron 是 5 字段（分 时 日 月 周）
    // 如果是 5 字段，在前面添加 "0" 作为秒字段
    let expression = job.cronExpression
    const fields = expression.trim().split(/\s+/)
    if (fields.length === 5) {
      expression = `0 ${expression}`
    }

    const timezone = job.timezone || 'Asia/Shanghai'
    log.debug({ jobId: job.id, expression, timezone }, 'Scheduling cron job')

    const cron = new Cron(expression, { timezone }, () => {
      log.debug({ jobId: job.id }, 'Cron job triggered')
      this.fire(job.id)
    })
    this.schedulers.set(job.id, cron)
  }

  private isISODateTime(str: string): boolean {
    return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(str)
  }

  private scheduleOneShot(job: CronJob): void {
    const hasTimezone = /[+-]\d{2}:\d{2}|Z$/.test(job.cronExpression)
    const dt = hasTimezone
      ? DateTime.fromISO(job.cronExpression)
      : DateTime.fromISO(job.cronExpression, { zone: job.timezone || 'Asia/Shanghai' })

    const runAt = dt.toMillis()
    const delay = runAt - Date.now()

    if (delay < 0) {
      this.storage.updateJob(job.id, { enabled: false })
      return
    }

    const timer = setTimeout(async () => {
      this.schedulers.delete(job.id)
      await this.fire(job.id)
      this.storage.deleteJob(job.id)
    }, delay)

    this.schedulers.set(job.id, timer)
  }

  private cancel(id: string): void {
    const scheduler = this.schedulers.get(id)
    if (scheduler) {
      this.stopScheduler(scheduler)
      this.schedulers.delete(id)
    }
  }

  private stopScheduler(scheduler: SchedulerEntry): void {
    if (typeof scheduler === 'number') {
      clearTimeout(scheduler)
    } else if (scheduler && typeof scheduler.stop === 'function') {
      scheduler.stop()
    }
  }

  private async fire(jobId: string): Promise<void> {
    if (this.inFlight.has(jobId)) {
      log.debug({ jobId }, 'Job already in flight, skipping')
      return
    }
    this.inFlight.add(jobId)

    const job = this.storage.getJob(jobId)
    if (!job) {
      log.warn({ jobId }, 'Job not found in storage')
      this.inFlight.delete(jobId)
      return
    }

    const scheduledTime = new Date()

    try {
      this.emit('job:execute', { jobId, job, scheduledTime } as JobExecuteEvent)
      this.storage.recordExecution(jobId, scheduledTime.toISOString(), 'success')
      log.debug({ jobId }, 'Job executed successfully')
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      log.error({ err: error, jobId }, 'Job execution error')
      this.storage.recordExecution(jobId, scheduledTime.toISOString(), 'error', errorMessage)
    } finally {
      this.inFlight.delete(jobId)
    }
  }
}
