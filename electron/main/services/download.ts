import { createWriteStream, existsSync, constants } from 'fs';
import { promises as fs, statSync } from 'fs';
import { join, basename, extname, resolve } from 'path';
import { tmpdir } from 'os';
import { BrowserWindow } from 'electron';
import { getDisabledPath } from './deadlock';
import { extractArchive, isArchive, checkOneClickOptOut, scanSuspiciousFiles } from './extract';
import { randomUUID } from 'crypto';
import { setModMetadataWithHash, getModMetadata } from './metadata';
import { inferHeroFromTitle } from '@grimoire/social-types/heroes';
import { fetchModDetails, GameBananaModDetails } from './gamebanana';
import { makeDisabledFileName, scanMods, disableMod, enableMod } from './mods';
import { validateDownloadUrl, validateFileSize } from './security';
import { loadSettings } from './settings';
import { getVpkLabels, inferHeroFromVpk } from './vpk';
import https from 'https';
import http from 'http';

export interface DownloadModArgs {
    modId: number;
    fileId: number;
    fileName: string;
    section?: string;
    categoryId?: number;
}

export interface DownloadInstallResult {
    installedVpks: string[];
}

export interface OneClickInstallArgs {
    archiveUrl: string;
    modType?: string;
    modId?: number;
    /** Optional pre-fetched details — avoids re-hitting the GB API. */
    enrichedDetails?: GameBananaModDetails;
}

/**
 * Strip the trailing archive extension from a GameBanana filename so we keep
 * a clean stem to use as a label fallback. Case-insensitive; leaves the rest
 * of the name untouched (underscores etc. survive — the picker can prettify).
 */
function stripArchiveExtension(name: string): string {
    return name.replace(/\.(zip|7z|rar|vpk)$/i, '').trim();
}

/**
 * GameBanana's per-file download URLs are `/dl/<fileId>` (or `/mmdl/<fileId>`).
 * The trailing path segment IS the file id, so we can recover it deterministically
 * from the archive URL handed to the 1-click protocol — no enrichment, no header
 * parsing required. Returns undefined when the URL isn't shaped like a GB
 * file-download endpoint.
 */
function extractGameBananaFileIdFromUrl(url: string): number | undefined {
    try {
        const parsed = new URL(url);
        if (!parsed.hostname.endsWith('gamebanana.com')) return undefined;
        const segments = parsed.pathname.split('/').filter(Boolean);
        const last = segments[segments.length - 1];
        if (!last) return undefined;
        const id = parseInt(last, 10);
        return Number.isFinite(id) && id > 0 ? id : undefined;
    } catch {
        return undefined;
    }
}

/**
 * Pull the filename out of an HTTP Content-Disposition header. Handles both
 * RFC 5987 `filename*=UTF-8''...` (preferred when present, supports unicode)
 * and the older `filename="..."` form. Returns undefined if neither is
 * present or the value is empty after decoding. Used by 1-click installs to
 * recover the canonical archive name when the URL itself doesn't include it.
 */
