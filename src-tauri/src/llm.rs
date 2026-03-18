use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::AppHandle;

use crate::settings::{get_settings, AppSettings};

// ─── Response types sent back to the frontend ────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct FunctionCall {
    pub name: String,
    pub args: Value,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct TokenUsage {
    pub prompt: i64,
    pub completion: i64,
    pub total: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct LlmResponse {
    pub text: Option<String>,
    pub function_calls: Vec<FunctionCall>,
    pub token_usage: TokenUsage,
}

// ─── Tool declarations ────────────────────────────────────────────────────────

/// OpenAI-compatible tools format (also used by most local LLM servers)
fn tools_openai() -> Value {
    json!([
        {
            "type": "function",
            "function": {
                "name": "render_resume",
                "description": "Create or update the CV by outputting a complete self-contained HTML document with embedded CSS.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "html": {
                            "type": "string",
                            "description": "Complete HTML document with all styles embedded."
                        }
                    },
                    "required": ["html"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "suggest_options",
                "description": "Provide multiple-choice options for the user to select from.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "options": {
                            "type": "array",
                            "items": {"type": "string"},
                            "description": "A list of 2-4 short options."
                        },
                        "question": {
                            "type": "string",
                            "description": "The question to ask alongside the options."
                        }
                    },
                    "required": ["options", "question"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "update_internal_notes",
                "description": "Update the AI's internal scratchpad/notes.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "notes": {"type": "string"}
                    },
                    "required": ["notes"]
                }
            }
        }
    ])
}

/// Gemini REST API tool format (uses uppercase type names)
fn tools_gemini() -> Value {
    json!([{
        "functionDeclarations": [
            {
                "name": "render_resume",
                "description": "Create or update the CV by outputting a complete self-contained HTML document.",
                "parameters": {
                    "type": "OBJECT",
                    "properties": {
                        "html": {"type": "STRING"}
                    },
                    "required": ["html"]
                }
            },
            {
                "name": "suggest_options",
                "description": "Provide multiple-choice options for the user.",
                "parameters": {
                    "type": "OBJECT",
                    "properties": {
                        "options": {
                            "type": "ARRAY",
                            "items": {"type": "STRING"}
                        },
                        "question": {"type": "STRING"}
                    },
                    "required": ["options", "question"]
                }
            },
            {
                "name": "update_internal_notes",
                "description": "Update the AI's internal scratchpad.",
                "parameters": {
                    "type": "OBJECT",
                    "properties": {
                        "notes": {"type": "STRING"}
                    },
                    "required": ["notes"]
                }
            }
        ]
    }])
}

// ─── API callers ──────────────────────────────────────────────────────────────

async fn call_gemini(
    settings: &AppSettings,
    system_instruction: &str,
    history: &[HistoryMessage],
) -> Result<LlmResponse, String> {
    let client = reqwest::Client::new();
    let url = format!(
        "https://generativelanguage.googleapis.com/v1beta/models/{}:generateContent?key={}",
        settings.llm.model, settings.llm.api_key
    );

    // Build contents from history — Gemini uses "user"/"model"
    let contents: Vec<Value> = history.iter().map(|m| {
        let role = if m.role == "user" { "user" } else { "model" };
        json!({ "role": role, "parts": [{"text": &m.content}] })
    }).collect();

    let body = json!({
        "contents": contents,
        "systemInstruction": {
            "parts": [{"text": system_instruction}]
        },
        "tools": tools_gemini()
    });

    let resp = client
        .post(&url)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Request failed: {e}"))?;

    let status = resp.status();
    let text = resp.text().await.map_err(|e| format!("Failed to read response: {e}"))?;
    let json: Value = serde_json::from_str(&text)
        .map_err(|e| format!("Invalid JSON from Gemini (HTTP {status}): {e}\nBody: {}", &text[..text.len().min(300)]))?;

    if let Some(err) = json.get("error") {
        return Err(format!("Gemini API error: {err}"));
    }

    let mut text: Option<String> = None;
    let mut function_calls: Vec<FunctionCall> = Vec::new();

    if let Some(candidates) = json["candidates"].as_array() {
        if let Some(candidate) = candidates.first() {
            if let Some(parts) = candidate["content"]["parts"].as_array() {
                for part in parts {
                    if let Some(t) = part["text"].as_str() {
                        if !t.is_empty() {
                            text = Some(t.to_string());
                        }
                    }
                    if let Some(fc) = part.get("functionCall") {
                        let name = fc["name"].as_str().unwrap_or("").to_string();
                        let args = fc["args"].clone();
                        function_calls.push(FunctionCall { name, args });
                    }
                }
            }
        }
    }

    let usage = &json["usageMetadata"];
    let token_usage = TokenUsage {
        prompt: usage["promptTokenCount"].as_i64().unwrap_or(0),
        completion: usage["candidatesTokenCount"].as_i64().unwrap_or(0),
        total: usage["totalTokenCount"].as_i64().unwrap_or(0),
    };

    Ok(LlmResponse { text, function_calls, token_usage })
}

