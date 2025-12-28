use crate::error::AppError;
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

pub fn ensure_dev_deadlock_path(app: &AppHandle) -> Result<PathBuf, AppError> {
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|e| AppError::Settings(e.to_string()))?;

    if !app_data.exists() {
        fs::create_dir_all(&app_data)?;
    }

    let dev_root = app_data.join("dev-deadlock");
    let citadel_dir = dev_root.join("game/citadel");
    let disabled_dir = citadel_dir.join("addons/.disabled");
    fs::create_dir_all(&disabled_dir)?;

    let gameinfo_path = citadel_dir.join("gameinfo.gi");
    if !gameinfo_path.exists() {
        fs::write(&gameinfo_path, "")?;
    }

    Ok(dev_root)
}
