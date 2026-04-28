import { createWriteStream, existsSync } from 'fs';
import { promises as fs, statSync } from 'fs';
import { join, basename, extname } from 'path';
import { BrowserWindow } from 'electron';
import { getDisabledPath } from './deadlock';
import { extractArchive, isArchive, checkOneClickOptOut, scanSuspiciousFiles } from './extract';
import { randomUUID } from 'crypto';
import { setModMetadata } from './metadata';
import { fetchModDetails, GameBananaModDetails } from './gamebanana';
import { getUsedPriorities } from './mods';
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

export interface OneClickInstallArgs {
    archiveUrl: string;
    modType?: string;
    modId?: number;
    /** Optional pre-fetched details — avoids re-hitting the GB API. */
    enrichedDetails?: GameBananaModDetails;
}

// Download queue to prevent race conditions with VPK priority assignment
interface QueuedDownload {
    deadlockPath: string;
    args: DownloadModArgs;
    directUrl?: string;
    enrichedDetails?: GameBananaModDetails;
    mainWindow: BrowserWindow | null;
    resolve: () => void;
    reject: (error: Error) => void;
}

const downloadQueue: QueuedDownload[] = [];
let isProcessingQueue = false;
let currentDownloadInfo: { modId: number; fileId: number; fileName: string } | null = null;

/**
 * Get the current download queue state for UI display
 */
export function getDownloadQueue(): Array<{ modId: number; fileId: number; fileName: string }> {
    return downloadQueue.map(item => ({
        modId: item.args.modId,
        fileId: item.args.fileId,
        fileName: item.args.fileName,
    }));
}

/**
 * Get the currently downloading item
 */
export function getCurrentDownload(): { modId: number; fileId: number; fileName: string } | null {
    return currentDownloadInfo;
}

/**
 * Remove a mod from the queue (cancel before download starts)
 */
export function removeFromQueue(modId: number): boolean {
    const index = downloadQueue.findIndex(item => item.args.modId === modId);
    if (index !== -1) {
        const removed = downloadQueue.splice(index, 1)[0];
        removed.reject(new Error('Cancelled by user'));
        emitQueueUpdate();
        return true;
    }
    return false;
}

/**
 * Emit queue update event to all windows
 */
function emitQueueUpdate(): void {
    const windows = BrowserWindow.getAllWindows();
    const queueState = getDownloadQueue();
    for (const win of windows) {
        win.webContents.send('download-queue-updated', {
            queue: queueState,
            count: queueState.length,
            currentDownload: currentDownloadInfo,
        });
    }
}

/**
 * Add a download to the queue (public API)
 * Prevents duplicate mods from being queued
 */
export function downloadMod(
    deadlockPath: string,
    args: DownloadModArgs,
    mainWindow: BrowserWindow | null
): Promise<void> {
    // Check if this mod is already in the queue (prevent duplicates)
    const alreadyQueued = downloadQueue.some(q => q.args.modId === args.modId);
    if (alreadyQueued) {
        console.log(`[downloadMod] Mod ${args.modId} already in queue, skipping`);
        return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
        downloadQueue.push({ deadlockPath, args, mainWindow, resolve, reject });
        emitQueueUpdate();
        processQueue();
    });
}

/**
 * Queue a 1-Click install triggered by a `grimoire:` protocol URL.
 * Differs from downloadMod in that the archive URL is already known —
 * we skip the GameBanana file lookup and (optionally) enrich metadata
 * via fetchModDetails when modId+modType were passed in the URL.
 */
