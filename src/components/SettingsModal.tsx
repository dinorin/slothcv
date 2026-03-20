import React, { useEffect, useState, useRef } from 'react';
import { X, Save, Key, Link, Tag, Moon, Sun, RefreshCw, AlertCircle, ChevronDown, Loader2, Settings, Check } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { invoke } from '@tauri-apps/api/core';
import { AppSettings, MASKED_KEY } from '../types';
import { getSettings, saveSettings } from '../services/settings';
import { listSessions, deleteSession } from '../services/storage';
import { cn } from '../lib/utils';
import ConfirmModal from './ConfirmModal';

interface Props {
  open: boolean;
  onClose: () => void;
  onDarkModeChange?: (dark: boolean) => void;
  onSaved?: (provider: string, model: string) => void;
  onClearData?: () => void;
  t: any;
}

import { PROVIDERS } from '../constants';

function ProviderIcon({ domain, color, initials, size, fontSize, rounded = 'rounded-md', shadow = false }: {
  domain: string | null;
  color: string;
  initials: string;
  size: number;
  fontSize: number;
  rounded?: string;
  shadow?: boolean;
}) {
  const [imgFailed, setImgFailed] = React.useState(false);
  const faviconUrl = domain ? `https://www.google.com/s2/favicons?domain=${domain}&sz=64` : null;

  if (faviconUrl && !imgFailed) {
    return (
      <div
        className={cn('flex items-center justify-center shrink-0 bg-white dark:bg-zinc-800', rounded, shadow && 'shadow-md')}
        style={{ width: size, height: size }}
      >
        <img
          src={faviconUrl}
          alt={initials}
          width={size * 0.6}
          height={size * 0.6}
          onError={() => setImgFailed(true)}
          style={{ objectFit: 'contain' }}
        />
      </div>
    );
  }

  return (
    <div
      className={cn('flex items-center justify-center text-white shrink-0', rounded, shadow && 'shadow-md')}
      style={{ width: size, height: size, backgroundColor: color, fontSize, fontWeight: 700, letterSpacing: '-0.02em' }}
    >
      {initials}
    </div>
  );
}

async function fetchModelsFromApi(provider: string, base_url: string, api_key: string): Promise<string[]> {
  return invoke<string[]>('fetch_models', { provider, baseUrl: base_url, apiKey: api_key });
}

