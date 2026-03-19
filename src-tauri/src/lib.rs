mod llm;
mod settings;
mod storage;

use tauri::Manager;

#[tauri::command]
fn app_ready(app: tauri::AppHandle) {
    if let Some(splashscreen) = app.get_webview_window("splashscreen") {
        let _ = splashscreen.close();
    }
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.maximize();
        let _ = win.show();
        let _ = win.set_focus();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            app_ready,
            llm::generate_resume,
            llm::fetch_models,
            llm::web_search,
            llm::fetch_web_content,
            settings::get_settings,
            settings::save_settings,
            storage::save_session,
            storage::list_sessions,
            storage::load_session,
            storage::delete_session,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
