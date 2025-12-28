use crate::deadlock::{get_addons_path, get_disabled_path};
use crate::error::AppError;
use crate::types::Mod;
use chrono::{DateTime, Utc};
use std::fs;
use std::path::Path;

/// Parse a VPK filename to extract priority
/// Format: pak##_dir.vpk where ## is 01-99
fn parse_vpk_priority(filename: &str) -> Option<u32> {
    if !filename.starts_with("pak") || !filename.ends_with("_dir.vpk") {
        return None;
    }

    let number_part = &filename[3..5];
    number_part.parse::<u32>().ok()
}

/// Generate a mod ID from the file path
fn generate_mod_id(path: &Path) -> String {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};

    let mut hasher = DefaultHasher::new();
    path.to_string_lossy().hash(&mut hasher);
    format!("{:x}", hasher.finish())
}

/// Extract a human-readable name from the VPK filename
fn extract_mod_name(filename: &str) -> String {
    // Try to extract a meaningful name from pak##_name_dir.vpk format
    let name = filename
        .trim_end_matches("_dir.vpk")
        .trim_end_matches(".vpk");

    // Remove the pak## prefix if present
    let name = if name.starts_with("pak") && name.len() > 5 {
        let rest = &name[5..]; // Skip "pak##"
        if rest.starts_with('_') {
            &rest[1..] // Skip the underscore
        } else {
            rest
        }
    } else {
        name
    };

    // Convert underscores/dashes to spaces and title case
    name.replace(['_', '-'], " ")
        .split_whitespace()
        .map(|word| {
            let mut chars = word.chars();
            match chars.next() {
                None => String::new(),
                Some(first) => first.to_uppercase().chain(chars).collect(),
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

/// Scan for mods in the addons folder
pub fn scan_mods(deadlock_path: &Path) -> Result<Vec<Mod>, AppError> {
    let addons_path = get_addons_path(deadlock_path)?;
    let disabled_path = get_disabled_path(deadlock_path)?;

    let mut mods = Vec::new();

    // Scan enabled mods
    mods.extend(scan_folder(&addons_path, true)?);

    // Scan disabled mods
    if disabled_path.exists() {
        mods.extend(scan_folder(&disabled_path, false)?);
    }

    // Sort by priority
    mods.sort_by_key(|m| m.priority);

    Ok(mods)
}

fn scan_folder(folder: &Path, enabled: bool) -> Result<Vec<Mod>, AppError> {
    let mut mods = Vec::new();

    if !folder.exists() {
        return Ok(mods);
    }

    for entry in fs::read_dir(folder)? {
        let entry = entry?;
        let path = entry.path();

        if !path.is_file() {
            continue;
        }

        let filename = match path.file_name().and_then(|n| n.to_str()) {
            Some(name) => name.to_string(),
            None => continue,
        };

        // Only process VPK files
        if !filename.ends_with("_dir.vpk") && !filename.ends_with(".vpk") {
            continue;
        }

        let metadata = fs::metadata(&path)?;
        let modified: DateTime<Utc> = metadata
            .modified()
            .map(|t| t.into())
            .unwrap_or_else(|_| Utc::now());

        let priority = parse_vpk_priority(&filename).unwrap_or(50);

        mods.push(Mod {
            id: generate_mod_id(&path),
            name: extract_mod_name(&filename),
            file_name: filename,
            path: path.to_string_lossy().to_string(),
            enabled,
            priority,
            size: metadata.len(),
            installed_at: modified,
            description: None,
            thumbnail_url: None,
            game_banana_id: None,
        });
    }

    Ok(mods)
}

/// Enable a mod by moving it from disabled to addons folder
pub fn enable_mod(deadlock_path: &Path, mod_id: &str) -> Result<Mod, AppError> {
    let mods = scan_mods(deadlock_path)?;
    let target_mod = mods
        .iter()
        .find(|m| m.id == mod_id)
        .ok_or_else(|| AppError::ModNotFound(mod_id.to_string()))?;

    if target_mod.enabled {
        return Ok(target_mod.clone());
    }

    let addons_path = get_addons_path(deadlock_path)?;
    let source_path = Path::new(&target_mod.path);
    let dest_path = addons_path.join(&target_mod.file_name);

    fs::rename(source_path, &dest_path)?;

    // Return updated mod
    let mut updated_mod = target_mod.clone();
    updated_mod.enabled = true;
    updated_mod.path = dest_path.to_string_lossy().to_string();

    Ok(updated_mod)
}

/// Disable a mod by moving it to the disabled folder
pub fn disable_mod(deadlock_path: &Path, mod_id: &str) -> Result<Mod, AppError> {
    let mods = scan_mods(deadlock_path)?;
    let target_mod = mods
        .iter()
        .find(|m| m.id == mod_id)
        .ok_or_else(|| AppError::ModNotFound(mod_id.to_string()))?;

    if !target_mod.enabled {
        return Ok(target_mod.clone());
    }

    let disabled_path = get_disabled_path(deadlock_path)?;
    let source_path = Path::new(&target_mod.path);
    let dest_path = disabled_path.join(&target_mod.file_name);

    fs::rename(source_path, &dest_path)?;

    // Return updated mod
    let mut updated_mod = target_mod.clone();
    updated_mod.enabled = false;
    updated_mod.path = dest_path.to_string_lossy().to_string();

    Ok(updated_mod)
}

/// Delete a mod completely
pub fn delete_mod(deadlock_path: &Path, mod_id: &str) -> Result<(), AppError> {
    let mods = scan_mods(deadlock_path)?;
    let target_mod = mods
        .iter()
        .find(|m| m.id == mod_id)
        .ok_or_else(|| AppError::ModNotFound(mod_id.to_string()))?;

    fs::remove_file(&target_mod.path)?;

    // Also remove related VPK files (pak##_000.vpk, pak##_001.vpk, etc.)
    let base_name = target_mod.file_name.trim_end_matches("_dir.vpk");
    let parent = Path::new(&target_mod.path)
        .parent()
        .ok_or_else(|| AppError::ModNotFound(mod_id.to_string()))?;

    for entry in fs::read_dir(parent)? {
        let entry = entry?;
        let filename = entry.file_name();
        let filename_str = filename.to_string_lossy();

        if filename_str.starts_with(base_name) && filename_str.ends_with(".vpk") {
            fs::remove_file(entry.path())?;
        }
    }

    Ok(())
}

/// Set the priority of a mod by renaming it
pub fn set_mod_priority(
    deadlock_path: &Path,
    mod_id: &str,
    new_priority: u32,
) -> Result<Mod, AppError> {
    let mods = scan_mods(deadlock_path)?;
    let target_mod = mods
        .iter()
        .find(|m| m.id == mod_id)
        .ok_or_else(|| AppError::ModNotFound(mod_id.to_string()))?;

    let source_path = Path::new(&target_mod.path);
    let parent = source_path
        .parent()
        .ok_or_else(|| AppError::ModNotFound(mod_id.to_string()))?;

    // Generate new filename with new priority
    let priority_str = format!("{:02}", new_priority.min(99));
    let new_filename = format!("pak{}_dir.vpk", priority_str);
    let dest_path = parent.join(&new_filename);

    // Check if destination already exists
    if dest_path.exists() && dest_path != source_path {
        return Err(AppError::InvalidDeadlockPath(format!(
            "Priority {} is already in use",
            new_priority
        )));
    }

    fs::rename(source_path, &dest_path)?;

    // Return updated mod
    let mut updated_mod = target_mod.clone();
    updated_mod.priority = new_priority;
    updated_mod.file_name = new_filename;
    updated_mod.path = dest_path.to_string_lossy().to_string();

    Ok(updated_mod)
}
