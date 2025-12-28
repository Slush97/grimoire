use crate::error::AppError;
use crate::types::AppSettings;
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

/// Get the settings file path
fn get_settings_path(app: &AppHandle) -> Result<PathBuf, AppError> {
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|e| AppError::Settings(e.to_string()))?;

    if !app_data.exists() {
        fs::create_dir_all(&app_data)?;
    }

    Ok(app_data.join("settings.json"))
}

/// Load settings from disk
pub fn load_settings(app: &AppHandle) -> Result<AppSettings, AppError> {
    let path = get_settings_path(app)?;

    if !path.exists() {
        return Ok(AppSettings::default());
    }

    let content = fs::read_to_string(&path)?;
    let settings: AppSettings = serde_json::from_str(&content)?;
    Ok(settings)
}

/// Save settings to disk
pub fn save_settings(app: &AppHandle, settings: &AppSettings) -> Result<(), AppError> {
    let path = get_settings_path(app)?;
    let content = serde_json::to_string_pretty(settings)?;
    fs::write(&path, content)?;
    Ok(())
}
