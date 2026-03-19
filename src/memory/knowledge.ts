import { existsSync, readFileSync, writeFileSync, readdirSync } from 'fs'
import { join } from 'path'
import type { Database } from 'bun:sqlite'
import { upsertIndex } from './database'

export class KnowledgeMemory {
  private knowledgeDir: string

  constructor(private db: Database, memoryDir: string) {
    this.knowledgeDir = join(memoryDir, 'knowledge')
  }

  save(topic: string, content: string, tags: string[] = []): void {
    const frontmatter = `---\ntitle: ${topic}\ndate: ${new Date().toISOString()}\ntags: [${tags.join(', ')}]\n---\n\n`
    writeFileSync(join(this.knowledgeDir, `${topic}.md`), frontmatter + content, 'utf-8')
    upsertIndex(this.db, `knowledge/${topic}`, 'knowledge', topic, content, tags)
  }

  read(topic: string): string | null {
    const filePath = join(this.knowledgeDir, `${topic}.md`)
    return existsSync(filePath) ? readFileSync(filePath, 'utf-8') : null
  }

  list(): string[] {
    return readdirSync(this.knowledgeDir)
      .filter(f => f.endsWith('.md'))
      .map(f => f.replace('.md', ''))
  }
}
