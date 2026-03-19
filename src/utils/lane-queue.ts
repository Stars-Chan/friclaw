// src/utils/lane-queue.ts
export class LaneQueue {
  private queue: Array<() => Promise<void>> = []
  private running = false

  async enqueue<T>(task: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.queue.push(async () => {
        try {
          resolve(await task())
        } catch (err) {
          reject(err)
        }
      })
      this.drain()
    })
  }

  private async drain(): Promise<void> {
    if (this.running) return
    this.running = true
    while (this.queue.length > 0) {
      const task = this.queue.shift()!
      await task()
    }
    this.running = false
  }

  get size(): number {
    return this.queue.length
  }
}
