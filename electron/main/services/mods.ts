import { promises as fs } from 'fs';
import { existsSync } from 'fs';
import { join, dirname, basename } from 'path';
import { createHash, randomBytes } from 'crypto';
import { getAddonsPath, getDisabledPath, getAddonFolderPaths, createNextOverflowFolder, overflowAddonsPath, MAX_ADDON_FOLDERS, metaKeyFor } from './deadlock';
import { fixGameinfo } from './system';
import { getModMetadata, setModMetadata, removeModMetadata, migrateModMetadata } from './metadata';
import { compareFileContents, fingerprintFile } from './fileMatch';

/** Minimum VPK priority number */
const MIN_VPK_PRIORITY = 1;
/** Maximum VPK priority number (Source 2 limit) */
const MAX_VPK_PRIORITY = 99;
/** Default priority for mods without pak## prefix */
const DEFAULT_MOD_PRIORITY = 50;
/**
 * Thrown by enableMod when every addon folder (base + overflow, up to
 * MAX_ADDON_FOLDERS) is full. The renderer matches on the "mods enabled at once"
 * phrase to surface this as a non-fatal toast instead of the full-page error
 * screen, so keep that substring stable across cap changes.
 */
export const ENABLE_LIMIT_MESSAGE =
    'You can have at most 990 mods enabled at once. Disable one to make room.';

type CollisionMetadataOwner = 'enabled' | 'disabled';

export interface Mod {
    id: string;
    name: string;
    fileName: string;
    path: string;
    /** Metadata/identity key for this VPK, derived from its folder location.
     *  Bare filename for the base addons folder + .disabled (unchanged for
     *  existing installs); `addons{N}/<file>` for overflow folders. Use this,
     *  not fileName, as the key for getModMetadata/setModMetadata and as the
     *  generateModId input, so a pakNN_dir.vpk can't collide across folders. */
    metaKey: string;
    enabled: boolean;
    priority: number;
    size: number;
    installedAt: string;
    description?: string;
    thumbnailUrl?: string;
    audioUrl?: string;
    gameBananaId?: number;
    gameBananaFileId?: number;
    categoryId?: number;
    categoryName?: string;
    sourceSection?: string;
    nsfw?: boolean;
    isArchived?: boolean;
    sha256?: string;
    isUnknown?: boolean;
    /** User-given name for this VPK, used to disambiguate variants of the
     *  same GameBanana mod (e.g. "Red preset" vs "Blue preset"). Optional. */
    variantLabel?: string;
    /** Author-provided file header from GameBanana (_sDescription). Used as
     *  the variant-picker fallback when the user hasn't set a label of their
     *  own, so rows show "Gold w/ alt candle" instead of the raw filename. */
    fileDescription?: string;
    /** Original GameBanana filename stem (e.g. "galaxy_rem_gold"). Captured
     *  so variants from mods whose author left descriptions empty still get
     *  a meaningful label - falls between fileDescription and the local
     *  pakNN_dir.vpk filename in the picker's display chain. */
    sourceFileName?: string;
    /** Hero this mod belongs to in the Locker (canonical name). Either
     *  auto-inferred at download time for Sound mods or manually set by the
     *  user; takes precedence over categoryId in the locker grouping. */
    lockerHero?: string;
    /** Provenance for lockerHero. Missing values are legacy inferred tags. */
    lockerHeroSource?: import('../../../src/types/mod').LockerHeroSource;
    /** Populated when this VPK was produced by mergeMods. The metadata
     *  enricher reads this from the mod metadata sidecar. */
    merged?: import('../../../src/types/mod').MergedModInfo;
    /** User opted out of the "update available" flag for this mod. The
     *  enricher reads this from the mod metadata sidecar. */
    ignoreUpdates?: boolean;
}

/**
 * Parse VPK filename to extract priority (pak##_dir.vpk format)
 */
function parseVpkPriority(filename: string): number | null {
    if (
        !filename.startsWith('pak') ||
        (!filename.endsWith('_dir.vpk') && !filename.endsWith('.vpk'))
    ) {
        return null;
    }
    const numberPart = filename.slice(3, 5);
    const num = parseInt(numberPart, 10);
    return isNaN(num) ? null : num;
}

/**
 * Generate a mod ID by hashing its metadata key (see metaKeyFor). The key is the
 * bare filename for base-addons + .disabled mods (so existing IDs are unchanged)
 * and `addons{N}/<file>` for overflow mods, which keeps IDs unique when the same
 * pakNN_dir.vpk name exists in more than one addon folder.
 */
