# Lane Queue Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将现有单队列 LaneQueue 重写为按 laneKey 隔离的多泳道队列，支持同用户串行、跨用户并行、超时保护和监控接口。

**Architecture:** 用 `Map<string, Lane>` 维护每个 laneKey 的独立队列；`enqueue(laneKey, task, timeoutMs)` 入队并触发 drain；drain 串行消费单条泳道，完成后自动清理空泳道；`withTimeout` 包装任务防止卡死。

**Tech Stack:** Bun, TypeScript, bun:test

---

## 现状说明

`src/utils/lane-queue.ts` 当前是**单队列**实现（无 laneKey），API 为 `enqueue(task)`，需完全重写为多泳道设计。现有 5 个测试全部基于旧 API，需同步替换。

`src/dispatcher.ts` 是 stub，尚未使用 LaneQueue，本次不需要修改。

---

## File Structure

| 操作 | 路径 | 职责 |
|------|------|------|
| Rewrite | `src/utils/lane-queue.ts` | 多泳道 LaneQueue 类 + withTimeout 工具函数 |
| Rewrite | `tests/unit/utils/lane-queue.test.ts` | 新 API 的完整测试套件（替换旧测试） |

---

## Task 1: 核心多泳道结构

**Files:**
- Rewrite: `src/utils/lane-queue.ts`
- Rewrite: `tests/unit/utils/lane-queue.test.ts`

- [ ] **Step 1: 写失败测试（替换整个测试文件）**

```typescript
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
})
```

- [ ] **Step 2: 运行测试，确认失败**

```bash
bun test tests/unit/utils/lane-queue.test.ts
```

Expected: FAIL — `enqueue` 参数不匹配（旧 API 只接受 1 个参数）

- [ ] **Step 3: 重写 src/utils/lane-queue.ts**

```typescript
// src/utils/lane-queue.ts

type Task<T> = () => Promise<T>

interface Lane {
  queue: Array<{
    task: Task<unknown>
    resolve: (v: unknown) => void
    reject: (e: unknown) => void
  }>
  running: boolean
}

export class LaneQueue {
  private lanes = new Map<string, Lane>()
  private maxLanes: number

  constructor(maxLanes = 100) {
    this.maxLanes = maxLanes
  }

  enqueue<T>(laneKey: string, task: Task<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      let lane = this.lanes.get(laneKey)
      if (!lane) {
        lane = { queue: [], running: false }
        this.lanes.set(laneKey, lane)
      }
      lane.queue.push({
        task: task as Task<unknown>,
        resolve: resolve as (v: unknown) => void,
        reject,
      })
      if (!lane.running) this.drain(laneKey)
    })
  }

  private async drain(laneKey: string): Promise<void> {
    const lane = this.lanes.get(laneKey)!
    lane.running = true
    while (lane.queue.length > 0) {
      const { task, resolve, reject } = lane.queue.shift()!
      try {
        resolve(await task())
      } catch (e) {
        reject(e)
      }
    }
    lane.running = false
    this.lanes.delete(laneKey)
  }

  activeLanes(): number {
    return this.lanes.size
  }
}
```

- [ ] **Step 4: 运行测试 + 类型检查，确认通过**

```bash
bun test tests/unit/utils/lane-queue.test.ts
bun run typecheck
```

Expected: 6 tests pass，typecheck 无错误

- [ ] **Step 5: Commit**

```bash
git add src/utils/lane-queue.ts tests/unit/utils/lane-queue.test.ts
git commit -m "feat: rewrite LaneQueue as multi-lane per-key queue"
```

---

## Task 2: maxLanes 限制 + stats() 监控

**Files:**
- Modify: `src/utils/lane-queue.ts`
- Modify: `tests/unit/utils/lane-queue.test.ts`

- [ ] **Step 1: 写失败测试**

在 `tests/unit/utils/lane-queue.test.ts` 的 `describe('LaneQueue')` 块末尾追加：

```typescript
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
```

- [ ] **Step 2: 运行测试，确认失败**

```bash
bun test tests/unit/utils/lane-queue.test.ts
```

Expected: FAIL — `q.stats is not a function`，maxLanes 未检查

- [ ] **Step 3: 更新 src/utils/lane-queue.ts**

在 `enqueue` 中加入 maxLanes 检查，并新增 `stats()` 方法：

