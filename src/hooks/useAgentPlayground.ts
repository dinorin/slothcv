// DEV-only: window.__agent__ for Claude Code / MCP automation
// See AGENT.md for full API docs.
import { useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Language, ChatMessage } from '../types';
import { ResumeData } from '../artifact/types';
import { compressImage } from '../artifact/utils';
import { listSessions } from '../services/storage';
import { SESSION_KEY } from './useSession';

interface AgentState {
  isLoading: boolean;
  messages: ChatMessage[];
  resumeData: ResumeData | null;
  isPreviewOpen: boolean;
  currentModel: string;
  language: Language;
}

interface Deps {
  agentStateRef: React.MutableRefObject<AgentState>;
  handleSendRef: React.MutableRefObject<(() => void) | null>;
  handleExportPdfRef: React.MutableRefObject<(() => void) | null>;
  handleSwitchSessionRef: React.MutableRefObject<((id: string) => void) | null>;
  handleNewChat: () => void;
  setInput: (v: string) => void;
  setPendingPhoto: (photo: string | null) => void;
  setIsPreviewOpen: (open: boolean) => void;
  setSettingsOpen: (open: boolean) => void;
  setDarkMode: (v: boolean) => void;
  setLanguage: (lang: Language) => void;
  showToast: (text: string, type: 'info' | 'success' | 'error') => void;
}

export function useAgentPlayground(deps: Deps) {
  const prevIsLoadingRef = useRef(false);

  const {
    agentStateRef, handleSendRef, handleExportPdfRef, handleSwitchSessionRef,
    handleNewChat, setInput, setPendingPhoto, setIsPreviewOpen,
    setSettingsOpen, setDarkMode, setLanguage, showToast,
  } = deps;

  // Dispatch CustomEvents for event-based monitoring
  const agentLog = (event: string, detail: object) => {
    if (!import.meta.env.DEV) return;
    const entry = { event, time: Date.now(), detail };
    const log: any[] = (window as any).__slothcv_log__ ?? [];
    log.push(entry);
    if (log.length > 200) log.shift();
    (window as any).__slothcv_log__ = log;
    window.dispatchEvent(new CustomEvent(event, { detail }));
  };

  // Fire slothcv:loading / slothcv:idle on isLoading transitions
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const { isLoading, messages, resumeData } = agentStateRef.current;
    if (isLoading === prevIsLoadingRef.current) return;
    prevIsLoadingRef.current = isLoading;
    if (isLoading) {
      agentLog('slothcv:loading', {});
    } else {
      const lastMsg = [...messages].reverse().find(m => m.role === 'ai' && !m.isTyping);
      agentLog('slothcv:idle', {
        hasResume: !!resumeData?.resume_html,
        messageCount: messages.length,
        lastMessage: lastMsg?.content?.slice(0, 400) ?? null,
      });
    }
  }); // runs every render, checks ref for change

  // Fire slothcv:resume when resumeData changes
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const html = agentStateRef.current.resumeData?.resume_html;
    if (html) agentLog('slothcv:resume', { length: html.length });
  }); // runs every render, harmless (agentLog checks DEV)

  // Mount window.__agent__
  useEffect(() => {
    if (!import.meta.env.DEV) return;

    (window as any).__agent__ = {
      // ── Input ──────────────────────────────────────────────────────────────
      send: (text: string) => { setInput(text); setTimeout(() => handleSendRef.current?.(), 50); },
      setInput,
      submit: () => handleSendRef.current?.(),
      clear: () => setInput(''),

      // ── Session ────────────────────────────────────────────────────────────
      newChat: () => handleNewChat(),
      getCurrentSessionId: () => localStorage.getItem(SESSION_KEY),
      getSessions: () => listSessions(),
      switchSession: (id: string) => handleSwitchSessionRef.current?.(id),

      // ── State inspection ───────────────────────────────────────────────────
      getState: () => ({
        isLoading: agentStateRef.current.isLoading,
        hasResume: !!agentStateRef.current.resumeData?.resume_html,
        isPreviewOpen: agentStateRef.current.isPreviewOpen,
        messageCount: agentStateRef.current.messages.length,
        currentModel: agentStateRef.current.currentModel,
        language: agentStateRef.current.language,
      }),
      getMessages: (n?: number) => {
        const msgs = agentStateRef.current.messages.map(m => ({ role: m.role, content: m.content }));
        return n !== undefined ? msgs.slice(-n) : msgs;
      },
      getLastAiMessage: () => {
        const msgs = agentStateRef.current.messages;
        return [...msgs].reverse().find(m => m.role === 'ai' && !m.isTyping)?.content ?? null;
      },
      getResumeHtml: () => agentStateRef.current.resumeData?.resume_html ?? null,

      // ── Event system ───────────────────────────────────────────────────────
      on:  (event: string, cb: (e: CustomEvent) => void) => window.addEventListener(event, cb as EventListener),
      off: (event: string, cb: (e: CustomEvent) => void) => window.removeEventListener(event, cb as EventListener),
      waitForEvent: (event: string, timeout = 30000) => new Promise((resolve, reject) => {
        const timer = setTimeout(() => { window.removeEventListener(event, handler); reject(new Error(`waitForEvent("${event}") timeout`)); }, timeout);
        const handler = (e: Event) => { clearTimeout(timer); resolve((e as CustomEvent).detail); };
        window.addEventListener(event, handler, { once: true });
      }),
      getLog: () => (window as any).__slothcv_log__ ?? [],
      clearLog: () => { (window as any).__slothcv_log__ = []; },

      // ── Async helpers ──────────────────────────────────────────────────────
      waitForIdle: (timeout = 60000) => new Promise<boolean>((resolve, reject) => {
        if (!agentStateRef.current.isLoading) return resolve(true);
        const timer = setTimeout(() => { window.removeEventListener('slothcv:idle', onIdle); reject(new Error('waitForIdle timeout')); }, timeout);
        const onIdle = () => { clearTimeout(timer); resolve(true); };
        window.addEventListener('slothcv:idle', onIdle, { once: true });
      }),

      // ── Photo ──────────────────────────────────────────────────────────────
      attachPhoto: async (url: string) => {
        const dataUri = await invoke<string>('fetch_image_base64', { url });
        const compressed = await compressImage(dataUri);
        setPendingPhoto(compressed);
      },
      removePhoto: () => setPendingPhoto(null),

      // ── UI control ─────────────────────────────────────────────────────────
      openPreview:    () => setIsPreviewOpen(true),
      closePreview:   () => setIsPreviewOpen(false),
      openSettings:   () => setSettingsOpen(true),
      closeSettings:  () => setSettingsOpen(false),
      setDarkMode,
      setLanguage,
      exportPdf:      () => handleExportPdfRef.current?.(),
      showToast,
    };

    return () => { delete (window as any).__agent__; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
}
