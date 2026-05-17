import { createHash } from 'crypto';
import { createReadStream, readFileSync, writeFileSync, existsSync, renameSync, unlinkSync } from 'fs';
import { promises as fs } from 'fs';
import { join } from 'path';
import { getAddonsPath, getDisabledPath } from './deadlock';
import { getMetadataPath } from '../utils/paths';

export interface ModMetadata {
    modName?: string;      // The human-readable mod name from GameBanana
    thumbnailUrl?: string;
    audioUrl?: string;     // GameBanana audio preview URL (Sound mods)
    gameBananaId?: number;
    gameBananaFileId?: number; // The specific file ID that was downloaded
    categoryId?: number;
    categoryName?: string; // Hero/category name from GameBanana
    sourceSection?: string;
    nsfw?: boolean;
    isArchived?: boolean;   // True when the downloaded GameBanana file is from the archived files list
    isMinaPreset?: boolean; // Flag for Mina presets we extracted from the 7z
    sha256?: string;       // SHA-256 hash of the installed VPK file contents
    variantLabel?: string;  // User-provided label to disambiguate variants of the same mod
    fileDescription?: string;  // GameBanana file "header" (_sDescription) — author's per-file label, used as fallback when the user hasn't named the variant
    sourceFileName?: string;   // Original GameBanana filename stem (e.g. "galaxy_rem_gold") — used as a label fallback when the author didn't set a file header
}

export type ModMetadataMap = Record<string, ModMetadata>;

/**
 * Load mod metadata from disk
 */
export function loadMetadata(): ModMetadataMap {
    const path = getMetadataPath();

    if (!existsSync(path)) {
        return {};
    }

    try {
        const content = readFileSync(path, 'utf-8');
        return JSON.parse(content) as ModMetadataMap;
    } catch (error) {
        console.warn('[Metadata] Failed to load metadata, returning empty:', error);
        return {};
    }
}

/**
 * Save mod metadata to disk atomically (P1 fix #8)
 * Uses write-to-temp-then-rename pattern to prevent corruption on crash
 */
export function saveMetadata(metadata: ModMetadataMap): void {
    const path = getMetadataPath();
    const tempPath = `${path}.tmp`;

    try {
        writeFileSync(tempPath, JSON.stringify(metadata, null, 2), 'utf-8');
        renameSync(tempPath, path);
    } catch (error) {
        try {
            if (existsSync(tempPath)) unlinkSync(tempPath);
        } catch { /* ignore */ }
        throw error;
    }
}

/**
 * Get metadata for a specific mod
 */
export function getModMetadata(fileName: string): ModMetadata | undefined {
    const metadata = loadMetadata();
    return metadata[fileName];
}

/**
 * Set metadata for a specific mod
 */
export function setModMetadata(fileName: string, data: ModMetadata): void {
    const metadata = loadMetadata();
    metadata[fileName] = { ...metadata[fileName], ...data };
    saveMetadata(metadata);
}

/**
 * Set metadata and attach a SHA-256 fingerprint for the installed VPK.
 * Callers pass the path because metadata is keyed by logical pak filename and
 * the same filename may exist in either addons or .disabled.
 */
export async function setModMetadataWithHash(
    fileName: string,
    data: ModMetadata,
    filePath: string
): Promise<void> {
    setModMetadata(fileName, {
        ...data,
        sha256: await hashFileSha256(filePath),
    });
}

/**
 * Backfill SHA-256 values for metadata written before hashes existed.
 * This runs without renaming/moving files; entries whose VPK no longer exists
 * are skipped and can still be pruned by the normal metadata cleanup path.
 */
export async function backfillMissingMetadataHashes(deadlockPath: string): Promise<number> {
    const metadata = loadMetadata();
    const missing = Object.entries(metadata).filter(([, data]) => !isValidSha256(data.sha256));
    if (missing.length === 0) return 0;

    const filesByName = await collectInstalledVpkPaths(deadlockPath);
    let updated = 0;

    for (const [fileName, data] of missing) {
        const filePath = filesByName.get(fileName.toLowerCase());
        if (!filePath) continue;

        try {
            data.sha256 = await hashFileSha256(filePath);
            updated++;
        } catch (error) {
            console.warn(`[Metadata] Failed to backfill SHA-256 for ${fileName}:`, error);
        }
    }

    if (updated > 0) {
        saveMetadata(metadata);
    }

    return updated;
}

async function collectInstalledVpkPaths(deadlockPath: string): Promise<Map<string, string>> {
    const filesByName = new Map<string, string>();

    for (const folder of [getAddonsPath(deadlockPath), getDisabledPath(deadlockPath)]) {
        for (const entry of await fs.readdir(folder, { withFileTypes: true }).catch(() => [])) {
            const key = entry.name.toLowerCase();
            if (entry.isFile() && key.endsWith('_dir.vpk') && !filesByName.has(key)) {
                filesByName.set(key, join(folder, entry.name));
            }
        }
    }

    return filesByName;
}

function isValidSha256(value: string | undefined): boolean {
    return typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value);
}

async function hashFileSha256(filePath: string): Promise<string> {
    const hash = createHash('sha256');

    await new Promise<void>((resolve, reject) => {
        const stream = createReadStream(filePath);
        stream.on('data', (chunk) => hash.update(chunk));
        stream.on('error', reject);
        stream.on('end', resolve);
    });

    return hash.digest('hex');
}

/**
 * Remove metadata for a specific mod
 */
export function removeModMetadata(fileName: string): void {
    const metadata = loadMetadata();
    delete metadata[fileName];
    saveMetadata(metadata);
}

// Alias for removeModMetadata
export const deleteModMetadata = removeModMetadata;

/**
 * Drop metadata entries whose VPK no longer exists on disk.
 *
 * Older versions of deleteMod removed the .vpk file but left metadata behind,
 * keyed by fileName. When the next mod was assigned the same pakNN_dir.vpk
 * slot, setModMetadata's merge behavior leaked the dead mod's gameBananaId,
 * categoryName, thumbnail, etc. onto the new install (issue #26). Callers
 * pass the current valid set so users with pre-existing orphans self-heal
 * the next time the mods list is scanned.
 */
export function pruneOrphanMetadata(validFileNames: Set<string>): void {
    const metadata = loadMetadata();
    const orphans = Object.keys(metadata).filter((key) => !validFileNames.has(key));
    if (orphans.length === 0) return;

    for (const key of orphans) {
        delete metadata[key];
    }
    saveMetadata(metadata);
}

/**
 * Atomically migrate metadata for a batch of rename operations.
 *
 * Why batched: when several mods are renamed in one operation (e.g. reorder),
 * a naive loop of setModMetadata(new) + removeModMetadata(old) can clobber
 * values whenever one mod's new name equals another mod's old name. This
 * happens whenever priorities compact (pak03 → pak01 while pak01 → pak02).
 *
 * Snapshot all source values first, delete all old keys, then write all new
 * keys in one load/save cycle.
 */
export function migrateModMetadata(
    migrations: Array<{ from: string; to: string }>
): void {
    if (migrations.length === 0) return;

    const metadata = loadMetadata();

    const pending = migrations
        .filter((m) => m.from !== m.to)
        .map((m) => ({ from: m.from, to: m.to, data: metadata[m.from] }))
        .filter((m) => m.data !== undefined);

    if (pending.length === 0) return;

    for (const m of pending) {
        delete metadata[m.from];
    }
    for (const m of pending) {
        metadata[m.to] = m.data!;
    }

    saveMetadata(metadata);
}
