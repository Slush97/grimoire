use crate::error::AppError;
use std::path::{Path, PathBuf};

/// Known Steam library locations to search
fn get_steam_library_paths() -> Vec<PathBuf> {
    let mut paths = Vec::new();

    #[cfg(target_os = "linux")]
    {
        if let Some(home) = dirs::home_dir() {
            // Common Steam locations on Linux
            paths.push(home.join(".steam/steam/steamapps/common"));
            paths.push(home.join(".local/share/Steam/steamapps/common"));
            paths.push(home.join(".var/app/com.valvesoftware.Steam/.steam/steam/steamapps/common")); // Flatpak
        }
    }

    #[cfg(target_os = "windows")]
    {
        // Common Steam locations on Windows
        paths.push(PathBuf::from(r"C:\Program Files (x86)\Steam\steamapps\common"));
        paths.push(PathBuf::from(r"C:\Program Files\Steam\steamapps\common"));
        paths.push(PathBuf::from(r"D:\Steam\steamapps\common"));
        paths.push(PathBuf::from(r"D:\SteamLibrary\steamapps\common"));
    }

    #[cfg(target_os = "macos")]
    {
        if let Some(home) = dirs::home_dir() {
            paths.push(home.join("Library/Application Support/Steam/steamapps/common"));
        }
    }

    paths
}

/// Try to auto-detect Deadlock installation
pub fn detect_deadlock_path() -> Option<PathBuf> {
    for library_path in get_steam_library_paths() {
        let deadlock_path = library_path.join("Deadlock");
        if is_valid_deadlock_path(&deadlock_path) {
            return Some(deadlock_path);
        }
    }
    None
}

/// Validate that a path is a valid Deadlock installation
pub fn is_valid_deadlock_path(path: &Path) -> bool {
    // Check for expected game structure
    let game_dir = path.join("game");
    let citadel_dir = game_dir.join("citadel");

    game_dir.exists() && citadel_dir.exists()
}

/// Get the addons folder path, creating it if necessary
pub fn get_addons_path(deadlock_path: &Path) -> Result<PathBuf, AppError> {
    let addons_path = deadlock_path.join("game/citadel/addons");

    if !addons_path.exists() {
        std::fs::create_dir_all(&addons_path)?;
    }

    Ok(addons_path)
}

/// Get the disabled mods folder path, creating it if necessary
pub fn get_disabled_path(deadlock_path: &Path) -> Result<PathBuf, AppError> {
    let disabled_path = deadlock_path.join("game/citadel/addons/.disabled");

    if !disabled_path.exists() {
        std::fs::create_dir_all(&disabled_path)?;
    }

    Ok(disabled_path)
}

/// Get the gameinfo.gi file path
pub fn get_gameinfo_path(deadlock_path: &Path) -> PathBuf {
    deadlock_path.join("game/citadel/gameinfo.gi")
}