function generateModId(metaKey: string): string {
    return createHash('md5').update(metaKey).digest('hex').slice(0, 16);
}

/**
 * Extract a human-readable name from the VPK filename
 */
function extractModName(filename: string): string {
    // Remove _dir.vpk or .vpk suffix
    let name = filename.replace(/_dir\.vpk$/, '').replace(/\.vpk$/, '');

    // Remove pak## prefix if present
    if (name.startsWith('pak') && name.length > 5) {
        const rest = name.slice(5);
        name = rest.startsWith('_') ? rest.slice(1) : rest;
    }

    // Convert underscores/dashes to spaces and title case
    return name
        .replace(/[_-]/g, ' ')
        .split(/\s+/)
        .filter((word) => word.length > 0)
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');
}

/**
 * Build a free-form, unique filename for a mod living in the .disabled/ folder.
 *
 * Disabled VPKs are not loaded by the game, so they don't need a pakNN load-order
 * slot. Naming them free-form (a) lifts the 99-name cap on the disabled library
 * and (b) keeps the enabled (pakNN) and disabled namespaces disjoint, so
 * `md5(fileName)` stays globally unique with no identity/metadata migration.
 *
 * The readable stem comes from the file's own name when it has one; for an
 * enabled mod (always a bare pakNN with no descriptive stem) we fall back to the
 * `preferredName` the caller pulls from metadata (the mod's display name), so a
 * disabled file reads like `glamorous_geist_dir.vpk` instead of `mod_12ce`. A
 * short token is appended only to stay unique, and the result is guaranteed not
 * to parse back as a pakNN slot.
 */
export function makeDisabledFileName(
    sourceFileName: string,
    taken: Set<string>,
    preferredName?: string
): string {
    // The file's own stem, minus any pak## load-order prefix (disabled files
    // carry no slot). Empty for bare pakNN names, which is the disable case.
    let stem = sourceFileName.replace(/_dir\.vpk$/i, '').replace(/\.vpk$/i, '');
    stem = stem.replace(/^pak\d{2}_?/i, '').trim();

    let base = slugify(stem) || slugify(preferredName ?? '') || 'mod';
    // Guard against a base that still starts with "pak<digit>": parseVpkPriority
    // is lenient (it reads chars 3-4 and parseInts them), so "pak1_foo" would be
    // read back as slot 1 and loop forever below. Prefix it out of that shape.
    if (/^pak\d/i.test(base)) base = `mod_${base}`;

    const build = (suffix: string) => `${base}${suffix}_dir.vpk`;
    let candidate = build('');
    while (parseVpkPriority(candidate) !== null || taken.has(candidate.toLowerCase())) {
        candidate = build(`_${randomBytes(2).toString('hex')}`);
    }
    return candidate;
}

/**
 * Lowercase a display string into a filesystem-safe, pakNN-free filename stem:
 * non-alphanumerics collapse to underscores, edges trimmed, length capped.
 */
function slugify(value: string): string {
    const s = value
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '');
    return s.slice(0, 48).replace(/_+$/, '');
}

/**
 * Folder index of an addon VPK from its on-disk path: 0 for the base
 * citadel/addons, N for an overflow citadel/addonsN. Anything else (e.g. a
 * .disabled file) reports 0; callers that care gate on mod.enabled first.
 */
function addonFolderIndex(vpkPath: string): number {
    const match = basename(dirname(vpkPath)).match(/^addons(\d+)$/i);
    return match ? parseInt(match[1], 10) : 0;
}

/**
 * The set of pakNN load-order numbers currently used by files in one folder.
 * Free-form (disabled) filenames don't parse as pakNN, so they're excluded.
 */
async function folderPakNumbers(folder: string): Promise<Set<number>> {
    const nums = new Set<number>();
    if (!existsSync(folder)) return nums;
    for (const entry of await fs.readdir(folder)) {
        const priority = parseVpkPriority(entry);
        if (priority !== null) nums.add(priority);
    }
    return nums;
}

/**
 * Choose an enabled (pakNN) slot for a mod being enabled. Tries the preferred
 * numbers in order (remembered last-priority, then the mod's own legacy number)
 * and otherwise takes the lowest free slot. Throws the cap error when all 99 are
 * taken. `forbidden` must include every addons number plus every OTHER disabled
 * pakNN, so enabling can never collide an id with a still-disabled mod.
 */
