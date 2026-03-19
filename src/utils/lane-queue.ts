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

  stats(): Record<string, number> {
    const result: Record<string, number> = {}
    for (const [key, lane] of this.lanes) {
      result[key] = lane.queue.length + (lane.running ? 1 : 0)
    }
    return result
  }
}
