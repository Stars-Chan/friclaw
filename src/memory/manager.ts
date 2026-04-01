import { mkdirSync } from 'fs'
import { join } from 'path'
import type { Database } from 'bun:sqlite'
import type { FriClawConfig } from '../config'
import { logger } from '../utils/logger'
import { initDatabase, search, type SearchResult } from './database'
import { IdentityMemory } from './identity'
import { KnowledgeMemory } from './knowledge'
import { EpisodeMemory } from './episode'

const log = logger('memory')

export class MemoryManager {
  identity!: IdentityMemory
  knowledge!: KnowledgeMemory
  episode!: EpisodeMemory
  private db!: Database

  constructor(private config: FriClawConfig['memory']) {}

  async init(): Promise<void> {
    const { dir } = this.config
    mkdirSync(join(dir, 'knowledge'), { recursive: true })
    mkdirSync(join(dir, 'episodes'), { recursive: true })

    this.db = initDatabase(join(dir, 'index.sqlite'))
    this.identity = new IdentityMemory(this.db, dir)
    this.knowledge = new KnowledgeMemory(this.db, dir)
    this.episode = new EpisodeMemory(this.db, dir)

    log.info({ dir }, 'Memory system initialized')
  }

  search(query: string, category?: string): SearchResult[] {
    return search(this.db, query, category, this.config.searchLimit)
  }

  async shutdown(): Promise<void> {
    this.db?.close()
    log.info('Memory system shutdown')
  }
}
