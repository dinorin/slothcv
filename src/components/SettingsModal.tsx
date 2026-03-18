import React, { useEffect, useState, useRef } from 'react';
import { X, Save, Key, Link, Tag, Moon, Sun, RefreshCw, AlertCircle, ChevronDown, Loader2 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { invoke } from '@tauri-apps/api/core';
import { AppSettings } from '../types';
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

interface ProviderDef {
  id: string;
  name: string;
  base_url: string;
  needs_key: boolean;
  local?: boolean;
  key_placeholder?: string;
}

const PROVIDERS: ProviderDef[] = [
  { id: 'gemini',     name: 'Google Gemini',  base_url: '',                                  needs_key: true,  key_placeholder: 'AIza...' },
  { id: 'openai',     name: 'OpenAI',          base_url: 'https://api.openai.com/v1',         needs_key: true,  key_placeholder: 'sk-...' },
  { id: 'groq',       name: 'Groq',            base_url: 'https://api.groq.com/openai/v1',    needs_key: true,  key_placeholder: 'gsk_...' },
  { id: 'openrouter', name: 'OpenRouter',      base_url: 'https://openrouter.ai/api/v1',      needs_key: true,  key_placeholder: 'sk-or-...' },
  { id: 'mistral',    name: 'Mistral',         base_url: 'https://api.mistral.ai/v1',         needs_key: true,  key_placeholder: 'API key' },
  { id: 'deepseek',   name: 'DeepSeek',        base_url: 'https://api.deepseek.com/v1',       needs_key: true,  key_placeholder: 'sk-...' },
  { id: 'together',   name: 'Together AI',     base_url: 'https://api.together.xyz/v1',       needs_key: true,  key_placeholder: 'API key' },
  { id: 'ollama',     name: 'Ollama (local)',  base_url: 'http://localhost:11434/v1',          needs_key: false, local: true },
  { id: 'lmstudio',   name: 'LM Studio',       base_url: 'http://localhost:1234/v1',           needs_key: false, local: true },
  { id: 'custom',     name: 'Custom / Other',  base_url: '',                                  needs_key: false },
];

async function fetchModelsFromApi(provider: string, base_url: string, api_key: string): Promise<string[]> {
  return invoke<string[]>('fetch_models', { provider, baseUrl: base_url, apiKey: api_key });
}

export default function SettingsModal({ open, onClose, onDarkModeChange, onSaved, onClearData, t }: Props) {
  const [settings, setSettings] = useState<AppSettings>({
    llm: { provider: 'gemini', base_url: '', api_key: '', model: '' },
    dark_mode: false,
  });
  const [models, setModels] = useState<string[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [modelError, setModelError] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  const providerDef = PROVIDERS.find((p) => p.id === settings.llm.provider) ?? PROVIDERS[PROVIDERS.length - 1];
  const showBaseUrl = settings.llm.provider !== 'gemini';

  // Load settings when modal opens
  useEffect(() => {
    if (!open) return;
    setModels([]);
    setModelError('');
    getSettings().then((s) => {
      setSettings(s);
      doFetch(s.llm.provider, s.llm.base_url, s.llm.api_key);
    }).catch(() => {});
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  function doFetch(provider: string, base_url: string, api_key: string) {
    const def = PROVIDERS.find((p) => p.id === provider);
    if (!def) return;
    if (def.needs_key && !api_key.trim()) return;
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

  function handleProviderChange(id: string) {
    const def = PROVIDERS.find((p) => p.id === id)!;
    setModels([]);
    setModelError('');
    const next = { ...settings, llm: { ...settings.llm, provider: id, base_url: def.base_url, model: '' } };
    setSettings(next);
    scheduleFetch(id, def.base_url, settings.llm.api_key);
  }

  function handleApiKeyChange(val: string) {
    const next = { ...settings, llm: { ...settings.llm, api_key: val } };
    setSettings(next);
    scheduleFetch(next.llm.provider, next.llm.base_url, val);
  }

  function handleBaseUrlChange(val: string) {
    const next = { ...settings, llm: { ...settings.llm, base_url: val } };
    setSettings(next);
    scheduleFetch(next.llm.provider, val, next.llm.api_key);
  }

  async function handleSave() {
    setSaving(true);
    setSaveError('');
    try {
      await saveSettings(settings);
      onSaved?.(settings.llm.provider, settings.llm.model);
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
        llm: { provider: 'gemini', base_url: '', api_key: '', model: '' },
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

  const modelOptions = settings.llm.model && !models.includes(settings.llm.model)
    ? [settings.llm.model, ...models]
    : models;

  return (
    <>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
            onClick={(e) => e.target === e.currentTarget && onClose()}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 10 }}
              transition={{ duration: 0.15 }}
              className="bg-white dark:bg-[#0a0a0a] rounded-xl shadow-2xl w-full max-w-md mx-4 overflow-hidden border border-zinc-200 dark:border-zinc-800"
            >
              {/* Header */}
              <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-100 dark:border-zinc-800">
                <h2 className="text-[12px] font-bold text-zinc-900 dark:text-zinc-100 uppercase tracking-widest">
                  {t.settings}
                </h2>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => {
                      const dark = !settings.dark_mode;
                      const next = { ...settings, dark_mode: dark };
                      setSettings(next);
                      onDarkModeChange?.(dark);
                      saveSettings(next).catch(console.error);
                    }}
                    className="p-2 rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-500 dark:text-zinc-400 transition-colors"
                    title={settings.dark_mode ? t.lightMode : t.darkMode}
                  >
                    {settings.dark_mode ? <Moon className="w-4 h-4" /> : <Sun className="w-4 h-4" />}
                  </button>
                  <button
                    onClick={onClose}
                    className="p-2 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-md text-zinc-400 transition-colors"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Body */}
              <div className="px-6 py-5 space-y-5">
                {/* Provider Selection */}
                <div className="space-y-1.5">
                  <label className="text-[11px] font-bold uppercase tracking-wider text-zinc-400 dark:text-zinc-500 block">
                    {t.apiProvider}
                  </label>
                  <div className="relative">
                    <select
                      value={settings.llm.provider}
                      onChange={(e) => handleProviderChange(e.target.value)}
                      className="w-full appearance-none bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg px-3 py-2 text-[13px] font-medium outline-none focus:ring-2 focus:ring-zinc-900/5 dark:focus:ring-zinc-100/5 transition-all text-zinc-900 dark:text-zinc-100"
                    >
                      {PROVIDERS.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}{p.local ? ' 🔵' : ''}
                        </option>
                      ))}
                    </select>
                    <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400 pointer-events-none" />
                  </div>
                </div>

                {/* Base URL */}
                {showBaseUrl && (
                  <div className="space-y-1.5">
                    <label className="text-[11px] font-bold uppercase tracking-wider text-zinc-400 dark:text-zinc-500 block flex items-center gap-1">
                      <Link className="w-3 h-3" /> {t.baseUrl}
                    </label>
                    <input
                      type="text"
                      value={settings.llm.base_url}
                      onChange={(e) => handleBaseUrlChange(e.target.value)}
                      placeholder="http://localhost:11434/v1"
                      className="w-full bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg px-3 py-2 text-[12px] outline-none focus:ring-2 focus:ring-zinc-900/5 dark:focus:ring-zinc-100/5 transition-all font-mono text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400"
                    />
                  </div>
                )}

                {/* API Key */}
                <div className="space-y-1.5">
                  <label className="text-[11px] font-bold uppercase tracking-wider text-zinc-400 dark:text-zinc-500 block flex items-center gap-1">
                    <Key className="w-3 h-3" /> {t.apiKey}
                    {!providerDef.needs_key && (
                      <span className="normal-case font-normal text-zinc-400 dark:text-zinc-500 ml-1">{t.optionalLocal}</span>
                    )}
                  </label>
                  <input
                    type="password"
                    value={settings.llm.api_key}
                    onChange={(e) => handleApiKeyChange(e.target.value)}
                    placeholder={providerDef.needs_key ? (providerDef.key_placeholder ?? t.apiKeyPlaceholder) : t.optionalLocal}
                    className="w-full bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg px-3 py-2 text-[12px] outline-none focus:ring-2 focus:ring-zinc-900/5 dark:focus:ring-zinc-100/5 transition-all font-mono text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400"
                  />
                </div>

                {/* Model */}
                <div className="space-y-1.5">
                  <label className="text-[11px] font-bold uppercase tracking-wider text-zinc-400 dark:text-zinc-500 block flex items-center justify-between">
                    <span className="flex items-center gap-1.5"><Tag className="w-3 h-3" /> {t.model}</span>
                    <button
                      onClick={() => doFetch(settings.llm.provider, settings.llm.base_url, settings.llm.api_key)}
                      disabled={loadingModels}
                      className="flex items-center gap-1 text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 disabled:opacity-40 transition-colors"
                    >
                      {loadingModels ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                      <span className="text-[10px] font-bold uppercase">{loadingModels ? t.saving : t.refresh}</span>
                    </button>
                  </label>
                  <div className="relative">
                    {modelOptions.length > 0 ? (
                      <select
                        value={settings.llm.model}
                        onChange={(e) => setSettings((p) => ({ ...p, llm: { ...p.llm, model: e.target.value } }))}
                        className="w-full appearance-none bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg px-3 py-2 text-[13px] font-medium outline-none focus:ring-2 focus:ring-zinc-900/5 dark:focus:ring-zinc-100/5 transition-all text-zinc-900 dark:text-zinc-100"
                      >
                        <option value="" disabled>{t.selectModel}</option>
                        {modelOptions.map((m) => <option key={m} value={m}>{m}</option>)}
                      </select>
                    ) : (
                      <input
                        type="text"
                        value={settings.llm.model}
                        onChange={(e) => setSettings({ ...settings, llm: { ...settings.llm, model: e.target.value } })}
                        placeholder={loadingModels ? t.fetchModels : providerDef.needs_key && !settings.llm.api_key ? t.enterKeyToLoad : t.modelNamePlaceholder}
                        className="w-full bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg px-3 py-2 text-[12px] outline-none focus:ring-2 focus:ring-zinc-900/5 dark:focus:ring-zinc-100/5 transition-all font-mono text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400"
                      />
                    )}
                    {modelOptions.length > 0 && <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400 pointer-events-none" />}
                  </div>
                  {modelError && (
                    <p className="flex items-center gap-1.5 text-[11px] text-amber-600 dark:text-amber-400 mt-1.5">
                      <AlertCircle className="w-3 h-3 shrink-0" />
                      {modelError}
                    </p>
                  )}
                </div>

                {saveError && (
                  <p className="text-[11px] text-red-500 bg-red-50 dark:bg-red-900/20 px-3 py-2 rounded-lg">{saveError}</p>
                )}
              </div>

              {/* Footer */}
              <div className="flex items-center justify-between px-6 py-4 border-t border-zinc-100 dark:border-zinc-800 bg-zinc-50 dark:bg-[#0f0f0f]">
                <button
                  onClick={() => setShowClearConfirm(true)}
                  disabled={saving}
                  className="px-4 py-2 text-[12px] font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-md transition-colors"
                >
                  {t.clearData}
                </button>
                <div className="flex items-center gap-3">
                  <button onClick={onClose} className="px-4 py-2 text-[12px] font-medium text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-800 rounded-md transition-colors">
                    {t.close}
                  </button>
                  <button
                    onClick={handleSave}
                    disabled={saving}
                    className={cn(
                      'flex items-center gap-2 px-5 py-2 rounded-md text-[12px] font-bold tracking-wider transition-all',
                      saved ? 'bg-green-600 text-white' : 'bg-zinc-900 hover:bg-black dark:bg-zinc-100 dark:hover:bg-white text-white dark:text-zinc-900 shadow-sm',
                    )}
                  >
                    <Save className="w-3.5 h-3.5" />
                    {saved ? t.saved : saving ? t.saving : t.save}
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
