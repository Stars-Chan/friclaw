// tests/unit/utils/lane-queue.test.ts
import { describe, it, expect } from 'bun:test'
import { LaneQueue } from '../../../src/utils/lane-queue'

describe('LaneQueue', () => {
  it('same laneKey tasks execute in FIFO order', async () => {
    const q = new LaneQueue()
    const order: number[] = []
    await Promise.all([
      q.enqueue('user-a', async () => { order.push(1) }),
      q.enqueue('user-a', async () => { order.push(2) }),
      q.enqueue('user-a', async () => { order.push(3) }),
    ])
    expect(order).toEqual([1, 2, 3])
  })

  it('same laneKey tasks are serialized (max concurrency = 1)', async () => {
    const q = new LaneQueue()
    let concurrent = 0
    let maxConcurrent = 0
    const task = async () => {
      concurrent++
      maxConcurrent = Math.max(maxConcurrent, concurrent)
      await new Promise(r => setTimeout(r, 10))
      concurrent--
    }
    await Promise.all([
      q.enqueue('user-a', task),
      q.enqueue('user-a', task),
      q.enqueue('user-a', task),
    ])
    expect(maxConcurrent).toBe(1)
  })

  it('different laneKey tasks run in parallel', async () => {
    const q = new LaneQueue()
    let concurrent = 0
    let maxConcurrent = 0
    const task = async () => {
      concurrent++
      maxConcurrent = Math.max(maxConcurrent, concurrent)
      await new Promise(r => setTimeout(r, 20))
      concurrent--
    }
    await Promise.all([
      q.enqueue('user-a', task),
      q.enqueue('user-b', task),
      q.enqueue('user-c', task),
    ])
    expect(maxConcurrent).toBeGreaterThan(1)
  })

  it('task error does not block subsequent tasks in same lane', async () => {
    const q = new LaneQueue()
    const results: string[] = []
    const [r1, r2] = await Promise.allSettled([
      q.enqueue('user-a', async () => { throw new Error('fail') }),
      q.enqueue('user-a', async () => { results.push('ok') }),
    ])
    expect(r1.status).toBe('rejected')
    expect(r2.status).toBe('fulfilled')
    expect(results).toEqual(['ok'])
  })

  it('returns task result to caller', async () => {
    const q = new LaneQueue()
    const result = await q.enqueue('user-a', async () => 42)
    expect(result).toBe(42)
  })

  it('empty lane is cleaned up after drain', async () => {
    const q = new LaneQueue()
    await q.enqueue('user-a', async () => {})
    expect(q.activeLanes()).toBe(0)
  })

  it('rejects when maxLanes is exceeded', async () => {
    const q = new LaneQueue(2)
    const blocker = () => new Promise<void>(r => setTimeout(r, 50))
    q.enqueue('lane-1', blocker)
    q.enqueue('lane-2', blocker)
    await expect(q.enqueue('lane-3', async () => {}))
      .rejects.toThrow('Lane limit reached: 2')
  })

  it('stats returns queue depth per lane', async () => {
    const q = new LaneQueue()
    const t1 = q.enqueue('user-a', () => new Promise(r => setTimeout(r, 50)))
    const t2 = q.enqueue('user-a', async () => {})
    const t3 = q.enqueue('user-a', async () => {})
    // drain shifts t1 before awaiting, so: queue=[t2,t3], running=true → depth=3
    expect(q.stats()['user-a']).toBe(3)
    await Promise.all([t1, t2, t3])
  })

  it('activeLanes returns count of active lanes', async () => {
    const q = new LaneQueue()
    const b1 = q.enqueue('user-a', () => new Promise(r => setTimeout(r, 50)))
    const b2 = q.enqueue('user-b', () => new Promise(r => setTimeout(r, 50)))
    expect(q.activeLanes()).toBe(2)
    await Promise.all([b1, b2])
    expect(q.activeLanes()).toBe(0)
  })
})
