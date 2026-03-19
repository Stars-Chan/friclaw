// tests/unit/cron/scheduler.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { CronScheduler } from '../../../src/cron/scheduler'
import type { Message } from '../../../src/types/message'

let tmpDir: string

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'friclaw-cron-'))
})

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true })
})

const makeDispatcher = () => {
  const dispatched: Message[] = []
  return {
    dispatched,
    dispatch: async (msg: Message) => { dispatched.push(msg) },
  }
}

describe('CronScheduler', () => {
  it('create() persists job and returns it', async () => {
    const scheduler = new CronScheduler(tmpDir, makeDispatcher() as never)
    const job = scheduler.create({
      name: 'test job',
      schedule: new Date(Date.now() + 60_000).toISOString(),
      message: 'hello',
      chatId: 'chat_001',
      platform: 'feishu',
      userId: 'user_001',
      enabled: true,
    })
    expect(job.id).toBeTruthy()
    expect(job.name).toBe('test job')
    expect(job.enabled).toBe(true)
    await scheduler.stop()
  })

  it('list() returns all jobs', async () => {
    const scheduler = new CronScheduler(tmpDir, makeDispatcher() as never)
    scheduler.create({ name: 'job1', schedule: '0 9 * * *', message: 'a', chatId: 'c1', platform: 'feishu', userId: 'u1', enabled: true })
    scheduler.create({ name: 'job2', schedule: '0 10 * * *', message: 'b', chatId: 'c2', platform: 'feishu', userId: 'u2', enabled: true })
    const jobs = scheduler.list()
    expect(jobs).toHaveLength(2)
    await scheduler.stop()
  })

  it('delete() removes job', async () => {
    const scheduler = new CronScheduler(tmpDir, makeDispatcher() as never)
    const job = scheduler.create({ name: 'to delete', schedule: '0 9 * * *', message: 'x', chatId: 'c', platform: 'feishu', userId: 'u', enabled: true })
    scheduler.delete(job.id)
    expect(scheduler.list()).toHaveLength(0)
    await scheduler.stop()
  })

  it('one-shot job triggers dispatch when time arrives', async () => {
    const dispatcher = makeDispatcher()
    const scheduler = new CronScheduler(tmpDir, dispatcher as never)
    const runAt = new Date(Date.now() + 50).toISOString()
    scheduler.create({ name: 'soon', schedule: runAt, message: 'ping', chatId: 'chat_x', platform: 'feishu', userId: 'user_x', enabled: true })
    await new Promise(r => setTimeout(r, 150))
    expect(dispatcher.dispatched).toHaveLength(1)
    expect(dispatcher.dispatched[0].content).toBe('ping')
    expect(dispatcher.dispatched[0].platform).toBe('feishu')
    await scheduler.stop()
  })

  it('one-shot job is disabled after execution', async () => {
    const dispatcher = makeDispatcher()
    const scheduler = new CronScheduler(tmpDir, dispatcher as never)
    const runAt = new Date(Date.now() + 50).toISOString()
    const job = scheduler.create({ name: 'once', schedule: runAt, message: 'once', chatId: 'c', platform: 'feishu', userId: 'u', enabled: true })
    await new Promise(r => setTimeout(r, 150))
    const updated = scheduler.list().find(j => j.id === job.id)
    expect(updated?.enabled).toBe(false)
    await scheduler.stop()
  })

  it('isCronExpression() correctly identifies cron vs ISO', async () => {
    const scheduler = new CronScheduler(tmpDir, makeDispatcher() as never)
    // access via public method for testability
    expect(scheduler.isCronExpression('0 9 * * *')).toBe(true)
    expect(scheduler.isCronExpression('0 9 * * 1-5')).toBe(true)
    expect(scheduler.isCronExpression('2026-03-19T09:00:00.000Z')).toBe(false)
    await scheduler.stop()
  })

  it('jobs persist across restart', async () => {
    const dispatcher = makeDispatcher()
    const s1 = new CronScheduler(tmpDir, dispatcher as never)
    s1.create({ name: 'persistent', schedule: '0 9 * * *', message: 'hi', chatId: 'c', platform: 'feishu', userId: 'u', enabled: true })
    await s1.stop()

    const s2 = new CronScheduler(tmpDir, dispatcher as never)
    await s2.start()
    expect(s2.list()).toHaveLength(1)
    expect(s2.list()[0].name).toBe('persistent')
    await s2.stop()
  })
})
