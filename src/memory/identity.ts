import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { Database } from 'bun:sqlite'
import { upsertIndex } from './database'

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

export class IdentityMemory {
  private soulPath: string

  constructor(private db: Database, memoryDir: string) {
    this.soulPath = join(memoryDir, 'SOUL.md')
  }

  read(): string {
    return existsSync(this.soulPath)
      ? readFileSync(this.soulPath, 'utf-8')
      : DEFAULT_SOUL
  }

  update(content: string): void {
    writeFileSync(this.soulPath, content, 'utf-8')
    upsertIndex(this.db, 'identity/SOUL', 'identity', 'SOUL', content)
  }
}
