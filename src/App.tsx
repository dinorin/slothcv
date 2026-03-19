import { useEffect, useRef, useState, useCallback } from 'react';
import { MessageSquare, Plus, Trash2, Settings, FileDown, Eye, EyeOff, ChevronRight, ImagePlus, X, ZoomIn, ZoomOut, Maximize, Copy, RotateCcw, Check, Pencil, Square, Loader2, ChevronDown, ArrowUp } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { TransformWrapper, TransformComponent } from 'react-zoom-pan-pinch';
import ReactMarkdown from 'react-markdown';
import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';
import { invoke } from '@tauri-apps/api/core';
import TitleBar from './components/TitleBar';
import SettingsModal from './components/SettingsModal';
import { generateResume, HistoryMessage } from './services/llm';
import { getSettings } from './services/settings';
import { saveSession, listSessions, loadSession, deleteSession, StoredSession, SessionSummary } from './services/storage';
import { ChatMessage, Language, ResumeData } from './types';
import { PROVIDERS, TRANSLATIONS } from './constants';
import { cn } from './lib/utils';
import ConfirmModal from './components/ConfirmModal';
import appIcon from './assets/icon.svg';

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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

  // Session state
  const [sessionId, setSessionId] = useState<string>(generateId());
  const [sessionTitle, setSessionTitle] = useState<string>(t.newChat);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [resumeData, setResumeData] = useState<ResumeData | null>(null);
  const [notes, setNotes] = useState<string>('');
  const [userPhoto, setUserPhoto] = useState<string | null>(null);

  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sidebarWidth, setSidebarWidth] = useState(240);
  const [previewWidth, setPreviewWidth] = useState(600);
  const [isResizingSidebar, setIsResizingSidebar] = useState(false);
  const [isResizingPreview, setIsResizingPreview] = useState(false);

  const [input, setInput] = useState('');
  const [appSettings, setAppSettings] = useState<AppSettings | null>(null);
  const [currentModel, setCurrentModel] = useState<string>('');
  const [quickModels, setQuickModels] = useState<string[]>([]);
  const [isLoadingModels, setIsLoadingModels] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [agentStatus, setAgentStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [isPdfExporting, setIsPdfExporting] = useState(false);

  const fetchQuickModels = async () => {
    if (!appSettings) return;
    setIsLoadingModels(true);
    try {
      const provider = appSettings.llm.provider;
      const cfg = appSettings.llm.configs[provider] || { 
        base_url: provider === 'gemini' ? '' : 'https://api.openai.com/v1', 
        api_key: '', 
        model: '' 
      };
      
      console.log(`[QuickModel] Fetching for ${provider} at ${cfg.base_url}`);
      const list = await invoke<string[]>('fetch_models', { 
        provider, 
        baseUrl: cfg.base_url, 
        apiKey: cfg.api_key 
      });
      setQuickModels(list);
    } catch (e) {
      console.error(e);
    } finally {
      setIsLoadingModels(false);
    }
  };

  const handleQuickModelChange = async (val: string) => {
    if (!appSettings) return;
    
    let nextProvider = appSettings.llm.provider;
    let nextModel = val;

    // Nếu người dùng chọn một provider khác (ví dụ: "provider:deepseek")
    if (val.startsWith('provider:')) {
      nextProvider = val.replace('provider:', '');
      const providerCfg = appSettings.llm.configs[nextProvider];
      nextModel = providerCfg?.model || '';
      
      // Fetch models cho provider mới ngay lập tức để cập nhật list
      setIsLoadingModels(true);
      try {
        const list = await invoke<string[]>('fetch_models', { 
          provider: nextProvider, 
          baseUrl: providerCfg?.base_url || '', 
          apiKey: providerCfg?.api_key || '' 
        });
        setQuickModels(list);
        if (list.length > 0 && !nextModel) nextModel = list[0];
      } catch (e) { console.error(e); }
      finally { setIsLoadingModels(false); }
    }

    const nextSettings = {
      ...appSettings,
      llm: {
        ...appSettings.llm,
        provider: nextProvider,
        model: nextModel,
        // Cập nhật cả active fields
        base_url: appSettings.llm.configs[nextProvider]?.base_url || '',
        api_key: appSettings.llm.configs[nextProvider]?.api_key || '',
        configs: {
          ...appSettings.llm.configs,
          [nextProvider]: {
            ...appSettings.llm.configs[nextProvider],
            model: nextModel
          }
        }
      }
    };

    try {
      await invoke('save_settings', { settings: nextSettings });
      setAppSettings(nextSettings);
      setCurrentModel(nextModel);
    } catch (e) {
      console.error(e);
    }
  };

  const [pendingPhoto, setPendingPhoto] = useState<string | null>(null);
  const [toastMsg, setToastMsg] = useState<{ text: string; type: 'info' | 'success' | 'error' } | null>(null);
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [editInput, setEditInput] = useState('');

  const showToast = useCallback((text: string, type: 'info' | 'success' | 'error' = 'info') => {
    setToastMsg({ text, type });
    setTimeout(() => setToastMsg(null), 3500);
  }, []);

  const chatEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isAbortedRef = useRef(false);

  const stopProcessing = useCallback(() => {
    isAbortedRef.current = true;
    setIsLoading(false);
    setAgentStatus(null);
    
    // Rollback: remove the last message if it was a user message waiting for AI, 
    // or the last AI message if it was still typing.
    setMessages(prev => {
      if (prev.length === 0) return prev;
      const last = prev[prev.length - 1];
      if (last.role === 'user' || last.isTyping) {
        const newMsgs = prev.slice(0, -1);
        // If we removed an AI message, we might also want to remove the user message that triggered it
        if (last.role === 'ai' && newMsgs.length > 0 && newMsgs[newMsgs.length - 1].role === 'user') {
          // Restore resume data from the user message if it exists
          const triggerMsg = newMsgs[newMsgs.length - 1];
          if (triggerMsg.resumeHtml) {
            setResumeData({ ...({} as ResumeData), resume_html: triggerMsg.resumeHtml });
          }
          return newMsgs.slice(0, -1);
        }
        // If we removed a user message, restore its resumeHtml
        if (last.role === 'user' && last.resumeHtml) {
          setResumeData({ ...({} as ResumeData), resume_html: last.resumeHtml });
        }
        return newMsgs;
      }
      return prev;
    });
  }, []);

  // ── Auto-resize Textarea ───────────────────────────────────────────────────
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
    }
  }, [input]);

  // ── Resizable sidebars logic ─────────────────────────────────────────────
  const startResizingSidebar = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizingSidebar(true);
  };

  const startResizingPreview = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizingPreview(true);
  };

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (isResizingSidebar) {
        const newWidth = Math.max(160, Math.min(450, e.clientX));
        setSidebarWidth(newWidth);
      } else if (isResizingPreview) {
        const newWidth = Math.max(400, Math.min(1200, window.innerWidth - e.clientX));
        setPreviewWidth(newWidth);
      }
    };

    const handleMouseUp = () => {
      setIsResizingSidebar(false);
      setIsResizingPreview(false);
    };

    if (isResizingSidebar || isResizingPreview) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = 'col-resize';
    } else {
      document.body.style.cursor = 'default';
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizingSidebar, isResizingPreview]);

  // ── Dark mode toggle ──────────────────────────────────────────────────────
  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode);
    localStorage.setItem('slothcv_dark', darkMode ? '1' : '0');
  }, [darkMode]);

  // ── Show window after frontend is ready ────────────────────
  useEffect(() => {
    invoke('app_ready').catch(() => {});
    
    // Disable context menu completely
    const handleContextMenu = (e: MouseEvent) => {
      e.preventDefault();
    };
    document.addEventListener('contextmenu', handleContextMenu);

    // Load initial dark mode setting from Rust and apply it
    getSettings().then(s => {
      setDarkMode(s.dark_mode);
      setAppSettings(s);
      setCurrentModel(s.llm.model);
      if (s.dark_mode) localStorage.setItem('slothcv_dark', '1');
      else localStorage.setItem('slothcv_dark', '0');
    }).catch(() => {});

    return () => {
      document.removeEventListener('contextmenu', handleContextMenu);
    };
  }, []);

  // ── Load session list on mount ────────────────────────────────────────────
  useEffect(() => {
    listSessions().then(setSessions).catch(() => {});
    setMessages([{ role: 'ai', content: t.welcome }]);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Auto-scroll ───────────────────────────────────────────────────────────
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleClearAllData = () => {
    setSessions([]);
    setCurrentModel('');
    handleNewChat();
  };

  const simulateStreaming = async (fullContent: string) => {
    const aiMsg: ChatMessage = {
      role: 'ai',
      content: '',
      isTyping: true,
    };
    setMessages(prev => [...prev, aiMsg]);

    let current = '';
    const speed = 15; // ms per char
    for (let i = 0; i < fullContent.length; i++) {
      current += fullContent[i];
      setMessages(prev => {
        const last = [...prev];
        last[last.length - 1] = { ...last[last.length - 1], content: current };
        return last;
      });
      await new Promise(r => setTimeout(r, speed));
    }

    setMessages(prev => {
      const last = [...prev];
      last[last.length - 1] = { ...last[last.length - 1], isTyping: false };
      return last;
    });
  };

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
    if (editInput.trim()) {
      setInput(editInput);
    }
    setEditingIdx(null);
    setEditInput('');
  };

  const handleRetry = async (targetIdx?: number, overrideContent?: string) => {
    if (isLoading) return;

    let actualIdx: number;
    if (targetIdx !== undefined) {
      actualIdx = targetIdx;
    } else {
      // Find last user message
      const lastUserMsgIdx = [...messages].reverse().findIndex(m => m.role === 'user');
      if (lastUserMsgIdx === -1) return;
      actualIdx = messages.length - 1 - lastUserMsgIdx;
    }

    const lastUserMsg = { ...messages[actualIdx] };
    if (overrideContent) {
      lastUserMsg.content = overrideContent;
    }

    // Restore resume state from this point in history
    const restoredResumeData = lastUserMsg.resumeHtml 
      ? { ...({} as ResumeData), resume_html: lastUserMsg.resumeHtml } 
      : null;
    setResumeData(restoredResumeData);

    // Slice messages to remove everything from the retry point onwards
    const historyBeforeRetry = messages.slice(0, actualIdx);
    const newHistory = [...historyBeforeRetry, lastUserMsg];
    setMessages(newHistory);

    setIsLoading(true);
    isAbortedRef.current = false;
    setAgentStatus(null);
    setError(null);
    setEditingIdx(null);

    const historyToSend: HistoryMessage[] = newHistory
      .filter(m => !m.isError)
      .slice(1)
      .slice(-15)
      .map(m => ({ role: m.role, content: m.content }));

    try {
      const isFirstBuild = !restoredResumeData;
      const result = await generateResume(
        historyToSend,
        restoredResumeData ?? undefined,
        false,
        notes,
        language,
        userPhoto ?? undefined,
        (status) => setAgentStatus(status),
        () => isAbortedRef.current,
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
    } catch (e: any) {
      if (e.message === 'ABORTED') return;
      const errMsg = String(e);
      const isApiKeyError = errMsg.toLowerCase().includes('api key') || errMsg.includes('401');
      setMessages(prev => [...prev, { 
        role: 'ai', 
        content: isApiKeyError ? t.apiKeyMissing : `${t.errorLabel}: ${errMsg}`,
        options: isApiKeyError ? [t.openSettings] : undefined,
        isError: true 
      }]);
    } finally {
      setIsLoading(false);
      setAgentStatus(null);
    }
  };


  // ── Debounced auto-save ───────────────────────────────────────────────────
  const persistSession = useCallback(
    (
      sid: string,
      title: string,
      msgs: ChatMessage[],
      rd: ResumeData | null,
      n: string,
      photo: string | null,
    ) => {
      if (msgs.length <= 1) return; // Don't save sessions with only welcome msg
      const stored: StoredSession = {
        id: sid,
        title,
        created_at: Date.now(),
        messages: msgs,
        resume_html: rd?.resume_html,
        notes: n,
        photo: photo ?? undefined,
      };
      saveSession(stored).catch(() => {});
      listSessions().then(setSessions).catch(() => {});
    },
    [],
  );

  useEffect(() => {
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    autoSaveTimer.current = setTimeout(() => {
      persistSession(sessionId, sessionTitle, messages, resumeData, notes, userPhoto);
    }, 1000);
    return () => { if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current); };
  }, [messages, resumeData, notes, sessionId, sessionTitle, userPhoto, persistSession]);

  // ── Photo helpers ─────────────────────────────────────────────────────────
  const handlePhotoFile = async (file: File) => {
    const reader = new FileReader();
    reader.onload = async (ev) => {
      const compressed = await compressImage(ev.target!.result as string);
      setPendingPhoto(compressed);
    };
    reader.readAsDataURL(file);
  };

  const handlePhotoPaste = async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const imageItem = Array.from(e.clipboardData.items).find(i => i.type.startsWith('image/'));
    if (!imageItem) return;
    e.preventDefault();
    const file = imageItem.getAsFile();
    if (!file) return;
    handlePhotoFile(file);
  };

  // ── Send message ──────────────────────────────────────────────────────────
  const handleSend = async () => {
    const userMsg = input.trim();
    if (!userMsg && !pendingPhoto) return;

    const attachedPhoto = pendingPhoto;
    const activePhoto = attachedPhoto || userPhoto;
    if (attachedPhoto) setUserPhoto(attachedPhoto);
    setPendingPhoto(null);
    setInput('');
    setError(null);

    const newUserMessage: ChatMessage = {
      role: 'user',
      content: userMsg || '(Photo attached)',
      photo: attachedPhoto ?? undefined,
      resumeHtml: resumeData?.resume_html,
    };
    const updatedMessages = [...messages, newUserMessage];
    setMessages(updatedMessages);
    setIsLoading(true);
    isAbortedRef.current = false;

    // Build history: limit to last 15 valid messages
    const MAX_HISTORY = 15;
    const historyToSend: HistoryMessage[] = updatedMessages
      .filter(m => !m.isError) // skip system/error messages
      .slice(1) // skip welcome
      .slice(-MAX_HISTORY)
      .map(m => ({ role: m.role, content: m.content }));

    try {
      const isFirstBuild = !resumeData;
      const result = await generateResume(
        historyToSend,
        resumeData ?? undefined,
        false,
        notes,
        language,
        activePhoto ?? undefined,
        (status) => setAgentStatus(status),
        () => isAbortedRef.current,
      );

      if (isAbortedRef.current) return;

      // Update title from first user message
      if (sessionTitle === t.newChat && userMsg) {
        setSessionTitle(userMsg.slice(0, 40));
      }

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
    } catch (e: any) {
      if (e.message === 'ABORTED') return;
      const errMsg = String(e);
      console.error('LLM Error:', errMsg);
      
      const isApiKeyError = 
        errMsg.toLowerCase().includes('api key') || 
        errMsg.toLowerCase().includes('mã khóa api') ||
        errMsg.toLowerCase().includes('api_key') ||
        errMsg.includes('401') ||
        errMsg.includes('403');

      if (isApiKeyError) {
        setMessages(prev => [
          ...prev, 
          { 
            role: 'ai', 
            content: t.apiKeyMissing,
            options: [t.openSettings],
            isError: true
          }
        ]);
      } else {
        setError(errMsg);
        setMessages(prev => [...prev, { role: 'ai', content: `${t.errorLabel}: ${errMsg}`, isError: true }]);
      }
    } finally {
      setIsLoading(false);
      setAgentStatus(null);
    }
  };

  // ── Option click ──────────────────────────────────────────────────────────
  const handleOptionClick = (opt: string) => {
    if (opt === 'Open Settings' || opt === 'Mở Cài Đặt') {
      setSettingsOpen(true);
      return;
    }
    setInput(opt);
  };

  // ── Session switch ────────────────────────────────────────────────────────
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
    } catch (e) {
      console.error(e);
    }
  };

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

  const handleDeleteSession = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    await deleteSession(id);
    setSessions(prev => prev.filter(s => s.id !== id));
    if (id === sessionId) handleNewChat();
  };

  // ── Inject Local Fonts & A4 Reset ─────────────────────────────────────────
  const getInjectedHtml = (html?: string) => {
    if (!html) return '';
    const baseUrl = window.location.origin;
    const fontCss = `
      <style>
        /* Base A4 Reset — using physical units (mm) */
        * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        html, body { 
          margin: 0 !important; 
          padding: 0 !important; 
          width: 210mm !important; 
          height: 297mm !important;
          background-color: white;
          overflow: hidden;
          font-family: 'Inter', sans-serif;
        }
        @font-face { font-family: 'Inter'; src: url('${baseUrl}/fonts/Inter-Regular.woff2') format('woff2'); font-weight: 400; font-style: normal; }
        @font-face { font-family: 'Inter'; src: url('${baseUrl}/fonts/Inter-SemiBold.woff2') format('woff2'); font-weight: 600; font-style: normal; }
        @font-face { font-family: 'Inter'; src: url('${baseUrl}/fonts/Inter-Bold.woff2') format('woff2'); font-weight: 700; font-style: normal; }
        
        /* Print optimizations */
        @media print {
          @page { size: 210mm 297mm; margin: 0; }
          body { width: 210mm !important; height: 297mm !important; }
        }
      </style>
    `;
    if (html.includes('</head>')) {
      return html.replace('</head>', `${fontCss}</head>`);
    }
    return fontCss + html;
  };

  // ── PDF Export ────────────────────────────────────────────────────────────
  const handleExportPdf = async () => {
    if (!resumeData?.resume_html || isPdfExporting) return;
    setIsPdfExporting(true);
    showToast(t.preparingPdf, 'info');

    try {
      // 1. Convert any internal print styles if needed, or inject a print-specific rule
      const printStyles = `
        <style>
          @media print {
            @page { size: A4 portrait; margin: 0; }
            body { -webkit-print-color-adjust: exact; print-color-adjust: exact; margin: 0 !important; box-shadow: none !important; }
          }
        </style>
      `;
      let htmlToPrint = getInjectedHtml(resumeData.resume_html);
      htmlToPrint = htmlToPrint.replace('</head>', `${printStyles}</head>`);

      // 2. Create a hidden iframe
      const iframe = document.createElement('iframe');
      iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:794px;height:1123px;border:none;opacity:0;pointer-events:none;z-index:-9999;';
      document.body.appendChild(iframe);

      await new Promise<void>(resolve => {
        iframe.onload = () => resolve();
        iframe.srcdoc = htmlToPrint;
      });

      // 3. Wait for fonts
      if (iframe.contentDocument && iframe.contentWindow) {
        await iframe.contentDocument.fonts.ready;
        await new Promise(r => setTimeout(r, 400));

        // 4. Trigger print
        iframe.contentWindow.focus();
        iframe.contentWindow.print();

        showToast(t.pdfOpened, 'success');
      }

      // Cleanup after print dialog closes
      setTimeout(() => {
        if (document.body.contains(iframe)) {
          document.body.removeChild(iframe);
        }
      }, 1000);

    } catch (e) {
      console.error('PDF export failed:', e);
      showToast(t.pdfError, 'error');
    } finally {
      setIsPdfExporting(false);
    }
  };
  // ── Last options from messages ────────────────────────────────────────────
  const lastOptions = [...messages].reverse().find(m => m.options && m.options.length > 0)?.options;
  const lastUserMsgIdx = [...messages].reverse().findIndex(m => m.role === 'user');
  const actualLastUserMsgIdx = lastUserMsgIdx === -1 ? -1 : messages.length - 1 - lastUserMsgIdx;

  return (
    <div className={cn('relative flex flex-col h-screen bg-white dark:bg-[#0a0a0a] text-zinc-900 dark:text-zinc-100 font-sans', darkMode && 'dark')}>
      <TitleBar t={t}>
        <button
          onClick={() => setSidebarOpen(p => !p)}
          title={t.toggleSidebar}
          className="p-1.5 rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-800/50 text-zinc-500 dark:text-zinc-400 transition-colors ml-1"
        >
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

          <button
            onClick={() => setSettingsOpen(true)}
            title={t.settings}
            className="p-1.5 rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-800/50 text-zinc-500 dark:text-zinc-400 transition-colors ml-1"
          >
            <Settings className="w-4 h-4" />
          </button>
        </div>
      </TitleBar>

      {/* Toast Notification */}
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

      {/* Settings Modal */}
      <SettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onDarkModeChange={setDarkMode}
        onSaved={(_p, model) => {
          setCurrentModel(model);
          setQuickModels([]); // Reset list để fetch lại theo provider mới
          getSettings().then(setAppSettings).catch(() => {});
        }}        onClearData={handleClearAllData}
        t={t}
      />
      {/* Hidden file input */}
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
        {/* ── Sidebar ────────────────────────────────────────────────────── */}
        <aside
          style={{ width: sidebarOpen ? sidebarWidth : 0 }}
          className={cn(
            'flex flex-col shrink-0 bg-[#fbfbfc] dark:bg-[#0f0f0f] border-r border-zinc-200 dark:border-zinc-800/80 overflow-hidden',
            !isResizingSidebar && 'transition-all duration-200',
          )}
        >
          <div className="px-3 pt-3 pb-2 shrink-0">
            <button
              onClick={handleNewChat}
              className="flex items-center gap-2 w-full px-3 py-2 rounded-md bg-zinc-900 hover:bg-black dark:bg-zinc-100 dark:hover:bg-white text-white dark:text-black text-[12px] font-medium transition-colors"
            >
              <Plus className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate">{t.newChat}</span>
            </button>
          </div>

          <div className="px-3 pt-4 pb-1 shrink-0">
            <span className="text-[10px] font-semibold text-zinc-400 dark:text-zinc-600">
              {t.recentChats}
            </span>
          </div>

          <div className="flex-1 overflow-y-auto px-2 pb-2 space-y-0.5 min-w-0 mt-1">
            {sessions.length === 0 ? (
              <p className="text-[11px] text-zinc-400 px-3 py-4 text-center whitespace-nowrap">{t.noSessions}</p>
            ) : (
              sessions.map(s => (
                <div
                  key={s.id}
                  onClick={() => handleSwitchSession(s.id)}
                  className={cn(
                    'group flex items-center justify-between w-full px-3 py-1.5 rounded-md text-left text-[12.5px] transition-colors min-w-0 cursor-pointer',
                    s.id === sessionId
                      ? 'bg-zinc-200/50 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 font-medium'
                      : 'hover:bg-zinc-100 dark:hover:bg-zinc-900/50 text-zinc-600 dark:text-zinc-400',
                  )}
                >
                  <span className="truncate flex-1 min-w-0">{s.title}</span>
                  <button
                    onClick={e => handleDeleteSession(s.id, e)}
                    className="opacity-0 group-hover:opacity-100 p-1 rounded-md hover:bg-red-100 dark:hover:bg-red-900/30 hover:text-red-600 dark:hover:text-red-400 transition-all shrink-0"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))
            )}
          </div>

          {/* Language selector */}
          <div className="px-3 py-3 shrink-0">
            <select
              value={language}
              onChange={e => setLanguage(e.target.value as Language)}
              className="w-full bg-transparent hover:bg-zinc-200/50 dark:hover:bg-zinc-800 border border-zinc-200 dark:border-zinc-800 rounded-md px-2 py-1.5 text-[11px] outline-none text-zinc-600 dark:text-zinc-400 transition-colors cursor-pointer appearance-none"
            >
              <option value="vi">Tiếng Việt</option>
              <option value="en">English</option>
              <option value="fr">Français</option>
              <option value="de">Deutsch</option>
              <option value="ja">日本語</option>
              <option value="ko">한국어</option>
              <option value="zh">中文</option>
            </select>
          </div>
        </aside>

        {/* Resize handle sidebar */}
        {sidebarOpen && (
          <div
            onMouseDown={startResizingSidebar}
            className="w-1 cursor-col-resize hover:bg-zinc-300 dark:hover:bg-zinc-700 transition-colors z-20 shrink-0 border-r border-zinc-100 dark:border-zinc-900"
          />
        )}


        {/* ── Chat panel ─────────────────────────────────────────────────── */}
        <div className="flex flex-col flex-1 min-w-0 overflow-hidden bg-white dark:bg-[#0a0a0a]">
          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-6 py-6 md:px-12 lg:px-24 space-y-6">
            {messages.map((msg, idx) => (
              <div key={idx} className={cn('flex flex-col max-w-3xl mx-auto group', msg.role === 'user' ? 'items-end' : 'items-start')}>
                {msg.role === 'ai' ? (
                  <div className="w-full space-y-2 relative group/msg text-zinc-900 dark:text-zinc-100">
                    <div className="flex items-center gap-2">
                      <div className="w-5 h-5 rounded-md bg-zinc-900 dark:bg-zinc-100 flex items-center justify-center">
                        <img src={appIcon} alt="AI" className="w-3.5 h-3.5 invert dark:invert-0" />
                      </div>
                      <span className="text-[11px] font-bold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">Sloth AI Agent</span>
                    </div>

                    <div className="text-[14px] leading-relaxed pl-7">
                      <ReactMarkdown
                        components={{
                          p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
                          strong: ({ children }) => <strong className="font-semibold text-black dark:text-white">{children}</strong>,
                          ul: ({ children }) => <ul className="list-disc list-inside space-y-1 mt-2 mb-2">{children}</ul>,
                          li: ({ children }) => <li className="text-[13.5px] opacity-90">{children}</li>,
                        }}
                      >
                        {msg.content}
                      </ReactMarkdown>
                      {msg.isTyping && (
                        <span className="inline-block w-1.5 h-4 bg-zinc-400 dark:bg-zinc-600 ml-1 animate-pulse align-middle" />
                      )}
                    </div>

                    {!msg.isTyping && (
                      <div className="flex items-center gap-1 pl-7 opacity-0 group-hover/msg:opacity-100 transition-opacity">
                        <button
                          onClick={(e) => { e.stopPropagation(); handleCopy(msg.content, idx); }}
                          className="p-1.5 rounded-md hover:bg-zinc-50 dark:hover:bg-zinc-900 text-zinc-400 hover:text-zinc-600 transition-all"
                          title={t.copy}
                        >
                          {copiedIdx === idx ? <Check className="w-3.5 h-3.5 text-green-500" /> : <Copy className="w-3.5 h-3.5" />}
                        </button>
                        {idx === messages.length - 1 && !isLoading && (
                          <button
                            onClick={(e) => { e.stopPropagation(); handleRetry(); }}
                            className="p-1.5 rounded-md hover:bg-zinc-50 dark:hover:bg-zinc-900 text-zinc-400 hover:text-zinc-600 transition-all"
                            title="Retry"
                          >
                            <RotateCcw className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    )}

                    {/* Artifact Card */}
                    {msg.isResumeUpdate && !msg.isTyping && (
                      <div className="mt-4 pl-7">
                        <button
                          onClick={() => setIsPreviewOpen(true)}
                          className={cn(
                            "group flex flex-col w-full sm:w-[320px] text-left p-3 rounded-xl border transition-all duration-200",
                            isPreviewOpen 
                              ? "border-zinc-300 bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800/50" 
                              : "border-zinc-200 bg-white hover:border-zinc-300 hover:shadow-sm dark:border-zinc-800 dark:bg-[#111111] dark:hover:border-zinc-700"
                          )}
                        >
                          <div className="flex items-center justify-between mb-1.5">
                            <div className="flex items-center gap-2 text-[12px] font-medium text-gray-900 dark:text-gray-100">
                              <FileDown className="w-4 h-4 text-zinc-500" />
                              {t.resumeDraft}
                            </div>
                            <span className="text-[10px] text-zinc-400 group-hover:text-zinc-600 dark:group-hover:text-zinc-300 transition-colors">
                              {isPreviewOpen ? t.open : t.clickToView}
                            </span>
                          </div>
                          <p className="text-[11px] text-zinc-500 line-clamp-1">
                            {t.artifactDesc}
                          </p>
                        </button>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="max-w-[85%] space-y-1 relative group/user flex flex-col items-end w-full">
                    {msg.photo && (
                      <div className="mb-2">
                        <img
                          src={msg.photo}
                          alt="Attached"
                          className="w-32 h-32 rounded-xl object-cover border border-zinc-200 dark:border-zinc-800 shadow-sm"
                        />
                      </div>
                    )}
                    
                    {editingIdx === idx ? (
                      <div className="w-full max-w-xl bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-3 shadow-sm">
                        <textarea
                          value={editInput}
                          onChange={(e) => setEditInput(e.target.value)}
                          className="w-full bg-transparent border-none outline-none text-[14px] text-zinc-900 dark:text-zinc-100 resize-none min-h-[80px]"
                          autoFocus
                        />
                        <div className="flex justify-end gap-2 mt-2">
                          <button
                            onClick={cancelEditing}
                            className="px-3 py-1 text-[11px] font-medium text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors"
                          >
                            {t.cancel || 'Cancel'}
                          </button>
                          <button
                            onClick={() => handleRetry(idx, editInput)}
                            disabled={!editInput.trim() || isLoading}
                            className="px-3 py-1 bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 rounded-md text-[11px] font-bold transition-all disabled:opacity-50"
                          >
                            {t.send || 'Send'}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        {msg.content && msg.content !== '(Photo attached)' && (
                          <div className="bg-zinc-100 dark:bg-zinc-800/80 text-zinc-900 dark:text-zinc-100 rounded-2xl rounded-tr-sm px-4 py-2.5 text-[14px] leading-relaxed shadow-sm">
                            {msg.content}
                          </div>
                        )}
                        <div className="opacity-0 group-hover/user:opacity-100 transition-opacity flex items-center gap-1 mt-1">
                          {!isLoading && (
                            <button
                              onClick={(e) => { e.stopPropagation(); startEditing(idx, msg.content); }}
                              className="p-1.5 rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-400 hover:text-zinc-600 transition-all"
                              title="Edit"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                          )}
                          <button
                            onClick={(e) => { e.stopPropagation(); handleCopy(msg.content, idx); }}
                            className="p-1.5 rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-400 hover:text-zinc-600 transition-all"
                            title={t.copy}
                          >
                            {copiedIdx === idx ? <Check className="w-3.5 h-3.5 text-green-500" /> : <Copy className="w-3.5 h-3.5" />}
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
            ))}

            {/* Suggestions */}
            {lastOptions && !isLoading && (
              <div className="flex flex-wrap gap-2 pt-2 max-w-3xl mx-auto">
                {lastOptions.map((opt, i) => (
                  <button
                    key={i}
                    onClick={() => handleOptionClick(opt)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#111] text-zinc-600 dark:text-zinc-400 text-[12px] font-medium hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
                  >
                    <ChevronRight className="w-3.5 h-3.5" />
                    {opt}
                  </button>
                ))}
              </div>
            )}

            {isLoading && (
              <div className="flex justify-start max-w-3xl mx-auto w-full">
                <div className="flex items-center gap-3 py-2 px-4 bg-zinc-50/50 dark:bg-zinc-900/20 rounded-lg border border-zinc-100 dark:border-zinc-800/40">
                  <div className="w-1 h-1 rounded-full bg-indigo-500 animate-pulse" />
                  <p className="text-[12px] font-mono text-zinc-500 dark:text-zinc-400">
                    {agentStatus || 'Processing...'}
                  </p>
                </div>
              </div>
            )}


            {error && (
              <div className="text-[11px] text-red-500 bg-red-50 dark:bg-red-900/20 px-3 py-2 rounded-lg">
                {error}
              </div>
            )}

            <div ref={chatEndRef} />
          </div>

          {/* Input area */}
          <div className="px-6 pb-6 shrink-0 max-w-3xl mx-auto w-full">
            <div className="bg-white dark:bg-[#0f0f0f] border border-zinc-200 dark:border-zinc-800 rounded-xl shadow-sm focus-within:ring-2 focus-within:ring-zinc-900/10 dark:focus-within:ring-zinc-100/10 transition-all overflow-hidden">
              {/* Pending photo preview */}
              {pendingPhoto && (
                <div className="px-3 pt-2.5 flex items-center gap-2 border-b border-zinc-100 dark:border-zinc-800/50 pb-2">
                  <div className="relative shrink-0">
                    <img
                      src={pendingPhoto}
                      alt="attachment"
                      className="w-12 h-12 rounded-md object-cover border border-zinc-200 dark:border-zinc-800"
                    />
                    <button
                      onClick={() => setPendingPhoto(null)}
                      className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-zinc-900 text-white rounded-full flex items-center justify-center text-[9px] hover:bg-black"
                    >
                      <X className="w-2.5 h-2.5" />
                    </button>
                  </div>
                  <span className="text-[11px] text-zinc-500">{t.profilePhotoAttached}</span>
                </div>
              )}

              <textarea
                ref={textareaRef}
                value={input}
                onChange={e => setInput(e.target.value)}
                onPaste={handlePhotoPaste}
                onKeyDown={e => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSend();
                  }
                }}
                placeholder={t.placeholder}
                rows={1}
                disabled={isLoading}
                className="w-full px-4 pt-3 pb-1 text-[13.5px] resize-none outline-none bg-transparent text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 dark:placeholder:text-zinc-600 disabled:opacity-60 min-h-[44px] max-h-[200px] overflow-y-auto"
              />

              <div className="flex items-center justify-between px-2 pb-2 pt-1">
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="flex items-center justify-center w-8 h-8 rounded-md text-zinc-400 hover:text-zinc-900 hover:bg-zinc-100 dark:hover:text-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                    title={t.attachPhoto}
                  >
                    <ImagePlus className="w-4 h-4" />
                  </button>
                  {currentModel ? (
                    <div className="relative flex items-center">
                      <select
                        value={currentModel}
                        onChange={(e) => handleQuickModelChange(e.target.value)}
                        onMouseDown={() => { if (quickModels.length === 0) fetchQuickModels(); }}
                        className="appearance-none bg-zinc-50 dark:bg-zinc-900 border border-zinc-100 dark:border-zinc-800 rounded-md px-2 py-1 pr-6 text-[10px] font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-tight outline-none focus:ring-1 focus:ring-indigo-500/30 transition-all cursor-pointer"
                      >
                        <optgroup label={`${appSettings?.llm.provider.toUpperCase()} (Active)`}>
                          <option value={currentModel}>{currentModel}</option>
                          {quickModels.filter(m => m !== currentModel).map(m => (
                            <option key={m} value={m}>{m}</option>
                          ))}
                        </optgroup>
                        
                        <optgroup label="Switch Provider">
                          {PROVIDERS.filter(p => {
                            const cfg = appSettings?.llm.configs[p.id];
                            return p.id !== appSettings?.llm.provider && (cfg?.api_key || p.local);
                          }).map(p => (
                            <option key={p.id} value={`provider:${p.id}`}>
                              ➜ Use {p.name}
                            </option>
                          ))}
                        </optgroup>
                      </select>
                      <ChevronDown className="absolute right-1.5 w-2.5 h-3 text-zinc-400 pointer-events-none" />
                      {isLoadingModels && <Loader2 className="absolute -right-5 w-3 h-3 text-zinc-400 animate-spin" />}
                    </div>
                  ) : (
                    <button
                      onClick={() => setSettingsOpen(true)}
                      className="text-[10px] font-bold text-indigo-500 hover:text-indigo-600 px-2 py-1 rounded-md bg-indigo-50 dark:bg-indigo-950/30 border border-indigo-100 dark:border-indigo-900/50 uppercase tracking-tight transition-colors"
                    >
                      {t.setupAi}
                    </button>
                  )}
                </div>

                 <button
                   onClick={isLoading ? stopProcessing : handleSend}
                   disabled={!isLoading && !input.trim() && !pendingPhoto}
                   className={cn(
                     "flex items-center justify-center h-8 rounded-md transition-colors",
                     isLoading
                       ? "w-8 bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 border border-zinc-200 dark:border-zinc-700 hover:bg-red-50 dark:hover:bg-red-900/20 hover:text-red-600 dark:hover:text-red-400 hover:border-red-200 dark:hover:border-red-900/30"
                       : "w-8 bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 hover:bg-black dark:hover:bg-white disabled:opacity-30 shadow-sm"
                   )}
                   title={isLoading ? t.cancel : t.send}
                 >
                   {isLoading ? (
                     <Square className="w-2.5 h-3 fill-current" />
                   ) : (
                     <ArrowUp className="w-4 h-4" strokeWidth={2.5} />
                   )}
                 </button>              </div>
            </div>
          </div>
        </div>

        {/* Resize handle preview */}
        {isPreviewOpen && (
          <div
            onMouseDown={startResizingPreview}
            className="w-1 cursor-col-resize hover:bg-zinc-300 dark:hover:bg-zinc-700 transition-colors z-20 shrink-0 border-x border-zinc-100 dark:border-zinc-900"
            title="Kéo để thay đổi kích thước Review"
          />
        )}

        {/* ── Preview panel ───────────────────────────────────────────────── */}
        <AnimatePresence>
          {isPreviewOpen && (
            <motion.div
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: previewWidth, opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={{ duration: isResizingPreview ? 0 : 0.25 }}
              style={{ width: previewWidth }}
              className="flex flex-col shrink-0 bg-[#fafafa] dark:bg-[#0a0a0a] overflow-hidden"
            >
              <div className="flex items-center justify-between px-4 h-11 bg-white dark:bg-[#0a0a0a] border-b border-zinc-200 dark:border-zinc-800 shrink-0">
                <div className="flex items-center gap-2">
                  <FileDown className="w-3.5 h-3.5 text-zinc-400" />
                  <span className="text-[11px] font-semibold text-zinc-600 dark:text-zinc-400 uppercase tracking-wider">{t.artifactPreview || 'ARTIFACT PREVIEW'}</span>
                </div>
                
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => setIsPreviewOpen(false)}
                    className="p-1.5 rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-800/50 text-zinc-400 transition-colors"
                    title="Close"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              <div className="flex-1 overflow-hidden relative bg-zinc-100 dark:bg-[#050505]">
                {resumeData?.resume_html ? (
                  <TransformWrapper
                    initialScale={1}
                    minScale={0.2}
                    maxScale={4}
                    centerOnInit={true}
                    limitToBounds={true} // Bật giới hạn không cho kéo ra ngoài
                    wheel={{ step: 0.1 }}
                    alignmentAnimation={{ sizeX: 0, sizeY: 0 }} // Tự động kéo về nếu kéo quá lề
                  >
                    {({ zoomIn, zoomOut, resetTransform, setTransform }) => {
                      // Hàm để fit chiều ngang
                      const handleFitWidth = () => {
                        // Chiều rộng A4 tính bằng pixel (xấp xỉ 794px cho 210mm)
                        const a4WidthPx = 794; 
                        // Lấy chiều rộng hiện tại của khung preview (trừ đi padding lề)
                        const availableWidth = previewWidth - 80; 
                        const scale = availableWidth / a4WidthPx;
                        setTransform(0, 40, scale, 200); // Căn giữa top, với scale mới
                      };

                      return (
                        <>
                          <div className="absolute top-4 right-4 z-10 flex items-center gap-1 bg-white/90 dark:bg-zinc-900/90 backdrop-blur-sm border border-zinc-200 dark:border-zinc-800 p-1 rounded-lg shadow-sm">
                            <button onClick={() => zoomOut()} className="p-1.5 text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-md transition-colors" title={t.zoomOut}>
                              <ZoomOut className="w-3.5 h-3.5" />
                            </button>
                            <button 
                              onClick={() => handleFitWidth()} 
                              className="p-1.5 text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-md transition-colors" 
                              title="Fit Width"
                            >
                              <Maximize className="w-3.5 h-3.5" />
                            </button>
                            <button onClick={() => zoomIn()} className="p-1.5 text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-md transition-colors" title={t.zoomIn}>
                              <ZoomIn className="w-3.5 h-3.5" />
                            </button>
                          </div>
                          <TransformComponent 
                            wrapperClass="!w-full !h-full cursor-grab active:cursor-grabbing" 
                            contentClass="flex items-start justify-center min-w-full min-h-full"
                          >
                            <div 
                              className="bg-white shadow-[0_0_50px_rgba(0,0,0,0.1)] dark:shadow-[0_0_50px_rgba(0,0,0,0.3)] my-10" 
                              style={{ 
                                width: '210mm', 
                                height: '297mm', 
                                flexShrink: 0,
                                transformOrigin: 'top center'
                              }}
                            >
                            <iframe
                              ref={iframeRef}
                              srcDoc={getInjectedHtml(resumeData.resume_html)}
                              title="Resume Preview"
                              sandbox="allow-same-origin allow-scripts"
                              style={{ width: '100%', height: '100%', border: 'none', display: 'block', pointerEvents: 'none' }}
                            />
                          </div>
                        </TransformComponent>
                      </>
                    );
                  }}
                </TransformWrapper>
                ) : (
                  <div className="flex flex-col items-center justify-center h-full text-zinc-400 space-y-3">
                    <FileDown className="w-8 h-8 opacity-20" />
                    <p className="text-[12px] font-medium">{t.noResumeData}</p>
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