function pickEnableSlot(forbidden: Set<number>, preferred: Array<number | undefined>): number {
    for (const p of preferred) {
        if (
            p != null &&
            Number.isInteger(p) &&
            p >= MIN_VPK_PRIORITY &&
            p <= MAX_VPK_PRIORITY &&
            !forbidden.has(p)
        ) {
            return p;
        }
    }
    for (let p = MIN_VPK_PRIORITY; p <= MAX_VPK_PRIORITY; p++) {
        if (!forbidden.has(p)) return p;
    }
    throw new Error(ENABLE_LIMIT_MESSAGE);
}

/**
 * Scan a folder for VPK mods (async)
 */
async function scanFolder(folder: string, enabled: boolean): Promise<Mod[]> {
    const mods: Mod[] = [];

    if (!existsSync(folder)) {
        return mods;
    }

    const entries = await fs.readdir(folder);

    for (const entry of entries) {
        const fullPath = join(folder, entry);

        try {
            const stats = await fs.stat(fullPath);
            if (!stats.isFile()) continue;

            if (!isDeadlockModVpk(entry)) continue;

            const priority = parseVpkPriority(entry) ?? DEFAULT_MOD_PRIORITY;
            const metaKey = metaKeyFor(fullPath);

            mods.push({
                id: generateModId(metaKey),
                name: extractModName(entry),
                fileName: entry,
                path: fullPath,
                metaKey,
                enabled,
                priority,
                size: stats.size,
                installedAt: stats.mtime.toISOString(),
            });
        } catch {
            // Skip files we can't read
        }
    }

    return mods;
}

/**
 * Scan for all mods in both enabled and disabled folders (async).
 *
 * Not pure: reconcileEnabledDisabledCollisions may rename or unlink files
 * when the same pakNN_dir.vpk exists in both addons/ and .disabled/. The
 * heal is idempotent, so repeated scans no-op after the first pass.
 */
export async function scanMods(deadlockPath: string): Promise<Mod[]> {
    const addonsPath = getAddonsPath(deadlockPath);
    const disabledPath = getDisabledPath(deadlockPath);

    await reconcileEnabledDisabledCollisions(deadlockPath, addonsPath, disabledPath);

    // Scan every enabled addon folder (base citadel/addons plus any overflow
    // addons1, addons2, ...) and the single shared .disabled parking lot. Each
    // mod's metaKey is stamped in scanFolder from its folder location.
    const enabledFolders = getAddonFolderPaths(deadlockPath);
    const scanned = await Promise.all([
        ...enabledFolders.map((folder) => scanFolder(folder, true)),
        scanFolder(disabledPath, false),
    ]);

    const mods = scanned.flat();

    // Sort by global load order: folder first (base, then addons1, addons2, ...),
    // then pakNN within a folder, so the list reflects real load priority.
    mods.sort(
        (a, b) =>
            addonFolderIndex(a.path) * 100 + a.priority - (addonFolderIndex(b.path) * 100 + b.priority)
    );

    return mods;
}

