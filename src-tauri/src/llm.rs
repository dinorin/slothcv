use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::AppHandle;
use std::time::Duration;

use crate::settings::{load_settings_raw, AppSettings};
use crate::artifact;

// ─── Web Search & Scraper Implementation ──────────────────────────────────────

#[tauri::command]
pub async fn web_search(query: String) -> Result<String, String> {
    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36")
        .timeout(Duration::from_secs(10))
        .build()
        .map_err(|e| e.to_string())?;

    let url = format!("https://duckduckgo.com/html/?q={}", urlencoding::encode(&query));
    let resp = client.get(&url).send().await.map_err(|e| format!("Search Network Error: {}", e))?;
    let status = resp.status();
    let html = resp.text().await.map_err(|e| format!("Search Decode Error (Status {}): {}", status, e))?;

    let mut results = Vec::new();
    let parts: Vec<&str> = html.split("result__snippet").collect();
    for (i, part) in parts.iter().skip(1).take(5).enumerate() {
        let snippet = part.split('>').nth(1).and_then(|s| s.split('<').next()).unwrap_or("");
        if !snippet.is_empty() {
            results.push(format!("{}. {}", i + 1, snippet.trim()));
        }
    }

    if results.is_empty() {
        Ok("No results found. Try a different query.".to_string())
    } else {
        Ok(results.join("\n"))
    }
}

#[tauri::command]
pub async fn fetch_web_content(url: String) -> Result<String, String> {
    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36")
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|e| e.to_string())?;

    let resp = client.get(&url).send().await.map_err(|e| format!("Fetch Network Error: {}", e))?;
    let status = resp.status();
    let html = resp.text().await.map_err(|e| format!("Fetch Decode Error (Status {}): {}", status, e))?;

    let mut clean_text = String::new();
    let mut in_script = false;
    let mut in_style = false;
    let mut tag_buffer = String::new();
    let mut is_tag = false;

    for c in html.chars() {
        if c == '<' { is_tag = true; tag_buffer.clear(); continue; }
        if c == '>' {
            is_tag = false;
            let tag = tag_buffer.to_lowercase();
            if tag == "script" || tag.starts_with("script ") { in_script = true; }
            else if tag == "/script" { in_script = false; }
            else if tag == "style" || tag.starts_with("style ") { in_style = true; }
            else if tag == "/style" { in_style = false; }
            else if tag == "p" || tag == "br" || tag == "div" || tag == "h1" || tag == "h2" || tag == "h3" || tag == "li" {
                clean_text.push('\n');
            }
            continue;
        }
        if is_tag { tag_buffer.push(c); } 
        else if !in_script && !in_style { clean_text.push(c); }
    }

    let final_text = clean_text.split_whitespace().collect::<Vec<&str>>().join(" ");
    if final_text.len() > 8000 {
        Ok(format!("{}... [Truncated due to length]", &final_text[..8000]))
    } else {
        Ok(final_text)
    }
}

// ─── Response types ──────────────────────────────────────────────────────────

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

// Tool declarations live in artifact.rs — update that file when forking.

// ─── API callers ──────────────────────────────────────────────────────────────

async fn call_gemini(settings: &AppSettings, sys: &str, history: &[HistoryMessage]) -> Result<LlmResponse, String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(90))
        .no_gzip()
        .no_deflate()
        .no_brotli()
        .no_proxy()
        .build()
        .map_err(|e| e.to_string())?;
    let url = format!("https://generativelanguage.googleapis.com/v1beta/models/{}:generateContent?key={}", settings.llm.model, settings.llm.api_key);
    let contents: Vec<Value> = history.iter().map(|m| {
        let role = if m.role == "user" { "user" } else { "model" };
        json!({ "role": role, "parts": [{"text": &m.content}] })
    }).collect();
    let body = json!({ "contents": contents, "system_instruction": { "parts": [{"text": sys}] }, "tools": artifact::tools_gemini() });
    let body_str = serde_json::to_string(&body).map_err(|e| e.to_string())?;
    let content_length = body_str.len();

    let resp = client.post(&url)
        .header("Content-Type", "application/json")
        .header("Content-Length", content_length)
        .header("User-Agent", "SlothCV/1.0 (Windows NT 10.0; Win64; x64)")
        .body(body_str)
        .send()
        .await
        .map_err(|e| {
            println!("[LLM] Network Error: {:?}", e);
            "Network error. Please check your internet connection.".to_string()
        })?;
    let status = resp.status();
    let bytes = resp.bytes().await.map_err(|_| "Failed to read response from AI provider.".to_string())?;
    let text = String::from_utf8_lossy(&bytes);
    
    let json: Value = serde_json::from_str(&text).map_err(|e| {
        println!("[LLM] JSON Parse Error: {}. Raw Body: {}", e, text);
        "AI response format error. Please try again later.".to_string()
    })?;

    if let Some(err) = json.get("error") { 
        return Err(format!("Gemini API error: {}", err["message"].as_str().unwrap_or("Unknown error"))); 
    }

    let candidate = &json["candidates"][0];
    if candidate.is_null() {
        return Err("Gemini returned no candidates. This usually means the request was blocked by safety filters or an empty response.".into());
    }

    let mut text = None;
    let mut function_calls = Vec::new();
    
    if let Some(parts) = candidate["content"]["parts"].as_array() {
        for part in parts {
            if let Some(t) = part["text"].as_str() { 
                if !t.is_empty() { text = Some(t.to_string()); } 
            }
            if let Some(fc) = part.get("functionCall") {
                let name = fc["name"].as_str().unwrap_or("").to_string();
                function_calls.push(FunctionCall { name, args: fc["args"].clone() });
            }
        }
    }

    if text.is_none() && function_calls.is_empty() {
        let finish_reason = candidate["finishReason"].as_str().unwrap_or("UNKNOWN");
        return Err(format!("AI returned empty content. Finish reason: {}", finish_reason));
    }

    let usage = &json["usageMetadata"];
    let token_usage = TokenUsage {
        prompt: usage["promptTokenCount"].as_i64().unwrap_or(0),
        completion: usage["candidatesTokenCount"].as_i64().unwrap_or(0),
        total: usage["totalTokenCount"].as_i64().unwrap_or(0),
    };
    Ok(LlmResponse { text, function_calls, token_usage })
}