function parseContentDispositionFilename(header: string): string | undefined {
    const rfc5987 = /filename\*\s*=\s*([^']*)'[^']*'([^;]+)/i.exec(header);
    if (rfc5987) {
        try {
            const decoded = decodeURIComponent(rfc5987[2].trim()).replace(/^"|"$/g, '');
            if (decoded.length > 0) return decoded;
        } catch { /* fall through */ }
    }
    const legacy = /filename\s*=\s*"?([^";]+)"?/i.exec(header);
    if (legacy) {
        const value = legacy[1].trim();
        if (value.length > 0) return value;
    }
    return undefined;
}

async function createDownloadWorkDir(): Promise<string> {
    return fs.mkdtemp(join(tmpdir(), 'grimoire-download-'));
}

async function cleanupDownloadWorkDir(workDir: string): Promise<void> {
    try {
        await fs.rm(workDir, { recursive: true, force: true });
    } catch (err) {
        console.warn(`[download] Failed to clean temporary download folder ${workDir}:`, err);
    }
}

function normalizePathForCompare(filePath: string): string {
    const normalized = resolve(filePath);
    return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

/**
 * Per-VPK lockerHero stamp. Skin downloads ride on their GameBanana
 * categoryId so this is a no-op for them. For Sound mods we prefer the
 * caller's title-inferred lockerHero (cheap, already computed), and only
 * fall back to cracking the VPK open when title inference missed.
 * Sound mods with creative titles ("King Vondicta", "Low Honor kills...")
 * still tag correctly because the underlying paths reference Source 2
 * codenames like `hornet` / `inferno` / `synth`.
 */
function stampVpkLockerHero<T extends { lockerHero?: string; lockerHeroSource?: import('../../../src/types/mod').LockerHeroSource }>(
    base: T,
    section: string | undefined,
    vpkPath: string
): T {
    if (base.lockerHero || section !== 'Sound') return base;
    try {
        const vpkHero = inferHeroFromVpk(vpkPath);
        if (vpkHero) return { ...base, lockerHero: vpkHero, lockerHeroSource: 'download-vpk' };
    } catch (err) {
        console.warn(`[download] VPK hero inference failed for ${vpkPath}:`, err);
    }
    return base;
}

async function moveFileWithoutOverwrite(sourcePath: string, destinationPath: string): Promise<void> {
    if (normalizePathForCompare(sourcePath) === normalizePathForCompare(destinationPath)) {
        return;
    }

    if (existsSync(destinationPath)) {
        throw new Error(`Refusing to overwrite existing mod file: ${basename(destinationPath)}`);
    }

    try {
        await fs.rename(sourcePath, destinationPath);
    } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'EXDEV') {
            throw err;
        }

        await fs.copyFile(sourcePath, destinationPath, constants.COPYFILE_EXCL);
        await fs.unlink(sourcePath);
    }
}

// Download queue to prevent race conditions with VPK priority assignment
interface QueuedDownload {
    deadlockPath: string;
    args: DownloadModArgs;
    directUrl?: string;
    enrichedDetails?: GameBananaModDetails;
    mainWindow: BrowserWindow | null;
    resolve: (result: DownloadInstallResult) => void;
    reject: (error: Error) => void;
}

const downloadQueue: QueuedDownload[] = [];
let isProcessingQueue = false;
let currentDownloadInfo: { modId: number; fileId: number; fileName: string } | null = null;

