import { createWriteStream, existsSync } from 'fs';
import { promises as fs, statSync } from 'fs';
import { join, basename } from 'path';
import { BrowserWindow } from 'electron';
import { getAddonsPath, getDisabledPath } from './deadlock';
import { extractArchive, isArchive } from './extract';
import { setModMetadata } from './metadata';
import { fetchModDetails, GameBananaModDetails } from './gamebanana';
import { findNextAvailablePriority, getUsedPriorities } from './mods';
import { validateDownloadUrl, validateFileSize } from './security';
import https from 'https';
import http from 'http';

export interface DownloadModArgs {
    modId: number;
    fileId: number;
    fileName: string;
    section?: string;
    categoryId?: number;
}

// Download queue to prevent race conditions with VPK priority assignment
interface QueuedDownload {
    deadlockPath: string;
    args: DownloadModArgs;
    mainWindow: BrowserWindow | null;
    resolve: () => void;
    reject: (error: Error) => void;
}

const downloadQueue: QueuedDownload[] = [];
let isProcessingQueue = false;

/**
 * Add a download to the queue (public API)
 */
export function downloadMod(
    deadlockPath: string,
    args: DownloadModArgs,
    mainWindow: BrowserWindow | null
): Promise<void> {
    return new Promise((resolve, reject) => {
        downloadQueue.push({ deadlockPath, args, mainWindow, resolve, reject });
        processQueue();
    });
}

/**
 * Process the download queue one at a time
 */
async function processQueue(): Promise<void> {
    if (isProcessingQueue || downloadQueue.length === 0) {
        return;
    }

    isProcessingQueue = true;

    while (downloadQueue.length > 0) {
        const item = downloadQueue.shift()!;
        try {
            await executeDownload(item.deadlockPath, item.args, item.mainWindow);
            item.resolve();
        } catch (error) {
            item.reject(error instanceof Error ? error : new Error(String(error)));
        }
    }

    isProcessingQueue = false;
}

/**
 * Download a file with progress reporting
 * Includes timeouts to prevent indefinite hangs (P1 fix #5)
 */
async function downloadFile(
    url: string,
    destPath: string,
    onProgress: (downloaded: number, total: number) => void,
    connectionTimeoutMs = 30000,
    responseTimeoutMs = 600000 // 10 minutes for large files
): Promise<void> {
    return new Promise((resolve, reject) => {
        const protocol = url.startsWith('https') ? https : http;
        let connectionTimedOut = false;
        let responseTimedOut = false;

        const request = protocol.get(url, (response) => {
            // Clear connection timeout once we get a response
            clearTimeout(connectionTimeoutId);

            // Handle redirects - validate redirect URL too
            if (response.statusCode === 301 || response.statusCode === 302) {
                const redirectUrl = response.headers.location;
                if (redirectUrl) {
                    // Validate redirect URL (security: must be HTTPS and trusted domain)
                    try {
                        validateDownloadUrl(redirectUrl);
                    } catch {
                        // Allow game banana subdomains in redirects
                        const parsed = new URL(redirectUrl);
                        if (!parsed.hostname.endsWith('gamebanana.com')) {
                            reject(new Error(`Redirect to untrusted domain: ${parsed.hostname}`));
                            return;
                        }
                    }
                    downloadFile(redirectUrl, destPath, onProgress, connectionTimeoutMs, responseTimeoutMs)
                        .then(resolve)
                        .catch(reject);
                    return;
                }
            }

            if (response.statusCode !== 200) {
                reject(new Error(`Download failed with status ${response.statusCode}`));
                return;
            }

            const totalSize = parseInt(response.headers['content-length'] || '0', 10);
            let downloadedSize = 0;
            let lastProgressTime = Date.now();

            const fileStream = createWriteStream(destPath);

            // Set up response timeout - reset on each data chunk
            const checkStall = setInterval(() => {
                if (Date.now() - lastProgressTime > 60000) { // 1 minute without data
                    responseTimedOut = true;
                    request.destroy();
                    fileStream.close();
                    clearInterval(checkStall);
                    reject(new Error('Download stalled - no data received for 60 seconds'));
                }
            }, 10000);

            response.on('data', (chunk: Buffer) => {
                downloadedSize += chunk.length;
                lastProgressTime = Date.now();
                onProgress(downloadedSize, totalSize);
            });

            response.pipe(fileStream);

            fileStream.on('finish', () => {
                clearInterval(checkStall);
                fileStream.close();
                resolve();
            });

            fileStream.on('error', async (err) => {
                clearInterval(checkStall);
                fileStream.close();
                if (existsSync(destPath)) {
                    await fs.unlink(destPath).catch(() => { });
                }
                reject(err);
            });
        });

        // Connection timeout - waiting for initial response
        const connectionTimeoutId = setTimeout(() => {
            connectionTimedOut = true;
            request.destroy();
            reject(new Error(`Download connection timed out after ${connectionTimeoutMs / 1000} seconds`));
        }, connectionTimeoutMs);

        request.on('error', (err) => {
            clearTimeout(connectionTimeoutId);
            if (connectionTimedOut || responseTimedOut) return;
            reject(err);
        });
    });
}

