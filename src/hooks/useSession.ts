import { useState, useEffect, useCallback, useRef } from 'react';
import { ChatMessage } from '../types';
import { ResumeData } from '../artifact/types';
import {
  saveSession, listSessions, loadSession, deleteSession,
  StoredSession, SessionSummary,
} from '../services/storage';

export const SESSION_KEY = 'slothcv_current_session';

export function generateId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function getPersistedSessionId(): string | null {
  return localStorage.getItem(SESSION_KEY);
}

export function useSession(newChatLabel: string, welcomeMessage: string) {
  const [sessionId, setSessionId] = useState(() => getPersistedSessionId() ?? generateId());
  const [sessionTitle, setSessionTitle] = useState(newChatLabel);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [resumeData, setResumeData] = useState<ResumeData | null>(null);
  const [notes, setNotes] = useState('');
  const [userPhoto, setUserPhoto] = useState<string | null>(null);
  const [pendingPhoto, setPendingPhoto] = useState<string | null>(null);

  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initRef = useRef(false);

  // Init: restore persisted session (StrictMode-safe)
  useEffect(() => {
    if (initRef.current) return;
    initRef.current = true;
    listSessions().then(setSessions).catch(() => {});
    const savedId = getPersistedSessionId();
    if (savedId) {
      loadSession(savedId).then(stored => {
        setSessionId(stored.id);
        setSessionTitle(stored.title);
        setMessages(stored.messages);
        setResumeData(stored.resume_html ? { resume_html: stored.resume_html } as ResumeData : null);
        setNotes(stored.notes ?? '');
        setUserPhoto(stored.photo ?? null);
      }).catch(() => {
        localStorage.removeItem(SESSION_KEY);
        setMessages([{ role: 'ai', content: welcomeMessage }]);
      });
    } else {
      setMessages([{ role: 'ai', content: welcomeMessage }]);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Persist current session ID so HMR/reload restores it
  useEffect(() => {
    localStorage.setItem(SESSION_KEY, sessionId);
  }, [sessionId]);

  // Auto-save (1s debounce)
  const persistSession = useCallback((
    sid: string, title: string, msgs: ChatMessage[],
    rd: ResumeData | null, n: string, photo: string | null,
  ) => {
    if (msgs.length <= 1) return;
    const stored: StoredSession = {
      id: sid, title, created_at: Date.now(),
      messages: msgs, resume_html: rd?.resume_html, notes: n, photo: photo ?? undefined,
    };
    saveSession(stored).catch(() => {});
    listSessions().then(setSessions).catch(() => {});
  }, []);

  useEffect(() => {
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    autoSaveTimer.current = setTimeout(() => {
      persistSession(sessionId, sessionTitle, messages, resumeData, notes, userPhoto);
    }, 1000);
    return () => { if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current); };
  }, [messages, resumeData, notes, sessionId, sessionTitle, userPhoto, persistSession]);

  const resetSession = useCallback(() => {
    setSessionId(generateId());
    setSessionTitle(newChatLabel);
    setMessages([{ role: 'ai', content: welcomeMessage }]);
    setResumeData(null);
    setNotes('');
    setUserPhoto(null);
    setPendingPhoto(null);
  }, [newChatLabel, welcomeMessage]);

  const switchToSession = useCallback(async (id: string) => {
    const stored = await loadSession(id);
    setSessionId(stored.id);
    setSessionTitle(stored.title);
    setMessages(stored.messages);
    setResumeData(stored.resume_html ? { resume_html: stored.resume_html } as ResumeData : null);
    setNotes(stored.notes ?? '');
    setUserPhoto(stored.photo ?? null);
    setPendingPhoto(null);
  }, []);

  const removeSession = useCallback(async (id: string): Promise<boolean> => {
    await deleteSession(id);
    setSessions(prev => prev.filter(s => s.id !== id));
    return id === sessionId;
  }, [sessionId]);

  return {
    sessionId, setSessionId,
    sessionTitle, setSessionTitle,
    sessions, setSessions,
    messages, setMessages,
    resumeData, setResumeData,
    notes, setNotes,
    userPhoto, setUserPhoto,
    pendingPhoto, setPendingPhoto,
    resetSession, switchToSession, removeSession,
  };
}
