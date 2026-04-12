import { readFileSync, writeFileSync, readdirSync } from 'fs'
import { join } from 'path'
import type { Database } from 'bun:sqlite'
import { getMeta, upsertIndex, upsertMeta } from './database'
import { parseFrontmatter, normalizeStringArray, serializeFrontmatter } from './frontmatter'
import type { KnowledgeMetadata, KnowledgeRecord } from './types'

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

  constructor(private db: Database, memoryDir: string) {
    this.knowledgeDir = join(memoryDir, 'knowledge')
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
    const fileContent = serializeFrontmatter(metadata, record.content)
    writeFileSync(topicFilePath(this.knowledgeDir, record.id), fileContent, 'utf-8')
    upsertIndex(this.db, `knowledge/${record.id}`, 'knowledge', metadata.title, record.content, metadata.tags)
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

  list(): string[] {
    return readdirSync(this.knowledgeDir)
      .filter(f => f.endsWith('.md'))
      .map(f => f.replace('.md', ''))
  }

  listRecords(): KnowledgeRecord[] {
    return this.list().map(topic => this.readRecord(topic)).filter(Boolean) as KnowledgeRecord[]
  }
}