export function downloadModFromUrl(
    deadlockPath: string,
    oneClick: OneClickInstallArgs,
    mainWindow: BrowserWindow | null
): Promise<void> {
    validateDownloadUrl(oneClick.archiveUrl);

    const fileName = deriveFileNameFromUrl(oneClick.archiveUrl);
    // Use the real GB modId when available, otherwise a synthetic negative id
    // so the queue/UI can track this install without colliding with real mods.
    const modId = oneClick.modId ?? -Math.floor(Date.now() / 1000);
    const fileId = -1;

    const alreadyQueued = downloadQueue.some(
        (q) => q.directUrl === oneClick.archiveUrl
    );
    if (alreadyQueued) {
        console.log(`[downloadModFromUrl] Already queued: ${oneClick.archiveUrl}`);
        return Promise.resolve();
    }

    const args: DownloadModArgs = {
        modId,
        fileId,
        fileName,
        section: oneClick.modType ?? 'Mod',
    };

    return new Promise((resolve, reject) => {
        downloadQueue.push({
            deadlockPath,
            args,
            directUrl: oneClick.archiveUrl,
            enrichedDetails: oneClick.enrichedDetails,
            mainWindow,
            resolve,
            reject,
        });
        emitQueueUpdate();
        processQueue();
    });
}

