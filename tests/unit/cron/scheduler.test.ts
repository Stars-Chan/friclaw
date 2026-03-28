import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { CronScheduler } from '../../../src/cron/scheduler'

let tmpDir: string
let dbPath: string

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'friclaw-cron-'))
  dbPath = join(tmpDir, 'test.db')
})

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true })
})

describe('CronScheduler', () => {
  it('create() persists job and returns it', async () => {
    const scheduler = new CronScheduler(dbPath)
    const job = scheduler.create({
      name: 'test job',
      cronExpression: '0 9 * * *',
      prompt: 'hello',
      platform: 'feishu',
      chatId: 'chat1',
      userId: 'user1',
      enabled: true,
    })
    expect(job.id).toBeTruthy()
    expect(job.name).toBe('test job')
    expect(job.enabled).toBe(true)
    await scheduler.stop()
  })

  it('list() returns all jobs', async () => {
    const scheduler = new CronScheduler(dbPath)
    scheduler.create({ name: 'job1', cronExpression: '0 9 * * *', prompt: 'a', platform: 'feishu', chatId: 'c1', userId: 'u1', enabled: true })
    scheduler.create({ name: 'job2', cronExpression: '0 10 * * *', prompt: 'b', platform: 'feishu', chatId: 'c2', userId: 'u2', enabled: true })
    const jobs = scheduler.list()
    expect(jobs).toHaveLength(2)
    await scheduler.stop()
  })

  it('delete() removes job', async () => {
    const scheduler = new CronScheduler(dbPath)
    const job = scheduler.create({ name: 'to delete', cronExpression: '0 9 * * *', prompt: 'x', platform: 'feishu', chatId: 'c', userId: 'u', enabled: true })
    scheduler.delete(job.id)
    expect(scheduler.list()).toHaveLength(0)
    await scheduler.stop()
  })

  it('update() modifies job', async () => {
    const scheduler = new CronScheduler(dbPath)
    const job = scheduler.create({ name: 'test', cronExpression: '0 9 * * *', prompt: 'x', platform: 'feishu', chatId: 'c', userId: 'u', enabled: true })
    const updated = scheduler.update(job.id, { enabled: false })
    expect(updated?.enabled).toBe(false)
    await scheduler.stop()
  })

  it('event emitter fires job:execute on schedule', async () => {
    const scheduler = new CronScheduler(dbPath)
    const events: any[] = []
    scheduler.on('job:execute', (event) => events.push(event))

    const job = scheduler.create({ name: 'test', cronExpression: '* * * * * *', prompt: 'test', platform: 'feishu', chatId: 'c', userId: 'u', enabled: true })
    await new Promise(r => setTimeout(r, 1500))

    expect(events.length).toBeGreaterThan(0)
    expect(events[0].jobId).toBe(job.id)
    await scheduler.stop()
  })

  it('execution history is recorded', async () => {
    const scheduler = new CronScheduler(dbPath)
    scheduler.on('job:execute', () => {})

    const job = scheduler.create({ name: 'test', cronExpression: '* * * * * *', prompt: 'test', platform: 'feishu', chatId: 'c', userId: 'u', enabled: true })
    await new Promise(r => setTimeout(r, 1500))

    const history = scheduler.getExecutionHistory(job.id)
    expect(history.length).toBeGreaterThan(0)
    expect(history[0].status).toBe('success')
    await scheduler.stop()
  })

  it('timezone support works', async () => {
    const scheduler = new CronScheduler(dbPath)
    const job = scheduler.create({
      name: 'tz test',
      cronExpression: '0 9 * * *',
      prompt: 'test',
      timezone: 'Asia/Shanghai',
      platform: 'feishu',
      chatId: 'c',
      userId: 'u',
      enabled: true
    })
    expect(job.timezone).toBe('Asia/Shanghai')
    await scheduler.stop()
  })

  it('jobs persist across restart', async () => {
    const s1 = new CronScheduler(dbPath)
    s1.create({ name: 'persistent', cronExpression: '0 9 * * *', prompt: 'hi', platform: 'feishu', chatId: 'c', userId: 'u', enabled: true })
    await s1.stop()

    const s2 = new CronScheduler(dbPath)
    await s2.start()
    expect(s2.list()).toHaveLength(1)
    expect(s2.list()[0].name).toBe('persistent')
    await s2.stop()
  })
})
