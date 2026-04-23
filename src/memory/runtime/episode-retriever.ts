import type { SearchResult } from '../database'
import type { Episode } from '../episode'
import type { EpisodeThreadState } from '../types'
import type {
  EpisodeRetrievalResult,
  RequestContext,
  RetrievalCandidateDiagnostic,
  RetrievalScoreReason,
  RetrievedEpisode,
  RuntimeSessionContext,
} from './types'

function stripFrontmatter(content: string): string {
  return content.replace(/^---[\s\S]*?---\n\n?/, '').trim()
}

function trimContent(content: string, maxLength = 700): string {
  const normalized = stripFrontmatter(content).replace(/\s+/g, ' ').trim()
  if (normalized.length <= maxLength) return normalized
  return `${normalized.slice(0, maxLength - 1)}…`
}

function parseTags(tags: string): string[] {
  return tags.split(',').map(tag => tag.trim()).filter(Boolean)
}

function addReason(reasons: RetrievalScoreReason[], label: string, points: number): void {
  if (points === 0) return
  reasons.push({ label, points })
}

function scoreSearchResult(result: SearchResult, request: RequestContext, keyword: string): { score: number; reasons: RetrievalScoreReason[] } {
  let score = 1
  const reasons: RetrievalScoreReason[] = [{ label: 'base_match', points: 1 }]
  if (request.intent === 'continue') {
    score += 2
    addReason(reasons, 'intent_continue', 2)
  }
  if (result.title.toLowerCase().includes(keyword.toLowerCase())) {
    score += 2
    addReason(reasons, `title_match:${keyword}`, 2)
  }
  if (result.content.toLowerCase().includes(keyword.toLowerCase())) {
    score += 1
    addReason(reasons, `content_match:${keyword}`, 1)
  }
  for (const entity of request.entities) {
    if (result.title.includes(entity) || result.content.includes(entity)) {
      score += 2
      addReason(reasons, `entity_match:${entity}`, 2)
    }
  }
  return { score, reasons }
}

function scoreRecentEpisode(episode: Episode, request: RequestContext): { score: number; reasons: RetrievalScoreReason[] } {
  let score = request.intent === 'continue' ? 2 : 0
  const reasons: RetrievalScoreReason[] = request.intent === 'continue'
    ? [{ label: 'intent_continue', points: 2 }]
    : []

  for (const keyword of request.keywords) {
    if (episode.summary.includes(keyword)) {
      score += 1
      addReason(reasons, `summary_match:${keyword}`, 1)
    }
    if (episode.tags.includes(keyword)) {
      score += 2
      addReason(reasons, `tag_match:${keyword}`, 2)
    }
    if (episode.nextStep?.includes(keyword)) {
      score += 2
      addReason(reasons, `next_step_match:${keyword}`, 2)
    }
  }

  for (const entity of request.entities) {
    if (episode.summary.includes(entity) || episode.tags.includes(entity)) {
      score += 2
      addReason(reasons, `entity_match:${entity}`, 2)
    }
    if (episode.nextStep?.includes(entity)) {
      score += 2
      addReason(reasons, `next_step_entity:${entity}`, 2)
    }
  }

  if ((episode.blockers?.length ?? 0) > 0) {
    score += 1
    addReason(reasons, 'has_blockers_context', 1)
  }

  if (episode.nextStep) {
    score += 1
    addReason(reasons, 'has_next_step', 1)
  }

  return { score, reasons }
}

function scoreThreadAffinity(
  episode: Episode,
  request: RequestContext,
  runtime?: RuntimeSessionContext,
  threadState?: EpisodeThreadState | null
): { score: number; reasons: RetrievalScoreReason[] } {
  let score = 0
  const reasons: RetrievalScoreReason[] = []

  if (runtime?.activeThreadId && episode.threadId === runtime.activeThreadId) {
    score += 10
    addReason(reasons, 'same_active_thread', 10)
  }

  const runtimeChatKey = runtime ? `${runtime.platform}:${runtime.chatId}` : undefined
  if (runtimeChatKey && threadState?.chatKey === runtimeChatKey) {
    score += 4
    addReason(reasons, 'same_chat', 4)
  }

  if (threadState?.status === 'active') {
    score += 3
    addReason(reasons, 'thread_active', 3)
  } else if (threadState?.status === 'dormant') {
    score += 1
    addReason(reasons, 'thread_dormant', 1)
  } else if (threadState?.status === 'archived') {
    score -= 2
    addReason(reasons, 'thread_archived', -2)
  }

  return { score, reasons }
}

