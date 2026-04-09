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
  private summaryModel: string
  private summaryTimeout: number

  constructor(
    private config: FriClawConfig['memory'],
    agentConfig?: { summaryModel?: string; summaryTimeout?: number }
  ) {
    this.summaryModel = agentConfig?.summaryModel ?? 'claude-haiku-4-5'
    this.summaryTimeout = (agentConfig?.summaryTimeout ?? 300) * 1000 // 转换为毫秒
  }

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

  /**
   * 生成会话摘要并保存到 episodes
   */
  async summarizeSession(
    conversationId: string,
    workspacesDir: string
  ): Promise<string | null> {
    return this.episode.summarizeSession(
      conversationId,
      workspacesDir,
      this.summaryModel,
      this.summaryTimeout
    )
  }

  async shutdown(): Promise<void> {
    this.db?.close()
    log.info('Memory system shutdown')
  }
}
