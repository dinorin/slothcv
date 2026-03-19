import { useRef, useEffect } from 'react';
import { FileDown, Copy, RotateCcw, Check, Pencil, ChevronRight } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { ChatMessage } from '../types';
import { cn } from '../lib/utils';
import appIcon from '../assets/icon.svg';

interface Props {
  messages: ChatMessage[];
  isLoading: boolean;
  agentStatus: string | null;
  error: string | null;
  copiedIdx: number | null;
  editingIdx: number | null;
  editInput: string;
  isPreviewOpen: boolean;
  t: any;
  onCopy: (text: string, idx: number) => void;
  onStartEditing: (idx: number, content: string) => void;
  onCancelEditing: () => void;
  onEditInputChange: (text: string) => void;
  onRetry: (idx?: number, content?: string) => void;
  onOptionClick: (opt: string) => void;
  onOpenPreview: () => void;
}

export default function MessageList({
  messages, isLoading, agentStatus, error,
  copiedIdx, editingIdx, editInput, isPreviewOpen, t,
  onCopy, onStartEditing, onCancelEditing, onEditInputChange,
  onRetry, onOptionClick, onOpenPreview,
}: Props) {
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const lastOptions = [...messages].reverse().find(m => m.options && m.options.length > 0)?.options;

  return (
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
                    onClick={e => { e.stopPropagation(); onCopy(msg.content, idx); }}
                    className="p-1.5 rounded-md hover:bg-zinc-50 dark:hover:bg-zinc-900 text-zinc-400 hover:text-zinc-600 transition-all"
                    title={t.copy}
                  >
                    {copiedIdx === idx ? <Check className="w-3.5 h-3.5 text-green-500" /> : <Copy className="w-3.5 h-3.5" />}
                  </button>
                  {idx === messages.length - 1 && !isLoading && (
                    <button
                      onClick={e => { e.stopPropagation(); onRetry(); }}
                      className="p-1.5 rounded-md hover:bg-zinc-50 dark:hover:bg-zinc-900 text-zinc-400 hover:text-zinc-600 transition-all"
                      title="Retry"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              )}

              {msg.isResumeUpdate && !msg.isTyping && (
                <div className="mt-4 pl-7">
                  <button
                    onClick={onOpenPreview}
                    className={cn(
                      'group flex flex-col w-full sm:w-[320px] text-left p-3 rounded-xl border transition-all duration-200',
                      isPreviewOpen
                        ? 'border-zinc-300 bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800/50'
                        : 'border-zinc-200 bg-white hover:border-zinc-300 hover:shadow-sm dark:border-zinc-800 dark:bg-[#111111] dark:hover:border-zinc-700',
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
                    <p className="text-[11px] text-zinc-500 line-clamp-1">{t.artifactDesc}</p>
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
                    onChange={e => onEditInputChange(e.target.value)}
                    className="w-full bg-transparent border-none outline-none text-[14px] text-zinc-900 dark:text-zinc-100 resize-none min-h-[80px]"
                    autoFocus
                  />
                  <div className="flex justify-end gap-2 mt-2">
                    <button
                      onClick={onCancelEditing}
                      className="px-3 py-1 text-[11px] font-medium text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors"
                    >
                      {t.cancel || 'Cancel'}
                    </button>
                    <button
                      onClick={() => onRetry(idx, editInput)}
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
                        onClick={e => { e.stopPropagation(); onStartEditing(idx, msg.content); }}
                        className="p-1.5 rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-400 hover:text-zinc-600 transition-all"
                        title="Edit"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                    )}
                    <button
                      onClick={e => { e.stopPropagation(); onCopy(msg.content, idx); }}
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

      {lastOptions && !isLoading && (
        <div className="flex flex-wrap gap-2 pt-2 max-w-3xl mx-auto">
          {lastOptions.map((opt, i) => (
            <button
              key={i}
              onClick={() => onOptionClick(opt)}
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
  );
}
