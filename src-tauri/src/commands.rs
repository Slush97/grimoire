use crate::deadlock::{detect_deadlock_path, get_addons_path, is_valid_deadlock_path};
use crate::error::AppError;
use crate::extract::{cleanup_archive, extract_archive, is_archive};
use crate::gamebanana::{
    self, GameBananaCategoryNode, GameBananaModDetails, GameBananaModsResponse, GameBananaSection,
};
use crate::mod_metadata::{self, ModMetadata};
use crate::mods::{delete_mod, disable_mod, enable_mod, scan_mods, set_mod_priority};
use crate::settings::{load_settings, save_settings};
use crate::types::{AppSettings, Mod};
use serde::Deserialize;
use std::path::Path;
use tauri::{AppHandle, Emitter};

/// Auto-detect Deadlock installation path
#[tauri::command]
pub fn detect_deadlock() -> Option<String> {
    detect_deadlock_path().map(|p| p.to_string_lossy().to_string())
}

/// Validate a Deadlock installation path
#[tauri::command]
pub fn validate_deadlock_path(path: String) -> bool {
    is_valid_deadlock_path(Path::new(&path))
}

/// Get current app settings
#[tauri::command]
pub fn get_settings(app: AppHandle) -> Result<AppSettings, AppError> {
    load_settings(&app)
}

/// Save app settings
#[tauri::command]
pub fn set_settings(app: AppHandle, settings: AppSettings) -> Result<(), AppError> {
    save_settings(&app, &settings)
}

/// Get list of installed mods
#[tauri::command]
pub fn get_mods(app: AppHandle) -> Result<Vec<Mod>, AppError> {
    let settings = load_settings(&app)?;
    let deadlock_path = settings
        .deadlock_path
        .ok_or(AppError::DeadlockNotFound)?;

    let mut mods = scan_mods(Path::new(&deadlock_path))?;

    if let Ok(metadata) = mod_metadata::load_metadata(&app) {
        mod_metadata::apply_metadata_to_mods(&mut mods, &metadata);
    }

    Ok(mods)
}

/// Enable a mod
#[tauri::command]
pub fn enable_mod_cmd(app: AppHandle, mod_id: String) -> Result<Mod, AppError> {
    let settings = load_settings(&app)?;
    let deadlock_path = settings
        .deadlock_path
        .ok_or(AppError::DeadlockNotFound)?;

    let mut mod_item = enable_mod(Path::new(&deadlock_path), &mod_id)?;
    if let Ok(metadata) = mod_metadata::load_metadata(&app) {
        mod_metadata::apply_metadata_to_mod(&mut mod_item, &metadata);
    }
    Ok(mod_item)
}

/// Disable a mod
#[tauri::command]
pub fn disable_mod_cmd(app: AppHandle, mod_id: String) -> Result<Mod, AppError> {
    let settings = load_settings(&app)?;
    let deadlock_path = settings
        .deadlock_path
        .ok_or(AppError::DeadlockNotFound)?;

    let mut mod_item = disable_mod(Path::new(&deadlock_path), &mod_id)?;
    if let Ok(metadata) = mod_metadata::load_metadata(&app) {
        mod_metadata::apply_metadata_to_mod(&mut mod_item, &metadata);
    }
    Ok(mod_item)
}

/// Delete a mod
#[tauri::command]
pub fn delete_mod_cmd(app: AppHandle, mod_id: String) -> Result<(), AppError> {
    let settings = load_settings(&app)?;
    let deadlock_path = settings
        .deadlock_path
        .ok_or(AppError::DeadlockNotFound)?;

    let mods = scan_mods(Path::new(&deadlock_path))?;
    if let Some(target_mod) = mods.iter().find(|m| m.id == mod_id) {
        let _ = mod_metadata::remove_metadata_entry(&app, &target_mod.file_name);
    }

    delete_mod(Path::new(&deadlock_path), &mod_id)
}

/// Set mod priority
#[tauri::command]
pub fn set_mod_priority_cmd(
    app: AppHandle,
    mod_id: String,
    priority: u32,
) -> Result<Mod, AppError> {
    let settings = load_settings(&app)?;
    let deadlock_path = settings
        .deadlock_path
        .ok_or(AppError::DeadlockNotFound)?;

    let existing_mods = scan_mods(Path::new(&deadlock_path))?;
    let old_file_name = existing_mods
        .iter()
        .find(|m| m.id == mod_id)
        .map(|m| m.file_name.clone());

    let mut mod_item = set_mod_priority(Path::new(&deadlock_path), &mod_id, priority)?;

    if let Some(old_file_name) = old_file_name {
        let _ = mod_metadata::rename_metadata_key(&app, &old_file_name, &mod_item.file_name);
    }

    if let Ok(metadata) = mod_metadata::load_metadata(&app) {
        mod_metadata::apply_metadata_to_mod(&mut mod_item, &metadata);
    }

    Ok(mod_item)
}

