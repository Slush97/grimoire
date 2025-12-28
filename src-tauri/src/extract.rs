use crate::error::AppError;
use std::fs::{self, File};
use std::io::{self, Cursor, Read};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

/// Check if a file is an archive that needs extraction
pub fn is_archive(path: &Path) -> bool {
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_lowercase());

    matches!(ext.as_deref(), Some("zip") | Some("7z") | Some("rar"))
}

/// Extract an archive to a destination directory
/// Returns the list of extracted VPK files
pub fn extract_archive(archive_path: &Path, dest_dir: &Path) -> Result<Vec<PathBuf>, AppError> {
    let ext = archive_path
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_lowercase());

    match ext.as_deref() {
        Some("zip") => extract_zip(archive_path, dest_dir),
        Some("7z") => extract_7z(archive_path, dest_dir),
        Some("rar") => extract_rar(archive_path, dest_dir),
        _ => Err(AppError::Settings(format!(
            "Unknown archive format: {:?}",
            archive_path.extension()
        ))),
    }
}

/// Extract a ZIP archive
fn extract_zip(archive_path: &Path, dest_dir: &Path) -> Result<Vec<PathBuf>, AppError> {
    let file = File::open(archive_path)?;
    let mut archive = zip::ZipArchive::new(file)
        .map_err(|e| AppError::Settings(format!("Failed to open ZIP: {}", e)))?;

    let mut extracted_vpks = Vec::new();

    for i in 0..archive.len() {
        let mut file = archive
            .by_index(i)
            .map_err(|e| AppError::Settings(format!("Failed to read ZIP entry: {}", e)))?;

        let outpath = match file.enclosed_name() {
            Some(path) => dest_dir.join(path),
            None => continue,
        };

        // Skip directories and non-VPK files
        if file.is_dir() {
            continue;
        }

        // Only extract VPK files
        let is_vpk = outpath
            .extension()
            .and_then(|e| e.to_str())
            .map(|e| e.to_lowercase() == "vpk")
            .unwrap_or(false);

        if !is_vpk {
            continue;
        }

        // Create parent directories if needed
        if let Some(parent) = outpath.parent() {
            if !parent.exists() {
                fs::create_dir_all(parent)?;
            }
        }

        // Handle nested directories - flatten to dest_dir
        let file_name = outpath.file_name().unwrap();
        let final_path = dest_dir.join(file_name);

        let mut outfile = File::create(&final_path)?;
        io::copy(&mut file, &mut outfile)?;

        extracted_vpks.push(final_path);
    }

    Ok(extracted_vpks)
}

/// Extract a 7z archive
fn extract_7z(archive_path: &Path, dest_dir: &Path) -> Result<Vec<PathBuf>, AppError> {
    if !dest_dir.exists() {
        fs::create_dir_all(dest_dir)?;
    }

    // Read the archive into a buffer
    let mut file = File::open(archive_path)?;
    let mut buffer = Vec::new();
    file.read_to_end(&mut buffer)?;

    // Create a cursor for the buffer (implements Read + Seek)
    let cursor = Cursor::new(buffer);

    // Use sevenz-rust to decompress
    let extract_result =
        sevenz_rust::decompress_with_extract_fn(cursor, dest_dir, |entry, reader, dest| {
        // Get the entry name
        let name = entry.name();

        // Only extract VPK files
        if !name.to_lowercase().ends_with(".vpk") {
            return Ok(true); // Skip non-VPK files
        }

        // Flatten directory structure - just use the filename
        let file_name = match Path::new(name).file_name() {
            Some(file_name) => file_name,
            None => return Ok(true),
        };
        let final_path = dest.join(file_name);

        // Create the file
        let mut outfile = File::create(&final_path)
            .map_err(|e| sevenz_rust::Error::io(e))?;

        // Copy contents
        io::copy(reader, &mut outfile)
            .map_err(|e| sevenz_rust::Error::io(e))?;

        Ok(true)
    })
    ;

    if let Err(err) = extract_result {
        let temp_dir = create_temp_dir("modmanager-7z")?;
        let mut last_err = Some(format!("{:?}", err));

        for tool in ["7z", "7za"] {
            let run_result = run_command(
                tool,
                &[
                    "x",
                    "-y",
                    &format!(
                        "-o{}",
                        temp_dir
                            .to_str()
                            .ok_or_else(|| AppError::Settings("Invalid temp path".to_string()))?
                    ),
                    archive_path
                        .to_str()
                        .ok_or_else(|| AppError::Settings("Invalid archive path".to_string()))?,
                ],
            );

            match run_result {
                Ok(()) => {
                    let extracted = collect_vpks(&temp_dir)?;
                    let copied = copy_vpks_to_dest(&extracted, dest_dir)?;
                    let _ = fs::remove_dir_all(&temp_dir);
                    return Ok(copied);
                }
                Err(err) => last_err = Some(err),
            }
        }

        let message = if let Some(err) = last_err {
            format!(
                "Failed to extract 7z. Install '7z' (p7zip) or '7za' and try again. Details: {}",
                err
            )
        } else {
            "Failed to extract 7z. Install '7z' (p7zip) or '7za' and try again.".to_string()
        };

        let _ = fs::remove_dir_all(&temp_dir);
        return Err(AppError::Settings(message));
    }

    // Scan dest_dir for extracted VPK files
    let mut extracted_vpks = Vec::new();
    for entry in fs::read_dir(dest_dir)? {
        let entry = entry?;
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) == Some("vpk") {
            extracted_vpks.push(path);
        }
    }

    Ok(extracted_vpks)
}

