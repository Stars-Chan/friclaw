import { EventEmitter } from 'events'
import { Cron } from 'croner'
import { CronStorage, type CronJob } from './storage'
import { DateTime } from 'luxon'

export interface JobExecuteEvent {
  jobId: string
  job: CronJob
  scheduledTime: Date
}

export class CronScheduler extends EventEmitter {
  private storage: CronStorage
  private schedulers: Map<string, Cron> = new Map()
  private inFlight: Set<string> = new Set()

  constructor(dbPath: string) {
    super()
    this.storage = new CronStorage(dbPath)
  }

  async start(): Promise<void> {
    const jobs = this.storage.listJobs()
    for (const job of jobs) {
      if (job.enabled) this.schedule(job)
    }
  }

  async reload(): Promise<void> {
    console.log('[CronScheduler] Reloading jobs from database')
    // 停止所有现有任务
    for (const [id, scheduler] of this.schedulers) {
      if (typeof scheduler === 'number') {
        clearTimeout(scheduler)
      } else if (scheduler && typeof scheduler.stop === 'function') {
        scheduler.stop()
      }
    }
    this.schedulers.clear()

    // 重新加载并调度
    const jobs = this.storage.listJobs()
    for (const job of jobs) {
      if (job.enabled) this.schedule(job)
    }
    console.log(`[CronScheduler] Reloaded ${jobs.length} jobs`)
  }

  async stop(): Promise<void> {
    for (const [id, scheduler] of this.schedulers) {
      if (typeof scheduler === 'number') {
        clearTimeout(scheduler)
      } else if (scheduler && typeof scheduler.stop === 'function') {
        scheduler.stop()
      }
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
    console.log(`[CronScheduler] Scheduling job ${job.id}: ${expression} (${timezone})`)

    const cron = new Cron(expression, { timezone }, () => {
      console.log(`[CronScheduler] Job ${job.id} triggered at ${new Date().toISOString()}`)
      this.fire(job.id)
    })
    this.schedulers.set(job.id, cron)
  }

  private isISODateTime(str: string): boolean {
    return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(str)
  }

  private scheduleOneShot(job: CronJob): void {
    // 使用 luxon 正确处理时区
    // 如果时间字符串没有时区后缀，将其视为指定时区的本地时间
    const hasTimezone = /[+-]\d{2}:\d{2}|Z$/.test(job.cronExpression)
    const dt = hasTimezone
      ? DateTime.fromISO(job.cronExpression)
      : DateTime.fromISO(job.cronExpression, { zone: job.timezone || 'Asia/Shanghai' })

    const runAt = dt.toMillis()
    const delay = runAt - Date.now()

    if (delay < 0) {
      // 已过期，立即禁用
      this.storage.updateJob(job.id, { enabled: false })
      return
    }

    const timer = setTimeout(async () => {
      this.schedulers.delete(job.id)
      await this.fire(job.id)
      // 禁用一次性任务
      this.storage.updateJob(job.id, { enabled: false })
    }, delay)

    this.schedulers.set(job.id, timer as any)
  }

  private cancel(id: string): void {
    const scheduler = this.schedulers.get(id)
    if (scheduler) {
      if (typeof scheduler === 'number') {
        clearTimeout(scheduler)
      } else if (scheduler && typeof scheduler.stop === 'function') {
        scheduler.stop()
      }
      this.schedulers.delete(id)
    }
  }

  private async fire(jobId: string): Promise<void> {
    console.log(`[CronScheduler] fire() called for job ${jobId}`)

    if (this.inFlight.has(jobId)) {
      console.log(`[CronScheduler] Job ${jobId} already in flight, skipping`)
      return
    }
    this.inFlight.add(jobId)

    const job = this.storage.getJob(jobId)
    if (!job) {
      console.log(`[CronScheduler] Job ${jobId} not found in storage`)
      this.inFlight.delete(jobId)
      return
    }

    const scheduledTime = new Date()
    console.log(`[CronScheduler] Emitting job:execute event for ${jobId}`)

    try {
      this.emit('job:execute', { jobId, job, scheduledTime } as JobExecuteEvent)
      this.storage.recordExecution(jobId, scheduledTime.toISOString(), 'success')
      console.log(`[CronScheduler] Job ${jobId} executed successfully`)
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      console.error(`[CronScheduler] Job ${jobId} execution error:`, errorMessage)
      this.storage.recordExecution(jobId, scheduledTime.toISOString(), 'error', errorMessage)
    } finally {
      this.inFlight.delete(jobId)
    }
  }
}