function deriveFileNameFromUrl(url: string): string {
    try {
        const parsed = new URL(url);
        const segments = parsed.pathname.split('/').filter(Boolean);
        const last = segments[segments.length - 1];
        if (last && /\.(zip|7z|rar|vpk)$/i.test(last)) {
            return decodeURIComponent(last);
        }
        return `gamebanana-mod-${Date.now()}.zip`;
    } catch {
        return `gamebanana-mod-${Date.now()}.zip`;
    }
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
        // Track what's currently downloading
        currentDownloadInfo = {
            modId: item.args.modId,
            fileId: item.args.fileId,
            fileName: item.args.fileName,
        };
        emitQueueUpdate(); // Notify UI that queue changed and current download started
        try {
            if (item.directUrl) {
                await executeOneClickDownload(
                    item.deadlockPath,
                    item.args,
                    item.directUrl,
                    item.enrichedDetails,
                    item.mainWindow
                );
            } else {
                await executeDownload(item.deadlockPath, item.args, item.mainWindow);
            }
            item.resolve();
        } catch (error) {
            item.reject(error instanceof Error ? error : new Error(String(error)));
        }
        currentDownloadInfo = null;
    }

    isProcessingQueue = false;
    emitQueueUpdate(); // Final update when queue is empty
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
    const { modId, fileId, fileName, section = 'Mod' } = args;

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
        audioUrl: details.previewMedia?.metadata?.audioUrl,  // Persist for Sound mod preview
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

            // The bundled extractors should handle virtually all archives; if they
            // failed, the archive is likely corrupt or uses an exotic format. We
            // still surface 7-Zip as a fallback users can try.
            const is7zError = errorMsg.includes("7z") ||
                errorMsg.includes("7-Zip") ||
                errorMsg.includes("p7zip") ||
                errorMsg.includes("unrar") ||
                errorMsg.includes("RAR extraction failed");

            mainWindow?.webContents.send('download-error', {
                modId,
                fileId,
                errorCode: is7zError ? 'MISSING_7ZIP' : 'EXTRACTION_FAILED',
                message: is7zError
                    ? "Couldn't extract this mod. Install 7-Zip from https://7-zip.org and try again."
                    : `Failed to extract mod: ${errorMsg}`,
                helpUrl: is7zError ? 'https://7-zip.org' : undefined,
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

// Promises awaiting the user's decision on a suspicious-file modal. Keyed by
// requestId so the renderer can respond out-of-order or from any window.
const pendingSuspiciousDecisions = new Map<string, (accepted: boolean) => void>();

/** Renderer-facing IPC entry point: deliver the user's modal decision. */
export function resolveSuspiciousFileDecision(requestId: string, accepted: boolean): void {
    const resolver = pendingSuspiciousDecisions.get(requestId);
    if (resolver) {
        resolver(accepted);
        pendingSuspiciousDecisions.delete(requestId);
    }
}

function awaitSuspiciousDecision(
    requestId: string,
    modName: string,
    files: string[],
    mainWindow: BrowserWindow | null
): Promise<boolean> {
    return new Promise((resolve) => {
        pendingSuspiciousDecisions.set(requestId, resolve);
        mainWindow?.webContents.send('one-click-suspicious-files', {
            requestId,
            modName,
            files,
        });
    });
}

/**
 * Sniff archive format from magic bytes so we don't have to trust the URL's
 * extension. GameBanana's `/dl/<id>` redirects don't expose the real filename
 * to the URL parser, so a Bat Mina `.rar` would otherwise be fed to adm-zip.
 */
async function detectArchiveFormat(filePath: string): Promise<'zip' | '7z' | 'rar' | null> {
    const fd = await fs.open(filePath, 'r');
    try {
        const buf = Buffer.alloc(8);
        await fd.read(buf, 0, 8, 0);
        // ZIP: PK\x03\x04 (also empty/single-file variants PK\x05\x06, PK\x07\x08)
        if (buf[0] === 0x50 && buf[1] === 0x4b) return 'zip';
        // RAR4: "Rar!\x1A\x07\x00" / RAR5: "Rar!\x1A\x07\x01\x00" — both start "Rar!"
        if (buf[0] === 0x52 && buf[1] === 0x61 && buf[2] === 0x72 && buf[3] === 0x21) return 'rar';
        // 7z: "7z\xBC\xAF\x27\x1C"
        if (buf[0] === 0x37 && buf[1] === 0x7a && buf[2] === 0xbc && buf[3] === 0xaf) return '7z';
        return null;
    } finally {
        await fd.close();
    }
}

/**
 * Execute a 1-Click install: download a pre-resolved archive URL, run the
 * GameBanana opt-out check, extract VPKs, then optionally enrich the mod
 * metadata via the GB API if a modId was passed in the protocol URL.
 */
async function executeOneClickDownload(
    deadlockPath: string,
    args: DownloadModArgs,
    archiveUrl: string,
    enrichedDetails: GameBananaModDetails | undefined,
    mainWindow: BrowserWindow | null
): Promise<void> {
    const { modId, fileId, fileName, section = 'Mod' } = args;

    console.log(
        `[oneClickInstall] Starting: url=${archiveUrl}, modType=${section}, modId=${modId}`
    );

    validateDownloadUrl(archiveUrl);

    const targetPath = getDisabledPath(deadlockPath);
    let downloadPath = join(targetPath, fileName);

    await downloadFile(archiveUrl, downloadPath, (downloaded, total) => {
        mainWindow?.webContents.send('download-progress', {
            modId,
            fileId,
            downloaded,
            total,
        });
    });

    try {
        const actualSize = statSync(downloadPath).size;
        validateFileSize(0, actualSize);
    } catch (sizeError) {
        if (existsSync(downloadPath)) {
            await fs.unlink(downloadPath).catch(() => { });
        }
        throw sizeError;
    }

    // GameBanana's /dl/<id> URLs hide the real filename, so the extension we
    // synthesized from the URL is unreliable. Sniff magic bytes and rename
    // before extractArchive() (which dispatches on extension).
    const detected = await detectArchiveFormat(downloadPath);
    if (detected) {
        const correctExt = `.${detected}`;
        const currentExt = extname(downloadPath).toLowerCase();
        if (currentExt !== correctExt) {
            const renamed =
                (currentExt ? downloadPath.slice(0, -currentExt.length) : downloadPath) +
                correctExt;
            await fs.rename(downloadPath, renamed);
            downloadPath = renamed;
        }
    }

    // Honor GameBanana opt-out markers before touching the archive contents.
    if (isArchive(downloadPath)) {
        const optOut = await checkOneClickOptOut(downloadPath);
        if (optOut.disabled) {
            if (existsSync(downloadPath)) {
                await fs.unlink(downloadPath).catch(() => { });
            }
            mainWindow?.webContents.send('download-error', {
                modId,
                fileId,
                errorCode: 'DISABLED_BY_AUTHOR',
                message: optOut.reason ?? '1-Click install was disabled by the mod author.',
            });
            throw new Error(optOut.reason ?? '1-Click install disabled by mod author');
        }

        // GameBanana 1-Click spec: scan for suspicious files (executables /
        // scripts) and prompt the user before installing. The extract
        // pipeline already filters by extension so these files cannot reach
        // the game folder, but the prompt gives users transparency and the
        // chance to bail on a sketchy archive.
        const suspicious = await scanSuspiciousFiles(downloadPath);
        if (suspicious.length > 0) {
            const requestId = randomUUID();
            const displayName = enrichedDetails?.name ?? fileName;
            const accepted = await awaitSuspiciousDecision(
                requestId,
                displayName,
                suspicious,
                mainWindow
            );
            if (!accepted) {
                if (existsSync(downloadPath)) {
                    await fs.unlink(downloadPath).catch(() => { });
                }
                mainWindow?.webContents.send('download-error', {
                    modId,
                    fileId,
                    errorCode: 'CANCELLED_BY_USER',
                    message: 'Install cancelled — archive contained suspicious files.',
                });
                throw new Error('User cancelled install due to suspicious files');
            }
        }
    }

    // Use pre-fetched details from the protocol handler when present so we
    // don't double-hit the GB API. Fall back to a fetch only when the caller
    // didn't pre-fetch (e.g. future callers, or if the pre-fetch failed).
    let enriched: GameBananaModDetails | null = enrichedDetails ?? null;
    if (!enriched && args.modId !== undefined && args.modId > 0) {
        try {
            enriched = await fetchModDetails(args.modId, section);
        } catch (err) {
            console.warn('[oneClickInstall] Metadata enrichment failed:', err);
        }
    }

    const thumbnail = enriched?.previewMedia?.images?.[0];
    const thumbnailUrl = thumbnail
        ? `${thumbnail.baseUrl}/${thumbnail.file530 || thumbnail.file}`
        : undefined;

    const realModId = args.modId !== undefined && args.modId > 0 ? args.modId : undefined;
    const metadata = {
        modName: enriched?.name ?? fileName.replace(/\.(zip|7z|rar|vpk)$/i, ''),
        gameBananaId: realModId,
        categoryId: enriched?.category?.id,
        categoryName: enriched?.category?.name,
        thumbnailUrl,
        audioUrl: enriched?.previewMedia?.metadata?.audioUrl,
        sourceSection: section,
        nsfw: enriched?.nsfw,
    };

    let installedVpks: string[] = [];

    if (isArchive(downloadPath)) {
        mainWindow?.webContents.send('download-extracting', { modId, fileId });

        let extractedVpks: string[];
        try {
            extractedVpks = await extractArchive(downloadPath, targetPath);
        } catch (extractError) {
            const errorMsg =
                extractError instanceof Error ? extractError.message : String(extractError);
            const is7zError =
                errorMsg.includes('7z') ||
                errorMsg.includes('7-Zip') ||
                errorMsg.includes('p7zip') ||
                errorMsg.includes('unrar') ||
                errorMsg.includes('RAR extraction failed');

            mainWindow?.webContents.send('download-error', {
                modId,
                fileId,
                errorCode: is7zError ? 'MISSING_7ZIP' : 'EXTRACTION_FAILED',
                message: is7zError
                    ? "Couldn't extract this mod. Install 7-Zip from https://7-zip.org and try again."
                    : `Failed to extract mod: ${errorMsg}`,
                helpUrl: is7zError ? 'https://7-zip.org' : undefined,
            });

            if (existsSync(downloadPath)) {
                await fs.unlink(downloadPath).catch(() => { });
            }
            throw extractError;
        }

        installedVpks = await renameVpksToAvoidConflicts(deadlockPath, targetPath, extractedVpks);

        // Standard 1-Click behavior: keep only the first VPK to avoid
        // accidentally enabling many slots from a single archive.
        installedVpks.sort((a, b) => a.localeCompare(b));
        const [primaryVpk, ...extraVpks] = installedVpks;
        installedVpks = primaryVpk ? [primaryVpk] : [];
        for (const extraVpk of extraVpks) {
            const extraPath = join(targetPath, extraVpk);
            if (existsSync(extraPath)) {
                await fs.unlink(extraPath);
            }
        }

        if (existsSync(downloadPath)) {
            await fs.unlink(downloadPath);
        }
    } else if (downloadPath.endsWith('.vpk')) {
        installedVpks = await renameVpksToAvoidConflicts(deadlockPath, targetPath, [downloadPath]);
    }

    for (const vpkFileName of installedVpks) {
        setModMetadata(vpkFileName, metadata);
    }

    mainWindow?.webContents.send('download-complete', { modId, fileId });
}
