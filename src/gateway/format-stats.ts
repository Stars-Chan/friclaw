// src/gateway/format-stats.ts
import type { RunResponseStats } from '../agent/types'

/**
 * 格式化统计信息为人类可读的字符串
 * @param response - 包含统计信息的响应对象
 * @returns 格式化后的统计信息字符串，如果没有统计信息则返回 null
 *
 * @example
 * ```typescript
 * const stats = formatStats({
 *   model: 'claude-sonnet-4-6',
 *   elapsedMs: 1500,
 *   inputTokens: 1000,
 *   outputTokens: 500,
 *   costCny: 0.0360
 * })
 * // 返回: "1.5s · 1000 in · 500 out · ¥0.0360 · claude-sonnet-4-6"
 * ```
 */
export function formatStats(response: RunResponseStats): string | null {
  const parts: string[] = []
  if (response.elapsedMs != null) parts.push(`${(response.elapsedMs / 1000).toFixed(1)}s`)
  if (response.inputTokens != null) parts.push(`${response.inputTokens} in`)
  if (response.outputTokens != null) parts.push(`${response.outputTokens} out`)
  if (response.costCny != null) parts.push(`¥${response.costCny.toFixed(4)}`)
  if (response.model) parts.push(response.model)
  return parts.length > 0 ? parts.join(' · ') : null
}
