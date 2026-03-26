import { useEffect, useRef, useState, useCallback } from 'react';
import type { Message, ConnectionStatus, WSServerMessage } from '../types';

const MAX_RECONNECT_ATTEMPTS = 5;
const RECONNECT_DELAY = 2000;

// 获取 WebSocket URL
// 优先级：环境变量 > 默认端口 3000
function getWebSocketURL(): string {
  const hostname = window.location.hostname;

  // 从环境变量读取端口（Vite: VITE_WS_PORT）
  const wsPort = import.meta.env.VITE_WS_PORT || '3000';

  // 开发环境通常前端在 5173，后端在 3000
  // 生产环境可能同端口
  const port = window.location.port === '5173' ? wsPort : window.location.port;

  return `ws://${hostname}:${port}/ws`;
}

export function useWebSocket(sessionId: string, onSessionSwitch?: (newSessionId: string) => void) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('connecting');
  const [error, setError] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const currentStreamRef = useRef<string>('');
  const currentThinkingRef = useRef<string>('');
  const streamingMessageIndexRef = useRef<number | null>(null); // 追踪当前流式传输的消息索引
  const reconnectAttemptsRef = useRef(0);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout>();
  const sessionIdRef = useRef(sessionId);

  // Update ref when sessionId changes
  useEffect(() => {
    sessionIdRef.current = sessionId;
  }, [sessionId]);

  const connect = useCallback(() => {
    try {
      const wsUrl = getWebSocketURL();
      console.log('Connecting to WebSocket:', wsUrl);
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        setIsConnected(true);
        setConnectionStatus('connected');
        setError(null);
        reconnectAttemptsRef.current = 0;
        ws.send(JSON.stringify({ type: 'register', sessionId: sessionIdRef.current }));
      };

      ws.onclose = () => {
        setIsConnected(false);
        wsRef.current = null;

        if (reconnectAttemptsRef.current < MAX_RECONNECT_ATTEMPTS) {
          setConnectionStatus('reconnecting');
          reconnectTimeoutRef.current = setTimeout(() => {
            reconnectAttemptsRef.current++;
            connect();
          }, RECONNECT_DELAY);
        } else {
          setConnectionStatus('disconnected');
          setError('连接已断开，请刷新页面重试');
        }
      };

      ws.onerror = (event) => {
        console.error('WebSocket error:', event);
        setError('WebSocket 连接错误');
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data) as WSServerMessage;
          console.log('WebSocket message:', data);

          switch (data.type) {
            case 'history':
              setMessages(data.data.messages);
              break;
            case 'response':
              setMessages((prev) => [...prev, { role: 'assistant', content: data.data.text, timestamp: Date.now() }]);
              break;
            case 'stream_start':
              currentStreamRef.current = '';
              currentThinkingRef.current = '';
              setMessages((prev) => {
                const newMessages = [...prev, { role: 'assistant', content: '', timestamp: Date.now() }];
                // 记录新消息的索引
                streamingMessageIndexRef.current = newMessages.length - 1;
                return newMessages;
              });
              break;
            case 'stream_delta':
              if (data.data.isThinking) {
                currentThinkingRef.current += data.data.text;
              } else {
                currentStreamRef.current += data.data.text;
              }
              // 使用记录的索引直接更新消息，避免竞态条件
              if (streamingMessageIndexRef.current !== null) {
                setMessages((prev) => {
                  const idx = streamingMessageIndexRef.current;
                  // 确保索引仍然有效
                  if (idx !== null && idx >= 0 && idx < prev.length) {
                    return [
                      ...prev.slice(0, idx),
                      {
                        ...prev[idx],
                        content: currentStreamRef.current,
                        thinkingContent: currentThinkingRef.current || undefined,
                      },
                      ...prev.slice(idx + 1),
                    ];
                  }
                  return prev;
                });
              }
              break;
            case 'stream_end':
              currentStreamRef.current = '';
              currentThinkingRef.current = '';
              streamingMessageIndexRef.current = null; // 清除索引
              break;
            case 'stream_stats':
              setMessages((prev) => {
                const newMessages = [...prev];
                if (newMessages.length > 0 && newMessages[newMessages.length - 1].role === 'assistant') {
                  newMessages[newMessages.length - 1].stats = data.data;
                }
                return newMessages;
              });
              break;
            case 'error':
              setError(data.data.message);
              break;
            case 'switch_session':
              setMessages([]);
              if (onSessionSwitch) {
                onSessionSwitch(data.data.newSessionId);
              }
              break;
          }
        } catch (err) {
          console.error('Failed to parse WebSocket message:', err);
          setError('消息解析失败');
        }
      };
    } catch (err) {
      console.error('Failed to create WebSocket:', err);
      setError('无法创建 WebSocket 连接');
      setConnectionStatus('disconnected');
    }
  }, [sessionId]);

  useEffect(() => {
    connect();

    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [sessionId, connect]);

  const sendMessage = useCallback((text: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      setMessages((prev) => [...prev, { role: 'user', content: text, timestamp: Date.now() }]);
      wsRef.current.send(JSON.stringify({ type: 'message', sessionId: sessionIdRef.current, content: text }));
    } else {
      setError('连接未就绪，无法发送消息');
    }
  }, []);

  return { messages, isConnected, sendMessage, connectionStatus, error };
}
