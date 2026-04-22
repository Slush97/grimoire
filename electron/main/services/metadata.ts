import { readFileSync, writeFileSync, existsSync, renameSync, unlinkSync } from 'fs';
import { getMetadataPath } from '../utils/paths';

export interface ModMetadata {
    modName?: string;      // The human-readable mod name from GameBanana
    thumbnailUrl?: string;
    gameBananaId?: number;
    gameBananaFileId?: number; // The specific file ID that was downloaded
    categoryId?: number;
    categoryName?: string; // Hero/category name from GameBanana
    sourceSection?: string;
    nsfw?: boolean;
    isMinaPreset?: boolean; // Flag for Mina presets we extracted from the 7z
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