// Cancellation handle for the in-flight phase of the current download. The
// active phase (HTTP fetch, multi-VPK picker prompt) installs a teardown
// function here; cancelActiveDownload() invokes it. Only one phase is active
// at a time, so a single slot is enough.
let currentCancelHandler: (() => void) | null = null;

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
): Promise<DownloadInstallResult> {
    // Dedup at (modId, fileId), not modId alone: a single submission can have
    // multiple files (Gold/Silver variants, lite/HD versions) and profile
    // imports legitimately queue several of them back-to-back. Also check the
    // in-progress download — handleConfirm fires its calls in one tick, so
    // call N+1 races against processQueue having already shifted call N out.
    const sameTarget = (q: QueuedDownload) =>
        q.args.modId === args.modId && q.args.fileId === args.fileId;
    if (downloadQueue.some(sameTarget)) {
        console.log(`[downloadMod] Mod ${args.modId} file ${args.fileId} already queued, skipping`);
        return Promise.resolve({ installedVpks: [] });
    }
    if (
        currentDownloadInfo?.modId === args.modId &&
        currentDownloadInfo?.fileId === args.fileId
    ) {
        console.log(`[downloadMod] Mod ${args.modId} file ${args.fileId} already downloading, skipping`);
        return Promise.resolve({ installedVpks: [] });
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
): Promise<DownloadInstallResult> {
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
        return Promise.resolve({ installedVpks: [] });
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
            const result = item.directUrl
                ? await executeOneClickDownload(
                    item.deadlockPath,
                    item.args,
                    item.directUrl,
                    item.enrichedDetails,
                    item.mainWindow
                )
                : await executeDownload(item.deadlockPath, item.args, item.mainWindow);
            item.resolve(result);
        } catch (error) {
            const err = error instanceof Error ? error : new Error(String(error));
            // Surface user-cancellation so the renderer can clear the row.
            // The multi-VPK-picker cancel path already emits download-error
            // itself; this only covers HTTP-phase cancels which don't.
            if (err.message === 'CANCELLED_BY_USER') {
                item.mainWindow?.webContents.send('download-error', {
                    modId: item.args.modId,
                    fileId: item.args.fileId,
                    errorCode: 'CANCELLED_BY_USER',
                    message: 'Download cancelled.',
                });
            }
            item.reject(err);
        }
        currentCancelHandler = null;
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
    responseTimeoutMs = 600000, // 10 minutes for large files
    onResponseFilename?: (filename: string) => void
): Promise<void> {
    return new Promise((resolve, reject) => {
        const protocol = url.startsWith('https') ? https : http;
        let connectionTimedOut = false;
        let responseTimedOut = false;
        let userCancelled = false;
        let settled = false;
        let fileStream: ReturnType<typeof createWriteStream> | null = null;

        // Wrap resolve/reject so a duplicate completion (e.g. cancel races
        // against a normal finish event) only fires the outer promise once.
        const finalize = (err: Error | null) => {
            if (settled) return;
            settled = true;
            if (err) reject(err);
            else resolve();
        };

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
                    downloadFile(redirectUrl, destPath, onProgress, connectionTimeoutMs, responseTimeoutMs, onResponseFilename)
                        .then(resolve)
                        .catch(reject);
                    return;
                }
            }

            if (response.statusCode !== 200) {
                finalize(new Error(`Download failed with status ${response.statusCode}`));
                return;
            }

            // GameBanana's /mmdl/<id> and /dl/<id> URLs don't carry the archive
            // filename in the path, but the final response sets it via
            // Content-Disposition. Surface it so 1-click installs can match the
            // local archive against the GB file list by canonical name.
            const disposition = response.headers['content-disposition'];
            if (disposition && onResponseFilename) {
                const parsed = parseContentDispositionFilename(disposition);
                if (parsed) onResponseFilename(parsed);
            }

            const totalSize = parseInt(response.headers['content-length'] || '0', 10);
            let downloadedSize = 0;
            let lastProgressTime = Date.now();

            fileStream = createWriteStream(destPath);
            const stream = fileStream;

            // Set up response timeout - reset on each data chunk
            const checkStall = setInterval(() => {
                if (Date.now() - lastProgressTime > 60000) { // 1 minute without data
                    responseTimedOut = true;
                    request.destroy();
                    stream.close();
                    clearInterval(checkStall);
                    finalize(new Error('Download stalled - no data received for 60 seconds'));
                }
            }, 10000);

            response.on('data', (chunk: Buffer) => {
                downloadedSize += chunk.length;
                lastProgressTime = Date.now();
                onProgress(downloadedSize, totalSize);
            });

            response.pipe(stream);

            stream.on('finish', () => {
                clearInterval(checkStall);
                stream.close();
                currentCancelHandler = null;
                finalize(null);
            });

            stream.on('error', async (err) => {
                clearInterval(checkStall);
                stream.close();
                currentCancelHandler = null;
                if (existsSync(destPath)) {
                    await fs.unlink(destPath).catch(() => { });
                }
                if (userCancelled) {
                    finalize(new Error('CANCELLED_BY_USER'));
                    return;
                }
                finalize(err);
            });
        });

        // Connection timeout - waiting for initial response
        const connectionTimeoutId = setTimeout(() => {
            connectionTimedOut = true;
            request.destroy();
            finalize(new Error(`Download connection timed out after ${connectionTimeoutMs / 1000} seconds`));
        }, connectionTimeoutMs);

        request.on('error', (err) => {
            clearTimeout(connectionTimeoutId);
            currentCancelHandler = null;
            if (connectionTimedOut || responseTimedOut) return;
            if (userCancelled) {
                finalize(new Error('CANCELLED_BY_USER'));
                return;
            }
            finalize(err);
        });

        // Register the cancel handler. request.destroy() alone is not enough:
        // when the response is mid-pipe to fileStream, destroying the request
        // may leave the write stream in a state where neither 'finish' nor
        // 'error' fires, so the outer promise stays pending. Tear both down
        // and reject explicitly.
        currentCancelHandler = () => {
            if (userCancelled) return;
            userCancelled = true;
            clearTimeout(connectionTimeoutId);
            try { request.destroy(); } catch { /* already gone */ }
            if (fileStream) {
                try { fileStream.destroy(); } catch { /* already gone */ }
            }
            // Best-effort cleanup of the partial file. The stream 'error'
            // handler also tries, but if the stream never fires we'd leak
            // the partial.
            if (existsSync(destPath)) {
                fs.unlink(destPath).catch(() => { });
            }
            finalize(new Error('CANCELLED_BY_USER'));
        };
    });
}