async function reconcileEnabledDisabledCollisions(
    deadlockPath: string,
    addonsPath: string,
    disabledPath: string
): Promise<void> {
    if (!existsSync(addonsPath) || !existsSync(disabledPath)) return;

    const [enabledEntries, disabledEntries] = await Promise.all([
        listPrimaryVpkFiles(addonsPath),
        listPrimaryVpkFiles(disabledPath),
    ]);
    const enabledByName = new Map(enabledEntries.map((entry) => [entry.toLowerCase(), entry]));

    // Names already present in .disabled (lowercased). Kept current as we rename
    // so two collisions healed in one pass can't be given the same new name.
    const takenDisabledNames = new Set(disabledEntries.map((entry) => entry.toLowerCase()));

    for (const disabledEntry of disabledEntries) {
        const enabledEntry = enabledByName.get(disabledEntry.toLowerCase());
        if (!enabledEntry) continue;

        const identical = await sameFileContents(
            join(addonsPath, enabledEntry),
            join(disabledPath, disabledEntry)
        );
        if (identical) {
            await fs.unlink(join(disabledPath, disabledEntry));
            console.warn(
                `[mods] Removed duplicate disabled VPK for ${enabledEntry}: ${disabledEntry}`
            );
            continue;
        }

        // Contents differ, so keep both, but the disabled copy must lose the
        // bare-filename id namespace it shares with the base-folder file. Give it
        // a free-form name (exactly as disableMod does) rather than a scarce pakNN
        // slot: disabled VPKs aren't loaded by the engine, so they need no
        // load-order number, and the free-form namespace has no 99-slot cap.
        // (The old pakNN allocator scanned only base addons + .disabled and threw
        // the 990 "enable limit" here once the base folder was full - which is the
        // norm for anyone who has spilled into overflow folders. Because that throw
        // happened before the heal completed, the collision never cleared and every
        // get-mods/get-conflicts/launch scan failed permanently.)
        const metadata = getModMetadata(enabledEntry);
        const owner = await getCollisionMetadataOwner(metadata?.sha256, join(disabledPath, disabledEntry));
        const preferredName = metadata?.modName ?? metadata?.sourceFileName ?? metadata?.variantLabel;
        const renamedFileName = makeDisabledFileName(disabledEntry, takenDisabledNames, preferredName);
        await fs.rename(join(disabledPath, disabledEntry), join(disabledPath, renamedFileName));
        takenDisabledNames.add(renamedFileName.toLowerCase());
        moveCollisionMetadata(enabledEntry, renamedFileName, owner, metadata);
        console.warn(
            `[mods] Renamed conflicting disabled VPK ${disabledEntry} to ${renamedFileName}; contents differ from enabled copy.`
        );
    }
}

async function listPrimaryVpkFiles(folder: string): Promise<string[]> {
    const entries = await fs.readdir(folder, { withFileTypes: true });
    return entries
        .filter((entry) => entry.isFile() && isDeadlockModVpk(entry.name))
        .map((entry) => entry.name);
}

function isDeadlockModVpk(fileName: string): boolean {
    return fileName.toLowerCase().endsWith('_dir.vpk');
}

async function sameFileContents(leftPath: string, rightPath: string): Promise<boolean> {
    const comparison = await compareFileContents(leftPath, rightPath);
    return comparison.matches;
}

function moveCollisionMetadata(
    enabledFileName: string,
    renamedFileName: string,
    owner: CollisionMetadataOwner,
    metadata: ReturnType<typeof getModMetadata>
): void {
    removeModMetadata(renamedFileName);
    if (owner !== 'disabled' || !metadata) return;

    setModMetadata(renamedFileName, metadata);
    removeModMetadata(enabledFileName);
}

async function getCollisionMetadataOwner(
    sha256: string | undefined,
    disabledPath: string
): Promise<CollisionMetadataOwner> {
    if (!sha256) return 'enabled';

    const disabledHash = await fingerprintFile(disabledPath);
    return disabledHash.sha256.toLowerCase() === sha256.toLowerCase() ? 'disabled' : 'enabled';
}

/**
 * Move a mod to a folder under an explicit destination filename, migrating its
 * metadata to follow the rename. Callers compute a collision-free destination
 * (enableMod picks a free pakNN slot; disableMod mints a free-form unique name),
 * so this is a straight rename - no slot-conflict healing needed here.
 *
 * `rememberPriority`, set on disable, is stashed in metadata BEFORE the rename
 * so it travels with the migrated entry and can be restored on the next enable.
 */
async function moveModToFolderAs(
    targetMod: Mod,
    destinationFolder: string,
    destinationFileName: string,
    enabled: boolean,
    rememberPriority?: number
): Promise<Mod> {
    if (rememberPriority != null) {
        setModMetadata(targetMod.metaKey, { lastPriority: rememberPriority });
    }

    await fs.mkdir(destinationFolder, { recursive: true });
    const destinationPath = join(destinationFolder, destinationFileName);
    await fs.rename(targetMod.path, destinationPath);
    const destMetaKey = metaKeyFor(destinationPath);

    if (destMetaKey !== targetMod.metaKey) {
        migrateModMetadata([{ from: targetMod.metaKey, to: destMetaKey }]);
    }

    return {
        ...targetMod,
        id: generateModId(destMetaKey),
        fileName: destinationFileName,
        metaKey: destMetaKey,
        enabled,
        priority: parseVpkPriority(destinationFileName) ?? targetMod.priority,
        path: destinationPath,
    };
}

interface AllocatedSlot {
    /** Absolute path of the chosen addon folder (base citadel/addons or an
     *  overflow citadel/addonsN). */
    folder: string;
    /** pakNN_dir.vpk name for the chosen free slot in that folder. */
    fileName: string;
}