async fn call_openai_compat(
    settings: &AppSettings,
    system_instruction: &str,
    history: &[HistoryMessage],
) -> Result<LlmResponse, String> {
    let client = reqwest::Client::new();
    let base = settings.llm.base_url.trim_end_matches('/');
    let url = format!("{base}/chat/completions");

    let mut req = client
        .post(&url)
        .header("Content-Type", "application/json");

    if !settings.llm.api_key.is_empty() {
        req = req.header(
            "Authorization",
            format!("Bearer {}", settings.llm.api_key),
        );
    }

    // Build messages: system prompt + full conversation history
    let mut messages = vec![json!({"role": "system", "content": system_instruction})];
    for m in history {
        let role = if m.role == "user" { "user" } else { "assistant" };
        messages.push(json!({"role": role, "content": m.content}));
    }

    let body = json!({
        "model": settings.llm.model,
        "messages": messages,
        "tools": tools_openai(),
        "tool_choice": "auto"
    });

    let resp = req
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Request failed: {e}"))?;

    let status = resp.status();
    let text = resp.text().await.map_err(|e| format!("Failed to read response: {e}"))?;
    let json: Value = serde_json::from_str(&text)
        .map_err(|e| format!("Invalid JSON from API (HTTP {status}): {e}\nBody: {}", &text[..text.len().min(300)]))?;

    if let Some(err) = json.get("error") {
        return Err(format!("API error: {err}"));
    }

    let mut text: Option<String> = None;
    let mut function_calls: Vec<FunctionCall> = Vec::new();

    if let Some(choices) = json["choices"].as_array() {
        if let Some(choice) = choices.first() {
            let msg = &choice["message"];

            if let Some(content) = msg["content"].as_str() {
                if !content.is_empty() {
                    text = Some(content.to_string());
                }
            }

            if let Some(tool_calls) = msg["tool_calls"].as_array() {
                for tc in tool_calls {
                    let name = tc["function"]["name"].as_str().unwrap_or("").to_string();
                    let args_str = tc["function"]["arguments"].as_str().unwrap_or("{}");
                    let args: Value = serde_json::from_str(args_str).unwrap_or(json!({}));
                    function_calls.push(FunctionCall { name, args });
                }
            }
        }
    }

    let usage = &json["usage"];
    let token_usage = TokenUsage {
        prompt: usage["prompt_tokens"].as_i64().unwrap_or(0),
        completion: usage["completion_tokens"].as_i64().unwrap_or(0),
        total: usage["total_tokens"].as_i64().unwrap_or(0),
    };

    Ok(LlmResponse { text, function_calls, token_usage })
}

// ─── Chat history ─────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize)]
pub struct HistoryMessage {
    pub role: String,    // "user" or "ai"
    pub content: String,
}

