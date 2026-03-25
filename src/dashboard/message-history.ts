// src/dashboard/message-history.ts
import { appendFileSync, readFileSync, existsSync, mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
  timestamp: number
}

export class MessageHistory {
  private historyFile: string

  constructor(workspaceDir: string) {
    const historyDir = join(workspaceDir, '.firclaw', '.history')
    mkdirSync(historyDir, { recursive: true })
    this.historyFile = join(historyDir, 'messages.jsonl')
  }

  append(message: ChatMessage): void {
    appendFileSync(this.historyFile, JSON.stringify(message) + '\n', 'utf-8')
  }

  load(): ChatMessage[] {
    if (!existsSync(this.historyFile)) return []

    const content = readFileSync(this.historyFile, 'utf-8')
    return content
      .split('\n')
      .filter(line => line.trim())
      .map(line => JSON.parse(line))
  }

  clear(): void {
    writeFileSync(this.historyFile, '', 'utf-8')
  }
}
