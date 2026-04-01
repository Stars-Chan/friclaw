import Database from 'bun:sqlite'
import { randomUUID } from 'crypto'
import { mkdirSync } from 'fs'
import { dirname } from 'path'

export interface CronJob {
  id: string
  name: string
  cronExpression: string
  prompt: string
  timezone?: string
  platform: string
  chatId: string
  userId: string
  chatType?: 'private' | 'group'
  enabled: boolean
  createdAt: string
  updatedAt: string
}

export interface CronExecution {
  id: string
  jobId: string
  scheduledTime: string
  executedAt: string
  status: 'success' | 'error'
  errorMessage?: string
}

export class CronStorage {
  private db: Database

  constructor(dbPath: string) {
    mkdirSync(dirname(dbPath), { recursive: true })
    this.db = new Database(dbPath)
    this.init()
  }

  private init(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS cron_jobs (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        cron_expression TEXT NOT NULL,
        prompt TEXT NOT NULL,
        timezone TEXT,
        platform TEXT NOT NULL,
        chat_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        chat_type TEXT DEFAULT 'private',
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `)

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS cron_executions (
        id TEXT PRIMARY KEY,
        job_id TEXT NOT NULL,
        scheduled_time TEXT NOT NULL,
        executed_at TEXT NOT NULL,
        status TEXT NOT NULL,
        error_message TEXT,
        FOREIGN KEY (job_id) REFERENCES cron_jobs(id) ON DELETE CASCADE
      )
    `)

    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_executions_job_id ON cron_executions(job_id)`)
  }

  createJob(input: Omit<CronJob, 'id' | 'createdAt' | 'updatedAt'>): CronJob {
    const now = new Date().toISOString()
    const job: CronJob = {
      ...input,
      id: randomUUID(),
      createdAt: now,
      updatedAt: now,
    }
    this.db.prepare(`
      INSERT INTO cron_jobs (id, name, cron_expression, prompt, timezone, platform, chat_id, user_id, chat_type, enabled, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(job.id, job.name, job.cronExpression, job.prompt, job.timezone ?? null, job.platform, job.chatId ?? null, job.userId ?? null, job.chatType ?? null, job.enabled ? 1 : 0, job.createdAt, job.updatedAt)
    return job
  }

  getJob(id: string): CronJob | undefined {
    const row = this.db.prepare('SELECT * FROM cron_jobs WHERE id = ?').get(id) as any
    return row ? this.mapJob(row) : undefined
  }

  listJobs(platform?: string): CronJob[] {
    const query = platform
      ? this.db.prepare('SELECT * FROM cron_jobs WHERE platform = ? ORDER BY created_at DESC')
      : this.db.prepare('SELECT * FROM cron_jobs ORDER BY created_at DESC')
    const rows = (platform ? query.all(platform) : query.all()) as any[]
    return rows.map(r => this.mapJob(r))
  }

  updateJob(id: string, patch: Partial<Omit<CronJob, 'id' | 'createdAt' | 'updatedAt'>>): CronJob | undefined {
    const job = this.getJob(id)
    if (!job) return undefined
    const updated = { ...job, ...patch, updatedAt: new Date().toISOString() }
    this.db.prepare(`
      UPDATE cron_jobs SET name = ?, cron_expression = ?, prompt = ?, timezone = ?, platform = ?, chat_id = ?, user_id = ?, chat_type = ?, enabled = ?, updated_at = ?
      WHERE id = ?
    `).run(updated.name, updated.cronExpression, updated.prompt, updated.timezone ?? null, updated.platform, updated.chatId ?? null, updated.userId ?? null, updated.chatType ?? null, updated.enabled ? 1 : 0, updated.updatedAt, id)
    return updated
  }

  deleteJob(id: string): void {
    this.db.prepare('DELETE FROM cron_jobs WHERE id = ?').run(id)
  }

  recordExecution(jobId: string, scheduledTime: string, status: 'success' | 'error', errorMessage?: string): void {
    const execution: CronExecution = {
      id: randomUUID(),
      jobId,
      scheduledTime,
      executedAt: new Date().toISOString(),
      status,
      errorMessage,
    }
    this.db.prepare(`
      INSERT INTO cron_executions (id, job_id, scheduled_time, executed_at, status, error_message)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(execution.id, execution.jobId, execution.scheduledTime, execution.executedAt, execution.status, execution.errorMessage ?? null)
  }

  getExecutionHistory(jobId: string, limit = 50): CronExecution[] {
    const rows = this.db.prepare(`
      SELECT * FROM cron_executions WHERE job_id = ? ORDER BY executed_at DESC LIMIT ?
    `).all(jobId, limit) as any[]
    return rows.map(r => this.mapExecution(r))
  }

  private mapJob(row: any): CronJob {
    return {
      id: row.id,
      name: row.name,
      cronExpression: row.cron_expression,
      prompt: row.prompt,
      timezone: row.timezone,
      platform: row.platform,
      chatId: row.chat_id,
      userId: row.user_id,
      chatType: row.chat_type,
      enabled: row.enabled === 1,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }
  }

  private mapExecution(row: any): CronExecution {
    return {
      id: row.id,
      jobId: row.job_id,
      scheduledTime: row.scheduled_time,
      executedAt: row.executed_at,
      status: row.status,
      errorMessage: row.error_message,
    }
  }

  getDataVersion(): number {
    const result = this.db.prepare('PRAGMA data_version').get() as any
    return result.data_version
  }

  close(): void {
    this.db.close()
  }
}

