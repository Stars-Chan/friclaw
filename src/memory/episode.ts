import { mkdirSync, writeFileSync, readdirSync, readFileSync } from 'fs'
import { join } from 'path'
import type { Database } from 'bun:sqlite'
import { getMeta, getMetaByThread, upsertIndex, upsertMeta } from './database'
import { parseFrontmatter, normalizeStringArray, serializeFrontmatter } from './frontmatter'
import { summarizeTranscript } from './summarizer'
import { logger } from '../utils/logger'
import type { EpisodeMetadata, EpisodeRecord, EpisodeThreadState } from './types'

const log = logger('episode')

export interface Episode {
  id: string
  date: string
  tags: string[]
  summary: string
  threadId?: string
  status?: string
  nextStep?: string
  blockers?: string[]
}

function isValidEpisodeMetadata(metadata: Partial<EpisodeMetadata>, body: string): boolean {
  const record = metadata as Record<string, unknown>
  if (typeof metadata.date !== 'string' || !metadata.date.trim()) return false
  if (typeof record.startedAt === 'string') return false
  return body.trim().length > 0
}

export function isEpisodeRecord(raw: string): boolean {
  const { metadata, body } = parseFrontmatter<EpisodeMetadata>(raw)
  return isValidEpisodeMetadata(metadata, body)
}

function createEpisodeId(): string {
  const now = new Date()
  const date = now.toISOString().slice(0, 10)
  const ts = process.hrtime.bigint().toString().padStart(20, '0')
  const shortId = crypto.randomUUID().replace(/-/g, '').slice(0, 6)
  return `${date}-${ts}-${shortId}`
}

function episodeFilePath(episodesDir: string, id: string): string {
  return join(episodesDir, `${id}.md`)
}

function threadStatePath(threadsDir: string, threadId: string): string {
  return join(threadsDir, `${threadId.replace(/[/:]/g, '_')}.md`)
}

function readTextOrNull(filePath: string): string | null {
  try {
    return readFileSync(filePath, 'utf-8')
  } catch (error: any) {
    if (error?.code === 'ENOENT') return null
    throw error
  }
}

function buildEpisodeMetadata(id: string, tags: string[] = [], metadata: Partial<EpisodeMetadata> = {}): EpisodeMetadata {
  const now = new Date().toISOString()
  return {
    title: metadata.title ?? id,
    date: metadata.date ?? now.slice(0, 10),
    updatedAt: metadata.updatedAt ?? now,
    tags,
    threadId: metadata.threadId,
    chatKey: metadata.chatKey,
    status: metadata.status ?? 'active',
    sourceSessionId: metadata.sourceSessionId,
    sourceWorkspaceDir: metadata.sourceWorkspaceDir,
    nextStep: metadata.nextStep,
    blockers: metadata.blockers,
  }
}

export class EpisodeMemory {
  private episodesDir: string
  private threadsDir: string

  constructor(private db: Database, memoryDir: string) {
    this.episodesDir = join(memoryDir, 'episodes')
    this.threadsDir = join(this.episodesDir, 'threads')
    mkdirSync(this.threadsDir, { recursive: true })
  }

  createThread(input: {
    platform: string
    chatId: string
    sessionId: string
    workspaceDir: string
    title?: string
  }): EpisodeThreadState {
    const startedAt = new Date().toISOString()
    const threadId = `${input.platform}:${input.chatId}:${Date.now()}`
    const state: EpisodeThreadState = {
      threadId,
      chatKey: `${input.platform}:${input.chatId}`,
      status: 'active',
      startedAt,
      updatedAt: startedAt,
      sourceSessionId: input.sessionId,
      sourceWorkspaceDir: input.workspaceDir,
      title: input.title,
    }
    this.saveThreadState(state)
    return state
  }

  save(summary: string, tags: string[] = [], metadata: Partial<EpisodeMetadata> = {}): string {
    const id = createEpisodeId()
    const episodeMetadata = buildEpisodeMetadata(id, tags, metadata)
    const content = serializeFrontmatter(episodeMetadata, summary)
    writeFileSync(episodeFilePath(this.episodesDir, id), content, 'utf-8')
    upsertIndex(this.db, `episode/${id}`, 'episode', episodeMetadata.title, summary, tags)
    upsertMeta(this.db, {
      id: `episode/${id}`,
      category: 'episode',
      threadId: episodeMetadata.threadId,
      chatKey: episodeMetadata.chatKey,
      status: episodeMetadata.status,
      updatedAt: episodeMetadata.updatedAt,
      source: episodeMetadata.sourceSessionId,
    })

    if (episodeMetadata.threadId) {
      const current = this.readThreadState(episodeMetadata.threadId)
      const nextStatus = metadata.status ?? current?.status ?? episodeMetadata.status ?? 'active'
      this.saveThreadState({
        threadId: episodeMetadata.threadId,
        chatKey: episodeMetadata.chatKey ?? current?.chatKey ?? '',
        status: nextStatus,
        startedAt: current?.startedAt ?? episodeMetadata.updatedAt ?? new Date().toISOString(),
        updatedAt: episodeMetadata.updatedAt ?? new Date().toISOString(),
        sourceSessionId: episodeMetadata.sourceSessionId ?? current?.sourceSessionId,
        sourceWorkspaceDir: episodeMetadata.sourceWorkspaceDir ?? current?.sourceWorkspaceDir,
        lastSummaryId: id,
        title: episodeMetadata.title,
        nextStep: episodeMetadata.nextStep,
        blockers: episodeMetadata.blockers,
      })
    }

    return id
  }

