use crate::deadlock::{detect_deadlock_path, get_addons_path, is_valid_deadlock_path};
use crate::error::AppError;
use crate::extract::{cleanup_archive, extract_archive, is_archive};
use crate::gamebanana::{
    self, GameBananaCategoryNode, GameBananaModDetails, GameBananaModsResponse, GameBananaSection,
};
use crate::mod_metadata::{self, ModMetadata, ModMetadataMap};
use crate::mods::{delete_mod, disable_mod, enable_mod, scan_mods, set_mod_priority};
use crate::deadlock::get_disabled_path;
use crate::settings::{load_settings, save_settings};
use crate::types::{AppSettings, Mod};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
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
    #[serde(alias = "category_id")]
    category_id: Option<u64>,
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

    let category_id = mod_details
        .category
        .as_ref()
        .and_then(|category| category.id)
        .or(args.category_id);

    let metadata = ModMetadata {
        name: mod_details.name.clone(),
        game_banana_id: Some(mod_details.id),
        category_id,
        source_section: Some(section),
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

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetMinaPresetArgs {
    preset_file_name: String,
}

#[tauri::command]
pub fn set_mina_preset(
    app: AppHandle,
    args: SetMinaPresetArgs,
) -> Result<(), AppError> {
    let settings = load_settings(&app)?;
    let deadlock_path = settings
        .deadlock_path
        .ok_or(AppError::DeadlockNotFound)?;

    let addons_path = get_addons_path(Path::new(&deadlock_path))?;
    let disabled_path = get_disabled_path(Path::new(&deadlock_path))?;

    let metadata_map = mod_metadata::load_metadata(&app).unwrap_or_default();
    let mut preset_files = Vec::new();
    let mut texture_files = Vec::new();

    for entry in fs::read_dir(&addons_path)? {
        let entry = entry?;
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let file_name = match path.file_name().and_then(|n| n.to_str()) {
            Some(name) => name.to_string(),
            None => continue,
        };
        collect_mina_files(
            &file_name,
            Some(&metadata_map),
            &mut preset_files,
            &mut texture_files,
            true,
        );
    }

    for entry in fs::read_dir(&disabled_path)? {
        let entry = entry?;
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let file_name = match path.file_name().and_then(|n| n.to_str()) {
            Some(name) => name.to_string(),
            None => continue,
        };
        collect_mina_files(
            &file_name,
            Some(&metadata_map),
            &mut preset_files,
            &mut texture_files,
            false,
        );
    }

    if !preset_files.iter().any(|(name, _)| name == &args.preset_file_name) {
        return Err(AppError::ModNotFound(format!(
            "Preset {} not found",
            args.preset_file_name
        )));
    }

    for (file_name, is_enabled) in &preset_files {
        let source = if *is_enabled { &addons_path } else { &disabled_path };
        let dest = if *is_enabled { &disabled_path } else { &addons_path };

        if file_name == &args.preset_file_name {
            if !*is_enabled {
                fs::rename(source.join(file_name), dest.join(file_name))?;
            }
        } else if *is_enabled {
            fs::rename(source.join(file_name), dest.join(file_name))?;
        }
    }

    for (file_name, is_enabled) in &texture_files {
        if !*is_enabled {
            fs::rename(disabled_path.join(file_name), addons_path.join(file_name))?;
        }
    }

    Ok(())
}

fn collect_mina_files(
    file_name: &str,
    metadata_map: Option<&ModMetadataMap>,
    preset_files: &mut Vec<(String, bool)>,
    texture_files: &mut Vec<(String, bool)>,
    is_enabled: bool,
) {
    let lower = file_name.to_lowercase();
    let is_metadata_mina = metadata_map
        .and_then(|map| map.get(file_name))
        .map(|meta| meta.name.starts_with("Midnight Mina —"))
        .unwrap_or(false);
    if (lower.starts_with("clothing_preset_")
        || lower.starts_with("sts_midnight_mina_")
        || is_metadata_mina)
        && lower.ends_with(".vpk")
    {
        preset_files.push((file_name.to_string(), is_enabled));
        return;
    }

    if lower.contains("textures")
        && lower.ends_with(".vpk")
        && (lower.contains("mina") || lower.contains("midnight") || lower == "textures-pak21_dir.vpk")
    {
        texture_files.push((file_name.to_string(), is_enabled));
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListMinaVariantsArgs {
    archive_path: String,
}

#[tauri::command]
pub fn list_mina_variants(args: ListMinaVariantsArgs) -> Result<Vec<String>, AppError> {
    let output = run_7z_list(&args.archive_path)?;
    Ok(parse_7z_paths(&output))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplyMinaVariantArgs {
    archive_path: String,
    archive_entry: String,
    preset_label: String,
    hero_category_id: Option<u64>,
}

#[tauri::command]
pub fn apply_mina_variant(app: AppHandle, args: ApplyMinaVariantArgs) -> Result<(), AppError> {
    let settings = load_settings(&app)?;
    let deadlock_path = settings
        .deadlock_path
        .ok_or(AppError::DeadlockNotFound)?;

    let addons_path = get_addons_path(Path::new(&deadlock_path))?;
    let disabled_path = get_disabled_path(Path::new(&deadlock_path))?;

    let temp_dir = create_temp_dir("modmanager-mina")?;
    extract_7z_entry(&args.archive_path, &args.archive_entry, &temp_dir)?;

    let entry_name = Path::new(&args.archive_entry)
        .file_name()
        .ok_or_else(|| AppError::Settings("Invalid archive entry".to_string()))?;
    let extracted_path = temp_dir.join(entry_name);
    if !extracted_path.exists() {
        return Err(AppError::Settings("Preset extraction failed".to_string()));
    }

    let entry_name_str = entry_name
        .to_str()
        .ok_or_else(|| AppError::Settings("Invalid preset filename".to_string()))?;
    let preferred_pak = parse_pak_number(entry_name_str).unwrap_or(20);
    let pak_number = find_available_pak_number(preferred_pak, &addons_path, &disabled_path)?;
    let dest_file_name = format!("pak{:02}_dir.vpk", pak_number);
    let dest_path = addons_path.join(&dest_file_name);
    if dest_path.exists() {
        fs::remove_file(&dest_path)?;
    }
    if let Err(err) = fs::rename(&extracted_path, &dest_path) {
        if err.raw_os_error() == Some(18) {
            fs::copy(&extracted_path, &dest_path)?;
            fs::remove_file(&extracted_path)?;
        } else {
            return Err(AppError::Settings(format!(
                "Failed to move preset: {}",
                err
            )));
        }
    }

    let metadata = ModMetadata {
        name: format!("Midnight Mina — {}", args.preset_label),
        game_banana_id: None,
        category_id: args.hero_category_id,
        source_section: Some("Mod".to_string()),
        description: None,
        thumbnail_url: None,
    };

    let mut metadata_map = mod_metadata::load_metadata(&app).unwrap_or_default();
    metadata_map.insert(dest_file_name.clone(), metadata.clone());

    let mut preset_files = Vec::new();
    let mut texture_files = Vec::new();
    for entry in fs::read_dir(&addons_path)? {
        let entry = entry?;
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let file_name = match path.file_name().and_then(|n| n.to_str()) {
            Some(name) => name.to_string(),
            None => continue,
        };
        collect_mina_files(
            &file_name,
            Some(&metadata_map),
            &mut preset_files,
            &mut texture_files,
            true,
        );
    }
    for entry in fs::read_dir(&disabled_path)? {
        let entry = entry?;
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let file_name = match path.file_name().and_then(|n| n.to_str()) {
            Some(name) => name.to_string(),
            None => continue,
        };
        collect_mina_files(
            &file_name,
            Some(&metadata_map),
            &mut preset_files,
            &mut texture_files,
            false,
        );
    }

    let dest_name = dest_path
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| AppError::Settings("Invalid preset filename".to_string()))?;
    for (file_name, is_enabled) in &preset_files {
        let source = if *is_enabled { &addons_path } else { &disabled_path };
        let dest = if *is_enabled { &disabled_path } else { &addons_path };
        if file_name == dest_name {
            if !*is_enabled {
                fs::rename(source.join(file_name), dest.join(file_name))?;
            }
        } else if *is_enabled {
            fs::rename(source.join(file_name), dest.join(file_name))?;
        }
    }

    for (file_name, is_enabled) in &texture_files {
        if !*is_enabled {
            fs::rename(disabled_path.join(file_name), addons_path.join(file_name))?;
        }
    }

    let _ = mod_metadata::upsert_metadata_for_files(&app, &[dest_path], &metadata);

    let _ = fs::remove_dir_all(&temp_dir);
    Ok(())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CleanupAddonsResult {
    removed_archives: u32,
    renamed_mina_presets: u32,
    renamed_mina_textures: u32,
    skipped_mina_presets: u32,
    skipped_mina_textures: u32,
}

#[tauri::command]
pub fn cleanup_addons(app: AppHandle) -> Result<CleanupAddonsResult, AppError> {
    let settings = load_settings(&app)?;
    let deadlock_path = settings
        .deadlock_path
        .ok_or(AppError::DeadlockNotFound)?;

    let addons_path = get_addons_path(Path::new(&deadlock_path))?;
    let disabled_path = get_disabled_path(Path::new(&deadlock_path))?;

    let mut removed = 0u32;
    let mut renamed_mina_presets = 0u32;
    let mut renamed_mina_textures = 0u32;
    let mut skipped_mina_presets = 0u32;
    let mut skipped_mina_textures = 0u32;
    let mut metadata_map = mod_metadata::load_metadata(&app).unwrap_or_default();

    let mut used_paks = std::collections::HashSet::new();
    for dir in [&addons_path, &disabled_path] {
        if !dir.exists() {
            continue;
        }
        for entry in fs::read_dir(dir)? {
            let entry = entry?;
            let path = entry.path();
            if !path.is_file() {
                continue;
            }
            if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
                if let Some(num) = parse_pak_number(name) {
                    used_paks.insert(num);
                }
            }
        }
    }

    for dir in [&addons_path, &disabled_path] {
        if !dir.exists() {
            continue;
        }
        for entry in fs::read_dir(dir)? {
            let entry = entry?;
            let path = entry.path();
            if !path.is_file() {
                continue;
            }
            let ext = path
                .extension()
                .and_then(|e| e.to_str())
                .map(|e| e.to_lowercase());
            if matches!(ext.as_deref(), Some("zip") | Some("7z") | Some("rar")) {
                fs::remove_file(path)?;
                removed += 1;
            }
        }
    }

    // Normalize Mina textures to pak21_dir.vpk when possible.
    for dir in [&addons_path, &disabled_path] {
        if !dir.exists() {
            continue;
        }
        for entry in fs::read_dir(dir)? {
            let entry = entry?;
            let path = entry.path();
            if !path.is_file() {
                continue;
            }
            let file_name = match path.file_name().and_then(|n| n.to_str()) {
                Some(name) => name.to_string(),
                None => continue,
            };
            if !is_mina_texture(&file_name) {
                continue;
            }
            if file_name == "pak21_dir.vpk" {
                continue;
            }
            if used_paks.contains(&21) {
                skipped_mina_textures += 1;
                continue;
            }
            let dest_path = dir.join("pak21_dir.vpk");
            move_with_fallback(&path, &dest_path)?;
            metadata_map = rename_metadata_key_inline(metadata_map, &file_name, "pak21_dir.vpk");
            used_paks.insert(21);
            renamed_mina_textures += 1;
        }
    }

    // Normalize Mina presets to pak20_dir.vpk (and next available slots if needed).
    for dir in [&addons_path, &disabled_path] {
        if !dir.exists() {
            continue;
        }
        for entry in fs::read_dir(dir)? {
            let entry = entry?;
            let path = entry.path();
            if !path.is_file() {
                continue;
            }
            let file_name = match path.file_name().and_then(|n| n.to_str()) {
                Some(name) => name.to_string(),
                None => continue,
            };
            if !is_mina_preset(&file_name, Some(&metadata_map)) {
                continue;
            }
            if is_pak_file(&file_name) {
                continue;
            }
            let preferred = 20;
            let mut target = None;
            for number in preferred..=99 {
                if !used_paks.contains(&number) {
                    target = Some(number);
                    break;
                }
            }
            if target.is_none() {
                for number in 0..preferred {
                    if !used_paks.contains(&number) {
                        target = Some(number);
                        break;
                    }
                }
            }
            let target_number = match target {
                Some(number) => number,
                None => {
                    skipped_mina_presets += 1;
                    continue;
                }
            };
            let dest_file_name = format!("pak{:02}_dir.vpk", target_number);
            let dest_path = dir.join(&dest_file_name);
            if dest_path.exists() {
                skipped_mina_presets += 1;
                continue;
            }
            move_with_fallback(&path, &dest_path)?;
            metadata_map = rename_metadata_key_inline(metadata_map, &file_name, &dest_file_name);
            used_paks.insert(target_number);
            renamed_mina_presets += 1;
        }
    }

    let _ = mod_metadata::save_metadata(&app, &metadata_map);

    Ok(CleanupAddonsResult {
        removed_archives: removed,
        renamed_mina_presets,
        renamed_mina_textures,
        skipped_mina_presets,
        skipped_mina_textures,
    })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GameinfoStatus {
    configured: bool,
    message: String,
}

#[tauri::command]
pub fn get_gameinfo_status(app: AppHandle) -> Result<GameinfoStatus, AppError> {
    let settings = load_settings(&app)?;
    let deadlock_path = settings
        .deadlock_path
        .ok_or(AppError::DeadlockNotFound)?;
    let gameinfo_path = crate::deadlock::get_gameinfo_path(Path::new(&deadlock_path));
    let content = fs::read_to_string(&gameinfo_path)?;
    let configured = is_gameinfo_configured(&content);
    Ok(GameinfoStatus {
        configured,
        message: if configured {
            "gameinfo.gi is configured for addons.".to_string()
        } else {
            "gameinfo.gi is missing addon search paths.".to_string()
        },
    })
}

#[tauri::command]
pub fn fix_gameinfo(app: AppHandle) -> Result<GameinfoStatus, AppError> {
    let settings = load_settings(&app)?;
    let deadlock_path = settings
        .deadlock_path
        .ok_or(AppError::DeadlockNotFound)?;
    let gameinfo_path = crate::deadlock::get_gameinfo_path(Path::new(&deadlock_path));
    let content = fs::read_to_string(&gameinfo_path)?;
    let updated = normalize_gameinfo(&content)?;
    if updated != content {
        fs::write(&gameinfo_path, updated)?;
    }
    Ok(GameinfoStatus {
        configured: true,
        message: "gameinfo.gi updated with addon paths.".to_string(),
    })
}

fn run_7z_list(archive_path: &str) -> Result<String, AppError> {
    for tool in ["7z", "7za"] {
        let output = std::process::Command::new(tool)
            .args(["l", "-ba", "-slt", archive_path])
            .output();
        if let Ok(output) = output {
            if output.status.success() {
                return String::from_utf8(output.stdout)
                    .map_err(|e| AppError::Settings(format!("7z output invalid: {}", e)));
            }
        }
    }
    Err(AppError::Settings(
        "7z is required to list Mina variants".to_string(),
    ))
}

fn extract_7z_entry(archive_path: &str, entry_path: &str, dest_dir: &Path) -> Result<(), AppError> {
    for tool in ["7z", "7za"] {
        let result = std::process::Command::new(tool)
            .args([
                "e",
                "-y",
                &format!("-o{}", dest_dir.to_string_lossy()),
                archive_path,
                entry_path,
            ])
            .output();
        if let Ok(output) = result {
            if output.status.success() {
                return Ok(());
            }
        }
    }
    Err(AppError::Settings(
        "7z is required to extract Mina variants".to_string(),
    ))
}

fn parse_7z_paths(output: &str) -> Vec<String> {
    let mut paths = Vec::new();
    for line in output.lines() {
        if let Some(rest) = line.strip_prefix("Path = ") {
            let path = rest.trim();
            if path.ends_with(".vpk") {
                paths.push(path.to_string());
            }
        }
    }
    paths
}

fn create_temp_dir(prefix: &str) -> Result<PathBuf, AppError> {
    let mut dir = std::env::temp_dir();
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| AppError::Settings(format!("Failed to create temp dir: {}", e)))?
        .as_nanos();
    dir.push(format!("{}-{}", prefix, nanos));
    fs::create_dir_all(&dir)?;
    Ok(dir)
}

fn parse_pak_number(file_name: &str) -> Option<u32> {
    let lower = file_name.to_lowercase();
    if !lower.ends_with("_dir.vpk") {
        return None;
    }
    if let Some(index) = lower.rfind("pak") {
        let start = index + 3;
        let digits: String = lower.chars().skip(start).take(2).collect();
        if digits.len() == 2 && digits.chars().all(|c| c.is_ascii_digit()) {
            return digits.parse().ok();
        }
    }
    None
}

fn is_gameinfo_configured(content: &str) -> bool {
    content.contains("Game                citadel/addons")
        && content.contains("AddonRoot           citadel_addons")
        && content.contains("OfficialAddonRoot   citadel_community_addons")
        && content.contains("\"UseOfficialAddons\" \"1\"")
}

fn normalize_gameinfo(content: &str) -> Result<String, AppError> {
    const TARGET_BLOCK: &str = r#"	FileSystem
	{
		//
		// The code that loads this file automatically does a few things here:
		//
		// 1. For each "Game" search path, it adds a "GameBin" path, in <dir>\bin
		// 2. For each "Game" search path, it adds another "Game" path in front of it with _<language> at the end.
		//    For example: c:\hl2\cstrike on a french machine would get a c:\hl2\cstrike_french path added to it.
		// 3. If no "Mod" key, for the first "Game" search path, it adds a search path called "MOD".
		// 4. If no "Write" key, for the first "Game" search path, it adds a search path called "DEFAULT_WRITE_PATH".
		//

		//
		// Search paths are relative to the exe directory\..\
		//
		SearchPaths
		{
			// These are optional language paths. They must be mounted first, which is why there are first in the list.
			// *LANGUAGE* will be replaced with the actual language name. If not running a specific language, these paths will not be mounted
			Game_Language		citadel_*LANGUAGE*
			
			Mod                 citadel
			Write               citadel
			Game                citadel/addons
			Game                citadel
			Mod                 core
			Write               core
			Game                core
			AddonRoot           citadel_addons
			OfficialAddonRoot   citadel_community_addons
		}
	}
	AddonConfig
	{
		"UseOfficialAddons" "1"
	}"#;

    let without_addon = remove_block(content, "AddonConfig");
    if let Some((start, end)) = find_block(&without_addon, "FileSystem") {
        let mut updated = String::new();
        updated.push_str(&without_addon[..start]);
        updated.push_str(TARGET_BLOCK);
        updated.push_str(&without_addon[end..]);
        Ok(updated)
    } else {
        Err(AppError::Settings(
            "FileSystem block not found in gameinfo.gi".to_string(),
        ))
    }
}

fn find_block(content: &str, key: &str) -> Option<(usize, usize)> {
    let key_index = content.find(key)?;
    let brace_index = content[key_index..].find('{')? + key_index;
    let mut depth = 0;
    for (offset, ch) in content[brace_index..].char_indices() {
        if ch == '{' {
            depth += 1;
        } else if ch == '}' {
            depth -= 1;
            if depth == 0 {
                let end = brace_index + offset + 1;
                return Some((key_index, end));
            }
        }
    }
    None
}

fn remove_block(content: &str, key: &str) -> String {
    if let Some((start, end)) = find_block(content, key) {
        let mut updated = String::new();
        updated.push_str(&content[..start]);
        updated.push_str(&content[end..]);
        updated
    } else {
        content.to_string()
    }
}

fn is_pak_file(file_name: &str) -> bool {
    let lower = file_name.to_lowercase();
    lower.starts_with("pak") && lower.ends_with("_dir.vpk") && parse_pak_number(&lower).is_some()
}

fn is_mina_texture(file_name: &str) -> bool {
    let lower = file_name.to_lowercase();
    if !lower.ends_with(".vpk") {
        return false;
    }
    if !lower.contains("textures") {
        return false;
    }
    lower.contains("mina") || lower.contains("midnight") || lower == "textures-pak21_dir.vpk"
}

fn is_mina_preset(file_name: &str, metadata_map: Option<&ModMetadataMap>) -> bool {
    let lower = file_name.to_lowercase();
    let is_metadata_mina = metadata_map
        .and_then(|map| map.get(file_name))
        .map(|meta| meta.name.starts_with("Midnight Mina —"))
        .unwrap_or(false);
    (lower.starts_with("clothing_preset_")
        || lower.starts_with("sts_midnight_mina_")
        || is_metadata_mina)
        && lower.ends_with(".vpk")
        && !is_mina_texture(file_name)
}

fn rename_metadata_key_inline(
    mut map: ModMetadataMap,
    from: &str,
    to: &str,
) -> ModMetadataMap {
    if let Some(entry) = map.remove(from) {
        map.insert(to.to_string(), entry);
    }
    map
}

fn move_with_fallback(source: &Path, dest: &Path) -> Result<(), AppError> {
    if let Err(err) = fs::rename(source, dest) {
        if err.raw_os_error() == Some(18) {
            fs::copy(source, dest)?;
            fs::remove_file(source)?;
        } else {
            return Err(AppError::Settings(format!(
                "Failed to move file: {}",
                err
            )));
        }
    }
    Ok(())
}

fn find_available_pak_number(
    preferred: u32,
    addons_path: &Path,
    disabled_path: &Path,
) -> Result<u32, AppError> {
    let mut used = std::collections::HashSet::new();
    for dir in [addons_path, disabled_path] {
        if !dir.exists() {
            continue;
        }
        for entry in fs::read_dir(dir)? {
            let entry = entry?;
            let path = entry.path();
            if !path.is_file() {
                continue;
            }
            if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
                if let Some(num) = parse_pak_number(name) {
                    used.insert(num);
                }
            }
        }
    }

    for number in preferred..=99 {
        if !used.contains(&number) {
            return Ok(number);
        }
    }
    for number in 0..preferred {
        if !used.contains(&number) {
            return Ok(number);
        }
    }

    Err(AppError::Settings(
        "No available pak slots (00-99)".to_string(),
    ))
}
