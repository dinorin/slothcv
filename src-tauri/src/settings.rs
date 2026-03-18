use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

// XOR key — changes the on-disk bytes so the key is never plaintext in any file.
// Not cryptographic, but prevents casual inspection of the config directory.
const XOR_SEED: &[u8] = b"slothcv\xde\xad\xbe\xef\x13\x37\xc0\xde\xfa\xce\xba\xbe\x00\xff\x42\x69";

fn obfuscate(s: &str) -> String {
    s.bytes()
        .enumerate()
        .map(|(i, b)| format!("{:02x}", b ^ XOR_SEED[i % XOR_SEED.len()]))
        .collect()
}

fn deobfuscate(hex: &str) -> String {
    let bytes: Vec<u8> = (0..hex.len())
        .step_by(2)
        .enumerate()
        .filter_map(|(i, pos)| {
            if pos + 2 > hex.len() { return None; }
            u8::from_str_radix(&hex[pos..pos + 2], 16)
                .ok()
                .map(|b| b ^ XOR_SEED[i % XOR_SEED.len()])
        })
        .collect();
    String::from_utf8(bytes).unwrap_or_default()
}

// ── What the frontend sees ────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct LlmSettings {
    pub provider: String,
    pub base_url: String,
    pub api_key: String,
    pub model: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AppSettings {
    pub llm: LlmSettings,
    pub dark_mode: bool,
}

impl Default for AppSettings {
    fn default() -> Self {
        AppSettings {
            llm: LlmSettings {
                provider: "gemini".to_string(),
                base_url: String::new(),
                api_key: String::new(),
                model: String::new(),
            },
            dark_mode: false,
        }
    }
}

// ── Disk format (api_key never written here) ──────────────────────────────────

#[derive(Debug, Deserialize)]
struct StoredRaw {
    #[serde(default)]
    llm: StoredLlmRaw,
    #[serde(default)]
    dark_mode: bool,
}

#[derive(Debug, Default, Deserialize)]
struct StoredLlmRaw {
    #[serde(default)]
    provider: String,
    #[serde(default)]
    base_url: String,
    #[serde(default)]
    model: String,
    /// Legacy field — present in old settings.json, migrated on first read.
    #[serde(default)]
    api_key: String,
}

#[derive(Debug, Serialize)]
struct StoredSave {
    llm: StoredLlmSave,
    dark_mode: bool,
}

#[derive(Debug, Serialize)]
struct StoredLlmSave {
    provider: String,
    base_url: String,
    model: String,
}

// ── Paths ─────────────────────────────────────────────────────────────────────

fn config_dir(app: &AppHandle) -> PathBuf {
    let dir = app
        .path()
        .app_config_dir()
        .unwrap_or_else(|_| PathBuf::from("."));
    let _ = fs::create_dir_all(&dir);
    dir
}

fn settings_path(app: &AppHandle) -> PathBuf {
    config_dir(app).join("settings.json")
}

fn key_path(app: &AppHandle) -> PathBuf {
    config_dir(app).join("api.key")
}

// ── Key file helpers ──────────────────────────────────────────────────────────

fn key_read(app: &AppHandle) -> String {
    fs::read_to_string(key_path(app))
        .map(|s| deobfuscate(s.trim()))
        .unwrap_or_default()
}

fn key_write(app: &AppHandle, key: &str) -> Result<(), String> {
    let key = key.trim();
    if key.is_empty() {
        let _ = fs::remove_file(key_path(app));
        return Ok(());
    }
    fs::write(key_path(app), obfuscate(key)).map_err(|e| format!("Failed to save API key: {e}"))
}

// ── Tauri commands ────────────────────────────────────────────────────────────

#[tauri::command]
pub fn get_settings(app: AppHandle) -> AppSettings {
    let raw: Option<StoredRaw> = fs::read_to_string(settings_path(&app))
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok());

    let stored = match raw {
        None => return AppSettings::default(),
        Some(s) => s,
    };

    // Migrate: old settings.json had api_key in plaintext — move it to key file.
    let api_key = if !stored.llm.api_key.trim().is_empty() {
        let key = stored.llm.api_key.trim().to_string();
        let _ = key_write(&app, &key);
        // Rewrite settings.json without the api_key field
        let clean = StoredSave {
            llm: StoredLlmSave {
                provider: stored.llm.provider.clone(),
                base_url: stored.llm.base_url.clone(),
                model: stored.llm.model.clone(),
            },
            dark_mode: stored.dark_mode,
        };
        if let Ok(content) = serde_json::to_string_pretty(&clean) {
            let _ = fs::write(settings_path(&app), content);
        }
        key
    } else {
        key_read(&app)
    };

    AppSettings {
        llm: LlmSettings {
            provider: stored.llm.provider,
            base_url: stored.llm.base_url,
            model: stored.llm.model,
            api_key,
        },
        dark_mode: stored.dark_mode,
    }
}

#[tauri::command]
pub fn save_settings(app: AppHandle, settings: AppSettings) -> Result<(), String> {
    key_write(&app, &settings.llm.api_key)?;

    let stored = StoredSave {
        llm: StoredLlmSave {
            provider: settings.llm.provider,
            base_url: settings.llm.base_url,
            model: settings.llm.model,
        },
        dark_mode: settings.dark_mode,
    };
    let content = serde_json::to_string_pretty(&stored).map_err(|e| e.to_string())?;
    fs::write(settings_path(&app), content).map_err(|e| e.to_string())
}