/**
 * Find a free enabled (pakNN) slot, walking the base addons folder first then
 * each existing overflow folder in order, minting a new overflow folder (and
 * patching gameinfo.gi to add its Game path) only when all are full. Per Model A
 * the earlier folder is higher priority, so filling base-first keeps the densest
 * load order. Throws ENABLE_LIMIT_MESSAGE at the MAX_ADDON_FOLDERS cap.
 *
 * `preferred` slot numbers (a remembered last-priority, a mod's own legacy pakNN)
 * are honored only in the base folder. `disabledForbidden` are pakNN held by
 * .disabled files; the base folder must avoid them because base + .disabled share
 * the bare-filename id namespace (overflow folders are folder-namespaced, so they
 * don't). Shared by enableMod and allocateEnabledVpkPath.
 */
async function allocateSlot(
    deadlockPath: string,
    opts: { disabledForbidden: Set<number>; preferred: Array<number | undefined> }
): Promise<AllocatedSlot> {
    const folders = getAddonFolderPaths(deadlockPath);
    for (let i = 0; i < folders.length; i++) {
        const folder = folders[i];
        const used = await folderPakNumbers(folder);
        const forbidden = i === 0 ? new Set<number>([...used, ...opts.disabledForbidden]) : used;
        const preferred = i === 0 ? opts.preferred : [];
        let slot: number;
        try {
            slot = pickEnableSlot(forbidden, preferred);
        } catch {
            continue; // this folder is full; try the next
        }
        return { folder, fileName: `pak${String(slot).padStart(2, '0')}_dir.vpk` };
    }

    // Every existing folder is full: spill into a fresh overflow folder. Add it
    // to gameinfo BEFORE the caller writes a VPK in, or the engine won't load it.
    // createNextOverflowFolder returns null once the MAX_ADDON_FOLDERS cap is hit.
    const overflowFolder = createNextOverflowFolder(deadlockPath);
    if (!overflowFolder) {
        throw new Error(ENABLE_LIMIT_MESSAGE);
    }
    const status = fixGameinfo(deadlockPath);
    if (!status.configured) {
        throw new Error(
            `Couldn't add the overflow mod folder to gameinfo.gi${status.message ? `: ${status.message}` : ''}. ` +
                'Open Settings and use Fix Configuration, then try again.'
        );
    }
    return { folder: overflowFolder, fileName: `pak${String(MIN_VPK_PRIORITY).padStart(2, '0')}_dir.vpk` };
}

/**
 * Absolute path a brand-new ENABLED VPK should be written to (custom local
 * import, merge output), honoring the multi-folder overflow model so the create
 * still succeeds when the base addons folder is full: this spills into overflow
 * folders and mints a new one at capacity. Throws ENABLE_LIMIT_MESSAGE at the cap.
 *
 * The caller writes the VPK to this path and then keys its metadata by
 * metaKeyFor(path), since an overflow destination uses a folder-prefixed key.
 */
export async function allocateEnabledVpkPath(deadlockPath: string): Promise<string> {
    const disabledForbidden = await folderPakNumbers(getDisabledPath(deadlockPath));
    const { folder, fileName } = await allocateSlot(deadlockPath, { disabledForbidden, preferred: [] });
    return join(folder, fileName);
}

/**
 * Enable a mod by moving it from disabled to addons folder (async)
 */
export async function enableMod(deadlockPath: string, modId: string): Promise<Mod> {
    const mods = await scanMods(deadlockPath);
    const targetMod = mods.find((m) => m.id === modId);

    if (!targetMod) {
        throw new Error(`Mod not found: ${modId}`);
    }

    if (targetMod.enabled) {
        return targetMod;
    }

    const disabledPath = getDisabledPath(deadlockPath);

    // A still-disabled mod with a legacy pakNN name shares the bare-filename id
    // namespace with a base-folder file, so the base folder must avoid those
    // numbers (an overflow file's id is namespaced by its folder, so disabled
    // names can't collide there). The mod we're moving out is excluded.
    const disabledUsed = await folderPakNumbers(disabledPath);
    const ownNumber = parseVpkPriority(targetMod.fileName);
    if (ownNumber !== null) disabledUsed.delete(ownNumber);

    // Prefer the slot the mod last held, then its own legacy number, so a
    // re-enable returns it to roughly its old load-order position when free.
    // allocateSlot fills the base addons folder first, then each overflow folder
    // in order, minting a new one (and patching gameinfo) only when all are full.
    const meta = getModMetadata(targetMod.metaKey);
    const { folder, fileName } = await allocateSlot(deadlockPath, {
        disabledForbidden: disabledUsed,
        preferred: [meta?.lastPriority, ownNumber ?? undefined],
    });
    return moveModToFolderAs(targetMod, folder, fileName, true);
}