```typescript
  enqueue<T>(laneKey: string, task: Task<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      let lane = this.lanes.get(laneKey)
      if (!lane) {
        if (this.lanes.size >= this.maxLanes) {
          reject(new Error(`Lane limit reached: ${this.maxLanes}`))
          return
        }
        lane = { queue: [], running: false }
        this.lanes.set(laneKey, lane)
      }
      lane.queue.push({
        task: task as Task<unknown>,
        resolve: resolve as (v: unknown) => void,
        reject,
      })
      if (!lane.running) this.drain(laneKey)
    })
  }

  stats(): Record<string, number> {
    const result: Record<string, number> = {}
    for (const [key, lane] of this.lanes) {
      result[key] = lane.queue.length + (lane.running ? 1 : 0)
    }
    return result
  }
```

- [ ] **Step 4: 运行测试 + 类型检查，确认通过**

```bash
bun test tests/unit/utils/lane-queue.test.ts
bun run typecheck
```

Expected: 9 tests pass，typecheck 无错误

- [ ] **Step 5: Commit**

```bash
git add src/utils/lane-queue.ts tests/unit/utils/lane-queue.test.ts
git commit -m "feat: add maxLanes limit and stats/activeLanes monitoring to LaneQueue"
```

---

## Task 3: 超时保护

**Files:**
- Modify: `src/utils/lane-queue.ts`
- Modify: `tests/unit/utils/lane-queue.test.ts`

- [ ] **Step 1: 写失败测试**

在 `tests/unit/utils/lane-queue.test.ts` 末尾追加：

```typescript
  it('times out a slow task and rejects the caller', async () => {
    const q = new LaneQueue()
    const slow = () => new Promise<void>(r => setTimeout(r, 200))
    await expect(q.enqueue('user-a', slow, 50))
      .rejects.toThrow('Task timeout after 50ms')
  })

  it('lane continues processing after a timeout', async () => {
    const q = new LaneQueue()
    const results: string[] = []
    const slow = () => new Promise<void>(r => setTimeout(r, 200))
    await Promise.allSettled([
      q.enqueue('user-a', slow, 50),
      q.enqueue('user-a', async () => { results.push('ok') }),
    ])
    expect(results).toEqual(['ok'])
  })
```

- [ ] **Step 2: 运行测试，确认失败**

```bash
bun test tests/unit/utils/lane-queue.test.ts
```

Expected: FAIL — `enqueue` 不接受第三个参数，超时不触发

- [ ] **Step 3: 更新 src/utils/lane-queue.ts**

在 class 定义之前新增 `withTimeout`，并更新 `enqueue` 签名：

```typescript
function withTimeout<T>(task: Task<T>, ms: number): Task<T> {
  return () => Promise.race([
    task(),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`Task timeout after ${ms}ms`)), ms)
    ),
  ])
}
```

将 `enqueue` 签名改为：

```typescript
  enqueue<T>(laneKey: string, task: Task<T>, timeoutMs = 300_000): Promise<T> {
```

并在入队前包装任务（替换 `task as Task<unknown>` 为 `withTimeout(task, timeoutMs) as Task<unknown>`）：

```typescript
      lane.queue.push({
        task: withTimeout(task, timeoutMs) as Task<unknown>,
        resolve: resolve as (v: unknown) => void,
        reject,
      })
```

- [ ] **Step 4: 运行测试 + 类型检查，确认通过**

```bash
bun test tests/unit/utils/lane-queue.test.ts
bun run typecheck
```

Expected: 11 tests pass，typecheck 无错误

- [ ] **Step 5: 运行全量测试，确认无回归**

```bash
bun test
```

Expected: 所有测试通过

- [ ] **Step 6: Commit**

```bash
git add src/utils/lane-queue.ts tests/unit/utils/lane-queue.test.ts
git commit -m "feat: add timeout protection to LaneQueue.enqueue"
```

---

## 验收检查

- [ ] `bun test` 全部通过
- [ ] `bun run typecheck` 无类型错误
- [ ] 同 laneKey 消息不乱序（FIFO 测试通过）
- [ ] 不同 laneKey 互不阻塞（并行测试 maxConcurrent > 1）
- [ ] 空泳道自动清理（activeLanes() = 0）
- [ ] 超时任务不卡死泳道（后续任务正常执行）
