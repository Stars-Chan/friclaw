import { readFileSync, writeFileSync, readdirSync, mkdirSync } from 'fs'
import { join } from 'path'
import type { Database } from 'bun:sqlite'
import { getMeta, listMetaByCategory, upsertIndex, upsertMeta } from './database'
import { parseFrontmatter, normalizeStringArray, serializeFrontmatter } from './frontmatter'
import type { KnowledgeMergeResult, KnowledgeMetadata, KnowledgeRecord, KnowledgeSummary, PromotionCandidate } from './types'

const KNOWLEDGE_STATUS_VALUES = new Set(['active', 'uncertain', 'archived'])
const MEMORY_CONFIDENCE_VALUES = new Set(['low', 'medium', 'high'])

function validateKnowledgeRecord(record: KnowledgeRecord): void {
  if (!record.id.trim()) throw new Error('Knowledge id is required')
  if (!record.content.trim()) throw new Error('Knowledge content is required')
  if (!record.metadata.title?.trim()) throw new Error('Knowledge title is required')
  if (!record.metadata.date?.trim()) throw new Error('Knowledge date is required')
  if (!Array.isArray(record.metadata.tags)) throw new Error('Knowledge tags must be an array')
  if (record.metadata.status && !KNOWLEDGE_STATUS_VALUES.has(record.metadata.status)) {
    throw new Error(`Invalid knowledge status: ${record.metadata.status}`)
  }
  if (record.metadata.confidence && !MEMORY_CONFIDENCE_VALUES.has(record.metadata.confidence)) {
    throw new Error(`Invalid knowledge confidence: ${record.metadata.confidence}`)
  }
}

export function toValidatedKnowledgeRecord(topic: string, input: {
  content: string
  metadata?: Partial<KnowledgeMetadata>
  tags?: string[]
}): KnowledgeRecord {
  const metadata = buildKnowledgeMetadata(topic, input.tags ?? input.metadata?.tags ?? [], input.metadata)
  const record: KnowledgeRecord = {
    id: topic,
    metadata,
    content: input.content.trim(),
  }
  validateKnowledgeRecord(record)
  return record
}

function topicFileName(topic: string): string {
  return `${topic}.md`
}

function topicFilePath(knowledgeDir: string, topic: string): string {
  return join(knowledgeDir, topicFileName(topic))
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'notes'
}

function buildPromotionId(input: { title: string; source?: string }): string {
  if (input.source) {
    const normalizedSource = input.source
      .replace(/^promotion:/, '')
      .replace(/[/:]+/g, '-')
    return `promotion-${slugify(normalizedSource)}`
  }
  return `promotion-title-${slugify(input.title)}`
}

function buildIdentityCandidateId(sourceId: string): string {
  return `identity-${slugify(sourceId)}`
}

function candidateFilePath(candidatesDir: string, id: string): string {
  return join(candidatesDir, `${id}.md`)
}

function buildCandidateId(candidate: PromotionCandidate): string {
  if (candidate.targetCategory === 'identity') {
    return buildIdentityCandidateId(candidate.sourceId)
  }
  return `${candidate.targetCategory}-${slugify(`${candidate.sourceCategory}-${candidate.sourceId}`)}`
}

function buildKnowledgeMetadata(topic: string, tags: string[] = [], metadata: Partial<KnowledgeMetadata> = {}): KnowledgeMetadata {
  const now = new Date().toISOString()
  return {
    title: metadata.title ?? topic,
    date: metadata.date ?? now,
    updatedAt: metadata.updatedAt ?? now,
    tags,
    domain: metadata.domain,
    entities: metadata.entities,
    status: metadata.status ?? 'active',
    confidence: metadata.confidence ?? 'medium',
    source: metadata.source,
  }
}

function normalizeMergeText(value: string): string {
  return value.replace(/\s+/g, ' ').trim().toLowerCase()
}

function areKnowledgeRecordsMergeable(left: KnowledgeRecord, right: KnowledgeRecord): boolean {
  if (normalizeMergeText(left.content) === normalizeMergeText(right.content)) return true
  if (left.metadata.title === right.metadata.title) return true
  const leftTags = new Set(left.metadata.tags)
  const sharedTags = right.metadata.tags.filter(tag => leftTags.has(tag))
  return sharedTags.length >= 2
}

