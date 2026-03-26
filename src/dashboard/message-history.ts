// src/dashboard/message-history.ts
import { appendFile, readFile, access, mkdir, writeFile } from 'fs/promises'
import { join } from 'path'
import { existsSync } from 'fs'

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
  timestamp: number
  thinkingContent?: string
}

export class MessageHistory {
  private historyFile: string
  private historyDir: string

  constructor(workspaceDir: string) {
    this.historyDir = join(workspaceDir, '.firclaw', '.history')
    this.historyFile = join(this.historyDir, 'messages.jsonl')
    this.ensureDir()
  }

  private async ensureDir(): Promise<void> {
    try {
      await mkdir(this.historyDir, { recursive: true })
    } catch (error) {
      // 目录可能已存在，忽略错误
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
        throw error
      }
    }
  }

  async append(message: ChatMessage): Promise<void> {
    await appendFile(this.historyFile, JSON.stringify(message) + '\n', 'utf-8')
  }

  async load(): Promise<ChatMessage[]> {
    try {
      await access(this.historyFile)
    } catch {
      // 文件不存在，返回空数组
      return []
    }

    const content = await readFile(this.historyFile, 'utf-8')
    return content
      .split('\n')
      .filter(line => line.trim())
      .map(line => JSON.parse(line))
  }

  async clear(): Promise<void> {
    await writeFile(this.historyFile, '', 'utf-8')
  }

  // 同步版本用于初始化（如果需要）
  appendSync(message: ChatMessage): void {
    const { appendFileSync } = require('fs')
    appendFileSync(this.historyFile, JSON.stringify(message) + '\n', 'utf-8')
  }

  loadSync(): ChatMessage[] {
    if (!existsSync(this.historyFile)) return []
    const { readFileSync } = require('fs')
    const content = readFileSync(this.historyFile, 'utf-8')
    return content
      .split('\n')
      .filter(line => line.trim())
      .map(line => JSON.parse(line))
  }
}
