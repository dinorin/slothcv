import { useState, useRef, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { ChatMessage, Language } from '../types';
import { ResumeData } from '../artifact/types';
import { generateResume, HistoryMessage } from '../services/llm';

interface Deps {
  messages: ChatMessage[];
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  resumeData: ResumeData | null;
  setResumeData: (rd: ResumeData | null) => void;
  setIsPreviewOpen: (open: boolean) => void;
  notes: string;
  language: Language;
  userPhoto: string | null;
  setUserPhoto: (photo: string | null) => void;
  sessionTitle: string;
  setSessionTitle: (title: string) => void;
  pendingPhoto: string | null;
  setPendingPhoto: (photo: string | null) => void;
  input: string;
  setInput: (v: string) => void;
  t: { newChat: string; errorLabel: string; apiKeyMissing: string; openSettings: string };
}

export function useLlm(deps: Deps) {
  const [isLoading, setIsLoading] = useState(false);
  const [agentStatus, setAgentStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isAbortedRef = useRef(false);
  const handleSendRef = useRef<(() => void) | null>(null);

  const {
    messages, setMessages, resumeData, setResumeData,
    setIsPreviewOpen, notes, language, userPhoto, setUserPhoto,
    sessionTitle, setSessionTitle, pendingPhoto, setPendingPhoto,
    input, setInput, t,
  } = deps;

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
    const isKeyError = ['api key', 'api_key', '401', '403'].some(k => errMsg.toLowerCase().includes(k));
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
          if (trigger.resumeHtml) setResumeData({ resume_html: trigger.resumeHtml } as ResumeData);
          return trimmed.slice(0, -1);
        }
        if (last.role === 'user' && last.resumeHtml) setResumeData({ resume_html: last.resumeHtml } as ResumeData);
        return trimmed;
      }
      return prev;
    });
  }, [setMessages, setResumeData]);

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
  }, [isLoading, input, pendingPhoto, messages, resumeData, notes, language, userPhoto, sessionTitle, t]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleRetry = async (targetIdx?: number, overrideContent?: string) => {
    if (isLoading) return;
    const idx = targetIdx ?? messages.length - 1 - [...messages].reverse().findIndex(m => m.role === 'user');
    if (idx < 0) return;
    const msg = { ...messages[idx], ...(overrideContent ? { content: overrideContent } : {}) };
    const restoredRd = msg.resumeHtml ? { resume_html: msg.resumeHtml } as ResumeData : null;
    setResumeData(restoredRd);
    const history = [...messages.slice(0, idx), msg];
    setMessages(history);
    setIsLoading(true);
    isAbortedRef.current = false;
    setAgentStatus(null);
    setError(null);
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

  return {
    isLoading, agentStatus, error,
    isAbortedRef, handleSendRef,
    stopProcessing, handleSend, handleRetry,
  };
}