/**
 * Disable a mod by moving it to the disabled folder (async)
 */
export async function disableMod(deadlockPath: string, modId: string): Promise<Mod> {
    const mods = await scanMods(deadlockPath);
    const targetMod = mods.find((m) => m.id === modId);

    if (!targetMod) {
        throw new Error(`Mod not found: ${modId}`);
    }

    if (!targetMod.enabled) {
        return targetMod;
    }

    const disabledPath = getDisabledPath(deadlockPath);

    // Disabled mods carry no load-order slot, so give them a free-form unique
    // name (lifting the 99-name cap on the disabled library) and remember the
    // priority they held so re-enabling can restore it.
    const taken = existsSync(disabledPath)
        ? new Set((await fs.readdir(disabledPath)).map((n) => n.toLowerCase()))
        : new Set<string>();
    // Name the disabled file after the mod's display name (an enabled mod's own
    // filename is a bare pakNN with nothing readable to keep).
    const meta = getModMetadata(targetMod.metaKey);
    const preferredName = meta?.modName ?? meta?.sourceFileName ?? meta?.variantLabel;
    const destinationFileName = makeDisabledFileName(targetMod.fileName, taken, preferredName);

    return moveModToFolderAs(targetMod, disabledPath, destinationFileName, false, targetMod.priority);
}

/**
 * Delete a mod completely (async)
 */
export async function deleteMod(deadlockPath: string, modId: string): Promise<void> {
    const mods = await scanMods(deadlockPath);
    const targetMod = mods.find((m) => m.id === modId);

    if (!targetMod) {
        throw new Error(`Mod not found: ${modId}`);
    }

    await fs.unlink(targetMod.path);

    // Metadata is keyed by metaKey. If we leave it behind, the next mod that
    // is assigned the same slot will inherit the deleted mod's gameBananaId,
    // thumbnail, category, etc. via setModMetadata's merge.
    removeModMetadata(targetMod.metaKey);
}

/**
 * Replace the pak## prefix in a VPK filename with a new priority.
 */
function renameWithPriority(fileName: string, priority: number): string {
    const priorityStr = String(Math.min(MAX_VPK_PRIORITY, priority)).padStart(2, '0');
    return fileName.replace(/^pak\d{2}_/, `pak${priorityStr}_`);
}

/**
 * Set the priority of a mod by renaming its VPK file (async).
 * Also migrates metadata to the new filename.
 */
export async function setModPriority(
    deadlockPath: string,
    modId: string,
    newPriority: number
): Promise<Mod> {
    const mods = await scanMods(deadlockPath);
    const targetMod = mods.find((m) => m.id === modId);

    if (!targetMod) {
        throw new Error(`Mod not found: ${modId}`);
    }

    const parentDir = dirname(targetMod.path);
    const newFileName = renameWithPriority(targetMod.fileName, newPriority);

    if (newFileName === targetMod.fileName) {
        return targetMod;
    }

    // Reject a slot already taken in the mod's OWN folder. For a base-folder mod
    // also reject one held by a disabled file: the two share the bare-filename id
    // namespace, so reconcile would otherwise rename the disabled file on the next
    // scan and a merged-mod manifest pointing at it would lose its source.
    // (Overflow folders have a folder-prefixed id namespace, so disabled names
    // can't collide there.)
    const collides =
        existsSync(join(parentDir, newFileName)) ||
        (addonFolderIndex(targetMod.path) === 0 &&
            existsSync(join(getDisabledPath(deadlockPath), newFileName)));
    if (collides) {
        throw new Error(`Priority ${newPriority} is already in use`);
    }
    const newPath = join(parentDir, newFileName);
    await fs.rename(join(parentDir, targetMod.fileName), newPath);
    const newMetaKey = metaKeyFor(newPath);

    const oldMeta = getModMetadata(targetMod.metaKey);
    if (oldMeta) {
        setModMetadata(newMetaKey, oldMeta);
        removeModMetadata(targetMod.metaKey);
    }

    return {
        ...targetMod,
        priority: newPriority,
        fileName: newFileName,
        metaKey: newMetaKey,
        path: newPath,
        id: generateModId(newMetaKey),
    };
}