  async summarizeSession(
    conversationId: string,
    workspaceDir: string,
    model?: string,
    timeoutMs?: number,
    options?: {
      threadId?: string
      chatKey?: string
      status?: 'active' | 'paused' | 'closed'
      nextStep?: string
      blockers?: string[]
    }
  ): Promise<string | null> {
    const historyDir = join(workspaceDir, '.friclaw', '.history')

    let files: string[]
    try {
      files = readdirSync(historyDir)
        .filter(f => f.endsWith('.txt'))
        .sort()
    } catch (err: any) {
      if (err?.code === 'ENOENT') {
        log.warn({ conversationId }, 'No history directory found, skipping summarization')
        return null
      }
      log.warn({ conversationId, error: err }, 'Error reading history directory')
      return null
    }

    if (files.length === 0) {
      log.info({ conversationId }, 'No history files found')
      return null
    }

    const markerPath = join(historyDir, '.last-summarized-offset')
    let offsets: Record<string, number> = {}
    try {
      const marker = readTextOrNull(markerPath)
      if (marker) offsets = JSON.parse(marker)
    } catch (err) {
      log.warn({ conversationId, error: err }, 'Error reading offset marker')
      offsets = {}
    }

    const newParts: string[] = []
    const newOffsets: Record<string, number> = { ...offsets }

    for (const file of files) {
      const filePath = join(historyDir, file)
      const content = readFileSync(filePath, 'utf-8')
      const prevOffset = offsets[file] ?? 0

      if (prevOffset >= content.length) continue
      const newContent = content.slice(prevOffset).trim()
      if (newContent) newParts.push(newContent)

      newOffsets[file] = content.length
    }

    if (newParts.length === 0) {
      log.info({ conversationId }, 'No new history to summarize')
      return null
    }

    const transcript = newParts.join('\n').trim()

    if (transcript.length < 100) {
      writeFileSync(markerPath, JSON.stringify(newOffsets, null, 2), 'utf-8')
      log.info({ conversationId, length: transcript.length }, 'Transcript too short, skipping')
      return null
    }

    const maxChars = 20_000
    const truncated = transcript.length > maxChars ? transcript.slice(-maxChars) : transcript

    log.info({
      conversationId,
      rawChars: transcript.length,
      truncatedChars: truncated.length,
      threadId: options?.threadId,
    }, 'Summarizing session')

    try {
      const summaryMd = await summarizeTranscript(truncated, model, timeoutMs)
      const parsed = parseFrontmatter<EpisodeMetadata>(summaryMd)
      const summary = parsed.body
      const metadata = buildEpisodeMetadata(createEpisodeId(), normalizeStringArray(parsed.metadata.tags), {
        ...parsed.metadata,
        threadId: options?.threadId ?? parsed.metadata.threadId,
        chatKey: options?.chatKey ?? parsed.metadata.chatKey,
        status: options?.status ?? parsed.metadata.status,
        sourceSessionId: conversationId,
        sourceWorkspaceDir: workspaceDir,
        nextStep: options?.nextStep ?? parsed.metadata.nextStep,
        blockers: options?.blockers ?? normalizeStringArray(parsed.metadata.blockers),
      })

      const id = this.save(summary, metadata.tags, metadata)
      writeFileSync(markerPath, JSON.stringify(newOffsets, null, 2), 'utf-8')
      log.info({ conversationId, id }, 'Session summary saved')
      return id
    } catch (err) {
      log.warn({ conversationId, error: err }, 'Failed to summarize session')
      return null
    }
  }

  recent(limit = 10): Episode[] {
    return readdirSync(this.episodesDir)
      .filter(f => f.endsWith('.md'))
      .sort()
      .reverse()
      .flatMap((f) => {
        const raw = readTextOrNull(join(this.episodesDir, f))
        if (!raw || !isEpisodeRecord(raw)) return []
        return [this.parseContent(f.replace('.md', ''), raw)]
      })
      .slice(0, limit)
  }

