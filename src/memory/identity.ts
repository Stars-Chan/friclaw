import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import type { Database } from 'bun:sqlite'
import { upsertIndex } from './database'
import { parseFrontmatter, serializeFrontmatter } from './frontmatter'
import type { AuditRecord, IdentityVersionRecord, PromotionCandidate, PromotionReview } from './types'

const DEFAULT_SOUL = `---
title: FriClaw Identity
date: ${new Date().toISOString().slice(0, 10)}
---

我是 FriClaw，你的私人 AI 管家。

## 性格
- 冷静、高效、专注
- 主动感知需求，而不是被动等待
- 直接给出答案，不废话

## 行为准则
- 记住用户的偏好和习惯
- 主动提醒重要事项
- 保护用户隐私，不泄露敏感信息
`

function createVersionId(): string {
  return `${new Date().toISOString().replace(/[:.]/g, '-')}-${crypto.randomUUID().slice(0, 6)}`
}

export class IdentityMemory {
  private soulPath: string
  private versionsDir: string

  constructor(private db: Database, memoryDir: string) {
    this.soulPath = join(memoryDir, 'SOUL.md')
    this.versionsDir = join(memoryDir, 'identity', 'versions')
    mkdirSync(this.versionsDir, { recursive: true })
  }

  read(): string {
    return existsSync(this.soulPath)
      ? readFileSync(this.soulPath, 'utf-8')
      : DEFAULT_SOUL
  }

  update(content: string, options?: {
    source?: IdentityVersionRecord['source']
    candidateId?: string
    review?: PromotionReview
    auditTrail?: AuditRecord[]
  }): void {
    const current = this.read()
    if (current !== content) {
      this.saveVersion({
        id: createVersionId(),
        createdAt: new Date().toISOString(),
        source: options?.source ?? 'manual_update',
        candidateId: options?.candidateId,
        review: options?.review,
        auditTrail: options?.auditTrail,
        content: current,
        beforeContent: current,
        afterContent: content,
      })
    }
    writeFileSync(this.soulPath, content, 'utf-8')
    upsertIndex(this.db, 'identity/SOUL', 'identity', 'SOUL', content)
  }

  applyCandidate(candidate: PromotionCandidate, review?: PromotionReview, auditTrail?: AuditRecord[]): void {
    const current = this.read().trim()
    if (current.includes(candidate.content.trim())) {
      this.update(current, {
        source: 'candidate_apply',
        candidateId: candidate.id,
        review,
        auditTrail,
      })
      return
    }

    const lines = [current]
    if (!current.includes('## Approved Memory Candidates')) {
      lines.push('', '## Approved Memory Candidates')
    }
    lines.push('', `### ${candidate.title}`)
    if (review?.rationale) lines.push(`> ${review.rationale}`)
    lines.push(candidate.content.trim())
    this.update(lines.join('\n'), {
      source: 'candidate_apply',
      candidateId: candidate.id,
      review,
      auditTrail,
    })
  }

  listVersions(): IdentityVersionRecord[] {
    return readdirSync(this.versionsDir)
      .filter(file => file.endsWith('.md'))
      .sort()
      .reverse()
      .map(file => this.readVersion(file.replace(/\.md$/, '')))
      .filter(Boolean) as IdentityVersionRecord[]
  }

  rollbackLatest(auditTrail?: AuditRecord[]): IdentityVersionRecord | null {
    const latest = this.listVersions()[0]
    if (!latest) return null
    this.update(latest.beforeContent ?? latest.content, { source: 'rollback', auditTrail })
    return latest
  }

  private saveVersion(record: IdentityVersionRecord): void {
    const filePath = join(this.versionsDir, `${record.id}.md`)
    writeFileSync(filePath, serializeFrontmatter({
      id: record.id,
      createdAt: record.createdAt,
      source: record.source,
      candidateId: record.candidateId,
      review: record.review ? JSON.stringify(record.review) : undefined,
      auditTrail: record.auditTrail ? JSON.stringify(record.auditTrail) : undefined,
      beforeContent: record.beforeContent,
      afterContent: record.afterContent,
    }, record.content), 'utf-8')
  }

  private readVersion(id: string): IdentityVersionRecord | null {
    const filePath = join(this.versionsDir, `${id}.md`)
    if (!existsSync(filePath)) return null
    const raw = readFileSync(filePath, 'utf-8')
    const { metadata, body } = parseFrontmatter<Record<string, unknown>>(raw)
    return {
      id,
      createdAt: String(metadata.createdAt ?? ''),
      source: (metadata.source as IdentityVersionRecord['source']) ?? 'manual_update',
      candidateId: typeof metadata.candidateId === 'string' ? metadata.candidateId : undefined,
      review: typeof metadata.review === 'string' && metadata.review ? JSON.parse(metadata.review) : undefined,
      auditTrail: typeof metadata.auditTrail === 'string' && metadata.auditTrail ? JSON.parse(metadata.auditTrail) : undefined,
      content: body,
      beforeContent: typeof metadata.beforeContent === 'string' ? metadata.beforeContent : body,
      afterContent: typeof metadata.afterContent === 'string' ? metadata.afterContent : undefined,
    }
  }
}
