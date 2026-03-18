import { invoke } from '@tauri-apps/api/core';
import { ChatMessage } from '../types';

export interface StoredSession {
  id: string;
  title: string;
  created_at: number;
  messages: ChatMessage[];
  resume_html?: string;
  notes?: string;
  photo?: string;
}

export interface SessionSummary {
  id: string;
  title: string;
  created_at: number;
  has_resume: boolean;
}

export const saveSession = (session: StoredSession): Promise<void> =>
  invoke('save_session', { session });

export const listSessions = (): Promise<SessionSummary[]> =>
  invoke('list_sessions');

export const loadSession = (id: string): Promise<StoredSession> =>
  invoke('load_session', { id });

export const deleteSession = (id: string): Promise<void> =>
  invoke('delete_session', { id });
