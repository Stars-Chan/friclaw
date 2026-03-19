// tests/unit/utils/lane-queue.test.ts
import { describe, it, expect } from 'bun:test'
import { LaneQueue } from '../../../src/utils/lane-queue'

describe('LaneQueue', () => {
  it('executes tasks in FIFO order', async () => {
    const queue = new LaneQueue()
    const order: number[] = []

    await Promise.all([
      queue.enqueue(async () => { order.push(1) }),
      queue.enqueue(async () => { order.push(2) }),
      queue.enqueue(async () => { order.push(3) }),
    ])

    expect(order).toEqual([1, 2, 3])
  })

  it('serializes concurrent tasks (max concurrency = 1)', async () => {
    const queue = new LaneQueue()
    let concurrent = 0
    let maxConcurrent = 0

    const task = async () => {
      concurrent++
      maxConcurrent = Math.max(maxConcurrent, concurrent)
      await new Promise(r => setTimeout(r, 10))
      concurrent--
    }

    await Promise.all([
      queue.enqueue(task),
      queue.enqueue(task),
      queue.enqueue(task),
    ])

    expect(maxConcurrent).toBe(1)
  })

  it('propagates task errors to caller without blocking queue', async () => {
    const queue = new LaneQueue()
    const results: string[] = []

    const [r1, r2] = await Promise.allSettled([
      queue.enqueue(async () => { throw new Error('fail') }),
      queue.enqueue(async () => { results.push('ok') }),
    ])

    expect(r1.status).toBe('rejected')
    expect(r2.status).toBe('fulfilled')
    expect(results).toEqual(['ok'])
  })

  it('returns task result to caller', async () => {
    const queue = new LaneQueue()
    const result = await queue.enqueue(async () => 42)
    expect(result).toBe(42)
  })

  it('size reflects pending tasks', async () => {
    const queue = new LaneQueue()
    const blocker = queue.enqueue(() => new Promise(r => setTimeout(r, 50)))
    queue.enqueue(async () => {})
    queue.enqueue(async () => {})

    expect(queue.size).toBeGreaterThan(0)
    await blocker
  })
})