async fn call_openai_compat(settings: &AppSettings, sys: &str, history: &[HistoryMessage]) -> Result<LlmResponse, String> {
    println!("[LLM] Calling OpenAI Compat API: {}/chat/completions", settings.llm.base_url.trim_end_matches('/'));
    
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(120)) // Tăng lên 2 phút
        .pool_max_idle_per_host(0)         // Tắt dùng lại kết nối cũ
        .no_gzip()
        .no_deflate()
        .no_brotli()
        .no_proxy()
        .build()
        .map_err(|e| e.to_string())?;
        
    let url = format!("{}/chat/completions", settings.llm.base_url.trim_end_matches('/'));
    
    let mut messages = vec![json!({"role": "system", "content": sys})];
    for m in history {
        let role = if m.role == "user" { "user" } else { "assistant" };
        messages.push(json!({"role": role, "content": m.content}));
    }
    
    let body = json!({ 
        "model": settings.llm.model, 
        "messages": messages, 
        "tools": artifact::tools_openai(),
        "tool_choice": "auto" 
    });

    let req = client.post(&url)
        .header("Authorization", format!("Bearer {}", settings.llm.api_key))
        .header("Accept", "application/json")
        .json(&body);

    println!("[LLM] Sending request...");
    let resp = req.send().await.map_err(|e| {
        println!("[LLM] Network Error: {:?}", e);
        "Network error. Please check your internet connection.".to_string()
    })?;

    let status = resp.status();
    println!("[LLM] Status Code: {}", status);

    let bytes = resp.bytes().await.map_err(|e| {
        println!("[LLM] Body Read Error: {:?}", e);
        "Failed to read response from AI provider.".to_string()
    })?;

    let text = String::from_utf8_lossy(&bytes).to_string();
    println!("[LLM] Received {} characters", text.len());

    let json: Value = serde_json::from_str(&text).map_err(|e| {
        println!("[LLM] JSON Parse Error: {}. Raw Body: {}", e, text);
        "AI response format error. Please try again later.".to_string()
    })?;

    if let Some(err) = json.get("error") { 
        let msg = err["message"].as_str().or(err.as_str()).unwrap_or("Unknown error");
        println!("[LLM] API Error: {}", msg);
        return Err("The AI provider returned an error. Check your API key or balance.".into()); 
    }

    let choice = &json["choices"][0];
    if choice.is_null() {
        return Err(format!("API returned no choices. Status: {}. Body: {}", status, text));
    }

    let msg = &choice["message"];
    let text_content = msg["content"].as_str().map(|s| s.to_string());
    let mut function_calls = Vec::new();
    
    if let Some(tool_calls) = msg["tool_calls"].as_array() {
        for tc in tool_calls {
            let name = tc["function"]["name"].as_str().unwrap_or("").to_string();
            let args: Value = serde_json::from_str(tc["function"]["arguments"].as_str().unwrap_or("{}")).unwrap_or(json!({}));
            function_calls.push(FunctionCall { name, args });
        }
    }

    if text_content.is_none() && function_calls.is_empty() {
        return Err("AI returned no text and no tool calls.".into());
    }

    let usage = &json["usage"];
    let token_usage = TokenUsage {
        prompt: usage["prompt_tokens"].as_i64().unwrap_or(0),
        completion: usage["completion_tokens"].as_i64().unwrap_or(0),
        total: usage["total_tokens"].as_i64().unwrap_or(0),
    };
    Ok(LlmResponse { text: text_content, function_calls, token_usage })
}

