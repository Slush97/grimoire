import { readFileSync, writeFileSync, existsSync } from 'fs';
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
    } catch {
        return {};
    }
}

/**
 * Save mod metadata to disk
 */
export function saveMetadata(metadata: ModMetadataMap): void {
    const path = getMetadataPath();
    writeFileSync(path, JSON.stringify(metadata, null, 2), 'utf-8');
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
