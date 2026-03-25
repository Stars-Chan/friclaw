import { useState } from 'react';
import type { Session } from '../types';

export function useSessions() {
  const [sessions] = useState<Session[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState('default');

  const selectSession = (sessionId: string) => {
    setCurrentSessionId(sessionId);
  };

  const updateSession = (_sessionId: string, _updates: Partial<Session>) => {
    // Placeholder for session updates
  };

  return { sessions, currentSessionId, selectSession, updateSession };
}