#[derive(Debug, Serialize, Deserialize)]
pub struct HistoryMessage { pub role: String, pub content: String }

#[tauri::command]
pub async fn generate_resume(
    app: AppHandle,
    history: Vec<HistoryMessage>,
    _current_data: Option<Value>,
    notes: Option<String>,
    language: String,
    has_photo: Option<bool>,
) -> Result<LlmResponse, String> {
    let settings = load_settings_raw(&app);
    let notes_str = notes.as_deref().unwrap_or("No notes yet.");
    let photo_instr = if has_photo.unwrap_or(false) {
        "User provided a photo. Use <img src=\"__PROFILE_PHOTO__\" alt=\"Profile\">."
    } else {
        "No photo provided. Don't use img placeholder."
    };

    let sys = artifact::system_prompt(&language, notes_str, photo_instr);

    if settings.llm.model.trim().is_empty() { return Err("No model selected. Open Settings.".into()); }
    let provider = settings.llm.provider.to_lowercase();
    let api_key = settings.llm.api_key.trim();

    if provider == "gemini" && api_key.is_empty() { return Err("Gemini API key missing.".into()); }
    if provider != "ollama" && provider != "lmstudio" && provider != "custom" && api_key.is_empty() {
        return Err(format!("API key for {} is missing.", settings.llm.provider).into());
    }
    if provider != "gemini" && settings.llm.base_url.trim().is_empty() { return Err("Base URL missing.".into()); }

    match provider.as_str() {
        "gemini" => call_gemini(&settings, &sys, &history).await,
        _ => call_openai_compat(&settings, &sys, &history).await,
    }
}

#[tauri::command]
pub async fn fetch_image_base64(url: String) -> Result<String, String> {
    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64)")
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|e| e.to_string())?;
    let resp = client.get(&url).send().await.map_err(|e| e.to_string())?;
    let content_type = resp.headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("image/jpeg")
        .split(';').next().unwrap_or("image/jpeg")
        .to_string();
    let bytes = resp.bytes().await.map_err(|e| e.to_string())?;
    use base64::Engine;
    let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
    Ok(format!("data:{};base64,{}", content_type, b64))
}

#[tauri::command]
pub async fn fetch_models(app: tauri::AppHandle, provider: String, base_url: String, api_key: String) -> Result<Vec<String>, String> {
    let api_key = crate::settings::resolve_api_key(&app, &provider, &api_key);
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .no_gzip()
        .no_deflate()
        .no_brotli()
        .build()
        .map_err(|e| e.to_string())?;
        
    match provider.as_str() {
        "gemini" => {
            if api_key.is_empty() { return Ok(vec![]); }
            let url = format!("https://generativelanguage.googleapis.com/v1beta/models?key={}&pageSize=50", api_key);
            let resp = client.get(&url).send().await.map_err(|e| format!("Network Error: {}", e))?;
            let status = resp.status();
            let bytes = resp.bytes().await.map_err(|e| format!("Body Read Error: {}", e))?;
            let text = String::from_utf8_lossy(&bytes);
            
            let json: Value = serde_json::from_str(&text).map_err(|e| {
                format!("Status: {}. JSON Decode Error: {}. Body: {}", status, e, text)
            })?;
            
            let models: Vec<String> = json["models"].as_array().unwrap_or(&vec![]).iter()
                .filter_map(|m| m["name"].as_str().map(|s| s.trim_start_matches("models/").to_string()))
                .filter(|n| !n.contains("embedding") && !n.contains("aqa"))
                .collect();
            Ok(models)
        }
        _ => {
            if base_url.is_empty() { return Ok(vec![]); }
            let mut req = client.get(format!("{}/models", base_url.trim_end_matches('/')));
            if !api_key.is_empty() { req = req.header("Authorization", format!("Bearer {}", api_key)); }
            
            let resp = req.send().await.map_err(|e| format!("Network Error: {}", e))?;
            let status = resp.status();
            let bytes = resp.bytes().await.map_err(|e| format!("Body Read Error: {}", e))?;
            let text = String::from_utf8_lossy(&bytes);

            let json: Value = serde_json::from_str(&text).map_err(|e| {
                format!("Status: {}. JSON Decode Error: {}. Body: {}", status, e, text)
            })?;
            
            let models_arr = json["data"].as_array().or_else(|| json["models"].as_array());
            let models: Vec<String> = models_arr.unwrap_or(&vec![]).iter()
                .filter_map(|m| m["id"].as_str().or_else(|| m["name"].as_str()).map(|s| s.to_string()))
                .collect();
            Ok(models)
        }
    }
}
