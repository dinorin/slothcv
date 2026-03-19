import { useEffect, useRef, useState, useCallback } from 'react';
import { Eye, EyeOff, FileDown, Settings, MessageSquare } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { invoke } from '@tauri-apps/api/core';
import TitleBar from './components/TitleBar';
import SettingsModal from './components/SettingsModal';
import ConfirmModal from './components/ConfirmModal';
import Sidebar from './components/Sidebar';
import MessageList from './components/MessageList';
import ChatInputArea from './components/ChatInputArea';
import PreviewPanel from './components/PreviewPanel';
import { useResizable } from './hooks/useResizable';
import { generateResume, HistoryMessage } from './services/llm';
import { getSettings } from './services/settings';
import { saveSession, listSessions, loadSession, deleteSession, StoredSession, SessionSummary } from './services/storage';
import { ChatMessage, Language, ResumeData, AppSettings } from './types';
import { TRANSLATIONS } from './constants';
import { cn } from './lib/utils';

function generateId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

const SESSION_KEY = 'slothcv_current_session';

function getPersistedSessionId(): string | null {
  // localStorage persists across HMR reloads (sessionStorage is cleared by Tauri/Vite HMR)
  return localStorage.getItem(SESSION_KEY);
}

const compressImage = (dataUri: string): Promise<string> =>
  new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      const MAX = 400;
      const scale = Math.min(MAX / img.width, MAX / img.height, 1);
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL('image/jpeg', 0.85));
    };
    img.src = dataUri;
  });

