import { createHash } from 'crypto';
import { createReadStream, readFileSync, writeFileSync, existsSync, renameSync, unlinkSync, statSync } from 'fs';
import { promises as fs } from 'fs';
import { join } from 'path';
import { getAddonFolderPaths, getDisabledPath, metaKeyFor } from './deadlock';
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
    sha256?: string;       // SHA-256 hash of the installed VPK file contents
    variantLabel?: string;  // User-provided label to disambiguate variants of the same mod
    fileDescription?: string;  // GameBanana file "header" (_sDescription) — author's per-file label, used as fallback when the user hasn't named the variant
    sourceFileName?: string;   // Original GameBanana filename stem (e.g. "galaxy_rem_gold") — used as a label fallback when the author didn't set a file header
    /** Hero this mod belongs to in the Locker, by canonical hero name (e.g. "Lady Geist").
     *  Two reasons to store it: (1) GameBanana sometimes leaves a Skin under the
     *  generic "Skins" parent so categoryId never names a hero; (2) Sound mods
     *  live under their own category tree entirely. Set automatically at download
     *  time for Sound mods via inferHeroFromTitle, or manually by the user from
     *  the Locker's unassigned section. Takes precedence over categoryId when
     *  the locker maps mods to heroes. */
    lockerHero?: string;
    /** Provenance for lockerHero. Missing values are legacy inferred tags. */
    lockerHeroSource?: import('../../../src/types/mod').LockerHeroSource;
    /** Set once we've run the full VPK-tree hero inference for an UNKNOWN mod
     *  (see inferHeroFromVpkTree). Lets enrichMod skip the re-parse on later
     *  scans when the tree yielded no confident hero, the same way globalType
     *  uses a null sentinel. Only meaningful for unknown mods. */
    lockerHeroVpkChecked?: boolean;
    /** Global (non-hero) cosmetic category, classified from the VPK file tree
     *  (see classifyGlobalModType in vpk.ts). Tri-state: a GlobalModType when
     *  the mod is a recognized global cosmetic, `null` when we classified it
     *  and it is NOT one (a hero skin or unrecognized), and `undefined` when it
     *  has not been classified yet. The null sentinel lets enrichMod skip
     *  re-parsing every skin's VPK on subsequent scans. */
    globalType?: import('../../../src/types/mod').GlobalModType | null;
    /** Classifier version that produced `globalType`. Lets enrichMod re-run a
     *  stale `null` result when the classifier patterns improve (see
     *  GLOBAL_CLASSIFIER_VERSION in vpk.ts). Absent on pre-stamp metadata,
     *  treated as version 0. */
    globalTypeClassifierVersion?: number;
    /** Set when this VPK was produced by mergeMods. The share code +
     *  source list are the unroll payload. */
    merged?: import('../../../src/types/mod').MergedModInfo;
    /** Set on the single Locker cosmetics VPK that holds applied hero cards.
     *  The card selection set; rebuilt on every apply/revert. Presence marks
     *  the VPK as Locker-managed so other surfaces hide it. */
    lockerCosmetics?: import('../../../src/types/mod').LockerCosmeticsInfo;
    /** Set on the single Locker-managed sound VPK that holds applied per-ability
     *  sounds. The selection set; rebuilt on every apply/revert. Presence marks
     *  the VPK as Locker-managed so other surfaces hide it. Separate from
     *  lockerCosmetics (disjoint paths, independent lifecycle). */
    lockerSounds?: import('../../../src/types/mod').LockerSoundsInfo;
    /** Set on the single Locker-managed colors VPK that holds applied ability
     *  recolors. The selection set; rebuilt on every apply/revert. Presence
     *  marks the VPK as Locker-managed. Separate from lockerCosmetics/lockerSounds
     *  (disjoint paths, independent lifecycle). */
    lockerColors?: import('../../../src/types/mod').LockerColorsInfo;
    /** Set on the single Locker-managed trippy-skins VPK that holds applied
     *  procedural skin paints. The selection set; rebuilt on every apply/revert.
     *  Presence marks the VPK as Locker-managed. Separate from lockerColors
     *  (disjoint paths: body/weapon materials vs particles). */
    lockerTrippySkins?: import('../../../src/types/mod').LockerTrippySkinsInfo;
    /** Per-ability sound classification from the VPK file tree. Tri-state like
     *  globalType: an AbilitySoundClassification when the mod has recognized
     *  hero ability/VO sounds, `null` when classified and it has none, and
     *  `undefined` when not yet classified (so enrichMod skips the re-parse). */
    abilitySounds?: import('../../../src/types/mod').AbilitySoundClassification | null;
    /** Set when this VPK was built from a user GLB via the soul-container
     *  import. The orientation/glow transform + tracking status; presence marks
     *  the slot for idempotent re-import (replace the previous build). */
    soulImport?: import('../../../src/types/mod').SoulContainerImportInfo;
    /** Set when this VPK was built from a user GLB via the Spirit Urn import.
     *  The orientation/span transform + tracking status; presence marks the slot
     *  for idempotent re-import (replace the previous build). */
    urnImport?: import('../../../src/types/mod').UrnImportInfo;
    /** Load-order slot this mod last held while enabled. Disabled mods now
     *  get free-form filenames (no pakNN), so the priority is no longer encoded
     *  in the name; we stash it here on disable and try to restore it on enable
     *  when that slot is still free, so re-enabling returns the mod to roughly
     *  where it was in load order. */
    lastPriority?: number;
    /** Manual opt-out from update detection. When true, the renderer
     *  excludes this mod from the "update available" check even if the
     *  installed gameBananaFileId is gone from the live file list. Useful
     *  when the user wants to stay on a specific version after the author
     *  replaces or rearranges files. */
    ignoreUpdates?: boolean;
}

