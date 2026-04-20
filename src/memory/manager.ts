import { mkdirSync } from 'fs'
import { join } from 'path'
import type { Database } from 'bun:sqlite'
import type { FriClawConfig } from '../config'
import { logger } from '../utils/logger'
import { LaneQueue } from '../utils/lane-queue'
import { initDatabase, search, type SearchResult } from './database'
import { IdentityMemory } from './identity'
import { KnowledgeMemory } from './knowledge'
import { EpisodeMemory } from './episode'
import { analyzeRequest } from './runtime/request-analyzer'
import { retrieveKnowledge } from './runtime/knowledge-retriever'
import { retrieveEpisode } from './runtime/episode-retriever'
import { assembleMemoryContext } from './runtime/context-assembler'
import type { MemoryContextBundle, RuntimeSessionContext } from './runtime/types'
import type {
  PromotionCandidate,
  EpisodeThreadStatus,
  EpisodeSummaryMode,
  ThreadLifecycleState,
  KnowledgeLifecycleState,
  AuditRecord,
  LineageLink,
  PromotionCandidateStatus,
} from './types'

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

export interface BackgroundSummaryInput {
  sessionId: string
  workspaceDir: string
  threadId?: string
  chatKey: string
}

export interface SharedMemoryModels {
  threadLifecycleStates: ThreadLifecycleState[]
  knowledgeLifecycleStates: KnowledgeLifecycleState[]
  promotionCandidateStatuses: PromotionCandidateStatus[]
}

const SHARED_MEMORY_MODELS: SharedMemoryModels = {
  threadLifecycleStates: ['active', 'dormant', 'closed', 'archived'],
  knowledgeLifecycleStates: ['active', 'uncertain', 'archived'],
  promotionCandidateStatuses: ['proposed', 'approved', 'rejected', 'merged', 'applied', 'deferred'],
}

const IDENTITY_PROMOTION_ALLOWLIST = new Set(['profile', 'preference', 'personality', 'communication'])
const IDENTITY_PROMOTION_DENYLIST = new Set(['task', 'project', 'session', 'incident', 'temporary'])

function canPromoteKnowledgeToIdentity(record: { metadata: { status?: string; confidence?: string; domain?: string; tags?: string[] } }): boolean {
  if (record.metadata.confidence !== 'high' || record.metadata.status !== 'active') return false

  const tags = new Set(record.metadata.tags ?? [])
  const domain = record.metadata.domain?.toLowerCase()
  const matchesAllowlist = (domain && IDENTITY_PROMOTION_ALLOWLIST.has(domain))
    || Array.from(tags).some(tag => IDENTITY_PROMOTION_ALLOWLIST.has(tag.toLowerCase()))
  if (!matchesAllowlist) return false

  const matchesDenylist = (domain && IDENTITY_PROMOTION_DENYLIST.has(domain))
    || Array.from(tags).some(tag => IDENTITY_PROMOTION_DENYLIST.has(tag.toLowerCase()))
  return !matchesDenylist
}

export class MemoryManager {
  identity!: IdentityMemory
  knowledge!: KnowledgeMemory
  episode!: EpisodeMemory
  private db!: Database
  private summaryModel: string
  private summaryTimeout: number
  private summaryQueue = new LaneQueue()

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

  getSharedMemoryModels(): SharedMemoryModels {
    return SHARED_MEMORY_MODELS
  }

  createLineageLink(input: Omit<LineageLink, 'createdAt'>): LineageLink {
    return {
      ...input,
      createdAt: new Date().toISOString(),
    }
  }