/**
 * Rename VPK files to avoid priority conflicts (async)
 * Checks BOTH addons AND disabled folders to avoid overwriting disabled mods
 * Returns the list of renamed VPK filenames
 */
async function renameVpksToAvoidConflicts(
    deadlockPath: string,
    targetPath: string,
    extractedVpks: string[]
): Promise<string[]> {
    // Get used priorities from BOTH addons and disabled folders
    const usedPriorities = await getUsedPriorities(deadlockPath);
    const renamedFiles: string[] = [];

    const getNextAvailablePriority = () => {
        let newPriority = 1;
        while (usedPriorities.has(newPriority) && newPriority < 99) {
            newPriority++;
        }
        if (newPriority >= 99 && usedPriorities.has(99)) {
            throw new Error('No available priority slots (all 1-99 are used)');
        }
        return newPriority;
    };

    for (const vpkPath of extractedVpks) {
        const fileName = basename(vpkPath);
        // Check if this VPK has a priority that conflicts
        const match = fileName.match(/^pak(\d{2})_/);
        if (match) {
            const currentPriority = parseInt(match[1], 10);

            if (usedPriorities.has(currentPriority)) {
                const newPriority = getNextAvailablePriority();
                const newFileName = `pak${String(newPriority).padStart(2, '0')}_dir.vpk`;
                const newPath = join(targetPath, newFileName);

                console.log(`[renameVpks] Renaming ${fileName} to ${newFileName} to avoid conflict`);
                await fs.rename(vpkPath, newPath);
                usedPriorities.add(newPriority);
                renamedFiles.push(newFileName);
                continue;
            }

            usedPriorities.add(currentPriority);
            renamedFiles.push(fileName);
            continue;
        }

        const newPriority = getNextAvailablePriority();
        const newFileName = `pak${String(newPriority).padStart(2, '0')}_dir.vpk`;
        const newPath = join(targetPath, newFileName);

        console.log(`[renameVpks] Renaming ${fileName} to ${newFileName} to add priority`);
        await fs.rename(vpkPath, newPath);
        usedPriorities.add(newPriority);
        renamedFiles.push(newFileName);
    }

    return renamedFiles;
}

/**
 * Execute the actual download (internal, called from queue)
 */
