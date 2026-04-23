export type RequestIntent =
  | 'continue'
  | 'new_task'
  | 'question'
  | 'decision'
  | 'status_update'
  | 'unknown'

export interface RequestContext {
  rawText: string
  keywords: string[]
  entities: string[]
  intent: RequestIntent
}

export interface RuntimeSessionContext {
  sessionId: string
  platform: string
  chatId: string
  workspaceDir: string
  activeThreadId?: string
}

export interface RetrievalScoreReason {
  label: string
  points: number
}

export interface RetrievedKnowledge {
  id: string
  title: string
  content: string
  tags: string[]
  score: number
  domain?: string
  entities?: string[]
  status?: string
  confidence?: string
  source?: string
  reasons?: RetrievalScoreReason[]
}

export interface RetrievedEpisode {
  id: string
  title: string
  summary: string
  tags: string[]
  score: number
  threadId?: string
  status?: string
  nextStep?: string
  blockers?: string[]
  reasons?: RetrievalScoreReason[]
}

export interface RetrievalCandidateDiagnostic {
  id: string
  title: string
  score: number
  reasons: string[]
  threadId?: string
  status?: string
}

export interface RetrievalLayerDiagnostics {
  queries: string[]
  considered: number
  selectedIds: string[]
  clipped: boolean
  candidates: RetrievalCandidateDiagnostic[]
}

export interface RetrievalBudgetConfig {
  knowledgeItems: number
  knowledgeChars: number
  recentEpisodes: number
  threadEpisodes: number
  episodeChars: number
  promptChars: number
}

export interface RetrievalBudgetUsage {
  knowledgeItems: number
  knowledgeChars: number
  episodeChars: number
  promptChars: number
}

export interface RetrievalDiagnostics {
  requestIntent: RequestIntent
  keywords: string[]
  entities: string[]
  knowledge: RetrievalLayerDiagnostics
  episode: RetrievalLayerDiagnostics
  budget: {
    config: RetrievalBudgetConfig
    usage: RetrievalBudgetUsage
    clippedLayers: string[]
  }
}

export interface KnowledgeRetrievalResult {
  items: RetrievedKnowledge[]
  diagnostics: RetrievalLayerDiagnostics
}

export interface EpisodeRetrievalResult {
  item?: RetrievedEpisode
  diagnostics: RetrievalLayerDiagnostics
}

export interface MemoryContextBundle {
  knowledge: RetrievedKnowledge[]
  episode?: RetrievedEpisode
  promptBlock: string
  diagnostics?: RetrievalDiagnostics
}
