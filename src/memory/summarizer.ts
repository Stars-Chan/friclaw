// src/memory/summarizer.ts
import { logger } from '../utils/logger'

const log = logger('summarizer')

const SUMMARIZE_PROMPT = `你是一个对话摘要助手。分析以下对话记录并生成结构化摘要。

严格按照以下格式输出（前后不要有额外文本）：
---
title: "<简洁描述主要话题的标题>"
date: "<YYYY-MM-DD>"
tags: [<逗号分隔的相关标签>]
---

## 摘要
<2-4句话总结对话内容>

## 关键话题
- <话题 1>
- <话题 2>

## 决策与结果
- <决策或结果 1>
- <决策或结果 2>

## 重要信息
- <任何值得记住的重要事实、偏好或上下文>

对话记录：
`

export async function summarizeTranscript(
  transcript: string,
  model = 'claude-haiku-4-5',
  timeoutMs = 300_000
): Promise<string> {
  const prompt = SUMMARIZE_PROMPT + transcript
  const env = { ...process.env }
  delete env.CLAUDECODE
  delete env.CLAUDE_CODE_ENTRYPOINT

  log.info({ transcriptLength: transcript.length, model, timeoutMs }, 'Generating session summary')

  const result = Bun.spawnSync(['claude', '--model', model, '-p', prompt], {
    stdout: 'pipe',
    stderr: 'pipe',
    env,
    timeout: timeoutMs,
  })

  if (result.exitCode !== 0) {
    const stderr = result.stderr.toString().trim()
    const stdout = result.stdout.toString().trim()

    // 退出码 143 表示超时（SIGTERM）
    if (result.exitCode === 143) {
      throw new Error(`Claude CLI timeout after ${timeoutMs}ms`)
    }

    log.error({
      exitCode: result.exitCode,
      stderr: stderr.substring(0, 500),
      stdout: stdout.substring(0, 200)
    }, 'Claude CLI failed')

    throw new Error(`Claude CLI failed (exit ${result.exitCode}): ${stderr || stdout || 'Unknown error'}`)
  }

  const summary = result.stdout.toString().trim()
  log.info({ summaryLength: summary.length }, 'Session summary generated')
  return summary
}
