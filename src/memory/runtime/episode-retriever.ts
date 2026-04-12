import type { SearchResult } from '../database'
import type { Episode } from '../episode'
import type { RuntimeSessionContext, RequestContext, RetrievedEpisode } from './types'

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

function scoreSearchResult(result: SearchResult, request: RequestContext, keyword: string): number {
  let score = 1
  if (request.intent === 'continue') score += 2
  if (result.title.toLowerCase().includes(keyword.toLowerCase())) score += 2
  if (result.content.toLowerCase().includes(keyword.toLowerCase())) score += 1
  for (const entity of request.entities) {
    if (result.title.includes(entity) || result.content.includes(entity)) score += 2
  }
  return score
}

function scoreRecentEpisode(episode: Episode, request: RequestContext): number {
  let score = request.intent === 'continue' ? 2 : 0
  for (const keyword of request.keywords) {
    if (episode.summary.includes(keyword)) score += 1
    if (episode.tags.includes(keyword)) score += 2
  }
  for (const entity of request.entities) {
    if (episode.summary.includes(entity) || episode.tags.includes(entity)) score += 2
  }
  return score
}

function toRetrievedEpisode(id: string, episode: Episode, score: number): RetrievedEpisode {
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
  }
}

export function retrieveEpisode(
  memory: {
    search(query: string, category?: string): SearchResult[]
    episode: {
      recent(limit?: number): Episode[]
      listThreadEpisodes(threadId: string, limit?: number): Episode[]
    }
  },
  request: RequestContext,
  runtime?: RuntimeSessionContext
): RetrievedEpisode | undefined {
  const ranked = new Map<string, RetrievedEpisode>()
  const queries = request.keywords.length > 0 ? request.keywords : [request.rawText]

  if (runtime?.activeThreadId) {
    const threadEpisodes = memory.episode.listThreadEpisodes(runtime.activeThreadId, 3)
    for (const episode of threadEpisodes) {
      const score = 10 + scoreRecentEpisode(episode, request)
      const id = `episode/${episode.id}`
      ranked.set(id, toRetrievedEpisode(id, episode, score))
    }
  }

  for (const query of queries) {
    const results = memory.search(query, 'episode')
    for (const result of results) {
      const score = scoreSearchResult(result, request, query)
      const existing = ranked.get(result.id)
      ranked.set(result.id, {
        id: result.id,
        title: result.title,
        summary: trimContent(result.content),
        tags: parseTags(result.tags),
        score: (existing?.score ?? 0) + score,
      })
    }
  }

  for (const episode of memory.episode.recent(5)) {
    const score = scoreRecentEpisode(episode, request)
    if (score <= 0) continue
    const id = `episode/${episode.id}`
    const existing = ranked.get(id)
    ranked.set(id, toRetrievedEpisode(id, episode, Math.max(existing?.score ?? 0, score)))
  }

  return Array.from(ranked.values())
    .sort((a, b) => b.score - a.score)
    .at(0)
}
