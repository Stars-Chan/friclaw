// src/agent/types.ts
export interface RunRequest {
  conversationId: string
  workspaceDir: string
  text: string
  attachments?: Array<{ type: 'image'; buffer: Buffer }>
}

export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }

/**
 * Agent 运行响应统计信息
 */
export interface RunResponseStats {
  text: string
  sessionId: string
  model?: string
  elapsedMs?: number
  inputTokens?: number
  outputTokens?: number
  costCny?: number
}

export type AgentStreamEvent =
  | { type: 'thinking_delta'; text: string }
  | { type: 'text_delta'; text: string }
  | { type: 'tool_use'; name: string; input: unknown }
  | { type: 'ask_questions'; questions: string[]; conversationId: string }
  | { type: 'done'; response: RunResponseStats }