// ─── Tauri command ────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn generate_resume(
    app: AppHandle,
    history: Vec<HistoryMessage>,
    current_data: Option<Value>,
    notes: Option<String>,
    language: String,
    has_photo: Option<bool>,
) -> Result<LlmResponse, String> {
    let settings = get_settings(app);

    let notes_str = notes.as_deref().unwrap_or("No notes yet.");
    let has_photo = has_photo.unwrap_or(false);

    let system_instruction = format!(
        r#"You are SlothCV — a career consultant and world-class CV designer. You chat with users to learn their story, then design stunning resumes using full HTML/CSS freedom.

LANGUAGE: Always respond in {language}. Never switch languages.

━━━ HOW YOU WORK ━━━
1. GATHER — ask about their target role, experience, skills. Max 2 questions at a time.
2. BUILD EARLY — as soon as you have name + role + 1 experience, call render_resume. Don't wait.
3. KEEP IMPROVING — update the CV as you learn more. Call render_resume again to update.
4. IF ASKED TO BUILD NOW — do it immediately with whatever info you have.

━━━ CV CONTENT RULES ━━━
• Bullet points: [Action verb] + [what] + [measurable result]
  ✓ "Cut API latency 40% by switching to Redis, serving 2M daily users"
  ✗ "Improved performance"
• Always probe for metrics: %, headcount, revenue, users, timelines

━━━ HTML/CSS DESIGN RULES ━━━
When calling render_resume, output a COMPLETE, self-contained HTML document:
• Page size: exactly 794px wide × 1123px tall (A4 at 96dpi)
• All styles in a <style> block — no external CSS files
• Do NOT use Google Fonts. The font 'Inter' is already injected locally. Just use `font-family: 'Inter', sans-serif;`
• Do NOT use FontAwesome or external icon libraries. You MUST use raw inline SVG code for all icons (e.g., `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">...</svg>`). This is critical for PDF export.
• Use any layout technique: CSS Grid, Flexbox, absolute positioning, multi-column
• Be bold with design: colored sidebars, full-bleed headers, creative typography
• Use real data only — no Lorem Ipsum, no placeholders
• Include @media print {{ ... }} for clean PDF output
• Body margin: 0; overflow: hidden; so it fits exactly in the preview

Design guidance:
• Pick an intentional accent color that fits their industry/personality
• Senior profiles: sophisticated, dense, minimal decoration
• Creative roles: expressive typography, bold color use
• Tech roles: clean grid layout, skill tags, dark/light contrast
• Entry level: spacious, clear hierarchy, highlight education + projects

━━━ CONVERSATION RULES ━━━
• ALWAYS return a text response (never silent tool calls)
• Max 2 questions per reply
• Use suggest_options for any choices the user should make
• After calling render_resume, briefly describe your design choices

━━━ PROFILE PHOTO ━━━
{photo_instruction}

━━━ NOTES ━━━
Use update_internal_notes to track: gathered info, pending questions, target role, key strengths.

CURRENT NOTES: {notes_str}"#,
        language = language,
        notes_str = notes_str,
        photo_instruction = if has_photo {
            "The user has provided a profile photo. When rendering the CV, place an <img src=\"__PROFILE_PHOTO__\" alt=\"Profile\"> with appropriate size and shape (circular border-radius for modern layouts). The placeholder __PROFILE_PHOTO__ will be automatically replaced with the actual image."
        } else {
            "No profile photo provided. Do not include an <img> placeholder for a photo."
        },
    );

    // Validate config before calling API
    if settings.llm.model.trim().is_empty() {
        return Err("No model selected. Please open Settings and choose a model.".into());
    }
    let api_key = settings.llm.api_key.trim().to_string();
    if settings.llm.provider == "gemini" && api_key.is_empty() {
        return Err("Gemini API key is missing. Please open Settings and enter your API key.".into());
    }
    if settings.llm.provider != "gemini" && settings.llm.base_url.trim().is_empty() {
        return Err("Base URL is missing. Please open Settings and set the provider URL.".into());
    }

    let settings = crate::settings::AppSettings {
        llm: crate::settings::LlmSettings {
            api_key: api_key,
            ..settings.llm
        },
        ..settings
    };

    match settings.llm.provider.as_str() {
        "gemini" => call_gemini(&settings, &system_instruction, &history).await,
        _ => call_openai_compat(&settings, &system_instruction, &history).await,
    }
}

#[tauri::command]
pub async fn fetch_models(
    provider: String,
    base_url: String,
    api_key: String,
) -> Result<Vec<String>, String> {
    let client = reqwest::Client::new();
    match provider.as_str() {
        "gemini" => {
            if api_key.is_empty() {
                return Ok(vec![]);
            }
            let url = format!(
                "https://generativelanguage.googleapis.com/v1beta/models?key={}&pageSize=50",
                api_key
            );
            let resp = client
                .get(&url)
                .send()
                .await
                .map_err(|e| e.to_string())?;
            let json: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
            if let Some(err) = json.get("error") {
                return Err(format!("API error: {err}"));
            }
            let models: Vec<String> = json["models"]
                .as_array()
                .unwrap_or(&vec![])
                .iter()
                .filter_map(|m| {
                    m["name"].as_str().map(|s| s.trim_start_matches("models/").to_string())
                })
                .filter(|n| {
                    n.contains("gemini")
                        && !n.contains("embedding")
                        && !n.contains("aqa")
                        && !n.contains("imagen")
                        && !n.contains("tts")
                })
                .collect();
            Ok(models)
        }
        _ => {
            // All non-Gemini providers use OpenAI-compatible /models endpoint
            if base_url.is_empty() {
                return Ok(vec![]);
            }
            let base = base_url.trim_end_matches('/');
            let url = format!("{base}/models");
            let mut req = client.get(&url);
            if !api_key.is_empty() {
                req = req.header("Authorization", format!("Bearer {}", api_key));
            }
            let resp = req.send().await.map_err(|e| e.to_string())?;
            let json: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
            if let Some(err) = json.get("error") {
                return Err(format!("API error: {err}"));
            }
            // Handle both {data:[]} (OpenAI) and {models:[]} (some providers) formats
            let models_arr = json["data"]
                .as_array()
                .or_else(|| json["models"].as_array());
            let models: Vec<String> = models_arr
                .unwrap_or(&vec![])
                .iter()
                .filter_map(|m| {
                    m["id"].as_str()
                        .or_else(|| m["name"].as_str())
                        .map(|s| s.to_string())
                })
                .collect();
            Ok(models)
        }
    }
}
