import { Plus, Trash2 } from 'lucide-react';
import { SessionSummary } from '../services/storage';
import { Language } from '../types';
import { cn } from '../lib/utils';

interface Props {
  width: number;
  isOpen: boolean;
  isResizing: boolean;
  sessions: SessionSummary[];
  currentSessionId: string;
  language: Language;
  t: any;
  onResizeStart: (e: React.MouseEvent) => void;
  onNewChat: () => void;
  onSwitchSession: (id: string) => void;
  onDeleteSession: (id: string, e: React.MouseEvent) => void;
  onLanguageChange: (lang: Language) => void;
}

export default function Sidebar({
  width, isOpen, isResizing, sessions, currentSessionId,
  language, t, onResizeStart, onNewChat, onSwitchSession,
  onDeleteSession, onLanguageChange,
}: Props) {
  return (
    <>
      <aside
        style={{ width: isOpen ? width : 0 }}
        className={cn(
          'flex flex-col shrink-0 bg-[#fbfbfc] dark:bg-[#0f0f0f] border-r border-zinc-200 dark:border-zinc-800/80 overflow-hidden',
          !isResizing && 'transition-all duration-200',
        )}
      >
        <div className="px-3 pt-3 pb-2 shrink-0">
          <button
            onClick={onNewChat}
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
                onClick={() => onSwitchSession(s.id)}
                className={cn(
                  'group flex items-center justify-between w-full px-3 py-1.5 rounded-md text-left text-[12.5px] transition-colors min-w-0 cursor-pointer',
                  s.id === currentSessionId
                    ? 'bg-zinc-200/50 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 font-medium'
                    : 'hover:bg-zinc-100 dark:hover:bg-zinc-900/50 text-zinc-600 dark:text-zinc-400',
                )}
              >
                <span className="truncate flex-1 min-w-0">{s.title}</span>
                <button
                  onClick={e => onDeleteSession(s.id, e)}
                  className="opacity-0 group-hover:opacity-100 p-1 rounded-md hover:bg-red-100 dark:hover:bg-red-900/30 hover:text-red-600 dark:hover:text-red-400 transition-all shrink-0"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))
          )}
        </div>

        <div className="px-3 py-3 shrink-0">
          <select
            value={language}
            onChange={e => onLanguageChange(e.target.value as Language)}
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

      {isOpen && (
        <div
          onMouseDown={onResizeStart}
          className="w-1 cursor-col-resize hover:bg-zinc-300 dark:hover:bg-zinc-700 transition-colors z-20 shrink-0 border-r border-zinc-100 dark:border-zinc-900"
        />
      )}
    </>
  );
}
