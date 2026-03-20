import { useEffect, useRef, useState, useCallback } from 'react';
import { Eye, EyeOff, Settings, MessageSquare } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { invoke } from '@tauri-apps/api/core';
import TitleBar from './components/TitleBar';
import SettingsModal from './components/SettingsModal';
import ConfirmModal from './components/ConfirmModal';
import Sidebar from './components/Sidebar';
import MessageList from './components/MessageList';
import ChatInputArea from './components/ChatInputArea';
import ArtifactPreview from './artifact/Preview';
import { compressImage, exportArtifact } from './artifact/utils';
import { useResizable } from './hooks/useResizable';
import { useSession } from './hooks/useSession';
import { useLlm } from './hooks/useLlm';
import { useAgentPlayground } from './hooks/useAgentPlayground';
import { getSettings } from './services/settings';
import { AppSettings, Language } from './types';
import { ResumeData } from './artifact/types';
import { TRANSLATIONS } from './constants';
import { cn } from './lib/utils';

export default function App() {
  const [language, setLanguage] = useState<Language>('en');
  const t = TRANSLATIONS[language];

  const [darkMode, setDarkMode] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [isPdfExporting, setIsPdfExporting] = useState(false);

  const [input, setInput] = useState('');
  const [appSettings, setAppSettings] = useState<AppSettings | null>(null);
  const [currentModel, setCurrentModel] = useState('');
  const [quickModels, setQuickModels] = useState<string[]>([]);
  const [isLoadingModels, setIsLoadingModels] = useState(false);

  const [toastMsg, setToastMsg] = useState<{ text: string; type: 'info' | 'success' | 'error' } | null>(null);
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [editInput, setEditInput] = useState('');

  const fileInputRef = useRef<HTMLInputElement>(null);
  const handleExportPdfRef = useRef<(() => void) | null>(null);
  const handleSwitchSessionRef = useRef<((id: string) => void) | null>(null);

  const sidebar = useResizable('sidebar', 240, 160, 450);
  const preview = useResizable('preview', 600, 400, 1200);

  const showToast = useCallback((text: string, type: 'info' | 'success' | 'error' = 'info') => {
    setToastMsg({ text, type });
    setTimeout(() => setToastMsg(null), 3500);
  }, []);

  // ── Session & LLM hooks ───────────────────────────────────────────────────
  const session = useSession(t.newChat, t.welcome);

  const llm = useLlm({
    messages: session.messages,
    setMessages: session.setMessages,
    resumeData: session.resumeData,
    setResumeData: session.setResumeData,
    setIsPreviewOpen,
    notes: session.notes,
    language,
    userPhoto: session.userPhoto,
    setUserPhoto: session.setUserPhoto,
    sessionTitle: session.sessionTitle,
    setSessionTitle: session.setSessionTitle,
    pendingPhoto: session.pendingPhoto,
    setPendingPhoto: session.setPendingPhoto,
    input,
    setInput,
    t,
  });

  // Keep handleSendRef in sync so agent playground can call it
  useEffect(() => { llm.handleSendRef.current = llm.handleSend; }, [llm.handleSend]);

  // ── Init ──────────────────────────────────────────────────────────────────
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
    document.documentElement.classList.toggle('dark', darkMode);
    localStorage.setItem('slothcv_dark', darkMode ? '1' : '0');
  }, [darkMode]);

  // ── Session actions ───────────────────────────────────────────────────────
  const handleNewChat = useCallback(() => {
    llm.stopProcessing();
    session.resetSession();
  }, [llm.stopProcessing, session.resetSession]);

  const handleSwitchSession = useCallback(async (id: string) => {
    llm.stopProcessing();
    try { await session.switchToSession(id); } catch (e) { console.error(e); }
  }, [llm.stopProcessing, session.switchToSession]);

  const handleDeleteSession = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const wasActive = await session.removeSession(id);
    if (wasActive) handleNewChat();
  };

  useEffect(() => { handleSwitchSessionRef.current = handleSwitchSession; }, [handleSwitchSession]);

  // ── Model management ──────────────────────────────────────────────────────
  const fetchQuickModels = async () => {
    if (!appSettings) return;
    setIsLoadingModels(true);
    try {
      const provider = appSettings.llm.provider;
      const cfg = appSettings.llm.configs[provider] || { base_url: '', api_key: '', model: '' };
      setQuickModels(await invoke<string[]>('fetch_models', { provider, baseUrl: cfg.base_url, apiKey: cfg.api_key }));
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
      session.setPendingPhoto(await compressImage(ev.target!.result as string));
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

  // ── Export ────────────────────────────────────────────────────────────────
  const handleExportPdf = async () => {
    if (!session.resumeData?.resume_html || isPdfExporting) return;
    setIsPdfExporting(true);
    try {
      await exportArtifact(
        session.resumeData.resume_html,
        { preparing: t.preparingPdf, opened: t.pdfOpened, error: t.pdfError },
        showToast,
      );
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

  // ── Agent state ref (DEV only) ────────────────────────────────────────────
  const agentStateRef = useRef({
    isLoading: false, messages: session.messages,
    resumeData: null as ResumeData | null,
    isPreviewOpen: false, currentModel: '', language: 'en' as Language,
  });
  useEffect(() => {
    agentStateRef.current = {
      isLoading: llm.isLoading, messages: session.messages,
      resumeData: session.resumeData, isPreviewOpen, currentModel, language,
    };
  }, [llm.isLoading, session.messages, session.resumeData, isPreviewOpen, currentModel, language]);

  useAgentPlayground({
    agentStateRef,
    handleSendRef: llm.handleSendRef,
    handleExportPdfRef,
    handleSwitchSessionRef,
    handleNewChat,
    setInput,
    setPendingPhoto: session.setPendingPhoto,
    setIsPreviewOpen,
    setSettingsOpen,
    setDarkMode,
    setLanguage,
    showToast,
  });

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className={cn('relative flex flex-col h-screen bg-white dark:bg-[#0a0a0a] text-zinc-900 dark:text-zinc-100 font-sans', darkMode && 'dark')}>
      <TitleBar t={t}>
        <button onClick={() => setSidebarOpen(p => !p)} title={t.toggleSidebar} className="p-1.5 rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-800/50 text-zinc-500 dark:text-zinc-400 transition-colors ml-1">
          <MessageSquare className="w-4 h-4" />
        </button>
        <span className="flex-1 text-[12px] font-medium text-zinc-400 dark:text-zinc-500 truncate px-2" data-tauri-drag-region>
          {session.sessionTitle}
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
        onClearData={() => { session.setSessions([]); setCurrentModel(''); handleNewChat(); }}
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
          sessions={session.sessions}
          currentSessionId={session.sessionId}
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
            messages={session.messages}
            isLoading={llm.isLoading}
            agentStatus={llm.agentStatus}
            error={llm.error}
            copiedIdx={copiedIdx}
            editingIdx={editingIdx}
            editInput={editInput}
            isPreviewOpen={isPreviewOpen}
            t={t}
            onCopy={handleCopy}
            onStartEditing={startEditing}
            onCancelEditing={cancelEditing}
            onEditInputChange={setEditInput}
            onRetry={llm.handleRetry}
            onOptionClick={handleOptionClick}
            onOpenPreview={() => setIsPreviewOpen(true)}
          />
          <ChatInputArea
            input={input}
            pendingPhoto={session.pendingPhoto}
            isLoading={llm.isLoading}
            currentModel={currentModel}
            quickModels={quickModels}
            isLoadingModels={isLoadingModels}
            appSettings={appSettings}
            t={t}
            onInputChange={setInput}
            onSend={llm.handleSend}
            onStop={llm.stopProcessing}
            onPhotoPaste={handlePhotoPaste}
            onAttachClick={() => fileInputRef.current?.click()}
            onRemovePhoto={() => session.setPendingPhoto(null)}
            onModelChange={handleQuickModelChange}
            onFetchModels={fetchQuickModels}
            onOpenSettings={() => setSettingsOpen(true)}
          />
        </div>

        <ArtifactPreview
          width={preview.width}
          isOpen={isPreviewOpen}
          isResizing={preview.isResizing}
          resumeData={session.resumeData}
          t={t}
          onResizeStart={preview.startResizing}
          onClose={() => setIsPreviewOpen(false)}
          onExport={handleExportPdf}
          isExporting={isPdfExporting}
        />
      </div>
    </div>
  );
}
