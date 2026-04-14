import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { mkdirSync, writeFileSync, rmSync, existsSync, readdirSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { EpisodeMemory } from '../../src/memory/episode'
import { initDatabase } from '../../src/memory/database'
import { getWorkspaceDailyHistoryFile, getWorkspaceHistoryDir, getWorkspaceHistoryFile } from '../../src/session/history-paths'
import * as summarizer from '../../src/memory/summarizer'

describe('Session Summarization Integration', () => {
  const testDir = join(tmpdir(), `friclaw-test-${Date.now()}`)
  const memoryDir = join(testDir, 'memory')
  const workspacesDir = join(testDir, 'workspaces')
  let episode: EpisodeMemory
  let db: ReturnType<typeof initDatabase>

  beforeAll(() => {
    mkdirSync(join(memoryDir, 'episodes'), { recursive: true })
    mkdirSync(workspacesDir, { recursive: true })
    db = initDatabase(join(memoryDir, 'index.sqlite'))
    episode = new EpisodeMemory(db, memoryDir)
  })

  afterAll(() => {
    db.close()
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true })
    }
  })

  test.skip('should create history files and generate summary (requires Claude CLI)', async () => {
    const conversationId = 'test:chat123'
    const sanitized = conversationId.replace(/:/g, '_')
    const workspaceDir = join(workspacesDir, sanitized)
    const historyDir = getWorkspaceHistoryDir(workspaceDir)

    // 创建历史目录
    mkdirSync(historyDir, { recursive: true })

    // 写入对话历史
    const date = new Date().toISOString().slice(0, 10)
    const historyContent = `[2024-01-01T10:00:00Z] [user] 你好，我想了解 FriClaw 的功能

[2024-01-01T10:00:05Z] [assistant] 你好！FriClaw 是一个 AI 助手平台，主要功能包括：
1. 多平台接入（飞书、企业微信）
2. 长期记忆系统
3. 会话摘要功能
4. 定时任务调度

[2024-01-01T10:01:00Z] [user] 会话摘要是如何工作的？

[2024-01-01T10:01:10Z] [assistant] 会话摘要功能会在你执行 /new 命令时自动触发：
1. 读取历史对话记录
2. 使用 Claude 生成结构化摘要
3. 保存到 episodes 目录
4. 建立全文索引供后续搜索

这样可以帮助你回顾之前的对话内容。`

    writeFileSync(getWorkspaceDailyHistoryFile(workspaceDir, date), historyContent, 'utf-8')

    // 生成摘要（使用较短的超时时间进行测试）
    const summaryId = await episode.summarizeSession(
      conversationId,
      workspaceDir,
      'claude-haiku-4-5',
      30000 // 30秒超时
    )

    // 验证摘要已生成
    expect(summaryId).toBeTruthy()

    // 验证偏移标记文件已创建
    const markerPath = getWorkspaceHistoryFile(workspaceDir, '.last-summarized-offset')
    expect(existsSync(markerPath)).toBe(true)

    // 验证摘要文件已创建
    const episodesDir = join(memoryDir, 'episodes')
    const files = existsSync(episodesDir) ? readdirSync(episodesDir).filter(f => f.endsWith('.md')) : []
    expect(files.length).toBeGreaterThan(0)
  }, 60000) // 60秒超时

  test('should skip summarization for short transcripts', async () => {
    const conversationId = 'test:chat456'
    const sanitized = conversationId.replace(/:/g, '_')
    const workspaceDir = join(workspacesDir, sanitized)
    const historyDir = getWorkspaceHistoryDir(workspaceDir)

    mkdirSync(historyDir, { recursive: true })

    // 写入很短的历史
    const date = new Date().toISOString().slice(0, 10)
    writeFileSync(getWorkspaceDailyHistoryFile(workspaceDir, date), '[user] hi\n[assistant] hello', 'utf-8')

    const summaryId = await episode.summarizeSession(
      conversationId,
      workspaceDir,
      'claude-haiku-4-5',
      30000
    )

    // 应该返回 null（内容太短）
    expect(summaryId).toBeNull()
  })

  test('should save fallback episode when summarization fails', async () => {
    const conversationId = 'test:fallback'
    const workspaceDir = join(workspacesDir, conversationId.replace(/:/g, '_'))
    const historyDir = getWorkspaceHistoryDir(workspaceDir)
    mkdirSync(historyDir, { recursive: true })

    const date = new Date().toISOString().slice(0, 10)
    writeFileSync(
      getWorkspaceDailyHistoryFile(workspaceDir, date),
      `[user] 我习惯用 TypeScript 开发，后续如果没有特别说明，希望默认使用 TS 和 TSX 来写代码与示例。\n[assistant] 好的，我记住了，后续会优先使用 TypeScript 风格。\n[user] 请继续记录这个偏好，后续实现默认 TypeScript，并在需要时补充类型定义与接口设计，避免再回到纯 JavaScript 风格。`,
      'utf-8',
    )

    summarizer.setSummarizeRunnerForTest(async () => {
      throw new Error('summary failed')
    })

    try {
      const result = await episode.summarizeSession(
        conversationId,
        workspaceDir,
        'claude-haiku-4-5',
        30000,
        {
          threadId: 'test:fallback:thread-1',
          chatKey: 'test:fallback',
          status: 'closed',
        },
      )

      expect(result).toBeTruthy()
      expect(result?.mode).toBe('fallback')

      const markerPath = getWorkspaceHistoryFile(workspaceDir, '.last-summarized-offset')
      expect(existsSync(markerPath)).toBe(true)

      const record = episode.readRecord(result!.id)
      expect(record?.metadata.status).toBe('summary_failed')
      expect(record?.summary).toContain('自动摘要失败')

      const thread = episode.readThreadState('test:fallback:thread-1')
      expect(thread?.status).toBe('summary_failed')
      expect(thread?.lastSummaryId).toBe(result!.id)
    } finally {
      summarizer.resetSummarizeRunnerForTest()
    }
  })
})