function mergeUnique(values: Array<string | undefined>): string[] {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value))))
}

function readTextOrNull(filePath: string): string | null {
  try {
    return readFileSync(filePath, 'utf-8')
  } catch (error: any) {
    if (error?.code === 'ENOENT') return null
    throw error
  }
}

export class KnowledgeMemory {
  private knowledgeDir: string
  private candidatesDir: string

  constructor(private db: Database, memoryDir: string) {
    this.knowledgeDir = join(memoryDir, 'knowledge')
    this.candidatesDir = join(this.knowledgeDir, 'candidates')
    mkdirSync(this.candidatesDir, { recursive: true })
  }

  save(topic: string, content: string, tags: string[] = []): void {
    this.saveRecord({
      id: topic,
      metadata: buildKnowledgeMetadata(topic, tags),
      content,
    })
  }

  saveRecord(record: KnowledgeRecord): void {
    const metadata = buildKnowledgeMetadata(record.id, record.metadata.tags ?? [], record.metadata)
    const normalizedRecord = {
      ...record,
      metadata,
      content: record.content.trim(),
    }
    validateKnowledgeRecord(normalizedRecord)
    const fileContent = serializeFrontmatter(metadata, normalizedRecord.content)
    writeFileSync(topicFilePath(this.knowledgeDir, record.id), fileContent, 'utf-8')
    upsertIndex(this.db, `knowledge/${record.id}`, 'knowledge', metadata.title, normalizedRecord.content, metadata.tags)
    upsertMeta(this.db, {
      id: `knowledge/${record.id}`,
      category: 'knowledge',
      domain: metadata.domain,
      entities: metadata.entities,
      status: metadata.status,
      confidence: metadata.confidence,
      updatedAt: metadata.updatedAt,
      source: metadata.source,
    })
  }

  savePromotion(input: {
    title: string
    content: string
    tags?: string[]
    entities?: string[]
    domain?: string
    source?: string
    confidence?: 'low' | 'medium' | 'high'
  }): string {
    const id = buildPromotionId({ title: input.title, source: input.source })
    const existing = this.readRecord(id)
    const now = new Date().toISOString()
    this.saveRecord({
      id,
      metadata: {
        title: input.title,
        date: existing?.metadata.date ?? now,
        updatedAt: now,
        tags: input.tags ?? [],
        entities: input.entities,
        domain: input.domain,
        source: input.source,
        confidence: input.confidence ?? 'medium',
        status: 'active',
      },
      content: input.content,
    })
    return id
  }

  saveIdentityCandidate(candidate: PromotionCandidate): PromotionCandidate {
    const id = candidate.id ?? buildCandidateId(candidate)
    const existing = this.readIdentityCandidate(id)
    const now = new Date().toISOString()
    const nextCandidate: PromotionCandidate = {
      ...existing,
      ...candidate,
      id,
      targetCategory: candidate.targetCategory,
      createdAt: existing?.createdAt ?? candidate.createdAt ?? now,
      updatedAt: now,
      status: candidate.status ?? existing?.status ?? 'proposed',
      lineage: candidate.lineage ?? existing?.lineage ?? [],
      auditTrail: candidate.auditTrail ?? existing?.auditTrail ?? [],
    }
    writeFileSync(candidateFilePath(this.candidatesDir, id), serializeFrontmatter({
      id: nextCandidate.id,
      sourceCategory: nextCandidate.sourceCategory,
      sourceId: nextCandidate.sourceId,
      targetCategory: nextCandidate.targetCategory,
      reason: nextCandidate.reason,
      title: nextCandidate.title,
      tags: nextCandidate.tags,
      entities: nextCandidate.entities,
      confidence: nextCandidate.confidence,
      status: nextCandidate.status,
      review: nextCandidate.review ? JSON.stringify(nextCandidate.review) : undefined,
      lineage: nextCandidate.lineage ? JSON.stringify(nextCandidate.lineage) : undefined,
      auditTrail: nextCandidate.auditTrail ? JSON.stringify(nextCandidate.auditTrail) : undefined,
      applied: nextCandidate.applied ? 'true' : undefined,
      appliedTargetId: nextCandidate.appliedTargetId,
      createdAt: nextCandidate.createdAt,
      updatedAt: nextCandidate.updatedAt,
    }, nextCandidate.content), 'utf-8')
    return nextCandidate
  }