export default function App() {
  const [language, setLanguage] = useState<Language>('en');
  const t = TRANSLATIONS[language];

  const [darkMode, setDarkMode] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const [sessionId, setSessionId] = useState(() => getPersistedSessionId() ?? generateId());
  const [sessionTitle, setSessionTitle] = useState<string>(t.newChat);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [resumeData, setResumeData] = useState<ResumeData | null>(null);
  const [notes, setNotes] = useState('');
  const [userPhoto, setUserPhoto] = useState<string | null>(null);

  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [sidebarOpen, setSidebarOpen] = useState(true);

  const sidebar = useResizable('sidebar', 240, 160, 450);
  const preview = useResizable('preview', 600, 400, 1200);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [isPdfExporting, setIsPdfExporting] = useState(false);

  const [input, setInput] = useState('');
  const handleSendRef = useRef<(() => void) | null>(null);
  const [appSettings, setAppSettings] = useState<AppSettings | null>(null);
  const [currentModel, setCurrentModel] = useState('');
  const [quickModels, setQuickModels] = useState<string[]>([]);
  const [isLoadingModels, setIsLoadingModels] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [agentStatus, setAgentStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [pendingPhoto, setPendingPhoto] = useState<string | null>(null);
  const [toastMsg, setToastMsg] = useState<{ text: string; type: 'info' | 'success' | 'error' } | null>(null);
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [editInput, setEditInput] = useState('');

  const fileInputRef = useRef<HTMLInputElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isAbortedRef = useRef(false);
  const sessionInitRef = useRef(false); // Guard against React StrictMode double-invocation

  // Agent-readable state refs (DEV only)
  const agentStateRef = useRef({ isLoading: false, messages: [] as ChatMessage[], resumeData: null as ResumeData | null, isPreviewOpen: false, currentModel: '', language: 'en' as Language });
  const handleExportPdfRef = useRef<(() => void) | null>(null);
  const handleSwitchSessionRef = useRef<((id: string) => void) | null>(null);
  const prevIsLoadingRef = useRef(false);

  const showToast = useCallback((text: string, type: 'info' | 'success' | 'error' = 'info') => {
    setToastMsg({ text, type });
    setTimeout(() => setToastMsg(null), 3500);
  }, []);

  // ── Init ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    invoke('app_ready').catch(() => {});
    const noCtx = (e: MouseEvent) => e.preventDefault();
    document.addEventListener('contextmenu', noCtx);
    getSettings().then(s => {
      setDarkMode(s.dark_mode);
      setAppSettings(s);
      setCurrentModel(s.llm.model);
    }).catch(() => {});
    return () => document.removeEventListener('contextmenu', noCtx);
  }, []);

  useEffect(() => {
    // Guard: React StrictMode double-invokes effects in dev; run init only once
    if (sessionInitRef.current) return;
    sessionInitRef.current = true;

    listSessions().then(setSessions).catch(() => {});
    const savedId = getPersistedSessionId();
    if (savedId) {
      loadSession(savedId).then(stored => {
        setSessionId(stored.id);
        setSessionTitle(stored.title);
        setMessages(stored.messages);
        setResumeData(stored.resume_html ? { ...({} as ResumeData), resume_html: stored.resume_html } : null);
        setNotes(stored.notes ?? '');
        setUserPhoto(stored.photo ?? null);
      }).catch(() => {
        localStorage.removeItem(SESSION_KEY);
        setMessages([{ role: 'ai', content: t.welcome }]);
      });
    } else {
      setMessages([{ role: 'ai', content: t.welcome }]);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Persist current session ID so HMR/reload restores it
  useEffect(() => {
    localStorage.setItem('slothcv_current_session', sessionId);
  }, [sessionId]);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode);
    localStorage.setItem('slothcv_dark', darkMode ? '1' : '0');
  }, [darkMode]);

  // ── Auto-save ────────────────────────────────────────────────────────────
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

  // ── LLM helpers ──────────────────────────────────────────────────────────
  const simulateStreaming = async (fullContent: string) => {
    const aiMsg: ChatMessage = { role: 'ai', content: '', isTyping: true };
    setMessages(prev => [...prev, aiMsg]);
    let current = '';
    for (let i = 0; i < fullContent.length; i++) {
      current += fullContent[i];
      setMessages(prev => {
        const last = [...prev];
        last[last.length - 1] = { ...last[last.length - 1], content: current };
        return last;
      });
      await new Promise(r => setTimeout(r, 15));
    }
    setMessages(prev => {
      const last = [...prev];
      last[last.length - 1] = { ...last[last.length - 1], isTyping: false };
      return last;
    });
  };

  const callLlm = async (
    history: HistoryMessage[],
    photo: string | undefined,
    rd: ResumeData | null,
  ) => {
    const isFirstBuild = !rd;
    const result = await generateResume(
      history, rd ?? undefined, false, notes, language, photo,
      s => setAgentStatus(s), () => isAbortedRef.current,
    );
    if (isAbortedRef.current) return;
    await simulateStreaming(result.coach_message ?? '');
    if (isAbortedRef.current) return;
    setMessages(prev => {
      const last = [...prev];
      const lastMsg = last[last.length - 1];
      last[last.length - 1] = {
        ...lastMsg,
        options: result.metadata?.suggested_options,
        isResumeUpdate: result.metadata?.is_data_modified,
        resumeHtml: result.resume_html || lastMsg.resumeHtml,
      };
      return last;
    });
    if (result.metadata?.is_data_modified) {
      setResumeData(result);
      if (isFirstBuild) setIsPreviewOpen(true);
    }
  };

  const handleLlmError = (e: any) => {
    if (e.message === 'ABORTED') return;
    const errMsg = String(e);
    const isKeyError = ['api key', 'mã khóa api', 'api_key', '401', '403'].some(k => errMsg.toLowerCase().includes(k));
    setMessages(prev => [...prev, {
      role: 'ai',
      content: isKeyError ? t.apiKeyMissing : `${t.errorLabel}: ${errMsg}`,
      options: isKeyError ? [t.openSettings] : undefined,
      isError: true,
    }]);
    if (!isKeyError) setError(errMsg);
  };

  const stopProcessing = useCallback(() => {
    isAbortedRef.current = true;
    setIsLoading(false);
    setAgentStatus(null);
    setMessages(prev => {
      if (!prev.length) return prev;
      const last = prev[prev.length - 1];
      if (last.role === 'user' || last.isTyping) {
        const trimmed = prev.slice(0, -1);
        if (last.role === 'ai' && trimmed.length && trimmed[trimmed.length - 1].role === 'user') {
          const trigger = trimmed[trimmed.length - 1];
          if (trigger.resumeHtml) setResumeData({ ...({} as ResumeData), resume_html: trigger.resumeHtml });
          return trimmed.slice(0, -1);
        }
        if (last.role === 'user' && last.resumeHtml) setResumeData({ ...({} as ResumeData), resume_html: last.resumeHtml });
        return trimmed;
      }
      return prev;
    });
  }, []);

  const handleSend = useCallback(async () => {
    if (isLoading) return;
    const userMsg = input.trim();
    if (!userMsg && !pendingPhoto) return;
    const attachedPhoto = pendingPhoto;
    const activePhoto = attachedPhoto || userPhoto;
    if (attachedPhoto) setUserPhoto(attachedPhoto);
    setPendingPhoto(null);
    setInput('');
    setError(null);
    const newMsg: ChatMessage = {
      role: 'user', content: userMsg || '(Photo attached)',
      photo: attachedPhoto ?? undefined, resumeHtml: resumeData?.resume_html,
    };
    const updated = [...messages, newMsg];
    setMessages(updated);
    setIsLoading(true);
    isAbortedRef.current = false;
    if (sessionTitle === t.newChat && userMsg) setSessionTitle(userMsg.slice(0, 40));
    const history: HistoryMessage[] = updated.filter(m => !m.isError).slice(1).slice(-15).map(m => ({ role: m.role, content: m.content }));
    try {
      await callLlm(history, activePhoto ?? undefined, resumeData);
    } catch (e: any) {
      handleLlmError(e);
    } finally {
      setIsLoading(false);
      setAgentStatus(null);
    }
  }, [input, pendingPhoto, messages, resumeData, notes, language, userPhoto, sessionTitle, t]);

  useEffect(() => { handleSendRef.current = handleSend; }, [handleSend]);

  // ── Sync agent-readable state refs ───────────────────────────────────────
  useEffect(() => {
    agentStateRef.current = { isLoading, messages, resumeData, isPreviewOpen, currentModel, language };
  }, [isLoading, messages, resumeData, isPreviewOpen, currentModel, language]);

  // ── Dispatch agent events (DEV only) ─────────────────────────────────────
  const agentLog = (event: string, detail: object) => {
    if (!import.meta.env.DEV) return;
    const entry = { event, time: Date.now(), detail };
    const log: any[] = (window as any).__slothcv_log__ ?? [];
    log.push(entry);
    if (log.length > 100) log.shift();
    (window as any).__slothcv_log__ = log;
    window.dispatchEvent(new CustomEvent(event, { detail }));
  };

  useEffect(() => {
    if (!import.meta.env.DEV) return;
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
  }, [isLoading]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!import.meta.env.DEV || !resumeData?.resume_html) return;
    agentLog('slothcv:resume', { length: resumeData.resume_html.length });
  }, [resumeData]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Agent playground (DEV only) ───────────────────────────────────────────
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    (window as any).__agent__ = {
      // ── Send / input ──────────────────────────────────────────────────────
      send: (text: string) => { setInput(text); setTimeout(() => handleSendRef.current?.(), 50); },
      setInput: (text: string) => setInput(text),
      submit: () => handleSendRef.current?.(),
      clear: () => setInput(''),

      // ── Session ───────────────────────────────────────────────────────────
      newChat: () => handleNewChat(),
      getCurrentSessionId: () => agentStateRef.current ? localStorage.getItem(SESSION_KEY) : null,
      getSessions: () => listSessions(),
      switchSession: (id: string) => handleSwitchSessionRef.current?.(id),

      // ── State inspection ──────────────────────────────────────────────────
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

      // ── Event system ──────────────────────────────────────────────────────
      // Events fired: slothcv:loading, slothcv:idle, slothcv:resume
      on: (event: string, cb: (e: CustomEvent) => void) =>
        window.addEventListener(event, cb as EventListener),
      off: (event: string, cb: (e: CustomEvent) => void) =>
        window.removeEventListener(event, cb as EventListener),
      waitForEvent: (event: string, timeout = 30000) => new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          window.removeEventListener(event, handler);
          reject(new Error(`waitForEvent("${event}") timeout after ${timeout}ms`));
        }, timeout);
        const handler = (e: Event) => { clearTimeout(timer); resolve((e as CustomEvent).detail); };
        window.addEventListener(event, handler, { once: true });
      }),
      getLog: () => (window as any).__slothcv_log__ ?? [],
      clearLog: () => { (window as any).__slothcv_log__ = []; },

      // ── Async helpers ─────────────────────────────────────────────────────
      waitForIdle: (timeout = 60000) => new Promise<boolean>((resolve, reject) => {
        // Already idle — resolve immediately
        if (!agentStateRef.current.isLoading) return resolve(true);
        const timer = setTimeout(() => {
          window.removeEventListener('slothcv:idle', onIdle);
          reject(new Error(`waitForIdle timeout after ${timeout}ms`));
        }, timeout);
        const onIdle = () => { clearTimeout(timer); resolve(true); };
        window.addEventListener('slothcv:idle', onIdle, { once: true });
      }),

      // ── Photo ─────────────────────────────────────────────────────────────
      attachPhoto: async (url: string) => {
        const dataUri = await invoke<string>('fetch_image_base64', { url });
        const compressed = await compressImage(dataUri);
        setPendingPhoto(compressed);
      },
      removePhoto: () => setPendingPhoto(null),

      // ── UI control ────────────────────────────────────────────────────────
      openPreview: () => setIsPreviewOpen(true),
      closePreview: () => setIsPreviewOpen(false),
      openSettings: () => setSettingsOpen(true),
      closeSettings: () => setSettingsOpen(false),
      setDarkMode: (v: boolean) => setDarkMode(v),
      setLanguage: (lang: Language) => setLanguage(lang),
      exportPdf: () => handleExportPdfRef.current?.(),
      showToast: (text: string, type: 'info' | 'success' | 'error' = 'info') => showToast(text, type),
    };
    return () => { delete (window as any).__agent__; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleRetry = async (targetIdx?: number, overrideContent?: string) => {
    if (isLoading) return;
    const idx = targetIdx ?? messages.length - 1 - [...messages].reverse().findIndex(m => m.role === 'user');
    if (idx < 0) return;
    const msg = { ...messages[idx], ...(overrideContent ? { content: overrideContent } : {}) };
    const restoredRd = msg.resumeHtml ? { ...({} as ResumeData), resume_html: msg.resumeHtml } : null;
    setResumeData(restoredRd);
    const history = [...messages.slice(0, idx), msg];
    setMessages(history);
    setIsLoading(true);
    isAbortedRef.current = false;
    setAgentStatus(null);
    setError(null);
    setEditingIdx(null);
    const toSend: HistoryMessage[] = history.filter(m => !m.isError).slice(1).slice(-15).map(m => ({ role: m.role, content: m.content }));
    try {
      await callLlm(toSend, userPhoto ?? undefined, restoredRd);
    } catch (e: any) {
      handleLlmError(e);
    } finally {
      setIsLoading(false);
      setAgentStatus(null);
    }
  };

  // ── Session management ────────────────────────────────────────────────────
  const handleNewChat = () => {
    stopProcessing();
    setSessionId(generateId());
    setSessionTitle(t.newChat);
    setMessages([{ role: 'ai', content: t.welcome }]);
    setResumeData(null);
    setNotes('');
    setUserPhoto(null);
    setPendingPhoto(null);
    setError(null);
  };

  const handleSwitchSession = async (id: string) => {
    stopProcessing();
    try {
      const stored = await loadSession(id);
      setSessionId(stored.id);
      setSessionTitle(stored.title);
      setMessages(stored.messages);
      setResumeData(stored.resume_html ? { ...({} as ResumeData), resume_html: stored.resume_html } : null);
      setNotes(stored.notes ?? '');
      setUserPhoto(stored.photo ?? null);
      setPendingPhoto(null);
    } catch (e) { console.error(e); }
  };

  useEffect(() => { handleSwitchSessionRef.current = handleSwitchSession; });

  const handleDeleteSession = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    await deleteSession(id);
    setSessions(prev => prev.filter(s => s.id !== id));
    if (id === sessionId) handleNewChat();
  };

  // ── Model management ──────────────────────────────────────────────────────
  const fetchQuickModels = async () => {
    if (!appSettings) return;
    setIsLoadingModels(true);
    try {
      const provider = appSettings.llm.provider;
      const cfg = appSettings.llm.configs[provider] || { base_url: '', api_key: '', model: '' };
      const list = await invoke<string[]>('fetch_models', { provider, baseUrl: cfg.base_url, apiKey: cfg.api_key });
      setQuickModels(list);
    } catch (e) { console.error(e); }
    finally { setIsLoadingModels(false); }
  };

  const handleQuickModelChange = async (val: string) => {
    if (!appSettings) return;
    let nextProvider = appSettings.llm.provider;
    let nextModel = val;
    if (val.startsWith('provider:')) {
      nextProvider = val.replace('provider:', '');
      const cfg = appSettings.llm.configs[nextProvider];
      nextModel = cfg?.model || '';
      setIsLoadingModels(true);
      try {
        const list = await invoke<string[]>('fetch_models', { provider: nextProvider, baseUrl: cfg?.base_url || '', apiKey: cfg?.api_key || '' });
        setQuickModels(list);
        if (list.length && !nextModel) nextModel = list[0];
      } catch (e) { console.error(e); }
      finally { setIsLoadingModels(false); }
    }
    const next: AppSettings = {
      ...appSettings,
      llm: {
        ...appSettings.llm,
        provider: nextProvider, model: nextModel,
        base_url: appSettings.llm.configs[nextProvider]?.base_url || '',
        api_key: appSettings.llm.configs[nextProvider]?.api_key || '',
        configs: { ...appSettings.llm.configs, [nextProvider]: { ...appSettings.llm.configs[nextProvider], model: nextModel } },
      },
    };
    try {
      await invoke('save_settings', { settings: next });
      setAppSettings(next);
      setCurrentModel(nextModel);
    } catch (e) { console.error(e); }
  };

  // ── Photo helpers ─────────────────────────────────────────────────────────
  const handlePhotoFile = async (file: File) => {
    const reader = new FileReader();
    reader.onload = async ev => {
      setPendingPhoto(await compressImage(ev.target!.result as string));
    };
    reader.readAsDataURL(file);
  };

  const handlePhotoPaste = async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const item = Array.from(e.clipboardData.items).find(i => i.type.startsWith('image/'));
    if (!item) return;
    e.preventDefault();
    const file = item.getAsFile();
    if (file) handlePhotoFile(file);
  };

  // ── HTML injection for preview ─────────────────────────────────────────────
  const getInjectedHtml = (html?: string) => {
    if (!html) return '';
    const baseUrl = window.location.origin;
    const fontCss = `<style>
      * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      html, body { margin: 0 !important; padding: 0 !important; width: 210mm !important; height: 297mm !important; background-color: white; overflow: hidden; font-family: 'Inter', sans-serif; }
      @font-face { font-family: 'Inter'; src: url('${baseUrl}/fonts/Inter-Regular.woff2') format('woff2'); font-weight: 400; }
      @font-face { font-family: 'Inter'; src: url('${baseUrl}/fonts/Inter-SemiBold.woff2') format('woff2'); font-weight: 600; }
      @font-face { font-family: 'Inter'; src: url('${baseUrl}/fonts/Inter-Bold.woff2') format('woff2'); font-weight: 700; }
      @media print { @page { size: 210mm 297mm; margin: 0; } body { width: 210mm !important; height: 297mm !important; } }
    </style>`;
    return html.includes('</head>') ? html.replace('</head>', `${fontCss}</head>`) : fontCss + html;
  };

  // ── PDF export ─────────────────────────────────────────────────────────────
  const handleExportPdf = async () => {
    if (!resumeData?.resume_html || isPdfExporting) return;
    setIsPdfExporting(true);
    showToast(t.preparingPdf, 'info');
    try {
      const printStyles = `<style>@media print { @page { size: A4 portrait; margin: 0; } body { -webkit-print-color-adjust: exact; print-color-adjust: exact; margin: 0 !important; } }</style>`;
      let html = getInjectedHtml(resumeData.resume_html).replace('</head>', `${printStyles}</head>`);
      const iframe = document.createElement('iframe');
      iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:794px;height:1123px;border:none;opacity:0;pointer-events:none;z-index:-9999;';
      document.body.appendChild(iframe);
      await new Promise<void>(resolve => { iframe.onload = () => resolve(); iframe.srcdoc = html; });
      if (iframe.contentDocument && iframe.contentWindow) {
        await iframe.contentDocument.fonts.ready;
        await new Promise(r => setTimeout(r, 400));
        iframe.contentWindow.focus();
        iframe.contentWindow.print();
        showToast(t.pdfOpened, 'success');
      }
      setTimeout(() => { if (document.body.contains(iframe)) document.body.removeChild(iframe); }, 1000);
    } catch (e) {
      console.error(e);
      showToast(t.pdfError, 'error');
    } finally {
      setIsPdfExporting(false);
    }
  };

  useEffect(() => { handleExportPdfRef.current = handleExportPdf; });

  // ── Message actions ───────────────────────────────────────────────────────
  const handleCopy = (text: string, idx: number) => {
    navigator.clipboard.writeText(text);
    setCopiedIdx(idx);
    setTimeout(() => setCopiedIdx(null), 2000);
  };

  const startEditing = (idx: number, content: string) => {
    setEditingIdx(idx);
    setEditInput(content === '(Photo attached)' ? '' : content);
  };

  const cancelEditing = () => {
    if (editInput.trim()) setInput(editInput);
    setEditingIdx(null);
    setEditInput('');
  };

  const handleOptionClick = (opt: string) => {
    if (opt === 'Open Settings' || opt === 'Mở Cài Đặt') { setSettingsOpen(true); return; }
    setInput(opt);
  };

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className={cn('relative flex flex-col h-screen bg-white dark:bg-[#0a0a0a] text-zinc-900 dark:text-zinc-100 font-sans', darkMode && 'dark')}>
      <TitleBar t={t}>
        <button onClick={() => setSidebarOpen(p => !p)} title={t.toggleSidebar} className="p-1.5 rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-800/50 text-zinc-500 dark:text-zinc-400 transition-colors ml-1">
          <MessageSquare className="w-4 h-4" />
        </button>
        <span className="flex-1 text-[12px] font-medium text-zinc-400 dark:text-zinc-500 truncate px-2" data-tauri-drag-region>
          {sessionTitle}
        </span>
        <div className="flex items-center gap-1.5 pr-2">
          <button
            onClick={() => setIsPreviewOpen(p => !p)}
            title={isPreviewOpen ? t.hidePreview : t.showPreview}
            className={cn(
              'flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[11px] font-medium transition-colors border',
              isPreviewOpen
                ? 'bg-zinc-100 border-zinc-200 dark:bg-zinc-800 dark:border-zinc-700 text-zinc-900 dark:text-zinc-100'
                : 'border-transparent hover:bg-zinc-100 dark:hover:bg-zinc-800/50 text-zinc-500 dark:text-zinc-400',
            )}
          >
            {isPreviewOpen ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
            {t.preview}
          </button>
          {resumeData?.resume_html && (
            <button
              onClick={handleExportPdf}
              disabled={isPdfExporting}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[11px] font-medium bg-zinc-900 hover:bg-black dark:bg-zinc-100 dark:hover:bg-white text-white dark:text-black transition-colors disabled:opacity-60"
            >
              <FileDown className="w-3.5 h-3.5" />
              {isPdfExporting ? t.exporting : 'PDF'}
            </button>
          )}
          <button onClick={() => setSettingsOpen(true)} title={t.settings} className="p-1.5 rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-800/50 text-zinc-500 dark:text-zinc-400 transition-colors ml-1">
            <Settings className="w-4 h-4" />
          </button>
        </div>
      </TitleBar>

      <AnimatePresence>
        {toastMsg && (
          <motion.div
            initial={{ opacity: 0, y: 50, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9, transition: { duration: 0.2 } }}
            className="fixed bottom-6 right-6 z-50 flex items-center gap-2 px-4 py-3 rounded-lg shadow-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-[13px] font-medium text-zinc-800 dark:text-zinc-200"
          >
            {toastMsg.type === 'success' && <span className="text-green-500">✅</span>}
            {toastMsg.type === 'error' && <span className="text-red-500">❌</span>}
            {toastMsg.type === 'info' && <span className="text-blue-500 animate-pulse">⏳</span>}
            {toastMsg.text}
          </motion.div>
        )}
      </AnimatePresence>

      <SettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onDarkModeChange={setDarkMode}
        onSaved={(_p, model) => {
          setCurrentModel(model);
          setQuickModels([]);
          getSettings().then(setAppSettings).catch(() => {});
        }}
        onClearData={() => { setSessions([]); setCurrentModel(''); handleNewChat(); }}
        t={t}
      />

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={e => {
          const file = e.target.files?.[0];
          if (file) handlePhotoFile(file);
          e.target.value = '';
        }}
      />

      <div className="flex flex-1 overflow-hidden pt-10">
        <Sidebar
          width={sidebar.width}
          isOpen={sidebarOpen}
          isResizing={sidebar.isResizing}
          sessions={sessions}
          currentSessionId={sessionId}
          language={language}
          t={t}
          onResizeStart={sidebar.startResizing}
          onNewChat={handleNewChat}
          onSwitchSession={handleSwitchSession}
          onDeleteSession={handleDeleteSession}
          onLanguageChange={setLanguage}
        />

        <div className="flex flex-col flex-1 min-w-0 overflow-hidden bg-white dark:bg-[#0a0a0a]">
          <MessageList
            messages={messages}
            isLoading={isLoading}
            agentStatus={agentStatus}
            error={error}
            copiedIdx={copiedIdx}
            editingIdx={editingIdx}
            editInput={editInput}
            isPreviewOpen={isPreviewOpen}
            t={t}
            onCopy={handleCopy}
            onStartEditing={startEditing}
            onCancelEditing={cancelEditing}
            onEditInputChange={setEditInput}
            onRetry={handleRetry}
            onOptionClick={handleOptionClick}
            onOpenPreview={() => setIsPreviewOpen(true)}
          />
          <ChatInputArea
            input={input}
            pendingPhoto={pendingPhoto}
            isLoading={isLoading}
            currentModel={currentModel}
            quickModels={quickModels}
            isLoadingModels={isLoadingModels}
            appSettings={appSettings}
            t={t}
            onInputChange={setInput}
            onSend={handleSend}
            onStop={stopProcessing}
            onPhotoPaste={handlePhotoPaste}
            onAttachClick={() => fileInputRef.current?.click()}
            onRemovePhoto={() => setPendingPhoto(null)}
            onModelChange={handleQuickModelChange}
            onFetchModels={fetchQuickModels}
            onOpenSettings={() => setSettingsOpen(true)}
          />
        </div>

        <PreviewPanel
          width={preview.width}
          isOpen={isPreviewOpen}
          isResizing={preview.isResizing}
          resumeData={resumeData}
          t={t}
          onResizeStart={preview.startResizing}
          onClose={() => setIsPreviewOpen(false)}
          getInjectedHtml={getInjectedHtml}
        />
      </div>
    </div>
  );
}
