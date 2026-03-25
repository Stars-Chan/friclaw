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
  | { type: 'response'; data: { text: string } }
  | { type: 'stream_start'; data: Record<string, never> }
  | { type: 'stream_delta'; data: { text: string } }
  | { type: 'stream_end'; data: Record<string, never> }
  | { type: 'stream_stats'; data: MessageStats }
  | { type: 'error'; data: { message: string } }
  | { type: 'sessions_update'; data: { sessions: Session[] } }
  | { type: 'history'; data: { messages: Message[] } }
  | { type: 'switch_session'; data: { newSessionId: string } };
