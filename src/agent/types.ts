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

export type AgentStreamEvent =
  | { type: 'thinking_delta'; text: string }
  | { type: 'text_delta'; text: string }
  | { type: 'tool_use'; name: string; input: unknown }
  | { type: 'ask_questions'; questions: string[]; conversationId: string }
  | { type: 'done'; response: { text: string; sessionId: string } }
