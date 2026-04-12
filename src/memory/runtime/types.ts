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
}

export interface MemoryContextBundle {
  knowledge: RetrievedKnowledge[]
  episode?: RetrievedEpisode
  promptBlock: string
}