/**
 * Stage extracted VPKs into the disabled folder under free-form, unique names
 * (async). New mods are installed disabled and a disabled mod holds no pakNN
 * load-order slot, so installs don't consume the 99 enabled slots and the
 * library is effectively uncapped. A real pakNN slot is assigned later, on
 * enable. Returns the final filenames.
 */
async function renameVpksToAvoidConflicts(
    _deadlockPath: string,
    targetPath: string,
    extractedVpks: string[],
    nameHint?: string
): Promise<string[]> {
    const taken = existsSync(targetPath)
        ? new Set((await fs.readdir(targetPath)).map((n) => n.toLowerCase()))
        : new Set<string>();
    const renamedFiles: string[] = [];

    for (const vpkPath of extractedVpks) {
        const fileName = basename(vpkPath);
        // Prefer the extracted VPK's own descriptive name; for bare pakNN
        // downloads fall back to the mod's GameBanana name so the disabled file
        // is still readable on disk.
        const finalFileName = makeDisabledFileName(fileName, taken, nameHint);
        taken.add(finalFileName.toLowerCase());

        if (finalFileName !== fileName) {
            console.log(`[renameVpks] Installing ${fileName} as ${finalFileName} (disabled)`);
        }

        await moveFileWithoutOverwrite(vpkPath, join(targetPath, finalFileName));
        renamedFiles.push(finalFileName);
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
): Promise<DownloadInstallResult> {
    const { modId, fileId, fileName, section = 'Mod' } = args;

    console.log(`[downloadMod] Starting download: modId=${modId}, fileId=${fileId}, fileName=${fileName}`);

    // Get mod details to find download URL
    const details: GameBananaModDetails = await fetchModDetails(modId, section);

    if (!details.files || details.files.length === 0) {
        throw new Error(
            'This mod has no downloadable files on GameBanana. It may have been ' +
            'revoked (copyright, moderation) or the author removed the file. ' +
            'The catalog entry will clear on the next sync.'
        );
    }

    const file = details.files.find((f) => f.id === fileId);
    if (!file) {
        throw new Error(
            'The specific file Grimoire had cached for this mod is no longer on ' +
            'GameBanana (likely revoked or replaced). Open the mod page in Browse ' +
            'and pick a current file, or refresh the catalog.'
        );
    }

    // Validate download URL before proceeding (P0 security fix)
    validateDownloadUrl(file.downloadUrl);

    // Stage downloads before moving them into the disabled folder so an
    // incoming pakNN file cannot overwrite an existing mod before we rename it.
    const targetPath = getDisabledPath(deadlockPath);
    const workDir = await createDownloadWorkDir();
    const downloadPath = join(workDir, basename(fileName));

    try {
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

    // GameBanana lets mod authors label each file (e.g. "Gold w/ alt candle").
    // Persist that header so the variant picker can show meaningful names by
    // default — much friendlier than raw VPK filenames. Trim because the
    // upstream field occasionally has surrounding whitespace.
    const selectedFile = details.files?.find((f) => f.id === fileId);
    const fileDescription = selectedFile?.description?.trim();
    // Many mod authors leave file descriptions blank, so also capture the
    // GB filename stem (e.g. "galaxy_rem_gold.zip" → "galaxy_rem_gold").
    // This becomes the picker's second-line fallback so variants get a
    // meaningful label even when the description is empty.
    const sourceFileNameStem = stripArchiveExtension(fileName);

    // Auto-tag Sound mods with their hero so they show up in the per-hero
    // Locker view. Sound mods don't have hero categoryIds on GameBanana, so the
    // mod title is the only signal we have. Skin downloads keep their explicit
    // categoryId and don't need this fallback.
    const lockerHero =
        section === 'Sound' ? inferHeroFromTitle(details.name) ?? undefined : undefined;
    const lockerHeroSource = lockerHero ? 'download-title' : undefined;

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
        isArchived: selectedFile?.isArchived ?? false,
        fileDescription: fileDescription && fileDescription.length > 0 ? fileDescription : undefined,
        sourceFileName: sourceFileNameStem.length > 0 ? sourceFileNameStem : undefined,
        lockerHero,
        lockerHeroSource,
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
            extractedVpks = await extractArchive(downloadPath, workDir);
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
        installedVpks = await renameVpksToAvoidConflicts(deadlockPath, targetPath, extractedVpks, details.name);

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
            // Multi-VPK archive (Warden Remodel et al). Previously kept only
            // the alphabetically-first VPK and silently unlinked the rest —
            // user feedback flagged that as data-loss-feeling. Now we prompt
            // when there's more than one and let the user pick which to keep.
            installedVpks.sort((a, b) => a.localeCompare(b));
            if (installedVpks.length > 1) {
                const pickRequestId = randomUUID();
                const vpkLabels = getVpkLabels(
                    installedVpks.map((vpk) => ({ fileName: vpk, absPath: join(targetPath, vpk) }))
                );
                const pick = await awaitMultiVpkPick(
                    pickRequestId,
                    details.name ?? fileName,
                    installedVpks,
                    vpkLabels,
                    mainWindow
                );
                if (!pick || pick.selected.length === 0) {
                    // Cancelled — wipe everything we extracted plus the archive.
                    for (const vpk of installedVpks) {
                        const extraPath = join(targetPath, vpk);
                        if (existsSync(extraPath)) {
                            await fs.unlink(extraPath).catch(() => { });
                        }
                    }
                    if (existsSync(downloadPath)) {
                        await fs.unlink(downloadPath).catch(() => { });
                    }
                    installedVpks = [];
                    mainWindow?.webContents.send('download-error', {
                        modId,
                        fileId,
                        errorCode: 'CANCELLED_BY_USER',
                        message: 'Install cancelled.',
                    });
                    throw new Error('User cancelled multi-VPK pick');
                }
                const selectedSet = new Set(pick.selected);
                for (const vpk of installedVpks) {
                    if (!selectedSet.has(vpk)) {
                        const extraPath = join(targetPath, vpk);
                        if (existsSync(extraPath)) {
                            await fs.unlink(extraPath);
                        }
                    }
                }
                installedVpks = installedVpks.filter((vpk) => selectedSet.has(vpk));
            }
            // Single-VPK case: nothing to do — keep as-is.
        }

        // Clean up archive
        if (existsSync(downloadPath)) {
            await fs.unlink(downloadPath);
        }
    } else if (extname(downloadPath).toLowerCase() === '.vpk') {
        // Direct VPK download
        installedVpks = await renameVpksToAvoidConflicts(deadlockPath, targetPath, [downloadPath], details.name);
    }

    // Save metadata for each installed VPK
    console.log(`[downloadMod] Saving metadata for ${installedVpks.length} VPKs`);
    for (const vpkFileName of installedVpks) {
        console.log(`[downloadMod] Saving metadata for: ${vpkFileName}`);
        const vpkPath = join(targetPath, vpkFileName);
        const perVpkMetadata = stampVpkLockerHero(metadata, section, vpkPath);
        await setModMetadataWithHash(vpkFileName, perVpkMetadata, vpkPath);
    }

    // Switching variants: when the user installs a different file of a mod they
    // already have enabled, disable the previously-enabled sibling so only the
    // new pick is active. Avoids file-conflict warnings between sibling variants
    // (they usually touch the same in-game files). This only matters for non-
    // update installs (Browse, one-click, collection import); the explicit
    // update paths delete the old file before downloading, so there is no
    // enabled sibling left for this to act on.
    // Opt-out: settings.autoDisableSiblingVariants = false keeps every variant
    // enabled (e.g. a mod page whose separate files are meant to run together).
    const settings = loadSettings();
    if (settings.autoDisableSiblingVariants !== false) {
        try {
            const installedSet = new Set(installedVpks);
            const allMods = await scanMods(deadlockPath);
            // scanMods returns filesystem state only; gameBananaId and
            // gameBananaFileId live in the metadata sidecar (enriched at
            // the IPC boundary by enrichMod). Read them per-mod here or the
            // filter never matches and no sibling variants ever get disabled.
            const stalePeers = allMods.filter((m) => {
                if (!m.enabled) return false;
                if (installedSet.has(m.fileName)) return false;
                const meta = getModMetadata(m.fileName);
                return (
                    meta?.gameBananaId === modId &&
                    meta?.gameBananaFileId !== fileId
                );
            });
            const disabledPeers: Array<{ id: string; name: string; fileName: string }> = [];
            for (const peer of stalePeers) {
                console.log(`[downloadMod] Auto-disabling sibling variant: ${peer.fileName}`);
                await disableMod(deadlockPath, peer.id);
                disabledPeers.push({ id: peer.id, name: peer.name, fileName: peer.fileName });
            }
            // Downloads land in /disabled by default, so just disabling the
            // previously-enabled sibling would leave the mod entirely off
            // ("the newest pick is the active one" in the surrounding comment
            // requires actually promoting the new pick). When we kick an
            // enabled variant, move the freshly-downloaded VPK(s) into the
            // addons folder so the user ends up with the new variant active.
            if (disabledPeers.length > 0 && installedVpks.length > 0) {
                const refreshed = await scanMods(deadlockPath);
                for (const vpkFileName of installedVpks) {
                    const newMod = refreshed.find((m) => m.fileName === vpkFileName);
                    if (newMod && !newMod.enabled) {
                        try {
                            await enableMod(deadlockPath, newMod.id);
                        } catch (err) {
                            console.warn(`[downloadMod] Failed to enable new variant ${vpkFileName}:`, err);
                        }
                    }
                }
                mainWindow?.webContents.send('mods-auto-disabled', {
                    reason: 'sibling-variant',
                    modId,
                    fileId,
                    disabled: disabledPeers,
                });
            }
        } catch (err) {
            console.warn(`[downloadMod] Failed to auto-disable sibling variants:`, err);
        }
    }

    // Notify completion
    console.log(`[downloadMod] Sending download-complete event`);
    mainWindow?.webContents.send('download-complete', { modId, fileId });
    return { installedVpks };
    } finally {
        await cleanupDownloadWorkDir(workDir);
    }
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