export type ModMetadataMap = Record<string, ModMetadata>;

// In-memory cache of the parsed metadata.json. Without this, every enrichMod
// call (one per installed mod) re-reads + re-parses the whole sidecar from
// disk on the main thread; users with many mods see noticeable freezes on
// import/get-mods. Invalidated via (mtimeMs, size) so external writes still
// get picked up, and refreshed eagerly inside saveMetadata to avoid an
// immediate re-read after we just wrote.
interface MetadataCacheEntry {
    mtimeMs: number;
    size: number;
    data: ModMetadataMap;
}
let metadataCache: MetadataCacheEntry | null = null;

/**
 * Load mod metadata from disk
 */
export function loadMetadata(): ModMetadataMap {
    const path = getMetadataPath();

    if (!existsSync(path)) {
        metadataCache = null;
        return {};
    }

    try {
        const stat = statSync(path);
        if (
            metadataCache &&
            metadataCache.mtimeMs === stat.mtimeMs &&
            metadataCache.size === stat.size
        ) {
            return metadataCache.data;
        }

        const content = readFileSync(path, 'utf-8');
        const data = JSON.parse(content) as ModMetadataMap;
        metadataCache = { mtimeMs: stat.mtimeMs, size: stat.size, data };
        return data;
    } catch (error) {
        console.warn('[Metadata] Failed to load metadata, returning empty:', error);
        metadataCache = null;
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
        try {
            const stat = statSync(path);
            metadataCache = { mtimeMs: stat.mtimeMs, size: stat.size, data: metadata };
        } catch {
            metadataCache = null;
        }
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

    const filesByKey = await collectInstalledVpkPaths(deadlockPath);
    let updated = 0;

    for (const [key, data] of missing) {
        const filePath = filesByKey.get(key.toLowerCase());
        if (!filePath) continue;

        try {
            data.sha256 = await hashFileSha256(filePath);
            updated++;
        } catch (error) {
            console.warn(`[Metadata] Failed to backfill SHA-256 for ${key}:`, error);
        }
    }

    if (updated > 0) {
        saveMetadata(metadata);
    }

    return updated;
}

// Map every installed VPK to its absolute path, keyed by metaKey (lowercased) so
// it lines up with the metaKey-keyed metadata entries. Scans every addon folder
// (base + overflow) plus .disabled; for base/.disabled the key is the bare
// filename, for overflow it's addons{N}/<file>.
async function collectInstalledVpkPaths(deadlockPath: string): Promise<Map<string, string>> {
    const filesByKey = new Map<string, string>();

    for (const folder of [...getAddonFolderPaths(deadlockPath), getDisabledPath(deadlockPath)]) {
        for (const entry of await fs.readdir(folder, { withFileTypes: true }).catch(() => [])) {
            if (!entry.isFile() || !entry.name.toLowerCase().endsWith('_dir.vpk')) continue;
            const full = join(folder, entry.name);
            const key = metaKeyFor(full).toLowerCase();
            if (!filesByKey.has(key)) filesByKey.set(key, full);
        }
    }

    return filesByKey;
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
 * keyed by the mod's metaKey. When the next mod was assigned the same pakNN_dir.vpk
 * slot, setModMetadata's merge behavior leaked the dead mod's gameBananaId,
 * categoryName, thumbnail, etc. onto the new install (issue #26). Callers
 * pass the current valid set (metaKeys) so users with pre-existing orphans
 * self-heal the next time the mods list is scanned.
 */
export function pruneOrphanMetadata(validKeys: Set<string>): void {
    const metadata = loadMetadata();
    // Synthetic `locker:*` keys hold the Locker-managed selection sets (cards /
    // sounds), which live in citadel/grimoire and are NOT scanned filenames, so
    // they must never be treated as orphans.
    const orphans = Object.keys(metadata).filter(
        (key) => !key.startsWith('locker:') && !validKeys.has(key),
    );
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
