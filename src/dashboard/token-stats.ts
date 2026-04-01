// src/dashboard/token-stats.ts
import { appendFile, readFile, mkdir } from 'fs/promises'
import { join } from 'path'
import { existsSync } from 'fs'

export interface TokenUsage {
  timestamp: number
  sessionId: string
  inputTokens: number
  outputTokens: number
  model: string
  costCny?: number
}

export class TokenStatsManager {
  private statsFile: string
  private statsDir: string

  constructor(workspaceDir: string) {
    this.statsDir = join(workspaceDir, '.friclaw', '.stats')
    this.statsFile = join(this.statsDir, 'tokens.jsonl')
    this.ensureDir()
  }

  private async ensureDir(): Promise<void> {
    try {
      await mkdir(this.statsDir, { recursive: true })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
        throw error
      }
    }
  }

  async record(usage: TokenUsage): Promise<void> {
    await this.ensureDir()
    await appendFile(this.statsFile, JSON.stringify(usage) + '\n', 'utf-8')
  }

  async getStats(days: number = 7): Promise<TokenUsage[]> {
    if (!existsSync(this.statsFile)) return []

    const content = await readFile(this.statsFile, 'utf-8')
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000

    return content
      .split('\n')
      .filter(line => line.trim())
      .map(line => JSON.parse(line))
      .filter((usage: TokenUsage) => usage.timestamp >= cutoff)
  }
}