/**
 * Reorder the enabled mods to match the given order (async).
 *
 * `orderedIds` is the desired order of enabled mods (by id). They're laid out
 * densely across addon folders per Model A: the first 99 fill the base
 * citadel/addons (pak01..pak99), the next 99 fill addons1, then addons2, etc.
 * So flat position P maps to folderIndex floor((P-1)/99), slot ((P-1)%99)+1;
 * lower position = higher load-order priority.
 *
 * Slots held by mods NOT in the list are reserved so they're not overwritten: an
 * enabled mod keeps its slot in its own folder, and a legacy disabled pakNN
 * reserves that number in the BASE folder (it shares the bare-filename id
 * namespace). Disabled ids in the list are ignored - reordering never pulls a mod
 * out of .disabled (matches the old free-form-name no-op).
 *
 * Overflow folders are created and added to gameinfo before any file moves. A
 * two-phase rename (source -> temp in the target folder -> final) keeps
 * cross-folder moves and slot swaps collision-free; metadata migrates with each.
 */
export async function reorderMods(
    deadlockPath: string,
    orderedIds: string[]
): Promise<void> {
    const allMods = await scanMods(deadlockPath);
    const modById = new Map(allMods.map((m) => [m.id, m]));

    const targets: Mod[] = [];
    for (const id of orderedIds) {
        const mod = modById.get(id);
        if (!mod) throw new Error(`Mod not in list: ${id}`);
        if (mod.enabled) targets.push(mod);
    }
    if (targets.length === 0) return;
    const targetIds = new Set(targets.map((m) => m.id));

    // Reserve slots held by mods NOT being reordered, per folder index.
    const reservedByIndex = new Map<number, Set<number>>();
    const reserve = (idx: number, slot: number) => {
        const set = reservedByIndex.get(idx) ?? new Set<number>();
        set.add(slot);
        reservedByIndex.set(idx, set);
    };
    for (const m of allMods) {
        if (targetIds.has(m.id)) continue;
        const slot = parseVpkPriority(m.fileName);
        if (slot === null) continue; // free-form disabled: reserves nothing
        if (m.enabled) reserve(addonFolderIndex(m.path), slot);
        else reserve(0, slot); // legacy disabled pakNN blocks the base slot
    }

    // Generate dense (folderIndex, slot) addresses in priority order, skipping
    // reserved slots and advancing to the next folder when one fills.
    const addresses: Array<{ idx: number; slot: number }> = [];
    let idx = 0;
    let slot = MIN_VPK_PRIORITY;
    while (addresses.length < targets.length) {
        if (slot > MAX_VPK_PRIORITY) {
            idx++;
            slot = MIN_VPK_PRIORITY;
            if (idx > MAX_ADDON_FOLDERS - 1) throw new Error(ENABLE_LIMIT_MESSAGE);
            continue;
        }
        if (!reservedByIndex.get(idx)?.has(slot)) addresses.push({ idx, slot });
        slot++;
    }

    // Create the overflow folders the layout needs and make gameinfo list them
    // before moving any files in (or the engine won't load them).
    const maxIdx = addresses.reduce((mx, a) => Math.max(mx, a.idx), 0);
    if (maxIdx >= 1) {
        for (let k = 1; k <= maxIdx; k++) overflowAddonsPath(deadlockPath, k);
        const status = fixGameinfo(deadlockPath);
        if (!status.configured) {
            throw new Error(
                `Couldn't add the overflow mod folders to gameinfo.gi${status.message ? `: ${status.message}` : ''}. ` +
                    'Open Settings and use Fix Configuration, then try again.'
            );
        }
    }

    type Assignment = { mod: Mod; toFolder: string; toFileName: string; toMetaKey: string };
    const assignments: Assignment[] = [];
    for (let i = 0; i < targets.length; i++) {
        const mod = targets[i];
        const { idx: toIdx, slot: toSlot } = addresses[i];
        const toFolder = toIdx === 0 ? getAddonsPath(deadlockPath) : overflowAddonsPath(deadlockPath, toIdx);
        const toFileName = `pak${String(toSlot).padStart(2, '0')}_dir.vpk`;
        const toPath = join(toFolder, toFileName);
        if (mod.path !== toPath) {
            assignments.push({ mod, toFolder, toFileName, toMetaKey: metaKeyFor(toPath) });
        }
    }
    if (assignments.length === 0) return;

    // Two-phase rename: source -> temp (in the TARGET folder) -> final. Unique
    // temp names make cross-folder moves and same-folder slot swaps collision-free.
    const tmpId = randomBytes(4).toString('hex');
    type RenameStep = { fromPath: string; tmpPath: string; finalPath: string };
    const steps: RenameStep[] = assignments.map(({ mod, toFolder, toFileName }, i) => ({
        fromPath: mod.path,
        tmpPath: join(toFolder, `tmp${tmpId}_${i}_${toFileName}`),
        finalPath: join(toFolder, toFileName),
    }));

    const phase1Done: RenameStep[] = [];
    try {
        for (const step of steps) {
            await fs.rename(step.fromPath, step.tmpPath);
            phase1Done.push(step);
        }
    } catch (err) {
        for (const done of phase1Done.reverse()) {
            try {
                await fs.rename(done.tmpPath, done.fromPath);
            } catch { /* best-effort rollback */ }
        }
        throw err;
    }

    const phase2Done: RenameStep[] = [];
    try {
        for (const step of steps) {
            await fs.rename(step.tmpPath, step.finalPath);
            phase2Done.push(step);
        }
    } catch (err) {
        for (const done of phase2Done.reverse()) {
            try {
                await fs.rename(done.finalPath, done.tmpPath);
            } catch { /* ignore */ }
        }
        for (const step of steps) {
            try {
                await fs.rename(step.tmpPath, step.fromPath);
            } catch { /* ignore */ }
        }
        throw err;
    }

    migrateModMetadata(
        assignments.map(({ mod, toMetaKey }) => ({ from: mod.metaKey, to: toMetaKey }))
    );
}

