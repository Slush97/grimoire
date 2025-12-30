import { createWriteStream, unlinkSync, existsSync, readdirSync, renameSync } from 'fs';
import { join, basename } from 'path';
import { BrowserWindow } from 'electron';
import { getAddonsPath } from './deadlock';
import { extractArchive, isArchive } from './extract';
import { setModMetadata } from './metadata';
import { fetchModDetails, GameBananaModDetails } from './gamebanana';
import { findNextAvailablePriority, getUsedPriorities } from './mods';
import https from 'https';
import http from 'http';

export interface DownloadModArgs {
    modId: number;
    fileId: number;
    fileName: string;
    section?: string;
    categoryId?: number;
}

/**
 * Download a file with progress reporting
 */
async function downloadFile(
    url: string,
    destPath: string,
    onProgress: (downloaded: number, total: number) => void
): Promise<void> {
    return new Promise((resolve, reject) => {
        const protocol = url.startsWith('https') ? https : http;

        const request = protocol.get(url, (response) => {
            // Handle redirects
            if (response.statusCode === 301 || response.statusCode === 302) {
                const redirectUrl = response.headers.location;
                if (redirectUrl) {
                    downloadFile(redirectUrl, destPath, onProgress).then(resolve).catch(reject);
                    return;
                }
            }

            if (response.statusCode !== 200) {
                reject(new Error(`Download failed with status ${response.statusCode}`));
                return;
            }

            const totalSize = parseInt(response.headers['content-length'] || '0', 10);
            let downloadedSize = 0;

            const fileStream = createWriteStream(destPath);

            response.on('data', (chunk: Buffer) => {
                downloadedSize += chunk.length;
                onProgress(downloadedSize, totalSize);
            });

            response.pipe(fileStream);

            fileStream.on('finish', () => {
                fileStream.close();
                resolve();
            });

            fileStream.on('error', (err) => {
                fileStream.close();
                if (existsSync(destPath)) {
                    unlinkSync(destPath);
                }
                reject(err);
            });
        });

        request.on('error', (err) => {
            reject(err);
        });
    });
}

/**
 * Rename VPK files to avoid priority conflicts
 * Checks BOTH addons AND disabled folders to avoid overwriting disabled mods
 * Returns the list of renamed VPK filenames
 */
function renameVpksToAvoidConflicts(
    deadlockPath: string,
    extractedVpks: string[],
    modName: string
): string[] {
    const addonsPath = getAddonsPath(deadlockPath);

    // Get used priorities from BOTH addons and disabled folders
    const usedPriorities = getUsedPriorities(deadlockPath);
    const renamedFiles: string[] = [];

    for (const vpkPath of extractedVpks) {
        const fileName = basename(vpkPath);

        // Check if this VPK has a priority that conflicts
        const match = fileName.match(/^pak(\d{2})_/);
        if (match) {
            const currentPriority = parseInt(match[1], 10);

            if (usedPriorities.has(currentPriority)) {
                // Find next available priority starting from 1
                let newPriority = 1;
                while (usedPriorities.has(newPriority) && newPriority < 99) {
                    newPriority++;
                }

                if (newPriority <= 99 && !usedPriorities.has(newPriority)) {
                    // Rename to new priority
                    const newFileName = fileName.replace(/^pak\d{2}_/, `pak${String(newPriority).padStart(2, '0')}_`);
                    const newPath = join(addonsPath, newFileName);

                    console.log(`[renameVpks] Renaming ${fileName} to ${newFileName} to avoid conflict`);
                    renameSync(vpkPath, newPath);
                    usedPriorities.add(newPriority);
                    renamedFiles.push(newFileName);
                    continue;
                }
            }

            usedPriorities.add(currentPriority);
        }

        renamedFiles.push(fileName);
    }

    return renamedFiles;
}

/**
 * Download and install a mod from GameBanana
 */
export async function downloadMod(
    deadlockPath: string,
    args: DownloadModArgs,
    mainWindow: BrowserWindow | null
): Promise<void> {
    const { modId, fileId, fileName, section = 'Mod', categoryId } = args;

    console.log(`[downloadMod] Starting download: modId=${modId}, fileId=${fileId}, fileName=${fileName}`);

    // Get mod details to find download URL
    const details: GameBananaModDetails = await fetchModDetails(modId, section);

    if (!details.files || details.files.length === 0) {
        throw new Error('No files available for this mod');
    }

    const file = details.files.find((f) => f.id === fileId);
    if (!file) {
        throw new Error(`File ${fileId} not found in mod ${modId}`);
    }

    const addonsPath = getAddonsPath(deadlockPath);
    const downloadPath = join(addonsPath, fileName);

    console.log(`[downloadMod] Downloading to: ${downloadPath}`);

    // Download with progress
    await downloadFile(file.downloadUrl, downloadPath, (downloaded, total) => {
        mainWindow?.webContents.send('download-progress', {
            modId,
            fileId,
            downloaded,
            total,
        });
    });

    console.log(`[downloadMod] Download complete, checking for archive...`);

    // Get metadata for later
    const thumbnail = details.previewMedia?.images?.[0];
    const thumbnailUrl = thumbnail
        ? `${thumbnail.baseUrl}/${thumbnail.file530 || thumbnail.file}`
        : undefined;

    const metadata = {
        modName: details.name,  // Store the actual mod name from GameBanana
        gameBananaId: modId,
        gameBananaFileId: fileId,  // Store which specific file was downloaded
        categoryId: details.category?.id,  // Get category from mod details, not filter
        categoryName: details.category?.name,  // Also store category name for display
        thumbnailUrl,
        sourceSection: section,
        nsfw: false,
    };

    let installedVpks: string[] = [];

    // Extract if archive
    if (isArchive(downloadPath)) {
        console.log(`[downloadMod] Extracting archive...`);
        mainWindow?.webContents.send('download-extracting', { modId, fileId });

        const extractedVpks = await extractArchive(downloadPath, addonsPath);
        console.log(`[downloadMod] Extracted ${extractedVpks.length} VPK files:`, extractedVpks);

        // Rename VPKs to avoid conflicts
        installedVpks = renameVpksToAvoidConflicts(deadlockPath, extractedVpks, details.name);

        // Clean up archive
        if (existsSync(downloadPath)) {
            unlinkSync(downloadPath);
        }
    } else if (downloadPath.endsWith('.vpk')) {
        // Direct VPK download
        installedVpks = [fileName];
    }

    // Save metadata for each installed VPK
    console.log(`[downloadMod] Saving metadata for ${installedVpks.length} VPKs`);
    for (const vpkFileName of installedVpks) {
        console.log(`[downloadMod] Saving metadata for: ${vpkFileName}`);
        setModMetadata(vpkFileName, metadata);
    }

    // Notify completion
    console.log(`[downloadMod] Sending download-complete event`);
    mainWindow?.webContents.send('download-complete', { modId, fileId });
}