async function executeDownload(
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

    // Validate download URL before proceeding (P0 security fix)
    validateDownloadUrl(file.downloadUrl);

    // Download to disabled folder by default so it doesn't auto-apply
    const targetPath = getDisabledPath(deadlockPath);
    const downloadPath = join(targetPath, fileName);

    console.log(`[downloadMod] Downloading to: ${downloadPath}`);

    // Download with progress
    const expectedSize = file.fileSize || 0;
    await downloadFile(file.downloadUrl, downloadPath, (downloaded, total) => {
        mainWindow?.webContents.send('download-progress', {
            modId,
            fileId,
            downloaded,
            total,
        });
    });

    // Verify file size after download (P0 security fix)
    try {
        const actualSize = statSync(downloadPath).size;
        validateFileSize(expectedSize, actualSize);
    } catch (sizeError) {
        // Clean up failed download
        if (existsSync(downloadPath)) {
            await fs.unlink(downloadPath).catch(() => { });
        }
        throw sizeError;
    }

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
        nsfw: details.nsfw,  // Use actual NSFW flag from GameBanana
    };

    let installedVpks: string[] = [];

    // Detect if this is a Midnight Mina mod that needs special handling
    const isMidnightMina =
        fileName.toLowerCase().includes('midnight_mina') ||
        fileName.toLowerCase().includes('midnight mina') ||
        details.name?.toLowerCase().includes('midnight mina');

    // Extract if archive
    if (isArchive(downloadPath)) {
        console.log(`[downloadMod] Extracting archive...`);
        mainWindow?.webContents.send('download-extracting', { modId, fileId });

        let extractedVpks: string[];
        try {
            extractedVpks = await extractArchive(downloadPath, targetPath);
        } catch (extractError) {
            const errorMsg = extractError instanceof Error ? extractError.message : String(extractError);

            // Check if this is a 7-Zip related error
            const is7zError = errorMsg.includes("7z") ||
                errorMsg.includes("7-Zip") ||
                errorMsg.includes("p7zip") ||
                errorMsg.includes("unrar");

            // Emit download-error event with structured info
            mainWindow?.webContents.send('download-error', {
                modId,
                fileId,
                errorCode: is7zError ? 'MISSING_7ZIP' : 'EXTRACTION_FAILED',
                message: is7zError
                    ? '7-Zip is required to extract this mod. Please install it from https://7-zip.org and restart the app.'
                    : `Failed to extract mod: ${errorMsg}`,
            });

            // Clean up failed download
            if (existsSync(downloadPath)) {
                await fs.unlink(downloadPath).catch(() => { });
            }

            throw extractError;
        }
        console.log(`[downloadMod] Extracted ${extractedVpks.length} VPK files:`, extractedVpks);

        // Rename VPKs to avoid conflicts
        installedVpks = await renameVpksToAvoidConflicts(deadlockPath, targetPath, extractedVpks);

        if (isMidnightMina && installedVpks.length > 1) {
            // Special handling for Midnight Mina:
            // - Keep the textures VPK (required for all variants)
            // - Keep ONE preset VPK (so it works out of the box)
            // - User can select other presets via the Custom Variants UI
            console.log(`[downloadMod] Midnight Mina detected, filtering VPKs...`);

            const textureVpks = installedVpks.filter(vpk =>
                vpk.toLowerCase().includes('textures')
            );
            const presetVpks = installedVpks.filter(vpk =>
                !vpk.toLowerCase().includes('textures')
            );

            // Sort presets and keep only the first one
            presetVpks.sort((a, b) => a.localeCompare(b));
            const [primaryPreset, ...extraPresets] = presetVpks;

            // Keep textures + one preset
            installedVpks = [...textureVpks];
            if (primaryPreset) {
                installedVpks.push(primaryPreset);
            }

            console.log(`[downloadMod] Keeping: ${installedVpks.join(', ')}`);

            // Delete extra presets
            for (const extraVpk of extraPresets) {
                const extraPath = join(targetPath, extraVpk);
                if (existsSync(extraPath)) {
                    console.log(`[downloadMod] Removing extra preset: ${extraVpk}`);
                    await fs.unlink(extraPath);
                }
            }
        } else if (!isMidnightMina) {
            // Standard behavior: keep only the first VPK
            installedVpks.sort((a, b) => a.localeCompare(b));
            const [primaryVpk, ...extraVpks] = installedVpks;
            installedVpks = primaryVpk ? [primaryVpk] : [];
            for (const extraVpk of extraVpks) {
                const extraPath = join(targetPath, extraVpk);
                if (existsSync(extraPath)) {
                    await fs.unlink(extraPath);
                }
            }
        }

        // Clean up archive
        if (existsSync(downloadPath)) {
            await fs.unlink(downloadPath);
        }
    } else if (downloadPath.endsWith('.vpk')) {
        // Direct VPK download
        installedVpks = await renameVpksToAvoidConflicts(deadlockPath, targetPath, [downloadPath]);
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
