// src/dashboard/types.ts

/**
 * Messages sent from the client (frontend) to the server
 */
export type ClientMessage =
  | { type: 'register'; sessionId: string }
  | { type: 'message'; sessionId: string; content: string };

/**
 * Message statistics
 */
export interface MessageStats {
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  costCny?: number;
  elapsedMs?: number;
}

/**
 * Message structure
 */
export interface MessageData {
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  stats?: MessageStats;
}

/**
 * Messages sent from the server (backend) to the client
 */
export type ServerMessage =
  | { type: 'response'; sessionId: string; data: { text: string } }
  | { type: 'stream_start'; sessionId: string; data: Record<string, never> }
  | { type: 'stream_delta'; sessionId: string; data: { text: string } }
  | { type: 'stream_end'; sessionId: string; data: Record<string, never> }
  | { type: 'stream_stats'; sessionId: string; data: MessageStats }
  | { type: 'error'; sessionId: string; data: { message: string } }
  | { type: 'sessions_update'; sessionId: string; data: { sessions: SessionInfo[] } }
  | { type: 'history'; sessionId: string; data: { messages: MessageData[] } }
  | { type: 'switch_session'; sessionId: string; data: { newSessionId: string } }

/**
 * Session information shared with the client
 */
export interface SessionInfo {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
}

/**
 * Message handlers for WebSocket server
 */
export interface MessageHandlers {
  onMessage: (
    sessionId: string,
    text: string,
    replyFn: (response: { text: string }) => void,
    streamFn: (stream: AsyncIterable<{ text: string }>) => void
  ) => Promise<void>;
  onDisconnect: (sessionId: string) => void;
  onConnect?: (sessionId: string, ws: any, connectionId: string) => void;
  onSessionChange?: (
    oldSessionId: string | null,
    newSessionId: string,
    ws: any,
    connectionId: string
  ) => void;
}
