import { useState, useEffect } from 'react';
import type { Session } from '../types';

const STORAGE_KEY = 'friclaw_current_session';

export function useSessions() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState(() => {
    return localStorage.getItem(STORAGE_KEY) || 'default';
  });

  useEffect(() => {
    fetch('http://localhost:3000/api/sessions')
      .then(res => res.json())
      .then(data => {
        setSessions(data.sessions);
        // If no saved session or saved session doesn't exist, use most recent
        const savedId = localStorage.getItem(STORAGE_KEY);
        if (!savedId || !data.sessions.find((s: Session) => s.id === savedId)) {
          if (data.sessions.length > 0) {
            setCurrentSessionId(data.sessions[0].id);
            localStorage.setItem(STORAGE_KEY, data.sessions[0].id);
          }
        }
      })
      .catch(err => console.error('Failed to load sessions:', err));
  }, []);

  const selectSession = (sessionId: string) => {
    setCurrentSessionId(sessionId);
    localStorage.setItem(STORAGE_KEY, sessionId);
  };

  const updateSession = (_sessionId: string, _updates: Partial<Session>) => {
    // Placeholder for session updates
  };

  return { sessions, currentSessionId, selectSession, updateSession };
}
