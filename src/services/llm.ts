import { invoke } from '@tauri-apps/api/core';
import { ResumeData } from '../types';

interface FunctionCall {
  name: string;
  args: Record<string, unknown>;
}

interface LlmResponse {
  text: string | null;
  function_calls: FunctionCall[];
  token_usage: {
    prompt: number;
    completion: number;
    total: number;
  };
}

export interface HistoryMessage {
  role: string;   // "user" or "ai"
  content: string;
}

export async function generateResume(
  messages: HistoryMessage[],
  currentData?: ResumeData,
  _useCanvas: boolean = false,
  notes: string = '',
  language: string = 'en',
  userPhoto?: string,
): Promise<ResumeData> {
  const response: LlmResponse = await invoke('generate_resume', {
    history: messages,
    currentData: currentData ?? null,
    notes: notes || null,
    language,
    hasPhoto: !!userPhoto,
  });

  // Build new resume state by applying function calls
  let newState: ResumeData = currentData
    ? JSON.parse(JSON.stringify(currentData))
    : {
        layout: {
          type: 'one_column',
          accent_color: '#1E1E1E',
          font_family: 'Inter',
          photo_placement: 'none',
          skills_style: 'simple_list',
          spacing: 'compact',
          section_order: { sidebar: [], main: [] },
        },
        content: {
          personal: {
            name: 'Your Name',
            title: 'Professional Title',
            email: '',
            phone: '',
            location: '',
          },
          sections: [],
        },
      };

  let lastAction = 'No action taken';
  let isDataModified = false;
  let textResponse = response.text;

  for (const call of response.function_calls) {
    const args = call.args as Record<string, unknown>;
    lastAction = call.name;

    switch (call.name) {
      case 'render_resume': {
        let html = args.html as string;
        // Inject photo base64 — guaranteed offline, no network dependency
        if (userPhoto && html.includes('__PROFILE_PHOTO__')) {
          html = html.split('__PROFILE_PHOTO__').join(userPhoto);
        }
        newState.resume_html = html;
        isDataModified = true;
        lastAction = 'render_resume';
        break;
      }

      case 'suggest_options':
        if (!newState.metadata) newState.metadata = {};
        newState.metadata.suggested_options = args.options as string[];
        textResponse = args.question as string;
        break;

      case 'update_internal_notes':
        newState.notes = args.notes as string;
        break;
    }
  }

  newState.metadata = {
    ...newState.metadata,
    tokens_used: response.token_usage,
    last_action: lastAction,
    is_data_modified: isDataModified,
  };

  newState.coach_message = textResponse ?? (isDataModified ? 'CV has been updated.' : undefined);

  return newState;
}
