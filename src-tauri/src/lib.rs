mod commands;
mod deadlock;
mod error;
mod extract;
mod gamebanana;
mod mod_metadata;
mod mods;
mod settings;
mod types;

use commands::*;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            detect_deadlock,
            validate_deadlock_path,
            get_settings,
            set_settings,
            get_mods,
            enable_mod_cmd,
            disable_mod_cmd,
            delete_mod_cmd,
            set_mod_priority_cmd,
            browse_mods,
            get_mod_details,
            download_mod,
            get_gamebanana_sections,
            get_gamebanana_categories,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