/**
 * Swap the priorities of two mods (async).
 */
export async function swapModPriority(
    deadlockPath: string,
    modIdA: string,
    modIdB: string
): Promise<void> {
    const mods = await scanMods(deadlockPath);
    const a = mods.find((m) => m.id === modIdA);
    const b = mods.find((m) => m.id === modIdB);

    if (!a || !b) {
        throw new Error('Mod not found for swap');
    }
    if (a.priority === b.priority) {
        throw new Error('Cannot swap mods with identical priorities');
    }

    // Build the enabled mods in global load order (folder first, then pakNN),
    // swap A and B's positions, and hand the id order to reorderMods. We only
    // reorder enabled mods to avoid touching disabled-mod priorities.
    const globalPos = (m: Mod) => addonFolderIndex(m.path) * 100 + m.priority;
    const enabled = mods.filter((m) => m.enabled).sort((x, y) => globalPos(x) - globalPos(y));
    const aIdx = enabled.findIndex((m) => m.id === modIdA);
    const bIdx = enabled.findIndex((m) => m.id === modIdB);

    if (aIdx === -1 || bIdx === -1) {
        // At least one mod is disabled — fall back to direct priority swap via temp
        await directSwap(a, b);
        return;
    }

    const orderedIds = enabled.map((m) => m.id);
    [orderedIds[aIdx], orderedIds[bIdx]] = [orderedIds[bIdx], orderedIds[aIdx]];
    await reorderMods(deadlockPath, orderedIds);
}

/**
 * Direct swap of two mods' pak## priorities via a temp name.
 * Used when one or both mods live in the disabled folder.
 */
async function directSwap(a: Mod, b: Mod): Promise<void> {
    const parentA = dirname(a.path);
    const parentB = dirname(b.path);
    const tmpId = randomBytes(4).toString('hex');
    const steps = [
        {
            from: join(parentA, a.fileName),
            tmp: join(parentA, `tmp${tmpId}_${a.fileName}`),
            final: join(parentA, renameWithPriority(a.fileName, b.priority)),
        },
        {
            from: join(parentB, b.fileName),
            tmp: join(parentB, `tmp${tmpId}_${b.fileName}`),
            final: join(parentB, renameWithPriority(b.fileName, a.priority)),
        },
    ];

    for (const step of steps) await fs.rename(step.from, step.tmp);
    for (const step of steps) await fs.rename(step.tmp, step.final);

    migrateModMetadata([
        { from: a.metaKey, to: metaKeyFor(steps[0].final) },
        { from: b.metaKey, to: metaKeyFor(steps[1].final) },
    ]);
}
