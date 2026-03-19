export const MASKED_KEY = '__MASKED__';

export type LayoutType = "one_column" | "two_column" | "modern_asymmetric" | "timeline";
export type PhotoPlacement = "none" | "top_center_circle" | "top_right_square" | "sidebar_top" | "sidebar_top_circle";
export type SkillsStyle = "tag_cloud" | "progress_bars" | "simple_list" | "icons_with_levels";
export type Spacing = "compact" | "spacious";

export interface ResumeLayout {
  type: LayoutType;
  accent_color: string;
  background_color?: string;
  border_style?: "none" | "thin" | "thick" | "double" | "decorative";
  font_family: string;
  photo_placement: PhotoPlacement;
  skills_style: SkillsStyle;
  spacing: Spacing;
  section_order: {
    sidebar: string[];
    main: string[];
  };
}

export interface SectionItem {
  title?: string;
  subtitle?: string;
  location?: string;
  period?: string;
  description?: string;
  bullets?: string[];
  level?: number; // For skills/languages
}

export interface ResumeSection {
  id: string;
  title: string;
  type: "text" | "experience" | "education" | "projects" | "skills" | "list" | "grid";
  items: SectionItem[];
}

export interface PersonalInfo {
  name: string;
  title: string;
  email: string;
  phone: string;
  location: string;
  website?: string;
  linkedin?: string;
  github?: string;
  photo_url?: string;
}

export interface ResumeContent {
  personal: PersonalInfo;
  sections: ResumeSection[];
}

export interface CanvasElement {
  id: string;
  type: "text" | "rect" | "image" | "line" | "circle";
  x: number;
  y: number;
  width?: number;
  height?: number;
  radius?: number;
  text?: string;
  fontSize?: number;
  fontFamily?: string;
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  align?: "left" | "center" | "right";
  fontStyle?: string;
  opacity?: number;
  draggable?: boolean;
  points?: number[]; // for lines
}

export interface ResumeData {
  layout: ResumeLayout;
  content: ResumeContent;
  canvas_elements?: CanvasElement[];
  resume_html?: string;
  coach_message?: string;
  notes?: string;
  metadata?: {
    tokens_used?: {
      prompt: number;
      completion: number;
      total: number;
    };
    last_action?: string;
    suggested_options?: string[];
    is_data_modified?: boolean;
  };
}

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
