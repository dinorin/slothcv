// ─── Re-export artifact types for backward compat ────────────────────────────
// When forking: update this re-export to point to your new artifact/types.ts
export type {
  LayoutType, PhotoPlacement, SkillsStyle, Spacing,
  ResumeLayout, SectionItem, ResumeSection, PersonalInfo, ResumeContent,
  CanvasElement, ResumeData,
} from './artifact/types';

// ─── Generic app-wide types ───────────────────────────────────────────────────

export const MASKED_KEY = '__MASKED__';

export interface ChatMessage {
  role: 'user' | 'ai';
  content: string;
  options?: string[];
  photo?: string; // base64 data URI, only on user messages
  isResumeUpdate?: boolean; // If true, this AI message came with a resume update
  isError?: boolean; // If true, this is an error message that should not be sent to history
  isTyping?: boolean; // If true, the message is being "streamed"
  resumeHtml?: string; // The HTML content of the resume at this point in time
}

export type Language = "vi" | "en" | "fr" | "de" | "ja" | "ko" | "zh";

export interface LlmProviderConfig {
  base_url: string;
  api_key: string;
  model: string;
}

export interface LlmSettings {
  provider: string;
  configs: Record<string, LlmProviderConfig>;
  // Active fields (synced from configs[provider])
  base_url: string;
  api_key: string;
  model: string;
}

export interface AppSettings {
  llm: LlmSettings;
  dark_mode: boolean;
}

export interface ChatSession {
  id: string;
  title: string;
  messages: ChatMessage[];
  resumeData: ResumeData | null;
  createdAt: number;
}
