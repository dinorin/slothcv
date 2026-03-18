import { getCurrentWindow } from '@tauri-apps/api/window';
import { Minus, Square, X, Copy } from 'lucide-react';
import { useState, useEffect, ReactNode } from 'react';
import appIcon from '../assets/icon.svg';

const win = getCurrentWindow();

interface Props {
  children?: ReactNode;
  t: any;
}

export default function TitleBar({ children, t }: Props) {
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    win.isMaximized().then(setIsMaximized);
    const unlisten = win.onResized(async () => {
      setIsMaximized(await win.isMaximized());
    });
    return () => { unlisten.then(f => f()); };
  }, []);

  return (
    <div
      data-tauri-drag-region
      className="absolute top-0 left-0 right-0 h-10 flex items-center shrink-0 bg-transparent select-none z-50 pointer-events-none"
    >
      {/* App logo — part of drag region */}
      <div className="flex items-center gap-2 px-3 shrink-0 pointer-events-auto">
        <img src={appIcon} alt="Sloth CV" className="w-[16px] h-[16px] object-contain drop-shadow-sm opacity-80" />
        <span className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400">Sloth CV</span>
      </div>

      {/* Middle slot — app controls passed from parent */}
      <div className="flex-1 flex items-center min-w-0 pointer-events-auto pl-2" data-tauri-drag-region="false">
        {children}
      </div>

      {/* Window controls */}
      <div className="flex h-full shrink-0 pointer-events-auto">
        <button
          onClick={() => win.minimize()}
          className="w-11 h-full flex items-center justify-center text-zinc-500 dark:text-zinc-400 hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
          title={t.minimize}
        >
          <Minus className="w-3.5 h-3.5" strokeWidth={1.5} />
        </button>
        <button
          onClick={() => win.toggleMaximize()}
          className="w-11 h-full flex items-center justify-center text-zinc-500 dark:text-zinc-400 hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
          title={isMaximized ? t.restore : t.maximize}
        >
          {isMaximized ? (
            <Copy className="w-[13px] h-[13px]" strokeWidth={1.5} />
          ) : (
            <Square className="w-[13px] h-[13px]" strokeWidth={1.5} />
          )}
        </button>
        <button
          onClick={() => win.close()}
          className="w-11 h-full flex items-center justify-center text-zinc-500 dark:text-zinc-400 hover:bg-[#c42b1c] hover:text-white transition-colors"
          title={t.close}
        >
          <X className="w-[15px] h-[15px]" strokeWidth={1.5} />
        </button>
      </div>
    </div>
  );
}