function mergeReasons(existing: RetrievalScoreReason[] | undefined, incoming: RetrievalScoreReason[]): RetrievalScoreReason[] {
  return [...(existing ?? []), ...incoming]
}

function toRetrievedEpisode(id: string, episode: Episode, score: number, reasons: RetrievalScoreReason[] = []): RetrievedEpisode {
  return {
    id,
    title: episode.id,
    summary: trimContent(episode.summary),
    tags: episode.tags,
    score,
    threadId: episode.threadId,
    status: episode.status,
    nextStep: episode.nextStep,
    blockers: episode.blockers,
    reasons,
  }
}

function toDiagnostic(item: RetrievedEpisode): RetrievalCandidateDiagnostic {
  return {
    id: item.id,
    title: item.title,
    score: item.score,
    threadId: item.threadId,
    status: item.status,
    reasons: (item.reasons ?? []).map(reason => `${reason.label}:${reason.points}`),
  }
}

export function retrieveEpisode(
  memory: {
    search(query: string, category?: string): SearchResult[]
    episode: {
      recent(limit?: number): Episode[]
      listThreadEpisodes(threadId: string, limit?: number): Episode[]
      readThreadState?(threadId: string): EpisodeThreadState | null
    }
  },
  request: RequestContext,
  runtime?: RuntimeSessionContext,
  options?: { recentLimit?: number; threadEpisodeLimit?: number; maxChars?: number }
): EpisodeRetrievalResult {
  const ranked = new Map<string, RetrievedEpisode>()
  const queries = request.keywords.length > 0 ? request.keywords : [request.rawText]
  const recentLimit = options?.recentLimit ?? 5
  const threadEpisodeLimit = options?.threadEpisodeLimit ?? 3
  const maxChars = options?.maxChars ?? 700

  if (runtime?.activeThreadId) {
    const threadEpisodes = memory.episode.listThreadEpisodes(runtime.activeThreadId, threadEpisodeLimit)
    const threadState = memory.episode.readThreadState?.(runtime.activeThreadId) ?? null
    for (const episode of threadEpisodes) {
      const affinity = scoreThreadAffinity(episode, request, runtime, threadState)
      const topical = scoreRecentEpisode(episode, request)
      const score = affinity.score + topical.score
      const id = `episode/${episode.id}`
      ranked.set(id, {
        ...toRetrievedEpisode(id, {
          ...episode,
          summary: trimContent(episode.summary, maxChars),
        }, score, [...affinity.reasons, ...topical.reasons]),
      })
    }
  }

  for (const query of queries) {
    const results = memory.search(query, 'episode')
    for (const result of results) {
      const scored = scoreSearchResult(result, request, query)
      const existing = ranked.get(result.id)
      ranked.set(result.id, {
        id: result.id,
        title: result.title,
        summary: trimContent(result.content, maxChars),
        tags: parseTags(result.tags),
        score: (existing?.score ?? 0) + scored.score,
        threadId: existing?.threadId,
        status: existing?.status,
        nextStep: existing?.nextStep,
        blockers: existing?.blockers,
        reasons: mergeReasons(existing?.reasons, scored.reasons),
      })
    }
  }

  for (const episode of memory.episode.recent(recentLimit)) {
    const topical = scoreRecentEpisode(episode, request)
    const threadState = episode.threadId ? memory.episode.readThreadState?.(episode.threadId) ?? null : null
    const affinity = scoreThreadAffinity(episode, request, runtime, threadState)
    const score = topical.score + affinity.score
    if (score <= 0) continue
    const id = `episode/${episode.id}`
    const existing = ranked.get(id)
    ranked.set(id, toRetrievedEpisode(
      id,
      {
        ...episode,
        summary: trimContent(episode.summary, maxChars),
      },
      Math.max(existing?.score ?? 0, score),
      mergeReasons(existing?.reasons, [...affinity.reasons, ...topical.reasons]),
    ))
  }

  const candidates = Array.from(ranked.values()).sort((a, b) => b.score - a.score)
  const item = candidates.at(0)

  return {
    item,
    diagnostics: {
      queries,
      considered: ranked.size,
      selectedIds: item ? [item.id] : [],
      clipped: candidates.length > (item ? 1 : 0),
      candidates: candidates.slice(0, 5).map(toDiagnostic),
    },
  }
}
