import { writeFileSync, readdirSync, readFileSync, existsSync } from 'fs'
import { join } from 'path'
import type { Database } from 'bun:sqlite'
import { upsertIndex } from './database'
import { summarizeTranscript } from './summarizer'
import { logger } from '../utils/logger'

const log = logger('episode')

export interface Episode {
  id: string
  date: string
  tags: string[]
  summary: string
}

export class EpisodeMemory {
  private episodesDir: string

  constructor(private db: Database, memoryDir: string) {
    this.episodesDir = join(memoryDir, 'episodes')
  }

  save(summary: string, tags: string[] = []): string {
    const now = new Date()
    const date = now.toISOString().slice(0, 10)
    const ts = process.hrtime.bigint().toString().padStart(20, '0')
    const shortId = crypto.randomUUID().replace(/-/g, '').slice(0, 6)
    const id = `${date}-${ts}-${shortId}`
    const content = `---\ntitle: ${id}\ndate: ${date}\ntags: [${tags.join(', ')}]\n---\n\n${summary}`
    writeFileSync(join(this.episodesDir, `${id}.md`), content, 'utf-8')
    upsertIndex(this.db, `episode/${id}`, 'episode', id, summary, tags)
    return id
  }

  /**
   * 从会话历史生成摘要并保存
   */
  async summarizeSession(
    conversationId: string,
    workspacesDir: string,
    model?: string,
    timeoutMs?: number
  ): Promise<string | null> {
    const sanitized = conversationId.replace(/:/g, '_')
    const historyDir = join(workspacesDir, sanitized, '.firclaw', '.history')

    if (!existsSync(historyDir)) {
      log.warn({ conversationId }, 'No history directory found, skipping summarization')
      return null
    }

    // 读取所有历史文件
    let files: string[]
    try {
      files = readdirSync(historyDir)
        .filter(f => f.endsWith('.txt'))
        .sort()
    } catch (err) {
      log.warn({ conversationId, error: err }, 'Error reading history directory')
      return null
    }

    if (files.length === 0) {
      log.info({ conversationId }, 'No history files found')
      return null
    }

    // 读取偏移标记，跟踪已摘要的内容
    const markerPath = join(historyDir, '.last-summarized-offset')
    let offsets: Record<string, number> = {}
    try {
      if (existsSync(markerPath)) {
        offsets = JSON.parse(readFileSync(markerPath, 'utf-8'))
      }
    } catch (err) {
      log.warn({ conversationId, error: err }, 'Error reading offset marker')
      offsets = {}
    }

    // 只读取未摘要的内容
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
      // 更新偏移量，避免重复读取
      writeFileSync(markerPath, JSON.stringify(newOffsets, null, 2), 'utf-8')
      log.info({ conversationId, length: transcript.length }, 'Transcript too short, skipping')
      return null
    }

    // 截断过长的对话记录
    const maxChars = 20_000
    const truncated = transcript.length > maxChars ? transcript.slice(-maxChars) : transcript

    log.info({
      conversationId,
      rawChars: transcript.length,
      truncatedChars: truncated.length
    }, 'Summarizing session')

    try {
      const summaryMd = await summarizeTranscript(truncated, model, timeoutMs)

      // 保存摘要
      const date = new Date().toISOString().slice(0, 10)
      const ts = Date.now()
      const suffix = sanitized.slice(0, 20)
      const fileName = `${date}_${suffix}_${ts}.md`
      writeFileSync(join(this.episodesDir, fileName), summaryMd, 'utf-8')

      // 更新索引
      const id = fileName.replace('.md', '')
      const titleMatch = summaryMd.match(/^title:\s*"?([^"\n]+)"?\s*$/m)
      const title = titleMatch?.[1] ?? `Session ${date}`

      upsertIndex(this.db, `episode/${id}`, 'episode', title, summaryMd, [])

      // 持久化偏移量
      writeFileSync(markerPath, JSON.stringify(newOffsets, null, 2), 'utf-8')

      log.info({ conversationId, fileName }, 'Session summary saved')
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
      .slice(0, limit)
      .map(f => this.parse(f))
  }

  private parse(filename: string): Episode {
    const raw = readFileSync(join(this.episodesDir, filename), 'utf-8')
    const id = filename.replace('.md', '')
    const dateMatch = raw.match(/^date:\s*(.+)$/m)
    const tagsMatch = raw.match(/^tags:\s*\[(.*)]/m)
    const summary = raw.replace(/^---[\s\S]*?---\n\n/, '')
    return {
      id,
      date: dateMatch?.[1]?.trim() ?? '',
      tags: tagsMatch?.[1] ? tagsMatch[1].split(',').map(t => t.trim()).filter(Boolean) : [],
      summary,
    }
  }
}