// Multi-VPK picker decisions. The user picks which of N extracted VPKs to
// keep when an archive (e.g. Warden Remodel) contains more than one. Null
// means "cancel — discard everything".
const pendingVpkPicks = new Map<
    string,
    (decision: { selected: string[] } | null) => void
>();

/** Renderer-facing IPC entry point for multi-VPK picker responses. */
export function resolveMultiVpkPick(
    requestId: string,
    decision: { selected: string[] } | null
): void {
    const resolver = pendingVpkPicks.get(requestId);
    if (resolver) {
        resolver(decision);
        pendingVpkPicks.delete(requestId);
    }
}

/**
 * Ask the renderer which VPKs from a multi-VPK archive to keep. Returns the
 * subset the user wants to install, or null if they cancelled. Modal is
 * driven by a `multi-vpk-pick` event keyed on requestId.
 */
function awaitMultiVpkPick(
    requestId: string,
    modName: string,
    vpkFileNames: string[],
    vpkLabels: Record<string, string>,
    mainWindow: BrowserWindow | null
): Promise<{ selected: string[] } | null> {
    return new Promise((resolve) => {
        const wrappedResolve = (decision: { selected: string[] } | null) => {
            currentCancelHandler = null;
            resolve(decision);
        };
        pendingVpkPicks.set(requestId, wrappedResolve);
        // Toast cancel mid-picker resolves the same null-decision path the
        // picker modal's Cancel button uses, so the existing cleanup runs.
        currentCancelHandler = () => {
            pendingVpkPicks.delete(requestId);
            wrappedResolve(null);
        };
        mainWindow?.webContents.send('multi-vpk-pick', {
            requestId,
            modName,
            vpkFileNames,
            vpkLabels,
        });
    });
}