// ============================================================================
// GameBanana Commands
// ============================================================================

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowseModsArgs {
    page: u32,
    #[serde(alias = "per_page")]
    per_page: u32,
    search: Option<String>,
    section: Option<String>,
    category_id: Option<u64>,
}

/// Browse mods from GameBanana
#[tauri::command(rename_all = "snake_case")]
pub async fn browse_mods(args: BrowseModsArgs) -> Result<GameBananaModsResponse, AppError> {
    let section = args.section.unwrap_or_else(|| "Mod".to_string());
    gamebanana::fetch_submissions(
        &section,
        args.page,
        args.per_page,
        args.search.as_deref(),
        args.category_id,
    )
    .await
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GetModDetailsArgs {
    #[serde(alias = "mod_id")]
    mod_id: u64,
    section: Option<String>,
}

/// Get mod details from GameBanana
#[tauri::command]
pub async fn get_mod_details(args: GetModDetailsArgs) -> Result<GameBananaModDetails, AppError> {
    let section = args.section.unwrap_or_else(|| "Mod".to_string());
    gamebanana::fetch_mod_details(&section, args.mod_id).await
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadModArgs {
    #[serde(alias = "mod_id")]
    mod_id: u64,
    #[serde(alias = "file_id")]
    file_id: u64,
    #[serde(alias = "file_name")]
    file_name: String,
    section: Option<String>,
}

/// Download and install a mod from GameBanana
#[tauri::command]
pub async fn download_mod(
    app: AppHandle,
    args: DownloadModArgs,
) -> Result<(), AppError> {
    let settings = load_settings(&app)?;
    let deadlock_path = settings
        .deadlock_path
        .ok_or(AppError::DeadlockNotFound)?;

    let addons_path = get_addons_path(Path::new(&deadlock_path))?;

    // Get mod details to find the download URL
    let section = args.section.unwrap_or_else(|| "Mod".to_string());
    let mod_details = gamebanana::fetch_mod_details(&section, args.mod_id).await?;
    let files = mod_details
        .files
        .ok_or_else(|| AppError::ModNotFound("No files available".to_string()))?;

    let file = files
        .iter()
        .find(|f| f.id == args.file_id)
        .ok_or_else(|| AppError::ModNotFound(format!("File {} not found", args.file_id)))?;

    let dest_path = addons_path.join(&args.file_name);
    let app_clone = app.clone();

    // Download with progress events
    gamebanana::download_file(&file.download_url, &dest_path, |downloaded, total| {
        let _ = app_clone.emit(
            "download-progress",
            serde_json::json!({
                "modId": args.mod_id,
                "fileId": args.file_id,
                "downloaded": downloaded,
                "total": total,
            }),
        );
    })
    .await?;

    // Check if the downloaded file is an archive and extract it
    let extracted_files = if is_archive(&dest_path) {
        // Emit extracting status
        let _ = app.emit(
            "download-extracting",
            serde_json::json!({
                "modId": args.mod_id,
                "fileId": args.file_id,
            }),
        );

        // Extract the archive
        let extracted = extract_archive(&dest_path, &addons_path)?;

        // Clean up the archive file
        cleanup_archive(&dest_path)?;

        extracted
    } else {
        vec![dest_path]
    };

    let metadata = ModMetadata {
        name: mod_details.name.clone(),
        game_banana_id: Some(mod_details.id),
        description: mod_details.description.clone(),
        thumbnail_url: mod_details
            .preview_media
            .as_ref()
            .and_then(|media| media.images.as_ref())
            .and_then(|images| images.first())
            .map(|image| {
                let file = image.file_530.as_deref().unwrap_or(&image.file);
                format!("{}/{}", image.base_url, file)
            }),
    };
    let _ = mod_metadata::upsert_metadata_for_files(&app, &extracted_files, &metadata);

    // Emit completion event
    app.emit(
        "download-complete",
        serde_json::json!({
            "modId": args.mod_id,
            "fileId": args.file_id,
            "fileName": args.file_name,
            "extractedFiles": extracted_files.iter().map(|p| p.to_string_lossy().to_string()).collect::<Vec<_>>(),
        }),
    )
    .map_err(|e| AppError::Settings(e.to_string()))?;

    Ok(())
}

#[tauri::command]
pub async fn get_gamebanana_sections() -> Result<Vec<GameBananaSection>, AppError> {
    gamebanana::fetch_sections().await
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GetGameBananaCategoriesArgs {
    category_model_name: String,
}

#[tauri::command]
pub async fn get_gamebanana_categories(
    args: GetGameBananaCategoriesArgs,
) -> Result<Vec<GameBananaCategoryNode>, AppError> {
    gamebanana::fetch_category_tree(&args.category_model_name).await
}
