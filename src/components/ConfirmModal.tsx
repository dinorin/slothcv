import React from 'react';
import { AlertCircle, X } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface Props {
  open: boolean;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  onConfirm: () => void;
  onCancel: () => void;
  isDanger?: boolean;
}

export default function ConfirmModal({ 
  open, 
  title, 
  message, 
  confirmText = 'Confirm', 
  cancelText = 'Cancel', 
  onConfirm, 
  onCancel,
  isDanger = false 
}: Props) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
          onClick={(e) => e.target === e.currentTarget && onCancel()}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            className="bg-white dark:bg-[#0a0a0a] rounded-xl shadow-2xl w-full max-w-[380px] overflow-hidden border border-zinc-200 dark:border-zinc-800"
          >
            <div className="p-6 text-center">
              <div className={`mx-auto w-12 h-12 rounded-full flex items-center justify-center mb-4 ${isDanger ? 'bg-red-50 dark:bg-red-950/30 text-red-600 dark:text-red-400' : 'bg-zinc-50 dark:bg-zinc-900 text-zinc-600 dark:text-zinc-400'}`}>
                <AlertCircle className="w-6 h-6" />
              </div>
              
              <h3 className="text-[15px] font-bold text-zinc-900 dark:text-zinc-100 mb-2 uppercase tracking-wide">
                {title}
              </h3>
              
              <p className="text-[13px] text-zinc-500 dark:text-zinc-400 leading-relaxed px-2">
                {message}
              </p>
            </div>

            <div className="flex border-t border-zinc-100 dark:border-zinc-800">
              <button
                onClick={onCancel}
                className="flex-1 px-4 py-3.5 text-[12px] font-medium text-zinc-500 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-900 transition-colors border-r border-zinc-100 dark:border-zinc-800"
              >
                {cancelText}
              </button>
              <button
                onClick={onConfirm}
                className={`flex-1 px-4 py-3.5 text-[12px] font-bold transition-colors ${isDanger ? 'text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/20' : 'text-zinc-900 dark:text-zinc-100 hover:bg-zinc-50 dark:hover:bg-zinc-900'}`}
              >
                {confirmText}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
