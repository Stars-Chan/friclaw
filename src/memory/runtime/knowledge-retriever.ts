import type { SearchResult } from '../database'
import type { KnowledgeRecord } from '../types'
import type {
  KnowledgeRetrievalResult,
  RequestContext,
  RetrievalCandidateDiagnostic,
  RetrievalScoreReason,
  RetrievedKnowledge,
} from './types'

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

function addReason(reasons: RetrievalScoreReason[], label: string, points: number): void {
  if (points === 0) return
  reasons.push({ label, points })
}

function scoreResult(result: SearchResult, request: RequestContext, keyword: string, record?: KnowledgeRecord | null): { score: number; reasons: RetrievalScoreReason[] } {
  let score = 1
  const reasons: RetrievalScoreReason[] = [{ label: 'base_match', points: 1 }]
  const lowerTitle = result.title.toLowerCase()
  const lowerContent = result.content.toLowerCase()
  const lowerKeyword = keyword.toLowerCase()

  if (lowerTitle.includes(lowerKeyword)) {
    score += 3
    addReason(reasons, `title_match:${keyword}`, 3)
  }
  if (lowerContent.includes(lowerKeyword)) {
    score += 1
    addReason(reasons, `content_match:${keyword}`, 1)
  }

  const tags = parseTags(result.tags)
  for (const entity of request.entities) {
    if (result.title.includes(entity)) {
      score += 2
      addReason(reasons, `entity_title:${entity}`, 2)
    }
    if (tags.includes(entity)) {
      score += 2
      addReason(reasons, `entity_tag:${entity}`, 2)
    }
    if (result.content.includes(entity)) {
      score += 1
      addReason(reasons, `entity_content:${entity}`, 1)
    }
    if (record?.metadata.entities?.includes(entity)) {
      score += 3
      addReason(reasons, `entity_metadata:${entity}`, 3)
    }
  }

  if (record?.metadata.status === 'active') {
    score += 2
    addReason(reasons, 'status_active', 2)
  }
  if (record?.metadata.status === 'uncertain') {
    score -= 1
    addReason(reasons, 'status_uncertain', -1)
  }
  if (record?.metadata.status === 'archived') {
    score -= 3
    addReason(reasons, 'status_archived', -3)
  }
  if (record?.metadata.confidence === 'high') {
    score += 2
    addReason(reasons, 'confidence_high', 2)
  }
  if (record?.metadata.confidence === 'low') {
    score -= 1
    addReason(reasons, 'confidence_low', -1)
  }
  if (record?.metadata.domain && request.keywords.some(keyword => record.metadata.domain?.includes(keyword))) {
    score += 1
    addReason(reasons, `domain_match:${record.metadata.domain}`, 1)
  }

  return { score, reasons }
}

function mergeReasons(existing: RetrievalScoreReason[] | undefined, incoming: RetrievalScoreReason[]): RetrievalScoreReason[] {
  return [...(existing ?? []), ...incoming]
}

function toDiagnostic(item: RetrievedKnowledge): RetrievalCandidateDiagnostic {
  return {
    id: item.id,
    title: item.title,
    score: item.score,
    status: item.status,
    reasons: (item.reasons ?? []).map(reason => `${reason.label}:${reason.points}`),
  }
}

export function retrieveKnowledge(
  memory: {
    search(query: string, category?: string): SearchResult[]
    knowledge?: { readRecord(topic: string): KnowledgeRecord | null }
  },
  request: RequestContext,
  limit = 3,
  maxChars = 500
): KnowledgeRetrievalResult {
  const ranked = new Map<string, RetrievedKnowledge>()
  const queries = request.keywords.length > 0 ? request.keywords : [request.rawText]

  for (const query of queries) {
    const results = memory.search(query, 'knowledge')
    for (const result of results) {
      const topic = result.id.replace(/^knowledge\//, '')
      const record = memory.knowledge?.readRecord(topic) ?? null
      const { score, reasons } = scoreResult(result, request, query, record)
      const existing = ranked.get(result.id)
      const candidate: RetrievedKnowledge = {
        id: result.id,
        title: record?.metadata.title ?? result.title,
        content: trimContent(record?.content ?? result.content, maxChars),
        tags: record?.metadata.tags ?? parseTags(result.tags),
        score: (existing?.score ?? 0) + score,
        domain: record?.metadata.domain,
        entities: record?.metadata.entities,
        status: record?.metadata.status,
        confidence: record?.metadata.confidence,
        source: record?.metadata.source,
        reasons: mergeReasons(existing?.reasons, reasons),
      }
      ranked.set(result.id, candidate)
    }
  }

  const items = Array.from(ranked.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)

  return {
    items,
    diagnostics: {
      queries,
      considered: ranked.size,
      selectedIds: items.map(item => item.id),
      clipped: ranked.size > items.length,
      candidates: items.map(toDiagnostic),
    },
  }
}
