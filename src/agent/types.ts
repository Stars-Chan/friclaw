// src/agent/types.ts
export interface RunRequest {
  conversationId: string
  workspaceDir: string
  text: string
  attachments?: Array<{ type: 'image'; buffer: Buffer }>
  // 会话上下文，用于注入到 MCP 环境变量
  chatId?: string
  platform?: string
  userId?: string
  chatType?: 'private' | 'group'
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