  createAuditRecord(input: Omit<AuditRecord, 'timestamp'>): AuditRecord {
    return {
      ...input,
      timestamp: new Date().toISOString(),
    }
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
        if (canPromoteKnowledgeToIdentity(record)) {
          const candidate = this.knowledge.saveIdentityCandidate({
            sourceCategory: 'knowledge',
            sourceId: record.id,
            targetCategory: 'identity',
            reason: 'High-confidence active knowledge may be suitable for identity promotion later.',
            title: record.metadata.title,
            content: record.content,
            tags: record.metadata.tags,
            entities: record.metadata.entities,
            confidence: record.metadata.confidence,
            status: 'proposed',
            lineage: [this.createLineageLink({
              fromLayer: 'knowledge',
              fromId: record.id,
              toLayer: 'identity',
              toId: record.id,
              relationType: 'derived_from',
            })],
            auditTrail: [this.createAuditRecord({
              actionType: 'candidate_created',
              targetLayer: 'identity',
              targetId: record.id,
              sourceRefs: [{ layer: 'knowledge', id: record.id }],
              rationale: 'Generated from active high-confidence knowledge.',
            })],
          })
          candidates.push(candidate)
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
          status: 'proposed',
          lineage: [this.createLineageLink({
            fromLayer: 'episode',
            fromId: episode.id,
            toLayer: 'knowledge',
            toId: episode.id,
            relationType: 'promoted_from',
          })],
          auditTrail: [this.createAuditRecord({
            actionType: 'candidate_created',
            targetLayer: 'knowledge',
            targetId: episode.id,
            sourceRefs: [{ layer: 'episode', id: episode.id }],
            rationale: 'Generated from episode summary with durable continuation context.',
          })],
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

  reviewIdentityCandidate(id: string, input: {
    decision: 'approve' | 'reject' | 'defer'
    reviewer?: string
    rationale?: string
  }): PromotionCandidate | null {
    const candidate = this.knowledge.readIdentityCandidate(id)
    if (!candidate) return null

    const auditTrail = [
      ...(candidate.auditTrail ?? []),
      this.createAuditRecord({
        actionType: input.decision === 'approve' ? 'candidate_applied' : 'candidate_reviewed',
        targetLayer: 'identity',
        targetId: candidate.sourceId,
        sourceRefs: [{ layer: 'knowledge', id: candidate.sourceId }],
        decision: input.decision,
        rationale: input.rationale,
      }),
    ]

    const reviewed = this.knowledge.reviewIdentityCandidate(id, {
      decision: input.decision,
      reviewer: input.reviewer,
      rationale: input.rationale,
      applied: input.decision === 'approve',
      appliedTargetId: input.decision === 'approve' ? 'SOUL' : undefined,
      auditTrail,
    })
    if (!reviewed) return null

    if (input.decision === 'approve') {
      this.identity.applyCandidate(reviewed, reviewed.review, auditTrail)
      return this.knowledge.reviewIdentityCandidate(id, {
        decision: 'approve',
        reviewer: input.reviewer,
        rationale: input.rationale,
        applied: true,
        appliedTargetId: 'SOUL',
        auditTrail,
      })
    }

    return reviewed
  }

  rollbackIdentity(): ReturnType<IdentityMemory['rollbackLatest']> {
    return this.identity.rollbackLatest([
      this.createAuditRecord({
        actionType: 'identity_rolled_back',
        targetLayer: 'identity',
        targetId: 'SOUL',
        sourceRefs: [],
        rationale: 'Rollback to latest stable identity version.',
      }),
    ])
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

  startBackgroundSummary(input: BackgroundSummaryInput): void {
    const laneKey = input.threadId || input.sessionId
    this.summaryQueue.enqueue(laneKey, async () => {
      const result = await this.summarizeSession(input.sessionId, input.workspaceDir, {
        threadId: input.threadId,
        chatKey: input.chatKey,
        status: 'closed',
      })

      if (input.threadId && result?.mode === 'summary') {
        this.closeThread(input.threadId)
      }
    }).catch(error => {
      log.warn({ sessionId: input.sessionId, threadId: input.threadId, error }, 'Failed to summarize session in background')
    })
  }

  async drainBackgroundSummaries(): Promise<void> {
    while (this.summaryQueue.activeLanes() > 0) {
      await new Promise(resolve => setTimeout(resolve, 10))
    }
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