/// Extract a RAR archive using available system tools (7z or unrar)
fn extract_rar(archive_path: &Path, dest_dir: &Path) -> Result<Vec<PathBuf>, AppError> {
    let temp_dir = create_temp_dir("modmanager-rar")?;

    let mut last_err = None;
    for tool in ["7z", "7za", "unrar"] {
        let result = match tool {
            "unrar" => run_command(
                tool,
                &[
                    "x",
                    "-y",
                    archive_path
                        .to_str()
                        .ok_or_else(|| AppError::Settings("Invalid archive path".to_string()))?,
                    temp_dir
                        .to_str()
                        .ok_or_else(|| AppError::Settings("Invalid temp path".to_string()))?,
                ],
            ),
            _ => run_command(
                tool,
                &[
                    "x",
                    "-y",
                    &format!(
                        "-o{}",
                        temp_dir
                            .to_str()
                            .ok_or_else(|| AppError::Settings("Invalid temp path".to_string()))?
                    ),
                    archive_path
                        .to_str()
                        .ok_or_else(|| AppError::Settings("Invalid archive path".to_string()))?,
                ],
            ),
        };

        match result {
            Ok(()) => {
                let extracted = collect_vpks(&temp_dir)?;
                let copied = copy_vpks_to_dest(&extracted, dest_dir)?;
                let _ = fs::remove_dir_all(&temp_dir);
                return Ok(copied);
            }
            Err(err) => last_err = Some(err),
        }
    }

    let message = if let Some(err) = last_err {
        format!(
            "RAR extraction failed. Install '7z' or 'unrar' and try again. Details: {}",
            err
        )
    } else {
        "RAR extraction failed. Install '7z' or 'unrar' and try again.".to_string()
    };

    let _ = fs::remove_dir_all(&temp_dir);
    Err(AppError::Settings(message))
}

fn run_command(cmd: &str, args: &[&str]) -> Result<(), String> {
    let output = Command::new(cmd).args(args).output();
    match output {
        Ok(output) if output.status.success() => Ok(()),
        Ok(output) => Err(format!(
            "{} exited with {}: {}",
            cmd,
            output.status,
            String::from_utf8_lossy(&output.stderr)
        )),
        Err(err) => Err(format!("{} failed to run: {}", cmd, err)),
    }
}

fn collect_vpks(root: &Path) -> Result<Vec<PathBuf>, AppError> {
    let mut vpks = Vec::new();
    collect_vpks_recursive(root, &mut vpks)?;
    Ok(vpks)
}

fn collect_vpks_recursive(root: &Path, out: &mut Vec<PathBuf>) -> Result<(), AppError> {
    for entry in fs::read_dir(root)? {
        let entry = entry?;
        let path = entry.path();
        if path.is_dir() {
            collect_vpks_recursive(&path, out)?;
            continue;
        }
        if path.extension().and_then(|e| e.to_str()) == Some("vpk") {
            out.push(path);
        }
    }
    Ok(())
}

fn copy_vpks_to_dest(
    extracted: &[PathBuf],
    dest_dir: &Path,
) -> Result<Vec<PathBuf>, AppError> {
    let mut copied = Vec::new();
    for path in extracted {
        let file_name = path
            .file_name()
            .ok_or_else(|| AppError::Settings("Invalid VPK filename".to_string()))?;
        let dest_path = dest_dir.join(file_name);
        fs::copy(path, &dest_path)?;
        copied.push(dest_path);
    }
    Ok(copied)
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

/// Clean up archive file after successful extraction
pub fn cleanup_archive(archive_path: &Path) -> Result<(), AppError> {
    fs::remove_file(archive_path)?;
    Ok(())
}
