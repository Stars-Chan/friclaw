export type MemoryCategory = 'identity' | 'knowledge' | 'episode'

export type KnowledgeStatus = 'draft' | 'active' | 'deprecated'
export type MemoryConfidence = 'low' | 'medium' | 'high'
export type EpisodeThreadStatus = 'active' | 'paused' | 'closed'

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
  status: EpisodeThreadStatus
  startedAt: string
  updatedAt: string
  sourceSessionId?: string
  sourceWorkspaceDir?: string
  lastSummaryId?: string
  title?: string
  nextStep?: string
  blockers?: string[]
}

export interface PromotionCandidate {
  sourceCategory: 'episode' | 'knowledge'
  sourceId: string
  targetCategory: 'knowledge' | 'identity'
  reason: string
  title: string
  content: string
  tags: string[]
  entities?: string[]
  confidence?: MemoryConfidence
  applied?: boolean
  appliedTargetId?: string
}
