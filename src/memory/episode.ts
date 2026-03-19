import { writeFileSync, readdirSync, readFileSync } from 'fs'
import { join } from 'path'
import type { Database } from 'bun:sqlite'
import { upsertIndex } from './database'

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
    const date = new Date().toISOString().slice(0, 10)
    const shortId = crypto.randomUUID().replace(/-/g, '').slice(0, 6)
    const id = `${date}-${shortId}`
    const content = `---\ntitle: ${id}\ndate: ${date}\ntags: [${tags.join(', ')}]\n---\n\n${summary}`
    writeFileSync(join(this.episodesDir, `${id}.md`), content, 'utf-8')
    upsertIndex(this.db, `episode/${id}`, 'episode', id, summary, tags)
    return id
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
