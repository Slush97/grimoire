import { createHash } from 'crypto';
import { createReadStream, readFileSync, writeFileSync, existsSync, renameSync, unlinkSync, statSync, mkdirSync, copyFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { metaKeyFor } from './deadlock';
import { listInstalledUserVpks } from './modLibrary';
import { resolveVpkIdentity } from './vpkIdentity';
import { getMetadataPath } from '../utils/paths';

export interface ModMetadata {
    modName?: string;      // The human-readable mod name from GameBanana
    /** GameBanana submitter name, captured at download time. Absent for local
     *  mods. Embedded into the imprint (addonauthor / modinfo.author). */
    author?: string;
    thumbnailUrl?: string;
    audioUrl?: string;     // GameBanana audio preview URL (Sound mods)
    gameBananaId?: number;
    gameBananaFileId?: number; // The specific file ID that was downloaded
    vpkIndex?: number;      // Size-sorted index inside a multi-VPK GameBanana file
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
    /** Set when this VPK was handed over by deadlockforge.net through the local
     *  install bridge (see services/forgeBridge.ts). Presence marks the mod as
     *  forge-built so the UI can show the bundled DeadlockForge badge rather
     *  than a GameBanana thumbnail (there is none to fetch, and Grimoire never
     *  phones home for one). */
    forgeInstall?: import('../../../src/types/mod').ForgeInstallInfo;
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
    /** Set when this VPK was built via the Foundry hero sound-swap (drop your own
     *  MP3 onto a hero sound event). Labels the mod and records what was swapped;
     *  presence marks the slot as a local sound swap. */
    soundSwap?: import('../../../src/types/mod').SoundSwapInfo;
    /** Load-order slot this mod last held while enabled. Disabled mods now
     *  get free-form filenames (no pakNN), so the priority is no longer encoded
     *  in the name; we stash it here on disable and try to restore it on enable
     *  when that slot is still free, so re-enabling returns the mod to roughly
     *  where it was in load order. */
    lastPriority?: number;
    /** Set once this VPK has been re-packed in place with a self-identifying
     *  `addoninfo.txt` embed (path B imprinting, see imprintMods.ts). A UI / idempotency
     *  hint only: it does NOT affect canonical identity (metadata.sha256 stays the
     *  original) and the authoritative imprinted-state is the embed itself, read via
     *  resolveVpkIdentity. */
    imprinted?: boolean;
    /** Meaningful only alongside `imprinted`: the embed exists but is legacy
     *  format or has drifted from this sidecar entry, so a re-imprint is
     *  pending work. A UI hint for the toolbar button's pending count, kept
     *  honest by the startup reconcile (backfillImprintedFlags) and cleared by
     *  every successful (re)imprint; the preflight modal stays the source of
     *  truth for what a bulk run actually does. */
    imprintStale?: boolean;
    /** Manual opt-out from update detection. When true, the renderer
     *  excludes this mod from the "update available" check even if the
     *  installed gameBananaFileId is gone from the live file list. Useful
     *  when the user wants to stay on a specific version after the author
     *  replaces or rearranges files. */
    ignoreUpdates?: boolean;
    /** User marked this mod Global: it lives in the priority root
     *  (citadel/grimoire), which the engine searches before citadel/addons, so
     *  it wins every file collision and the launch shuffle leaves it enabled.
     *  Source of truth for placement, because a disabled mod sits in .disabled/
     *  where the folder can't tell us. Undefined (not false) when unset. */
    priorityMod?: boolean;
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
        // Returning {} here means every writer that follows treats "I could not
        // read the sidecar" as "there is nothing in the sidecar", and the first
        // one to save (setModMetadata on the next scan, or the startup
        // backfillMissingMetadataHashes, which mints a hash-only row per VPK)
        // commits that as fact. Copy the unreadable bytes aside first so the
        // real content outlives the overwrite: a truncated file after an
        // unclean shutdown, or a read that lost a race with antivirus, is then
        // recoverable instead of being the same total loss by a slower route.
        console.warn('[Metadata] Failed to load metadata, returning empty:', error);
        backupMetadataSidecar('unreadable');
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
        // Drop the cache, do not leave it. loadMetadata hands its cached map out
        // by reference and every mutating helper edits that object in place
        // before calling us, so a failed write leaves the cache holding changes
        // that never reached disk while its mtime/size still match the
        // untouched file. The next unrelated save would then write those
        // half-applied edits over the good file: one denied write during a
        // prune, and the rows it wanted to drop are gone at the next toggle.
        metadataCache = null;
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
 *
 * The stored hash is the CANONICAL identity (the original, pre-imprint
 * whole-file sha256), resolved via resolveVpkIdentity: an imprinted VPK yields
 * its embedded original hash, a pristine VPK yields its live hash (which IS
 * the original). Hashing live bytes here would re-stamp an imprinted file's
 * identity to post-imprint bytes and break every record on the original axis
 * (sha256AtMergeTime, sha256AtApplyTime, absorbed-source hiding).
 */
export async function setModMetadataWithHash(
    fileName: string,
    data: ModMetadata,
    filePath: string
): Promise<void> {
    setModMetadata(fileName, {
        ...data,
        sha256: (await resolveVpkIdentity(filePath)).sha256,
    });
}

/**
 * Backfill SHA-256 values for metadata written before hashes existed.
 * This runs without renaming/moving files; entries whose VPK no longer exists
 * are skipped and can still be pruned by the normal metadata cleanup path.
 */
export async function backfillMissingMetadataHashes(deadlockPath: string): Promise<number> {
    const metadata = loadMetadata();
    const filesByKey = await collectInstalledVpkPaths(deadlockPath);
    const metadataKeysByLower = new Map(
        Object.keys(metadata).map((key) => [key.toLowerCase(), key])
    );
    let updated = 0;

    // First repair pre-hash metadata entries that still have a VPK on disk.
    for (const [key, data] of Object.entries(metadata)) {
        if (isValidSha256(data.sha256)) continue;
        const filePath = filesByKey.get(key.toLowerCase());
        if (!filePath) continue;

        try {
            // Canonical (embed-aware) identity: an imprinted file backfills its
            // embedded original hash, never the post-imprint live bytes.
            data.sha256 = (await resolveVpkIdentity(filePath)).sha256;
            updated++;
        } catch (error) {
            console.warn(`[Metadata] Failed to backfill SHA-256 for ${key}:`, error);
        }
    }

    // A VPK dropped straight into addons has no sidecar entry at all. Give it
    // the smallest useful row so renderer features can use content identity
    // across enable/disable renames. Unknown-mod semantics remain unchanged:
    // callers classify on gameBananaId/modName, not metadata-row existence.
    for (const [lowerKey, filePath] of filesByKey) {
        if (metadataKeysByLower.has(lowerKey)) continue;
        const key = metaKeyFor(filePath);
        try {
            metadata[key] = { sha256: (await resolveVpkIdentity(filePath)).sha256 };
            metadataKeysByLower.set(lowerKey, key);
            updated++;
        } catch (error) {
            console.warn(`[Metadata] Failed to create SHA-256 metadata for ${key}:`, error);
        }
    }

    if (updated > 0) {
        saveMetadata(metadata);
    }

    return updated;
}

// Map every installed user VPK to its absolute path, keyed by metaKey
// (lowercased) so it lines up with the metaKey-keyed metadata entries. The
// shared inventory includes Global, addons/overflow, and .disabled while
// excluding the Locker-managed reserved priority VPKs.
async function collectInstalledVpkPaths(deadlockPath: string): Promise<Map<string, string>> {
    const filesByKey = new Map<string, string>();

    for (const vpk of await listInstalledUserVpks(deadlockPath)) {
        const key = vpk.metaKey.toLowerCase();
        if (!filesByKey.has(key)) filesByKey.set(key, vpk.path);
    }

    return filesByKey;
}

function isValidSha256(value: string | undefined): boolean {
    return typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value);
}

/**
 * Copy the metadata sidecar into mod-metadata.backups/<timestamp>_<tag>.json
 * before a batch identity mutation (e.g. the DMM import), so a bad batch can
 * be rolled back by restoring the file. Keeps the newest `keep` backups.
 * Returns the backup path, or null when there is no sidecar yet. Never
 * throws: a failed backup must not block the operation itself, so failures
 * log a warning and return null.
 */
export function backupMetadataSidecar(tag: string, keep = 5): string | null {
    const path = getMetadataPath();
    if (!existsSync(path)) return null;

    try {
        const dir = join(dirname(path), 'mod-metadata.backups');
        mkdirSync(dir, { recursive: true });
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        const backupPath = join(dir, `${stamp}_${tag}.json`);
        copyFileSync(path, backupPath);

        // Prune old backups: ISO-stamped names sort chronologically, so a
        // descending sort puts the newest first.
        const stale = readdirSync(dir)
            .filter((name) => name.endsWith('.json'))
            .sort()
            .reverse()
            .slice(keep);
        for (const name of stale) {
            try {
                unlinkSync(join(dir, name));
            } catch { /* ignore prune failure */ }
        }
        return backupPath;
    } catch (error) {
        console.warn('[Metadata] Sidecar backup failed:', error);
        return null;
    }
}

export async function hashFileSha256(filePath: string): Promise<string> {
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
 * Every absolute path a metaKey can name, without creating anything.
 *
 * Deliberately raw joins: getAddonsPath / getDisabledPath / getGrimoirePath all
 * mkdir their root on demand, which is exactly how a Deadlock folder that has
 * stopped resolving comes back as a clean empty tree. A function whose whole
 * job is to decide whether a file is really gone must not fabricate the folder
 * it is looking in.
 *
 * metaKeyFor produces three shapes: `grimoire/<file>` for the priority root,
 * `addonsN/<file>` for an overflow root, and a bare `<file>` otherwise, which
 * can be sitting in either citadel/addons or citadel/addons/.disabled.
 */
function resolveMetaKeyPaths(deadlockPath: string, key: string): string[] {
    const citadel = join(deadlockPath, 'game', 'citadel');
    const slash = key.indexOf('/');
    if (slash !== -1) {
        return [join(citadel, key.slice(0, slash), key.slice(slash + 1))];
    }
    return [join(citadel, 'addons', key), join(citadel, 'addons', '.disabled', key)];
}

/**
 * Drop metadata entries whose VPK no longer exists on disk.
 *
 * Older versions of deleteMod removed the .vpk file but left metadata behind,
 * keyed by the mod's metaKey. When the next mod was assigned the same pakNN_dir.vpk
 * slot, setModMetadata's merge behavior leaked the dead mod's gameBananaId,
 * categoryName, thumbnail, etc. onto the new install (issue #26). Callers
 * pass the current valid set (metaKeys) so users with pre-existing orphans
 * self-heal the next time the mods list is scanned.
 *
 * A key missing from that set is a *candidate*, never a verdict. The scan can
 * come back short for reasons that have nothing to do with the user deleting
 * anything: getAddonFolderPaths falls back to base-only when citadel/ is
 * unreadable (so every overflow-folder mod vanishes from the set at once),
 * scanFolder skips any file whose stat throws (antivirus holding one VPK), and
 * a path that stopped resolving scans as an empty tree. So confirm each
 * candidate against disk before deleting its row, and keep the row whenever the
 * file is there or we cannot tell.
 */
export function pruneOrphanMetadata(validKeys: Set<string>, deadlockPath: string): void {
    const metadata = loadMetadata();
    // Synthetic `locker:*` keys hold the Locker-managed selection sets (cards /
    // sounds), which live in citadel/grimoire and are NOT scanned filenames, so
    // they must never be treated as orphans.
    const candidates = Object.keys(metadata).filter(
        (key) => !key.startsWith('locker:') && !validKeys.has(key),
    );
    if (candidates.length === 0) return;

    const orphans = candidates.filter(
        (key) => !resolveMetaKeyPaths(deadlockPath, key).some((path) => existsSync(path)),
    );
    const kept = candidates.length - orphans.length;
    if (kept > 0) {
        console.warn(
            `[Metadata] ${kept} of ${candidates.length} prune candidates are still on disk; the scan missed them. Keeping their metadata.`
        );
    }
    if (orphans.length === 0) return;

    // Last line of defence, for the case the check above cannot see: when the
    // whole install is gone, every path misses and every row looks orphaned. A
    // prune that empties a populated sidecar is never a self-heal. Deleting a
    // mod drops its own row synchronously (deleteMod -> removeModMetadata), so
    // orphans are always a minority left behind by an older version or an
    // outside-Grimoire delete. The cost of keeping an orphan is one stale name
    // on a recycled pakNN slot; the cost of the wipe is every name, GameBanana
    // id, thumbnail and hero assignment the user has.
    if (validKeys.size === 0) {
        console.warn(
            `[Metadata] Refusing to prune ${orphans.length} entries against an empty scan: that would clear the sidecar, and no mod list is worth that.`
        );
        return;
    }

    // Cheap insurance on the one operation here that destroys user data. Runs
    // only on a real prune, which is rare (orphans are normally zero), and
    // keeps the last 5.
    backupMetadataSidecar('pre-prune');
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
