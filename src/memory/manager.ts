import { mkdirSync } from 'fs'
import { join } from 'path'
import type { Database } from 'bun:sqlite'
import type { FriClawConfig } from '../config'
import { logger } from '../utils/logger'
import { initDatabase, search, type SearchResult } from './database'
import { IdentityMemory } from './identity'
import { KnowledgeMemory } from './knowledge'
import { EpisodeMemory } from './episode'
import { analyzeRequest } from './runtime/request-analyzer'
import { retrieveKnowledge } from './runtime/knowledge-retriever'
import { retrieveEpisode } from './runtime/episode-retriever'
import { assembleMemoryContext } from './runtime/context-assembler'
import type { MemoryContextBundle, RuntimeSessionContext } from './runtime/types'
import type { PromotionCandidate, EpisodeThreadStatus, EpisodeSummaryMode } from './types'

const log = logger('memory')

interface ThreadSummaryOptions {
  threadId?: string
  chatKey?: string
  status?: EpisodeThreadStatus
  nextStep?: string
  blockers?: string[]
}

export interface ThreadSummaryResult {
  id: string
  mode: EpisodeSummaryMode
}

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
    this.summaryTimeout = (agentConfig?.summaryTimeout ?? 300) * 1000
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

  ensureThread(session: RuntimeSessionContext): string {
    if (session.activeThreadId) return session.activeThreadId
    const thread = this.episode.createThread({
      platform: session.platform,
      chatId: session.chatId,
      sessionId: session.sessionId,
      workspaceDir: session.workspaceDir,
    })
    return thread.threadId
  }

  buildRuntimeContext(input: string | { messageText: string; session: RuntimeSessionContext }): MemoryContextBundle {
    const payload = typeof input === 'string'
      ? { messageText: input, session: undefined }
      : input

    if (!payload.messageText.trim()) {
      return { knowledge: [], promptBlock: '' }
    }

    const request = analyzeRequest(payload.messageText)
    const knowledge = retrieveKnowledge(this, request, 3)
    const episode = retrieveEpisode(this, request, payload.session)
    return assembleMemoryContext({ knowledge, episode })
  }

  collectPromotionCandidates(recentEpisodeIds?: string[]): PromotionCandidate[] {
    const candidates: PromotionCandidate[] = []

    if (!recentEpisodeIds || recentEpisodeIds.length === 0) {
      for (const record of this.knowledge.listRecords()) {
        if (record.metadata.confidence === 'high' && record.metadata.status === 'active') {
          candidates.push({
            sourceCategory: 'knowledge',
            sourceId: record.id,
            targetCategory: 'identity',
            reason: 'High-confidence active knowledge may be suitable for identity promotion later.',
            title: record.metadata.title,
            content: record.content,
            tags: record.metadata.tags,
            entities: record.metadata.entities,
            confidence: record.metadata.confidence,
          })
        }
      }
    }

    const episodes = recentEpisodeIds && recentEpisodeIds.length > 0
      ? recentEpisodeIds.map(id => this.episode.read(id)).filter(Boolean)
      : this.episode.recent(10)

    for (const episode of episodes) {
      if (!episode) continue
      if (episode.nextStep || (episode.blockers?.length ?? 0) > 0) {
        candidates.push({
          sourceCategory: 'episode',
          sourceId: episode.id,
          targetCategory: 'knowledge',
          reason: 'Episode contains durable next-step or blocker context.',
          title: episode.id,
          content: [episode.summary, episode.nextStep ? `Next step: ${episode.nextStep}` : '', (episode.blockers?.length ?? 0) > 0 ? `Blockers: ${episode.blockers?.join(', ')}` : '']
            .filter(Boolean)
            .join('\n\n'),
          tags: Array.from(new Set([...episode.tags, 'promoted-from-episode'])),
          confidence: 'medium',
        })
      }
    }

    return candidates
  }

  applyPromotionCandidates(candidates?: PromotionCandidate[]): PromotionCandidate[] {
    const resolvedCandidates = candidates ?? this.collectPromotionCandidates()
    const pending = resolvedCandidates.filter(candidate => candidate.targetCategory === 'knowledge' && !candidate.applied)

    for (const candidate of pending) {
      const targetId = this.knowledge.savePromotion({
        title: candidate.title,
        content: candidate.content,
        tags: candidate.tags,
        entities: candidate.entities,
        source: `promotion:${candidate.sourceCategory}/${candidate.sourceId}`,
        confidence: candidate.confidence,
      })
      candidate.applied = true
      candidate.appliedTargetId = targetId
    }

    return resolvedCandidates
  }

  async summarizeSession(
    conversationId: string,
    workspaceDir: string,
    options?: ThreadSummaryOptions
  ): Promise<ThreadSummaryResult | null> {
    const result = await this.episode.summarizeSession(
      conversationId,
      workspaceDir,
      this.summaryModel,
      this.summaryTimeout,
      options,
    )

    if (result?.mode === 'summary') {
      this.applyPromotionCandidates(this.collectPromotionCandidates([result.id]))
    }

    return result
  }

  private updateThreadStatus(status: EpisodeThreadStatus, threadId: string, patch?: { nextStep?: string; blockers?: string[] }): void {
    this.episode.updateThreadState(threadId, {
      status,
      nextStep: patch?.nextStep,
      blockers: patch?.blockers,
      updatedAt: new Date().toISOString(),
    })
  }

  closeThread(threadId: string, patch?: { nextStep?: string; blockers?: string[] }): void {
    this.updateThreadStatus('closed', threadId, patch)
  }

  pauseThread(threadId: string, patch?: { nextStep?: string; blockers?: string[] }): void {
    this.updateThreadStatus('paused', threadId, patch)
  }

  async shutdown(): Promise<void> {
    this.db?.close()
    log.info('Memory system shutdown')
  }
}
