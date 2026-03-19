use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

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

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct LlmProviderConfig {
    pub base_url: String,
    pub api_key: String,
    pub model: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct LlmSettings {
    pub provider: String,
    pub configs: HashMap<String, LlmProviderConfig>,
    // Fields for backward compatibility and active state
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
                configs: HashMap::new(),
                base_url: String::new(),
                api_key: String::new(),
                model: String::new(),
            },
            dark_mode: false,
        }
    }
}

// Disk formats
#[derive(Debug, Serialize, Deserialize)]
struct StoredConfig {
    provider: String,
    configs: HashMap<String, LlmProviderConfigSave>,
    dark_mode: bool,
}

#[derive(Debug, Serialize, Deserialize)]
struct LlmProviderConfigSave {
    base_url: String,
    model: String,
}

fn config_dir(app: &AppHandle) -> PathBuf {
    let dir = app.path().app_config_dir().unwrap_or_else(|_| PathBuf::from("."));
    let _ = fs::create_dir_all(&dir);
    dir
}

fn settings_path(app: &AppHandle) -> PathBuf {
    config_dir(app).join("settings.v2.json")
}

fn keys_path(app: &AppHandle) -> PathBuf {
    config_dir(app).join("api.keys")
}

fn keys_read(app: &AppHandle) -> HashMap<String, String> {
    let content = fs::read_to_string(keys_path(app)).unwrap_or_default();
    if content.is_empty() { return HashMap::new(); }
    let deob = deobfuscate(content.trim());
    serde_json::from_str(&deob).unwrap_or_default()
}

fn keys_write(app: &AppHandle, keys: &HashMap<String, String>) -> Result<(), String> {
    let json = serde_json::to_string(keys).map_err(|e| e.to_string())?;
    fs::write(keys_path(app), obfuscate(&json)).map_err(|e| format!("Failed to save API keys: {e}"))
}

#[tauri::command]
pub fn get_settings(app: AppHandle) -> AppSettings {
    let keys = keys_read(&app);
    
    // Try loading new format first
    let stored: Option<StoredConfig> = fs::read_to_string(settings_path(&app))
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok());

    match stored {
        Some(s) => {
            let mut configs = HashMap::new();
            for (id, cfg) in s.configs {
                configs.insert(id.clone(), LlmProviderConfig {
                    base_url: cfg.base_url,
                    model: cfg.model,
                    api_key: keys.get(&id).cloned().unwrap_or_default(),
                });
            }
            
            let active_cfg = configs.get(&s.provider).cloned().unwrap_or_default();

            AppSettings {
                llm: LlmSettings {
                    provider: s.provider,
                    configs,
                    base_url: active_cfg.base_url,
                    api_key: active_cfg.api_key,
                    model: active_cfg.model,
                },
                dark_mode: s.dark_mode,
            }
        }
        None => {
            // Migration from v1 or default
            let old_path = config_dir(&app).join("settings.json");
            let old_keys_path = config_dir(&app).join("api.key");
            
            let mut app_settings = AppSettings::default();
            
            if let Ok(content) = fs::read_to_string(old_path) {
                if let Ok(json) = serde_json::from_str::<serde_json::Value>(&content) {
                    app_settings.dark_mode = json["dark_mode"].as_bool().unwrap_or(false);
                    let provider = json["llm"]["provider"].as_str().unwrap_or("gemini").to_string();
                    app_settings.llm.provider = provider.clone();
                    
                    let base_url = json["llm"]["base_url"].as_str().unwrap_or("").to_string();
                    let model = json["llm"]["model"].as_str().unwrap_or("").to_string();
                    let mut api_key = String::new();
                    
                    if let Ok(key_content) = fs::read_to_string(old_keys_path) {
                        api_key = deobfuscate(key_content.trim());
                    }

                    let mut configs = HashMap::new();
                    configs.insert(provider.clone(), LlmProviderConfig {
                        base_url,
                        model,
                        api_key: api_key.clone(),
                    });
                    app_settings.llm.configs = configs;
                    
                    // Save to new format immediately
                    let _ = save_settings(app, app_settings.clone());
                }
            }
            app_settings
        }
    }
}

#[tauri::command]
pub fn save_settings(app: AppHandle, settings: AppSettings) -> Result<(), String> {
    let mut keys = HashMap::new();
    let mut configs = HashMap::new();

    for (id, cfg) in &settings.llm.configs {
        if !cfg.api_key.trim().is_empty() {
            keys.insert(id.clone(), cfg.api_key.trim().to_string());
        }
        configs.insert(id.clone(), LlmProviderConfigSave {
            base_url: cfg.base_url.clone(),
            model: cfg.model.clone(),
        });
    }

    keys_write(&app, &keys)?;

    let stored = StoredConfig {
        provider: settings.llm.provider,
        configs,
        dark_mode: settings.dark_mode,
    };
    
    let content = serde_json::to_string_pretty(&stored).map_err(|e| e.to_string())?;
    fs::write(settings_path(&app), content).map_err(|e| e.to_string())
}