  readIdentityCandidate(id: string): PromotionCandidate | null {
    const raw = readTextOrNull(candidateFilePath(this.candidatesDir, id))
    if (!raw) return null
    const { metadata, body } = parseFrontmatter<Record<string, unknown>>(raw)
    return {
      id: typeof metadata.id === 'string' ? metadata.id : id,
      sourceCategory: metadata.sourceCategory as PromotionCandidate['sourceCategory'],
      sourceId: String(metadata.sourceId ?? ''),
      targetCategory: metadata.targetCategory as PromotionCandidate['targetCategory'] ?? 'identity',
      reason: String(metadata.reason ?? ''),
      title: String(metadata.title ?? id),
      content: body,
      tags: normalizeStringArray(metadata.tags),
      entities: normalizeStringArray(metadata.entities),
      confidence: typeof metadata.confidence === 'string' ? metadata.confidence as PromotionCandidate['confidence'] : undefined,
      status: typeof metadata.status === 'string' ? metadata.status as PromotionCandidate['status'] : undefined,
      review: typeof metadata.review === 'string' && metadata.review ? JSON.parse(metadata.review) : undefined,
      lineage: typeof metadata.lineage === 'string' && metadata.lineage ? JSON.parse(metadata.lineage) : undefined,
      auditTrail: typeof metadata.auditTrail === 'string' && metadata.auditTrail ? JSON.parse(metadata.auditTrail) : undefined,
      applied: metadata.applied === 'true',
      appliedTargetId: typeof metadata.appliedTargetId === 'string' ? metadata.appliedTargetId : undefined,
      createdAt: typeof metadata.createdAt === 'string' ? metadata.createdAt : undefined,
      updatedAt: typeof metadata.updatedAt === 'string' ? metadata.updatedAt : undefined,
    }
  }

  readCandidate(id: string): PromotionCandidate | null {
    return this.readIdentityCandidate(id)
  }

  listIdentityCandidates(): PromotionCandidate[] {
    return readdirSync(this.candidatesDir)
      .filter(file => file.endsWith('.md'))
      .map(file => this.readIdentityCandidate(file.replace('.md', '')))
      .filter(candidate => candidate?.targetCategory === 'identity') as PromotionCandidate[]
  }

  listCandidates(targetCategory?: PromotionCandidate['targetCategory']): PromotionCandidate[] {
    return readdirSync(this.candidatesDir)
      .filter(file => file.endsWith('.md'))
      .map(file => this.readCandidate(file.replace('.md', '')))
      .filter(Boolean)
      .filter(candidate => !targetCategory || candidate?.targetCategory === targetCategory) as PromotionCandidate[]
  }

  reviewIdentityCandidate(id: string, input: {
    decision: 'approve' | 'reject' | 'defer' | 'merge'
    reviewer?: string
    rationale?: string
    applied?: boolean
    appliedTargetId?: string
    auditTrail?: PromotionCandidate['auditTrail']
  }): PromotionCandidate | null {
    const existing = this.readIdentityCandidate(id)
    if (!existing) return null
    return this.saveIdentityCandidate({
      ...existing,
      id,
      status: input.decision === 'approve' ? 'approved' : input.decision === 'reject' ? 'rejected' : input.decision === 'defer' ? 'deferred' : 'merged',
      review: {
        decision: input.decision,
        reviewer: input.reviewer,
        rationale: input.rationale,
        reviewedAt: new Date().toISOString(),
      },
      applied: input.applied ?? existing.applied,
      appliedTargetId: input.appliedTargetId ?? existing.appliedTargetId,
      auditTrail: input.auditTrail ?? existing.auditTrail,
    })
  }

  read(topic: string): string | null {
    return readTextOrNull(topicFilePath(this.knowledgeDir, topic))
  }

