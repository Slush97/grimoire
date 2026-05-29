/**
 * Local preview-cache maintenance.
 *
 * Several services write regenerable derived data into userData subdirectories:
 * 3D model GLBs, extracted hero portraits, and locker card thumbnails. None of
 * it is authoritative: each is rebuilt on demand from the user's installed VPKs
 * via the bundled vpkmerge, so all of it is safe to delete to reclaim disk. This
 * module sizes and clears those directories for the Settings "Local preview
 * cache" action (the GameBanana catalog DB is wiped separately, see
 * `wipe-mod-cache`, because re-syncing it is far more expensive).
 *
 * The directory names are owned by the services that write them. Keep this list
 * in sync if one is renamed:
 *   - hero-poses         -> heroPoseModels.ts (modelDir)
 *   - soul-models        -> soulContainerModels.ts (modelDir)
 *   - portrait-cache     -> heroPortraits.ts (getHeroPortraits)
 *   - locker-card-thumbs -> heroCards.ts (getAppliedCardThumbnails)
 */
import { promises as fs } from 'fs';
import { join } from 'path';
import { app } from 'electron';

const PREVIEW_CACHE_DIRS = [
    'hero-poses',
    'soul-models',
    'portrait-cache',
    'locker-card-thumbs',
] as const;

/** Recursively sum the byte size of a directory tree. A missing directory (the
 *  common case before a cache is first populated) counts as 0. */
async function dirSize(dir: string): Promise<number> {
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => null);
    if (!entries) return 0;
    let total = 0;
    for (const entry of entries) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
            total += await dirSize(full);
        } else {
            // The file can vanish between readdir and stat; treat that as 0.
            total += await fs.stat(full).then((s) => s.size).catch(() => 0);
        }
    }
    return total;
}

export interface PreviewCacheSize {
    /** Total bytes across every preview-cache directory. */
    bytes: number;
}

/** Total disk currently used by the regenerable preview caches. */
export async function getPreviewCacheSize(): Promise<PreviewCacheSize> {
    const root = app.getPath('userData');
    let bytes = 0;
    for (const name of PREVIEW_CACHE_DIRS) {
        bytes += await dirSize(join(root, name));
    }
    return { bytes };
}

export interface PreviewCacheClearResult {
    /** Bytes reclaimed (the size measured immediately before deletion). */
    bytesFreed: number;
}

/** Delete every preview-cache directory. They regenerate on demand the next
 *  time a hero pose, soul model, portrait, or card thumbnail is requested. */
export async function clearPreviewCache(): Promise<PreviewCacheClearResult> {
    const root = app.getPath('userData');
    const { bytes } = await getPreviewCacheSize();
    for (const name of PREVIEW_CACHE_DIRS) {
        await fs.rm(join(root, name), { recursive: true, force: true });
    }
    return { bytesFreed: bytes };
}
