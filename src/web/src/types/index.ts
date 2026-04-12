export interface MessageStats {
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  costCny?: number;
  elapsedMs?: number;
}

export interface Message {
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  stats?: MessageStats;
  thinkingContent?: string;
}

export interface Session {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
}

export type ConnectionStatus = 'connected' | 'connecting' | 'disconnected' | 'reconnecting';

export type WSMessage =
  | { type: 'register'; sessionId: string }
  | { type: 'message'; sessionId: string; content: string };

export type WSServerMessage =
  | { type: 'response'; sessionId: string; data: { text: string } }
  | { type: 'stream_start'; sessionId: string; data: Record<string, never> }
  | { type: 'stream_delta'; sessionId: string; data: { text: string; isThinking?: boolean } }
  | { type: 'stream_end'; sessionId: string; data: Record<string, never> }
  | { type: 'stream_stats'; sessionId: string; data: MessageStats }
  | { type: 'error'; sessionId: string; data: { message: string } }
  | { type: 'sessions_update'; sessionId: string; data: { sessions: Session[] } }
  | { type: 'history'; sessionId: string; data: { messages: Message[] } }
  | { type: 'switch_session'; sessionId: string; data: { newSessionId: string } };
