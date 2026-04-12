import type { SearchResult } from '../database'
import type { KnowledgeRecord } from '../types'
import type { RetrievedKnowledge, RequestContext } from './types'

function stripFrontmatter(content: string): string {
  return content.replace(/^---[\s\S]*?---\n\n?/, '').trim()
}

function trimContent(content: string, maxLength = 500): string {
  const normalized = stripFrontmatter(content).replace(/\s+/g, ' ').trim()
  if (normalized.length <= maxLength) return normalized
  return `${normalized.slice(0, maxLength - 1)}…`
}

function parseTags(tags: string): string[] {
  return tags.split(',').map(tag => tag.trim()).filter(Boolean)
}

function scoreResult(result: SearchResult, request: RequestContext, keyword: string, record?: KnowledgeRecord | null): number {
  let score = 1
  const lowerTitle = result.title.toLowerCase()
  const lowerContent = result.content.toLowerCase()
  const lowerKeyword = keyword.toLowerCase()

  if (lowerTitle.includes(lowerKeyword)) score += 3
  if (lowerContent.includes(lowerKeyword)) score += 1

  const tags = parseTags(result.tags)
  for (const entity of request.entities) {
    if (result.title.includes(entity)) score += 2
    if (tags.includes(entity)) score += 2
    if (result.content.includes(entity)) score += 1
    if (record?.metadata.entities?.includes(entity)) score += 3
  }

  if (record?.metadata.status === 'active') score += 2
  if (record?.metadata.confidence === 'high') score += 2
  if (record?.metadata.domain && request.keywords.some(keyword => record.metadata.domain?.includes(keyword))) score += 1

  return score
}

export function retrieveKnowledge(
  memory: {
    search(query: string, category?: string): SearchResult[]
    knowledge?: { readRecord(topic: string): KnowledgeRecord | null }
  },
  request: RequestContext,
  limit = 3
): RetrievedKnowledge[] {
  const ranked = new Map<string, RetrievedKnowledge>()
  const queries = request.keywords.length > 0 ? request.keywords : [request.rawText]

  for (const query of queries) {
    const results = memory.search(query, 'knowledge')
    for (const result of results) {
      const topic = result.id.replace(/^knowledge\//, '')
      const record = memory.knowledge?.readRecord(topic) ?? null
      const score = scoreResult(result, request, query, record)
      const existing = ranked.get(result.id)
      const candidate: RetrievedKnowledge = {
        id: result.id,
        title: record?.metadata.title ?? result.title,
        content: trimContent(record?.content ?? result.content),
        tags: record?.metadata.tags ?? parseTags(result.tags),
        score: (existing?.score ?? 0) + score,
        domain: record?.metadata.domain,
        entities: record?.metadata.entities,
        status: record?.metadata.status,
        confidence: record?.metadata.confidence,
        source: record?.metadata.source,
      }
      ranked.set(result.id, candidate)
    }
  }

  return Array.from(ranked.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
}
