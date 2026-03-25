import { useEffect, useRef, useState, useCallback } from 'react';
import type { Message, ConnectionStatus, WSServerMessage } from '../types';

const MAX_RECONNECT_ATTEMPTS = 5;
const RECONNECT_DELAY = 2000;

export function useWebSocket(sessionId: string) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('connecting');
  const [error, setError] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const currentStreamRef = useRef<string>('');
  const reconnectAttemptsRef = useRef(0);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout>();

  const connect = useCallback(() => {
    try {
      const ws = new WebSocket(`ws://${window.location.hostname}:3000/ws`);
      wsRef.current = ws;

      ws.onopen = () => {
        setIsConnected(true);
        setConnectionStatus('connected');
        setError(null);
        reconnectAttemptsRef.current = 0;
        ws.send(JSON.stringify({ type: 'register', sessionId }));
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
              setMessages((prev) => [...prev, { role: 'assistant', content: '', timestamp: Date.now() }]);
              break;
            case 'stream_delta':
              currentStreamRef.current += data.data.text;
              setMessages((prev) => {
                const newMessages = [...prev];
                if (newMessages.length > 0 && newMessages[newMessages.length - 1].role === 'assistant') {
                  newMessages[newMessages.length - 1].content = currentStreamRef.current;
                }
                return newMessages;
              });
              break;
            case 'stream_end':
              currentStreamRef.current = '';
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
      wsRef.current.send(JSON.stringify({ type: 'message', sessionId, content: text }));
    } else {
      setError('连接未就绪，无法发送消息');
    }
  }, [sessionId]);

  return { messages, isConnected, sendMessage, connectionStatus, error };
}
