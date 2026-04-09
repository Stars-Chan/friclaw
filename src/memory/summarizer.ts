// src/memory/summarizer.ts
import Anthropic from '@anthropic-ai/sdk'
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
  model = 'claude-haiku-4-5-20241022',
  timeoutMs = 300_000
): Promise<string> {
  const prompt = SUMMARIZE_PROMPT + transcript

  log.info({ transcriptLength: transcript.length, model, timeoutMs }, 'Generating session summary')

  try {
    // 使用 Anthropic SDK 直接调用 API
    const apiKey = process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN
    if (!apiKey) {
      throw new Error('ANTHROPIC_API_KEY or ANTHROPIC_AUTH_TOKEN not found in environment')
    }

    const baseURL = process.env.ANTHROPIC_BASE_URL
    const client = new Anthropic({
      apiKey,
      baseURL,
      timeout: timeoutMs,
    })

    const message = await client.messages.create({
      model,
      max_tokens: 2048,
      messages: [{ role: 'user', content: prompt }],
    })

    const summary = message.content
      .filter(block => block.type === 'text')
      .map(block => (block as { type: 'text'; text: string }).text)
      .join('\n')
      .trim()

    log.info({ summaryLength: summary.length }, 'Session summary generated')
    return summary
  } catch (error) {
    log.error({ error, transcriptLength: transcript.length }, 'Failed to generate summary')
    throw error
  }
}
