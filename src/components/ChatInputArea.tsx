import { useRef, useEffect } from 'react';
import { ImagePlus, X, ChevronDown, Loader2, ArrowUp, Square } from 'lucide-react';
import { AppSettings } from '../types';
import { PROVIDERS } from '../constants';
import { cn } from '../lib/utils';

interface Props {
  input: string;
  pendingPhoto: string | null;
  isLoading: boolean;
  currentModel: string;
  quickModels: string[];
  isLoadingModels: boolean;
  appSettings: AppSettings | null;
  t: any;
  onInputChange: (text: string) => void;
  onSend: () => void;
  onStop: () => void;
  onPhotoPaste: (e: React.ClipboardEvent<HTMLTextAreaElement>) => void;
  onAttachClick: () => void;
  onRemovePhoto: () => void;
  onModelChange: (val: string) => void;
  onFetchModels: () => void;
  onOpenSettings: () => void;
}

export default function ChatInputArea({
  input, pendingPhoto, isLoading, currentModel, quickModels,
  isLoadingModels, appSettings, t,
  onInputChange, onSend, onStop, onPhotoPaste,
  onAttachClick, onRemovePhoto, onModelChange, onFetchModels, onOpenSettings,
}: Props) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
    }
  }, [input]);

  return (
    <div className="px-6 pb-6 shrink-0 max-w-3xl mx-auto w-full">
      <div className="bg-white dark:bg-[#0f0f0f] border border-zinc-200 dark:border-zinc-800 rounded-xl shadow-sm focus-within:ring-2 focus-within:ring-zinc-900/10 dark:focus-within:ring-zinc-100/10 transition-all overflow-hidden">
        {pendingPhoto && (
          <div className="px-3 pt-2.5 flex items-center gap-2 border-b border-zinc-100 dark:border-zinc-800/50 pb-2">
            <div className="relative shrink-0">
              <img
                src={pendingPhoto}
                alt="attachment"
                className="w-12 h-12 rounded-md object-cover border border-zinc-200 dark:border-zinc-800"
              />
              <button
                onClick={onRemovePhoto}
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
          onChange={e => onInputChange(e.target.value)}
          onPaste={onPhotoPaste}
          onKeyDown={e => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              onSend();
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
              onClick={onAttachClick}
              className="flex items-center justify-center w-8 h-8 rounded-md text-zinc-400 hover:text-zinc-900 hover:bg-zinc-100 dark:hover:text-zinc-100 dark:hover:bg-zinc-800 transition-colors"
              title={t.attachPhoto}
            >
              <ImagePlus className="w-4 h-4" />
            </button>

            {currentModel ? (
              <div className="relative flex items-center">
                <select
                  value={currentModel}
                  onChange={e => onModelChange(e.target.value)}
                  onMouseDown={() => { if (quickModels.length === 0) onFetchModels(); }}
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
                      <option key={p.id} value={`provider:${p.id}`}>➜ Use {p.name}</option>
                    ))}
                  </optgroup>
                </select>
                <ChevronDown className="absolute right-1.5 w-2.5 h-3 text-zinc-400 pointer-events-none" />
                {isLoadingModels && <Loader2 className="absolute -right-5 w-3 h-3 text-zinc-400 animate-spin" />}
              </div>
            ) : (
              <button
                onClick={onOpenSettings}
                className="text-[10px] font-bold text-indigo-500 hover:text-indigo-600 px-2 py-1 rounded-md bg-indigo-50 dark:bg-indigo-950/30 border border-indigo-100 dark:border-indigo-900/50 uppercase tracking-tight transition-colors"
              >
                {t.setupAi}
              </button>
            )}
          </div>

          {import.meta.env.DEV && (
            <button id="__agent_send__" onClick={onSend} style={{ display: 'none' }} aria-hidden="true" tabIndex={-1} />
          )}

          <button
            onClick={isLoading ? onStop : onSend}
            disabled={!isLoading && !input.trim() && !pendingPhoto}
            className={cn(
              'flex items-center justify-center h-8 rounded-md transition-colors',
              isLoading
                ? 'w-8 bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 border border-zinc-200 dark:border-zinc-700 hover:bg-red-50 dark:hover:bg-red-900/20 hover:text-red-600 dark:hover:text-red-400 hover:border-red-200 dark:hover:border-red-900/30'
                : 'w-8 bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 hover:bg-black dark:hover:bg-white disabled:opacity-30 shadow-sm',
            )}
            title={isLoading ? t.cancel : t.send}
          >
            {isLoading ? <Square className="w-2.5 h-3 fill-current" /> : <ArrowUp className="w-4 h-4" strokeWidth={2.5} />}
          </button>
        </div>
      </div>
    </div>
  );
}