  listThreadEpisodes(threadId: string, limit = 5): Episode[] {
    const metaRecords = getMetaByThread(this.db, threadId, 'episode', limit)
    return metaRecords
      .map(record => record.id.replace(/^episode\//, ''))
      .map(id => this.read(id))
      .filter(Boolean) as Episode[]
  }

  read(id: string): Episode | null {
    const raw = readTextOrNull(episodeFilePath(this.episodesDir, id))
    if (!raw) return null
    return this.parseContent(id, raw)
  }

  readRecord(id: string): EpisodeRecord | null {
    const raw = readTextOrNull(episodeFilePath(this.episodesDir, id))
    if (!raw) return null
    const { metadata, body } = parseFrontmatter<EpisodeMetadata>(raw)
    const dbMeta = getMeta(this.db, `episode/${id}`)
    return {
      id,
      metadata: {
        title: metadata.title ?? id,
        date: metadata.date ?? '',
        updatedAt: metadata.updatedAt ?? dbMeta?.updatedAt ?? undefined,
        tags: normalizeStringArray(metadata.tags),
        threadId: typeof metadata.threadId === 'string' ? metadata.threadId : dbMeta?.threadId ?? undefined,
        chatKey: typeof metadata.chatKey === 'string' ? metadata.chatKey : dbMeta?.chatKey ?? undefined,
        status: typeof metadata.status === 'string' ? metadata.status as EpisodeMetadata['status'] : (dbMeta?.status as EpisodeMetadata['status'] | undefined),
        sourceSessionId: typeof metadata.sourceSessionId === 'string' ? metadata.sourceSessionId : undefined,
        sourceWorkspaceDir: typeof metadata.sourceWorkspaceDir === 'string' ? metadata.sourceWorkspaceDir : undefined,
        nextStep: typeof metadata.nextStep === 'string' ? metadata.nextStep : undefined,
        blockers: normalizeStringArray(metadata.blockers),
      },
      summary: body,
    }
  }

  readThreadState(threadId: string): EpisodeThreadState | null {
    const raw = readTextOrNull(threadStatePath(this.threadsDir, threadId))
    if (!raw) return null
    const { metadata } = parseFrontmatter<EpisodeThreadState>(raw)
    if (!metadata.threadId || !metadata.chatKey || !metadata.status || !metadata.startedAt || !metadata.updatedAt) {
      return null
    }
    return {
      threadId: String(metadata.threadId),
      chatKey: String(metadata.chatKey),
      status: metadata.status as EpisodeThreadState['status'],
      startedAt: String(metadata.startedAt),
      updatedAt: String(metadata.updatedAt),
      sourceSessionId: typeof metadata.sourceSessionId === 'string' ? metadata.sourceSessionId : undefined,
      sourceWorkspaceDir: typeof metadata.sourceWorkspaceDir === 'string' ? metadata.sourceWorkspaceDir : undefined,
      lastSummaryId: typeof metadata.lastSummaryId === 'string' ? metadata.lastSummaryId : undefined,
      title: typeof metadata.title === 'string' ? metadata.title : undefined,
      nextStep: typeof metadata.nextStep === 'string' ? metadata.nextStep : undefined,
      blockers: normalizeStringArray(metadata.blockers),
    }
  }

  saveThreadState(state: EpisodeThreadState): void {
    writeFileSync(threadStatePath(this.threadsDir, state.threadId), serializeFrontmatter(state as unknown as Record<string, unknown>, ''), 'utf-8')
  }

  updateThreadState(threadId: string, patch: Partial<EpisodeThreadState>): EpisodeThreadState | null {
    const current = this.readThreadState(threadId)
    if (!current) return null
    const nextState: EpisodeThreadState = {
      ...current,
      ...patch,
      threadId,
      updatedAt: patch.updatedAt ?? new Date().toISOString(),
    }
    this.saveThreadState(nextState)
    return nextState
  }

  private parseContent(id: string, raw: string): Episode {
    const { metadata, body } = parseFrontmatter<EpisodeMetadata>(raw)
    const dbMeta = getMeta(this.db, `episode/${id}`)
    return {
      id,
      date: metadata.date ?? '',
      tags: normalizeStringArray(metadata.tags),
      summary: body,
      threadId: typeof metadata.threadId === 'string' ? metadata.threadId : dbMeta?.threadId ?? undefined,
      status: typeof metadata.status === 'string' ? metadata.status : dbMeta?.status ?? undefined,
      nextStep: typeof metadata.nextStep === 'string' ? metadata.nextStep : undefined,
      blockers: normalizeStringArray(metadata.blockers),
    }
  }
}
