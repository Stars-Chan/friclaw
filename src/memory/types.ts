export type MemoryCategory = 'identity' | 'knowledge' | 'episode'
export type MemoryLayer = MemoryCategory

export type KnowledgeStatus = 'active' | 'uncertain' | 'archived'
export type KnowledgeLifecycleState = 'active' | 'uncertain' | 'archived'
export type ThreadLifecycleState = 'active' | 'dormant' | 'closed' | 'archived'
export type MemoryConfidence = 'low' | 'medium' | 'high'
export type EpisodeThreadStatus = 'active' | 'closed' | 'summary_failed'
export type ThreadStatusInput = ThreadLifecycleState | 'paused' | 'summary_failed'
export type EpisodeSummaryMode = 'summary' | 'fallback'
export type PromotionSourceCategory = 'episode' | 'knowledge'
export type PromotionTargetCategory = 'knowledge' | 'identity'
export type PromotionCandidateStatus = 'proposed' | 'approved' | 'rejected' | 'merged' | 'applied' | 'deferred'
export type MemoryReviewDecision = 'approve' | 'reject' | 'defer' | 'merge'
export type MemoryLineageRelation = 'promoted_from' | 'merged_from' | 'derived_from'
export type MemoryAuditAction = 'candidate_created' | 'candidate_reviewed' | 'candidate_applied' | 'identity_rolled_back' | 'knowledge_merged'

export interface KnowledgeMergeResult {
  targetId: string
  mergedSourceIds: string[]
  lineage: LineageLink[]
  auditTrail: AuditRecord[]
}

export interface KnowledgeMetadata {
  title: string
  date: string
  updatedAt?: string
  tags: string[]
  domain?: string
  entities?: string[]
  status?: KnowledgeStatus
  confidence?: MemoryConfidence
  source?: string
}

export interface KnowledgeRecord {
  id: string
  metadata: KnowledgeMetadata
  content: string
}

export interface KnowledgeSummary {
  id: string
  title: string
  tags: string[]
  domain?: string
  status?: KnowledgeLifecycleState
  confidence?: MemoryConfidence
  updatedAt?: string
}

export interface EpisodeMetadata {
  title: string
  date: string
  updatedAt?: string
  tags: string[]
  threadId?: string
  chatKey?: string
  status?: EpisodeThreadStatus
  sourceSessionId?: string
  sourceWorkspaceDir?: string
  nextStep?: string
  blockers?: string[]
}

export interface EpisodeRecord {
  id: string
  metadata: EpisodeMetadata
  summary: string
}

export interface EpisodeThreadState {
  threadId: string
  chatKey: string
  status: ThreadLifecycleState
  startedAt: string
  updatedAt: string
  sourceSessionId?: string
  sourceWorkspaceDir?: string
  lastSummaryId?: string
  title?: string
  nextStep?: string
  blockers?: string[]
}

export interface ThreadPreview {
  threadId: string
  chatKey: string
  status: string
  startedAt: string
  updatedAt: string
  title?: string
  lastSummaryId?: string
  nextStep?: string
  blockers?: string[]
  summaryPreview?: string
}

export interface LineageLink {
  fromLayer: MemoryLayer
  fromId: string
  toLayer: MemoryLayer
  toId: string
  relationType: MemoryLineageRelation
  createdAt: string
}

export interface PromotionReview {
  decision: MemoryReviewDecision
  reviewer?: string
  reviewedAt?: string
  rationale?: string
}

export interface AuditRecord {
  actionType: MemoryAuditAction
  actor?: string
  targetLayer: MemoryLayer
  targetId: string
  sourceRefs: Array<{ layer: MemoryLayer; id: string }>
  decision?: MemoryReviewDecision
  rationale?: string
  timestamp: string
}

export interface PromotionCandidate {
  id?: string
  sourceCategory: PromotionSourceCategory
  sourceId: string
  targetCategory: PromotionTargetCategory
  reason: string
  title: string
  content: string
  tags: string[]
  entities?: string[]
  confidence?: MemoryConfidence
  status?: PromotionCandidateStatus
  review?: PromotionReview
  lineage?: LineageLink[]
  auditTrail?: AuditRecord[]
  applied?: boolean
  appliedTargetId?: string
  createdAt?: string
  updatedAt?: string
}

export interface IdentityVersionRecord {
  id: string
  createdAt: string
  source: 'manual_update' | 'candidate_apply' | 'rollback'
  content: string
  beforeContent?: string
  afterContent?: string
  candidateId?: string
  review?: PromotionReview
  auditTrail?: AuditRecord[]
}

export interface ProactiveQuietHours {
  start: number
  end: number
}

export interface ProactivePreference {
  enabled: boolean
  remindersEnabled: boolean
  dailySummaryEnabled: boolean
  patternSuggestionsEnabled: boolean
  reminderIntervalMinutes: number
  dailySummaryHour: number
  quietHours?: ProactiveQuietHours
}

export interface ProactiveInsight {
  id: string
  kind: 'reminder' | 'daily_summary' | 'pattern'
  title: string
  content: string
  userId: string
  createdAt: string
  sourceThreadIds?: string[]
  sourceCandidateIds?: string[]
  metadata?: Record<string, string | number | boolean | string[]>
}
