// src/dispatcher.ts
import type { FriClawConfig } from './config'
import type { MemoryManager } from './memory/manager'
import { logger } from './utils/logger'

export class Dispatcher {
  private accepting = true

  constructor(
    private config: FriClawConfig,
    private memory: MemoryManager,
  ) {}

  async start(): Promise<void> {
    logger.info('Dispatcher started (stub)')
    // TODO: implement in module 05 (gateway + session + agent)
  }

  stopAccepting(): void {
    this.accepting = false
    logger.info('Dispatcher stopped accepting new messages')
  }

  async drainQueues(): Promise<void> {
    // TODO: wait for all LaneQueues to drain
    logger.info('Lane queues drained (stub)')
  }

  async shutdown(): Promise<void> {
    this.stopAccepting()
    await this.drainQueues()
    await this.memory.shutdown()
    logger.info('Dispatcher shutdown complete')
  }
}