export default function SettingsModal({ open, onClose, onDarkModeChange, onSaved, onClearData, t }: Props) {
  const [settings, setSettings] = useState<AppSettings>({
    llm: { provider: 'gemini', configs: {}, base_url: '', api_key: '', model: '' },
    dark_mode: false,
  });
  const [activeTab, setActiveTab] = useState('gemini');
  const [models, setModels] = useState<string[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [modelError, setModelError] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load settings when modal opens
  useEffect(() => {
    if (!open) return;
    setModels([]);
    setModelError('');
    getSettings().then((s) => {
      setSettings(s);
      setActiveTab(s.llm.provider);
      const activeCfg = s.llm.configs[s.llm.provider] || { base_url: '', api_key: '', model: '' };
      doFetch(s.llm.provider, activeCfg.base_url, activeCfg.api_key);
    }).catch(() => {});
  }, [open]);

  function doFetch(provider: string, base_url: string, api_key: string) {
    const def = PROVIDERS.find((p) => p.id === provider);
    if (!def) return;
    // Allow fetch when key is masked (backend will resolve); block only when truly empty
    if (def.needs_key && !api_key.trim() && api_key !== MASKED_KEY) return;
    if (provider !== 'gemini' && !base_url.trim()) return;

    setLoadingModels(true);
    setModelError('');
    fetchModelsFromApi(provider, base_url, api_key)
      .then((list) => {
        setModels(list);
      })
      .catch((e) => {
        setModelError(String(e));
        setModels([]);
      })
      .finally(() => setLoadingModels(false));
  }

  function scheduleFetch(provider: string, base_url: string, api_key: string) {
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => doFetch(provider, base_url, api_key), 700);
  }

  const currentTabConfig = settings.llm.configs[activeTab] || { 
    base_url: PROVIDERS.find(p => p.id === activeTab)?.base_url || '', 
    api_key: '', 
    model: '' 
  };

  const providerDef = PROVIDERS.find((p) => p.id === activeTab) ?? PROVIDERS[PROVIDERS.length - 1];
  const showBaseUrl = activeTab !== 'gemini';

  function updateConfig(id: string, updates: Partial<LlmProviderConfig>) {
    setSettings(prev => ({
      ...prev,
      llm: {
        ...prev.llm,
        configs: {
          ...prev.llm.configs,
          [id]: { ...(prev.llm.configs[id] || { base_url: PROVIDERS.find(p => p.id === id)?.base_url || '', api_key: '', model: '' }), ...updates }
        }
      }
    }));
  }

  async function handleSave() {
    setSaving(true);
    setSaveError('');
    
    // Set provider hiện tại là provider đang được chọn ở tab active
    const finalSettings = {
      ...settings,
      llm: {
        ...settings.llm,
        provider: activeTab,
        // Đồng bộ active fields cho backend v1 nếu cần
        base_url: currentTabConfig.base_url,
        api_key: currentTabConfig.api_key,
        model: currentTabConfig.model
      }
    };

    try {
      await saveSettings(finalSettings);
      onSaved?.(finalSettings.llm.provider, finalSettings.llm.model);
      setSaved(true);
      setTimeout(() => { setSaved(false); onClose(); }, 700);
    } catch (e: unknown) {
      setSaveError(String(e));
    } finally {
      setSaving(false);
    }
  }

  async function handleClearData() {
    setSaving(true);
    setShowClearConfirm(false);
    try {
      const sessions = await listSessions();
      for (const s of sessions) {
        await deleteSession(s.id);
      }
      const defaultSettings: AppSettings = {
        llm: { provider: 'gemini', configs: {}, base_url: '', api_key: '', model: '' },
        dark_mode: settings.dark_mode,
      };
      await saveSettings(defaultSettings);
      setSettings(defaultSettings);
      onClearData?.();
      onClose();
    } catch (e) {
      alert(t.clearDataError + ': ' + String(e));
    } finally {
      setSaving(false);
    }
  }

  const modelOptions = currentTabConfig.model && !models.includes(currentTabConfig.model)
    ? [currentTabConfig.model, ...models]
    : models;

  return (
    <>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
            onClick={(e) => e.target === e.currentTarget && onClose()}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 10 }}
              transition={{ duration: 0.15 }}
              className="bg-white dark:bg-[#0a0a0a] rounded-2xl shadow-2xl w-full max-w-2xl flex flex-col overflow-hidden border border-zinc-200 dark:border-zinc-800"
              style={{ maxHeight: 'min(90vh, 600px)', minHeight: 0 }}
            >
              {/* Header */}
              <div className="flex items-center justify-between px-4 sm:px-6 py-3 sm:py-4 border-b border-zinc-100 dark:border-zinc-800 shrink-0">
                <div className="flex items-center gap-2 sm:gap-3">
                  <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-lg bg-zinc-900 dark:bg-zinc-100 flex items-center justify-center shrink-0">
                    <Settings className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-white dark:text-zinc-900" />
                  </div>
                  <h2 className="text-[13px] sm:text-[14px] font-bold text-zinc-900 dark:text-zinc-100 uppercase tracking-widest">
                    {t.settings}
                  </h2>
                </div>
                <div className="flex items-center gap-1 sm:gap-2">
                  <button
                    onClick={() => {
                      const dark = !settings.dark_mode;
                      const next = { ...settings, dark_mode: dark };
                      setSettings(next);
                      onDarkModeChange?.(dark);
                      saveSettings(next).catch(console.error);
                    }}
                    className="p-1.5 sm:p-2 rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-500 dark:text-zinc-400 transition-colors"
                  >
                    {settings.dark_mode ? <Moon className="w-4 h-4" /> : <Sun className="w-4 h-4" />}
                  </button>
                  <button onClick={onClose} className="p-1.5 sm:p-2 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-md text-zinc-400 transition-colors">
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Body: horizontal tabs on small, 2-column on sm+ */}
              <div className="flex flex-col sm:flex-row flex-1 min-h-0 overflow-hidden">
                {/* Provider List — horizontal scroll on small, vertical sidebar on sm+ */}
                <div className="flex flex-row sm:flex-col shrink-0 sm:w-44 border-b sm:border-b-0 sm:border-r border-zinc-100 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/20 overflow-x-auto sm:overflow-y-auto sm:overflow-x-hidden sm:p-2 sm:space-y-1">
                  <div className="hidden sm:block px-3 py-2 shrink-0">
                    <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">{t.apiProvider}</span>
                  </div>
                  {PROVIDERS.map((p) => {
                    const isConfigured = settings.llm.configs[p.id]?.api_key || (!p.needs_key && settings.llm.configs[p.id]?.base_url);
                    const isActive = activeTab === p.id;
                    const isGlobalActive = settings.llm.provider === p.id;

                    return (
                      <button
                        key={p.id}
                        onClick={() => {
                          setActiveTab(p.id);
                          const cfg = settings.llm.configs[p.id] || { base_url: p.base_url, api_key: '', model: '' };
                          doFetch(p.id, cfg.base_url, cfg.api_key);
                        }}
                        className={cn(
                          'shrink-0 flex items-center gap-2 text-left transition-all',
                          /* horizontal (small): pill tab */
                          'flex-col px-3 py-2.5 sm:flex-row sm:w-full sm:px-3 sm:py-2.5 sm:rounded-xl sm:justify-between',
                          isActive
                            ? 'sm:bg-white sm:dark:bg-zinc-800 sm:shadow-sm sm:border sm:border-zinc-200 sm:dark:border-zinc-700 text-zinc-900 dark:text-zinc-100 border-b-2 border-indigo-500 sm:border-b-0'
                            : 'text-zinc-400 sm:text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-300 sm:hover:bg-zinc-100 sm:dark:hover:bg-zinc-800/50 border-b-2 border-transparent',
                        )}
                      >
                        <ProviderIcon domain={p.domain} color={p.color} initials={p.initials} size={24} fontSize={p.initials.length > 1 ? 7 : 10} />
                        {/* Name: single line on small (truncated), full on sm */}
                        <div className="flex flex-col min-w-0 sm:flex-1">
                          <span className="text-[10px] sm:text-[12.5px] font-semibold truncate max-w-[52px] sm:max-w-none">{p.name.split(' ')[0]}<span className="hidden sm:inline"> {p.name.split(' ').slice(1).join(' ')}</span></span>
                          {isGlobalActive && (
                            <span className="hidden sm:block text-[9px] font-bold text-indigo-500 uppercase">Active Now</span>
                          )}
                        </div>
                        {isConfigured && !isActive && (
                          <Check className="hidden sm:block w-3 h-3 text-green-500 shrink-0" />
                        )}
                        {isGlobalActive && isActive && (
                          <div className="sm:hidden w-1.5 h-1.5 rounded-full bg-indigo-500 shrink-0" />
                        )}
                      </button>
                    );
                  })}
                </div>

                {/* Right: Config Panel */}
                <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4 sm:space-y-6 min-h-0">
                  <div className="flex items-center gap-3 sm:gap-4">
                    <ProviderIcon domain={providerDef.domain} color={providerDef.color} initials={providerDef.initials} size={40} fontSize={providerDef.initials.length > 1 ? 12 : 18} rounded="rounded-xl sm:rounded-2xl" shadow />
                    <div>
                      <h3 className="text-[15px] sm:text-[16px] font-bold text-zinc-900 dark:text-zinc-100">{providerDef.name}</h3>
                      <p className="text-[11px] sm:text-[12px] text-zinc-500 dark:text-zinc-400">{providerDef.local ? 'Local LLM Server' : 'Cloud API Provider'}</p>
                    </div>
                  </div>

                  {/* Base URL */}
                  {showBaseUrl && (
                    <div className="space-y-2">
                      <label className="text-[11px] font-bold uppercase tracking-wider text-zinc-400 dark:text-zinc-500 flex items-center gap-1.5">
                        <Link className="w-3 h-3" /> {t.baseUrl}
                      </label>
                      <input
                        type="text"
                        value={currentTabConfig.base_url}
                        onChange={(e) => {
                          updateConfig(activeTab, { base_url: e.target.value });
                          scheduleFetch(activeTab, e.target.value, currentTabConfig.api_key);
                        }}
                        placeholder="http://localhost:11434/v1"
                        className="w-full bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl px-3 sm:px-4 py-2.5 text-[13px] outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all font-mono text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400"
                      />
                    </div>
                  )}

                  {/* API Key */}
                  <div className="space-y-2">
                    <label className="text-[11px] font-bold uppercase tracking-wider text-zinc-400 dark:text-zinc-500 flex items-center gap-1.5">
                      <Key className="w-3 h-3" /> {t.apiKey}
                      {!providerDef.needs_key && <span className="normal-case font-normal opacity-60 ml-1">({t.optionalLocal})</span>}
                    </label>
                    <input
                      type="password"
                      value={currentTabConfig.api_key === MASKED_KEY ? '' : currentTabConfig.api_key}
                      onChange={(e) => {
                        updateConfig(activeTab, { api_key: e.target.value });
                        scheduleFetch(activeTab, currentTabConfig.base_url, e.target.value);
                      }}
                      placeholder={
                        currentTabConfig.api_key === MASKED_KEY
                          ? '•••••••••••• (configured — type to replace)'
                          : providerDef.needs_key ? (providerDef.key_placeholder ?? t.apiKeyPlaceholder) : t.optionalLocal
                      }
                      className="w-full bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl px-3 sm:px-4 py-2.5 text-[13px] outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all font-mono text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400"
                    />
                  </div>

                  {/* Model */}
                  <div className="space-y-2">
                    <label className="text-[11px] font-bold uppercase tracking-wider text-zinc-400 dark:text-zinc-500 flex items-center justify-between">
                      <span className="flex items-center gap-1.5"><Tag className="w-3 h-3" /> {t.model}</span>
                      <button
                        onClick={() => doFetch(activeTab, currentTabConfig.base_url, currentTabConfig.api_key)}
                        disabled={loadingModels}
                        className="flex items-center gap-1 text-indigo-500 hover:text-indigo-600 disabled:opacity-40 transition-colors"
                      >
                        {loadingModels ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                        <span className="text-[10px] font-bold uppercase">{loadingModels ? t.saving : t.refresh}</span>
                      </button>
                    </label>
                    <div className="relative">
                      {modelOptions.length > 0 ? (
                        <select
                          value={currentTabConfig.model}
                          onChange={(e) => updateConfig(activeTab, { model: e.target.value })}
                          className="w-full appearance-none bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl px-3 sm:px-4 py-2.5 text-[13px] font-medium outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all text-zinc-900 dark:text-zinc-100"
                        >
                          <option value="" disabled>{t.selectModel}</option>
                          {modelOptions.map((m) => <option key={m} value={m}>{m}</option>)}
                        </select>
                      ) : (
                        <input
                          type="text"
                          value={currentTabConfig.model}
                          onChange={(e) => updateConfig(activeTab, { model: e.target.value })}
                          placeholder={loadingModels ? t.fetchModels : providerDef.needs_key && !currentTabConfig.api_key && currentTabConfig.api_key !== MASKED_KEY ? t.enterKeyToLoad : t.modelNamePlaceholder}
                          className="w-full bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl px-3 sm:px-4 py-2.5 text-[13px] outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all font-mono text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400"
                        />
                      )}
                      {modelOptions.length > 0 && <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400 pointer-events-none" />}
                    </div>
                    {modelError && (
                      <p className="flex items-center gap-1.5 text-[11px] text-amber-600 dark:text-amber-400 mt-1.5 bg-amber-50 dark:bg-amber-900/20 p-2 rounded-lg">
                        <AlertCircle className="w-3 h-3 shrink-0" />
                        {modelError}
                      </p>
                    )}
                  </div>
                </div>
              </div>

              {/* Footer */}
              <div className="flex items-center justify-between gap-2 px-4 sm:px-6 py-3 sm:py-4 border-t border-zinc-100 dark:border-zinc-800 bg-zinc-50 dark:bg-[#0f0f0f] shrink-0">
                <button
                  onClick={() => setShowClearConfirm(true)}
                  disabled={saving}
                  className="px-3 sm:px-4 py-2 text-[12px] font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-md transition-colors shrink-0"
                >
                  {t.clearData}
                </button>
                <div className="flex items-center gap-2 sm:gap-3 min-w-0">
                  {saveError && <span className="text-[11px] text-red-500 truncate">{saveError}</span>}
                  <button onClick={onClose} className="px-3 sm:px-4 py-2 text-[12px] font-medium text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-800 rounded-md transition-colors shrink-0">
                    {t.close}
                  </button>
                  <button
                    onClick={handleSave}
                    disabled={saving}
                    className={cn(
                      'flex items-center gap-1.5 sm:gap-2 px-4 sm:px-6 py-2 rounded-xl text-[12px] font-bold tracking-wider transition-all shadow-lg active:scale-95 shrink-0',
                      saved ? 'bg-green-600 text-white' : 'bg-indigo-600 hover:bg-indigo-700 text-white'
                    )}
                  >
                    {saved ? <Check className="w-4 h-4" /> : <Save className="w-4 h-4" />}
                    {saved ? t.saved : saving ? t.saving : t.save + " & Activate"}
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <ConfirmModal
        open={showClearConfirm}
        title={t.clearData}
        message={t.clearDataConfirm}
        confirmText={t.clearData}
        cancelText={t.cancel}
        isDanger={true}
        onConfirm={handleClearData}
        onCancel={() => setShowClearConfirm(false)}
      />
    </>
  );
}