/**
 * Cancel the in-flight download phase (HTTP fetch or multi-VPK picker prompt)
 * for the currently-processing queue item. Returns true when a handler was
 * available and invoked. Safe no-op when nothing is in flight or the active
 * phase is non-cancellable (e.g. extracting, writing metadata).
 */
export function cancelActiveDownload(): boolean {
    if (!currentCancelHandler) return false;
    const handler = currentCancelHandler;
    currentCancelHandler = null;
    handler();
    return true;
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
): Promise<DownloadInstallResult> {
    const { modId, fileId, fileName, section = 'Mod' } = args;

    console.log(
        `[oneClickInstall] Starting: url=${archiveUrl}, modType=${section}, modId=${modId}`
    );

    validateDownloadUrl(archiveUrl);

    const targetPath = getDisabledPath(deadlockPath);
    const workDir = await createDownloadWorkDir();
    let downloadPath = join(workDir, basename(fileName));

    try {
    // Capture the canonical archive name from Content-Disposition. GB's 1-click
    // URL points at /mmdl/<id> which has no extension, so the URL-derived
    // fileName above is a generic placeholder; the response header carries the
    // real name (e.g. "bozzsilverv2.zip") which we use to match against the
    // mod's file list.
    let responseFilename: string | undefined;

    await downloadFile(
        archiveUrl,
        downloadPath,
        (downloaded, total) => {
            mainWindow?.webContents.send('download-progress', {
                modId,
                fileId,
                downloaded,
                total,
            });
        },
        undefined,
        undefined,
        (name) => {
            responseFilename = name;
        }
    );

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
    // GameBanana's grimoire:// protocol only carries the archive URL + mod id,
    // not the file id. Recover it by matching the URL (and falling back to the
    // filename, then to a sole file row) against the enriched file list so the
    // resulting variant carries the same gameBananaFileId a manual install
    // would. Without this, the file row in ModDetailsModal can't recognise the
    // 1-click variant as installed and a second click silently creates a
    // duplicate. The URL match is fragile in practice: the protocol passes
    // GB's user-facing download endpoint (mmdl/) while _sDownloadUrl is often
    // the file-redirect URL (dl/), so single-file mods fall through to the
    // positional match below.
    const enrichedFiles = enriched?.files ?? [];
    const urlFileId = extractGameBananaFileIdFromUrl(archiveUrl);
    let matchedFile =
        (urlFileId !== undefined
            ? enrichedFiles.find((f) => f.id === urlFileId)
            : undefined) ??
        (responseFilename
            ? enrichedFiles.find((f) => f.fileName === responseFilename)
            : undefined) ??
        enrichedFiles.find((f) => f.downloadUrl === archiveUrl) ??
        enrichedFiles.find((f) => f.fileName === fileName);
    if (!matchedFile && enrichedFiles.length === 1) {
        matchedFile = enrichedFiles[0];
    }
    // If we got the file id from the URL but enrichment was missing/failed,
    // still record it so per-file install state lights up — the label fields
    // will just fall back to URL/header-derived names.
    const resolvedFileId = matchedFile?.id ?? urlFileId;
    if (!matchedFile && enrichedFiles.length > 0) {
        console.warn(
            `[oneClickInstall] Could not match archiveUrl=${archiveUrl} (urlFileId=${urlFileId ?? '<none>'}, response=${responseFilename ?? '<none>'}, fileName=${fileName}) to any of ${enrichedFiles.length} GB file rows; gameBananaFileId=${resolvedFileId ?? '<none>'}.`
        );
    }
    const oneClickFileDescription = matchedFile?.description?.trim();
    const oneClickSourceFileName = stripArchiveExtension(
        matchedFile?.fileName ?? responseFilename ?? fileName
    );
    const oneClickModName = enriched?.name ?? fileName.replace(/\.(zip|7z|rar|vpk)$/i, '');
    const oneClickLockerHero =
        section === 'Sound' ? inferHeroFromTitle(oneClickModName) ?? undefined : undefined;
    const metadata = {
        modName: oneClickModName,
        gameBananaId: realModId,
        gameBananaFileId: resolvedFileId,
        categoryId: enriched?.category?.id,
        categoryName: enriched?.category?.name,
        thumbnailUrl,
        audioUrl: enriched?.previewMedia?.metadata?.audioUrl,
        sourceSection: section,
        nsfw: enriched?.nsfw,
        isArchived: matchedFile?.isArchived ?? false,
        fileDescription:
            oneClickFileDescription && oneClickFileDescription.length > 0
                ? oneClickFileDescription
                : undefined,
        sourceFileName: oneClickSourceFileName.length > 0 ? oneClickSourceFileName : undefined,
        lockerHero: oneClickLockerHero,
        lockerHeroSource: oneClickLockerHero ? 'download-title' : undefined,
    };

    let installedVpks: string[] = [];

    if (isArchive(downloadPath)) {
        mainWindow?.webContents.send('download-extracting', { modId, fileId });

        let extractedVpks: string[];
        try {
            extractedVpks = await extractArchive(downloadPath, workDir);
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

        installedVpks = await renameVpksToAvoidConflicts(deadlockPath, targetPath, extractedVpks, oneClickModName);

        // Multi-VPK 1-Click archive: prompt the user instead of silently
        // dropping all but the first entry. Same shape as the regular
        // download path so behavior is consistent across install entry points.
        installedVpks.sort((a, b) => a.localeCompare(b));
        if (installedVpks.length > 1) {
            const pickRequestId = randomUUID();
            const vpkLabels = getVpkLabels(
                installedVpks.map((vpk) => ({ fileName: vpk, absPath: join(targetPath, vpk) }))
            );
            const pick = await awaitMultiVpkPick(
                pickRequestId,
                enriched?.name ?? fileName,
                installedVpks,
                vpkLabels,
                mainWindow
            );
            if (!pick || pick.selected.length === 0) {
                for (const vpk of installedVpks) {
                    const extraPath = join(targetPath, vpk);
                    if (existsSync(extraPath)) {
                        await fs.unlink(extraPath).catch(() => { });
                    }
                }
                if (existsSync(downloadPath)) {
                    await fs.unlink(downloadPath).catch(() => { });
                }
                installedVpks = [];
                mainWindow?.webContents.send('download-error', {
                    modId,
                    fileId,
                    errorCode: 'CANCELLED_BY_USER',
                    message: 'Install cancelled.',
                });
                throw new Error('User cancelled multi-VPK pick');
            }
            const selectedSet = new Set(pick.selected);
            for (const vpk of installedVpks) {
                if (!selectedSet.has(vpk)) {
                    const extraPath = join(targetPath, vpk);
                    if (existsSync(extraPath)) {
                        await fs.unlink(extraPath);
                    }
                }
            }
            installedVpks = installedVpks.filter((vpk) => selectedSet.has(vpk));
        }

        if (existsSync(downloadPath)) {
            await fs.unlink(downloadPath);
        }
    } else if (extname(downloadPath).toLowerCase() === '.vpk') {
        installedVpks = await renameVpksToAvoidConflicts(deadlockPath, targetPath, [downloadPath], oneClickModName);
    }

    for (const vpkFileName of installedVpks) {
        const vpkPath = join(targetPath, vpkFileName);
        const perVpkMetadata = stampVpkLockerHero(metadata, section, vpkPath);
        await setModMetadataWithHash(vpkFileName, perVpkMetadata, vpkPath);
    }

    mainWindow?.webContents.send('download-complete', { modId, fileId });
    return { installedVpks };
    } finally {
        await cleanupDownloadWorkDir(workDir);
    }
}
