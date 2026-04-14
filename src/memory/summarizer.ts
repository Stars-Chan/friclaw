// src/memory/summarizer.ts
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { runClaudeCodePrompt } from '../agent/claude-code'
import { logger } from '../utils/logger'

const log = logger('summarizer')

function describeError(error: unknown) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
      cause: error.cause instanceof Error
        ? { name: error.cause.name, message: error.cause.message, stack: error.cause.stack }
        : error.cause,
    }
  }

  return {
    message: typeof error === 'string' ? error : JSON.stringify(error),
  }
}

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

let summarizeRunner: typeof runClaudeCodePrompt = runClaudeCodePrompt

export function setSummarizeRunnerForTest(runner: typeof runClaudeCodePrompt): void {
  summarizeRunner = runner
}

export function resetSummarizeRunnerForTest(): void {
  summarizeRunner = runClaudeCodePrompt
}

export async function summarizeTranscript(
  transcript: string,
  model = 'claude-haiku-4-5',
  timeoutMs = 300_000
): Promise<string> {
  const prompt = SUMMARIZE_PROMPT + transcript
  const workspaceDir = mkdtempSync(join(tmpdir(), 'friclaw-summary-'))

  log.info({ transcriptLength: transcript.length, model, timeoutMs }, 'Generating session summary')

  try {
    const result = await summarizeRunner({
      conversationId: `summary:${Date.now()}`,
      workspaceDir,
      text: prompt,
    }, {
      model,
      timeoutMs,
    })

    const summary = result.text.trim()
    log.info({ summaryLength: summary.length, model: result.model }, 'Session summary generated')
    return summary
  } catch (error) {
    log.error({ error: describeError(error), transcriptLength: transcript.length }, 'Failed to generate summary')
    throw error
  } finally {
    rmSync(workspaceDir, { recursive: true, force: true })
  }
}
