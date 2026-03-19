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
  isAborted?: () => boolean,
): Promise<ResumeData> {
  // Limit history to avoid context window issues
  const MAX_HISTORY = 15;
  const history = messages.slice(-MAX_HISTORY);

  const checkAbort = () => {
    if (isAborted?.()) {
      throw new Error('ABORTED');
    }
  };

  checkAbort();

  // TOKEN SAVING: Chỉ lấy tối đa 10 tin nhắn gần nhất để giữ context nhẹ
  const maxHistory = 10;
  const trimmedHistory = history.slice(-maxHistory);

  onStatus?.('Analyzing your request...');
  let response: LlmResponse = await invoke('generate_resume', {
    history: trimmedHistory,
    currentData: currentData ?? null,
    notes: notes || null,
    language,
    hasPhoto: !!userPhoto,
  });

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
    checkAbort();
    iteration++;
    const toolResults: HistoryMessage[] = [];

    for (const call of response.function_calls) {
      checkAbort();
      const args = call.args as Record<string, unknown>;
      lastAction = call.name;

      switch (call.name) {
        case 'web_search': {
          const query = args.query as string;
          onStatus?.(`[Tool: web_search] Searching: ${query}`);
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
          onStatus?.(`[Tool: fetch_web_content] Reading: ${url}`);
          try {
            const result = await invoke<string>('fetch_web_content', { url });
            toolResults.push({ role: 'user', content: `TOOL_RESULT [fetch_web_content]:\n${result}` });
          } catch (e) {
            toolResults.push({ role: 'user', content: `TOOL_ERROR [fetch_web_content]: ${e}` });
          }
          break;
        }

        case 'read_artifact': {
          onStatus?.(`[Tool: read_artifact] Reading current HTML`);
          const currentHtml = newState.resume_html || '';
          toolResults.push({ role: 'user', content: `TOOL_RESULT [read_artifact]:\n${currentHtml}` });
          break;
        }

        case 'edit_artifact': {
          onStatus?.(`[Tool: edit_artifact] Applying surgical edit`);
          const search = args.search as string;
          const replace = args.replace as string;
          if (newState.resume_html) {
            if (newState.resume_html.includes(search)) {
              newState.resume_html = newState.resume_html.replace(search, replace);
              isDataModified = true;
              toolResults.push({ role: 'user', content: `TOOL_RESULT [edit_artifact]: Success.` });
            } else {
              toolResults.push({ role: 'user', content: `TOOL_ERROR [edit_artifact]: Search string not found.` });
            }
          } else {
            toolResults.push({ role: 'user', content: `TOOL_ERROR [edit_artifact]: No artifact exists.` });
          }
          break;
        }

        case 'render_resume': {
          onStatus?.(`[Tool: render_resume] Full re-render of A4 CV`);
          let html = args.html as string;
          if (userPhoto && html.includes('__PROFILE_PHOTO__')) {
            html = html.split('__PROFILE_PHOTO__').join(userPhoto);
          }
          newState.resume_html = html;
          isDataModified = true;
          // Chỉ gửi lại thông báo thành công thay vì gửi cả cục HTML dài
          toolResults.push({ role: 'user', content: `TOOL_RESULT [render_resume]: Success. Current HTML updated.` });
          break;
        }

        case 'suggest_options':
          onStatus?.(`[Tool: suggest_options] Preparing user options`);
          if (!newState.metadata) newState.metadata = {};
          newState.metadata.suggested_options = args.options as string[];
          textResponse = args.question as string;
          toolResults.push({ role: 'user', content: `TOOL_RESULT [suggest_options]: Options presented.` });
          break;

        case 'update_internal_notes':
          onStatus?.(`[Tool: update_internal_notes] Saving data to memory`);
          newState.notes = args.notes as string;
          toolResults.push({ role: 'user', content: `TOOL_RESULT [update_internal_notes]: Notes updated.` });
          break;
      }
    }

    if (toolResults.length === 0) break;

    // Add results to history and call LLM again
    history.push(...toolResults);
    checkAbort();

    if (iteration === 1) {
      onStatus?.('Processing information...');
    } else if (iteration === 2) {
      onStatus?.('Refining design & details...');
    } else {
      onStatus?.('Finalizing everything...');
    }

    response = await invoke('generate_resume', {
      history,
      currentData: newState,
      notes: newState.notes || notes,
      language,
      hasPhoto: !!userPhoto,
    });
    if (response.text) textResponse = response.text;
  }

  checkAbort();

  newState.metadata = {
    ...newState.metadata,
    tokens_used: response.token_usage,
    last_action: lastAction,
    is_data_modified: isDataModified,
  };

  newState.coach_message = textResponse ?? (isDataModified ? 'CV has been updated.' : undefined);

  return newState;
}
