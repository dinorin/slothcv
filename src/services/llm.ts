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
  onStatus?: (status: string) => void,
): Promise<ResumeData> {
  // Limit history to avoid context window issues
  const MAX_HISTORY = 15;
  const history = messages.slice(-MAX_HISTORY);

  let response: LlmResponse = await invoke('generate_resume', {
    history,
    currentData: currentData ?? null,
    notes: notes || null,
    language,
    hasPhoto: !!userPhoto,
  });

  // Build new resume state
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
  let iteration = 0;
  const MAX_ITERATIONS = 5;

  // Agentic Loop: Handle tool calls sequentially
  while (response.function_calls.length > 0 && iteration < MAX_ITERATIONS) {
    iteration++;
    const toolResults: HistoryMessage[] = [];

    for (const call of response.function_calls) {
      const args = call.args as Record<string, unknown>;
      lastAction = call.name;

      switch (call.name) {
        case 'web_search': {
          const query = args.query as string;
          onStatus?.(`Searching web for: ${query}...`);
          try {
            const result = await invoke<string>('web_search', { query });
            toolResults.push({ role: 'user', content: `TOOL_RESULT [web_search]:\n${result}` });
          } catch (e) {
            toolResults.push({ role: 'user', content: `TOOL_ERROR [web_search]: ${e}` });
          }
          break;
        }

        case 'fetch_web_content': {
          const url = args.url as string;
          onStatus?.(`Reading webpage content...`);
          try {
            const result = await invoke<string>('fetch_web_content', { url });
            toolResults.push({ role: 'user', content: `TOOL_RESULT [fetch_web_content]:\n${result}` });
          } catch (e) {
            toolResults.push({ role: 'user', content: `TOOL_ERROR [fetch_web_content]: ${e}` });
          }
          break;
        }

        case 'render_resume': {
          onStatus?.(`Updating resume design...`);
          let html = args.html as string;
          if (userPhoto && html.includes('__PROFILE_PHOTO__')) {
            html = html.split('__PROFILE_PHOTO__').join(userPhoto);
          }
          newState.resume_html = html;
          isDataModified = true;
          toolResults.push({ role: 'user', content: `TOOL_RESULT [render_resume]: Success.` });
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

    if (toolResults.length === 0) break;

    // Add results to history and call LLM again
    history.push(...toolResults);
    response = await invoke('generate_resume', {
      history,
      currentData: newState,
      notes: newState.notes || notes,
      language,
      hasPhoto: !!userPhoto,
    });
    if (response.text) textResponse = response.text;
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