  readRecord(topic: string): KnowledgeRecord | null {
    const raw = this.read(topic)
    if (!raw) return null
    const { metadata, body } = parseFrontmatter<KnowledgeMetadata>(raw)
    const dbMeta = getMeta(this.db, `knowledge/${topic}`)
    const tags = normalizeStringArray(metadata.tags)
    const entities = normalizeStringArray(metadata.entities ?? dbMeta?.entities)

    return {
      id: topic,
      metadata: {
        title: metadata.title ?? topic,
        date: metadata.date ?? new Date().toISOString(),
        updatedAt: metadata.updatedAt ?? dbMeta?.updatedAt ?? metadata.date,
        tags,
        domain: typeof metadata.domain === 'string' ? metadata.domain : dbMeta?.domain ?? undefined,
        entities,
        status: typeof metadata.status === 'string' ? metadata.status as KnowledgeMetadata['status'] : (dbMeta?.status as KnowledgeMetadata['status'] | undefined),
        confidence: typeof metadata.confidence === 'string' ? metadata.confidence as KnowledgeMetadata['confidence'] : (dbMeta?.confidence as KnowledgeMetadata['confidence'] | undefined),
        source: typeof metadata.source === 'string' ? metadata.source : dbMeta?.source ?? undefined,
      },
      content: body,
    }
  }

  listSummaries(limit = 100): KnowledgeSummary[] {
    const metas = listMetaByCategory(this.db, 'knowledge', limit)
    return metas.map(meta => ({
      id: meta.id.replace(/^knowledge\//, ''),
      title: meta.id.replace(/^knowledge\//, ''),
      tags: this.readRecord(meta.id.replace(/^knowledge\//, ''))?.metadata.tags ?? [],
      domain: meta.domain ?? undefined,
      status: meta.status as KnowledgeSummary['status'] | undefined,
      confidence: meta.confidence as KnowledgeSummary['confidence'] | undefined,
      updatedAt: meta.updatedAt ?? undefined,
    }))
  }

  list(): string[] {
    return readdirSync(this.knowledgeDir)
      .filter(f => f.endsWith('.md'))
      .map(f => f.replace('.md', ''))
  }

  listRecords(): KnowledgeRecord[] {
    return this.list().map(topic => this.readRecord(topic)).filter(Boolean) as KnowledgeRecord[]
  }

  mergeRecords(targetId: string, sourceIds: string[]): KnowledgeMergeResult | null {
    const target = this.readRecord(targetId)
    if (!target) return null

    const sources = sourceIds
      .filter(id => id !== targetId)
      .map(id => this.readRecord(id))
      .filter(Boolean) as KnowledgeRecord[]

    if (sources.length === 0) return null

    const mergeable = sources.filter(source => areKnowledgeRecordsMergeable(target, source))
    if (mergeable.length === 0) return null

    const now = new Date().toISOString()
    const mergedContent = [target.content, ...mergeable.map(source => source.content)]
      .map(content => content.trim())
      .filter(Boolean)
      .filter((content, index, array) => array.indexOf(content) === index)
      .join('\n\n')

    const mergedTags = Array.from(new Set([target.metadata.tags, ...mergeable.map(source => source.metadata.tags)].flat()))
    const mergedEntities = Array.from(new Set([target.metadata.entities ?? [], ...mergeable.map(source => source.metadata.entities ?? [])].flat()))
    const mergedSources = mergeUnique([target.metadata.source, ...mergeable.map(source => source.metadata.source)])

    this.saveRecord({
      id: target.id,
      metadata: {
        ...target.metadata,
        updatedAt: now,
        tags: mergedTags,
        entities: mergedEntities,
        source: mergedSources.join(', ') || target.metadata.source,
      },
      content: mergedContent,
    })

    const lineage = mergeable.map(source => ({
      fromLayer: 'knowledge' as const,
      fromId: source.id,
      toLayer: 'knowledge' as const,
      toId: target.id,
      relationType: 'merged_from' as const,
      createdAt: now,
    }))

    const auditTrail = [{
      actionType: 'knowledge_merged' as const,
      targetLayer: 'knowledge' as const,
      targetId: target.id,
      sourceRefs: mergeable.map(source => ({ layer: 'knowledge' as const, id: source.id })),
      rationale: 'Merged duplicate knowledge records into canonical target.',
      timestamp: now,
    }]

    for (const source of mergeable) {
      this.saveRecord({
        ...source,
        metadata: {
          ...source.metadata,
          updatedAt: now,
          status: 'archived',
          source: `merged-into:${target.id}`,
        },
      })
    }

    return {
      targetId: target.id,
      mergedSourceIds: mergeable.map(source => source.id),
      lineage,
      auditTrail,
    }
  }
}
