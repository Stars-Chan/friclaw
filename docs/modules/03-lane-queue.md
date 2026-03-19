# 03 Lane Queue 实现

## 目标

实现按用户隔离的并发队列：同一用户的消息串行处理，不同用户并行处理，防止消息交叉污染。

## 背景

直接用全局锁会导致所有用户串行等待。Lane Queue 的核心思路：每个用户（userId）对应一条独立的"泳道"，泳道内串行，泳道间并行。

```
用户A: [msg1] → [msg2] → [msg3]   ← 串行
用户B: [msg1] → [msg2]             ← 串行
用户C: [msg1]                      ← 串行
         ↑ 三条泳道同时运行（并行）
```

## 子任务

### 3.1 核心数据结构

```typescript
// src/utils/lane-queue.ts

type Task<T> = () => Promise<T>

interface Lane {
  queue: Array<{ task: Task<unknown>; resolve: Function; reject: Function }>
  running: boolean
}

export class LaneQueue {
  private lanes = new Map<string, Lane>()
  private maxLanes: number

  constructor(maxLanes = 100) {
    this.maxLanes = maxLanes
  }
}
```

### 3.2 入队逻辑

```typescript
enqueue<T>(laneKey: string, task: Task<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    let lane = this.lanes.get(laneKey)
    if (!lane) {
      // 超出最大泳道数时拒绝新泳道
      if (this.lanes.size >= this.maxLanes) {
        reject(new Error(`Lane limit reached: ${this.maxLanes}`))
        return
      }
      lane = { queue: [], running: false }
      this.lanes.set(laneKey, lane)
    }
    lane.queue.push({ task, resolve, reject })
    if (!lane.running) this.drain(laneKey)
  })
}
```

### 3.3 排空逻辑

```typescript
private async drain(laneKey: string) {
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
  this.lanes.delete(laneKey) // 空泳道及时清理，防止内存泄漏
}
```

### 3.4 监控接口

```typescript
// 获取当前各泳道队列深度，用于 Dashboard 展示
stats(): Record<string, number> {
  const result: Record<string, number> = {}
  for (const [key, lane] of this.lanes) {
    result[key] = lane.queue.length + (lane.running ? 1 : 0)
  }
  return result
}

// 获取活跃泳道数
activeLanes(): number {
  return this.lanes.size
}
```

### 3.5 超时保护

防止单个任务卡死整条泳道：

```typescript
// 包装 task，超时后 reject
function withTimeout<T>(task: Task<T>, ms: number): Task<T> {
  return () => Promise.race([
    task(),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`Task timeout after ${ms}ms`)), ms)
    )
  ])
}
```

在 `enqueue` 时自动包装：

```typescript
enqueue<T>(laneKey: string, task: Task<T>, timeoutMs = 300_000): Promise<T> {
  return this._enqueue(laneKey, withTimeout(task, timeoutMs))
}
```

### 3.6 在 Dispatcher 中使用

```typescript
// src/dispatcher.ts
const queue = new LaneQueue(100)

async function handleMessage(msg: IncomingMessage) {
  return queue.enqueue(msg.userId, () => processMessage(msg))
}
```

### 3.7 单元测试要点

- 同一 laneKey 的任务按顺序执行
- 不同 laneKey 的任务并行执行（用时间戳验证）
- 超出 maxLanes 时正确拒绝
- 任务抛出异常不影响后续任务
- 超时任务正确 reject，泳道继续运行

## 验收标准

- 同用户消息不乱序
- 不同用户互不阻塞
- 空泳道自动清理，无内存泄漏
- 超时任务不卡死泳道
