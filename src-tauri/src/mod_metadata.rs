use crate::error::AppError;
use crate::types::Mod;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModMetadata {
    pub name: String,
    pub game_banana_id: Option<u64>,
    pub category_id: Option<u64>,
    pub source_section: Option<String>,
    pub description: Option<String>,
    pub thumbnail_url: Option<String>,
}

pub type ModMetadataMap = HashMap<String, ModMetadata>;

fn get_metadata_path(app: &AppHandle) -> Result<PathBuf, AppError> {
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|e| AppError::Settings(e.to_string()))?;

    if !app_data.exists() {
        fs::create_dir_all(&app_data)?;
    }

    Ok(app_data.join("mod_metadata.json"))
}

pub fn load_metadata(app: &AppHandle) -> Result<ModMetadataMap, AppError> {
    let path = get_metadata_path(app)?;
    if !path.exists() {
        return Ok(HashMap::new());
    }

    let content = fs::read_to_string(&path)?;
    let metadata: ModMetadataMap = serde_json::from_str(&content)?;
    Ok(metadata)
}

pub fn save_metadata(app: &AppHandle, metadata: &ModMetadataMap) -> Result<(), AppError> {
    let path = get_metadata_path(app)?;
    let content = serde_json::to_string_pretty(metadata)?;
    fs::write(&path, content)?;
    Ok(())
}

pub fn upsert_metadata_for_files(
    app: &AppHandle,
    files: &[PathBuf],
    metadata: &ModMetadata,
) -> Result<(), AppError> {
    let mut map = load_metadata(app)?;

    for path in files {
        if let Some(file_name) = path.file_name().and_then(|n| n.to_str()) {
            map.insert(file_name.to_string(), metadata.clone());
        }
    }

    save_metadata(app, &map)
}

pub fn remove_metadata_entry(app: &AppHandle, file_name: &str) -> Result<(), AppError> {
    let mut map = load_metadata(app)?;
    if map.remove(file_name).is_some() {
        save_metadata(app, &map)?;
    }
    Ok(())
}

pub fn rename_metadata_key(
    app: &AppHandle,
    from: &str,
    to: &str,
) -> Result<(), AppError> {
    let mut map = load_metadata(app)?;
    if let Some(entry) = map.remove(from) {
        map.insert(to.to_string(), entry);
        save_metadata(app, &map)?;
    }
    Ok(())
}

pub fn apply_metadata_to_mods(mods: &mut [Mod], metadata: &ModMetadataMap) {
    for mod_item in mods {
        apply_metadata_to_mod(mod_item, metadata);
    }
}

pub fn apply_metadata_to_mod(mod_item: &mut Mod, metadata: &ModMetadataMap) {
    if let Some(meta) = metadata.get(&mod_item.file_name) {
        mod_item.name = meta.name.clone();
        mod_item.game_banana_id = meta.game_banana_id;
        mod_item.category_id = meta.category_id;
        mod_item.source_section = meta.source_section.clone();
        mod_item.description = meta.description.clone();
        mod_item.thumbnail_url = meta.thumbnail_url.clone();
    }
}
