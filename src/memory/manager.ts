import type { FriClawConfig } from '../config'
import { logger } from '../utils/logger'

export class MemoryManager {
  constructor(private config: FriClawConfig['memory']) {}

  async init(): Promise<void> {
    logger.info({ dir: this.config.dir }, 'Memory system initialized (stub)')
    // TODO: implement in module 04 (SQLite + FTS5)
  }

  async shutdown(): Promise<void> {
    logger.info('Memory system shutdown')
  }
}
