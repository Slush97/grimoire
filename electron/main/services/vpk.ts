import { openSync, readSync, closeSync, existsSync, statSync } from 'fs';
import { heroForSoundCodename } from './heroSoundCodenames';
import { parseVpksInWorkers } from './workers';
import type { GlobalModType } from '../../../src/types/mod';

/**
 * VPK Header Structure (Version 2):
 * - Signature: 4 bytes (0x55AA1234)
 * - Version: 4 bytes
 * - TreeSize: 4 bytes (size of directory tree in bytes)
 *
 * After header comes the directory tree which contains:
 * - Extension strings (null-terminated)
 * - Path strings (null-terminated)
 * - Filename strings (null-terminated)
 *
 * We parse this to extract all file paths the VPK contains.
 */

const VPK_SIGNATURE = 0x55AA1234;

/**
 * Read a null-terminated string from a buffer at the given offset
 */
function readNullTerminatedString(buffer: Buffer, offset: number): { str: string; bytesRead: number } {
    let end = offset;
    while (end < buffer.length && buffer[end] !== 0) {
        end++;
    }
    const str = buffer.slice(offset, end).toString('utf-8');
    return { str, bytesRead: end - offset + 1 }; // +1 for null terminator
}

// Cache parsed VPK file lists keyed by (path, mtime, size). Conflict
// detection re-parses every enabled VPK on each scan, which previously
// pinned the main process for hundreds of ms with 60+ mods. Invalidates
// automatically when the file changes on disk; entries for deleted/missing
// VPKs are dropped opportunistically.
interface VpkCacheEntry {
    mtimeMs: number;
    size: number;
    paths: string[] | null;
}
const vpkParseCache = new Map<string, VpkCacheEntry>();

// Invalidation epochs guard the async (worker) parse path against a stale
// write-back: a VPK rewritten while a worker parse is in flight, to the same
// size within the same mtime tick, would otherwise land in the cache as if
// current (the Locker card/color/sound writers rewrite VPKs in place and then
// call invalidateVpkParseCache, which is exactly that shape). A worker result
// is only cached when both the per-path epoch and the global epoch still match
// their values at dispatch time. The sync path needs no guard: it parses
// current disk content by definition.
const cacheEpochs = new Map<string, number>();
let globalEpoch = 0;

// Dedupes concurrent async parses of the same path (e.g. a conflict scan and a
// get-mods pre-warm racing): the second caller awaits the first's result.
const inflightParses = new Map<string, Promise<string[] | null>>();

export function invalidateVpkParseCache(vpkPath?: string): void {
    if (vpkPath) {
        vpkParseCache.delete(vpkPath);
        cacheEpochs.set(vpkPath, (cacheEpochs.get(vpkPath) ?? 0) + 1);
    } else {
        vpkParseCache.clear();
        globalEpoch++;
    }
}

/** Optional counters callers can pass through a batch of cache lookups to
 *  measure hit rate. Conflict detection uses this to log whether the cache
 *  is doing its job on a given user's machine. */
export interface VpkParseStats {
    hits: number;
    misses: number;
}

/**
 * Parsed VPK file list with on-disk-aware caching. Re-uses the previous
 * parse when (path, mtime, size) is unchanged; otherwise falls through to
 * `parseVpkDirectory` and stores the fresh result.
 */
export function parseVpkDirectoryCached(vpkPath: string, stats?: VpkParseStats): string[] | null {
    let stat;
    try {
        stat = statSync(vpkPath);
    } catch {
        vpkParseCache.delete(vpkPath);
        return null;
    }

    const cached = vpkParseCache.get(vpkPath);
    if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
        if (stats) stats.hits++;
        return cached.paths;
    }

    if (stats) stats.misses++;
    const paths = parseVpkDirectory(vpkPath);
    vpkParseCache.set(vpkPath, { mtimeMs: stat.mtimeMs, size: stat.size, paths });
    return paths;
}

/**
 * Parse a batch of VPKs without blocking the main process: cache hits resolve
 * immediately, misses are parsed concurrently across the worker pool, and
 * results are written back into the shared cache so subsequent sync
 * parseVpkDirectoryCached calls hit for free.
 *
 * Failure handling degrades to exactly the pre-worker behavior: a per-file
 * worker error (e.g. file deleted mid-scan) and a wholesale pool failure
 * (including abort) both fall back to the sync parser on the main thread, so
 * callers always get the same results they would have gotten before this
 * function existed.
 */
export async function parseVpkDirectoriesAsync(
    vpkPaths: string[],
    options: { signal?: AbortSignal; stats?: VpkParseStats } = {}
): Promise<Map<string, string[] | null>> {
    const { signal, stats } = options;
    const results = new Map<string, string[] | null>();
    const pending: Array<Promise<void>> = [];
    const misses: string[] = [];

    for (const vpkPath of vpkPaths) {
        if (results.has(vpkPath) || misses.includes(vpkPath)) continue;

        let stat;
        try {
            stat = statSync(vpkPath);
        } catch {
            vpkParseCache.delete(vpkPath);
            results.set(vpkPath, null);
            continue;
        }

        const cached = vpkParseCache.get(vpkPath);
        if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
            if (stats) stats.hits++;
            results.set(vpkPath, cached.paths);
            continue;
        }
        if (stats) stats.misses++;

        const inflight = inflightParses.get(vpkPath);
        if (inflight) {
            pending.push(inflight.then((paths) => { results.set(vpkPath, paths); }));
            continue;
        }
        misses.push(vpkPath);
    }

    if (misses.length > 0) {
        const globalEpochAtDispatch = globalEpoch;
        const epochsAtDispatch = new Map<string, number>();
        const resolvers = new Map<string, (paths: string[] | null) => void>();
        for (const vpkPath of misses) {
            epochsAtDispatch.set(vpkPath, cacheEpochs.get(vpkPath) ?? 0);
            const promise = new Promise<string[] | null>((resolve) => {
                resolvers.set(vpkPath, resolve);
            });
            inflightParses.set(vpkPath, promise);
            pending.push(promise.then((paths) => { results.set(vpkPath, paths); }));
        }

        // Settle one path: optionally cache (worker results only, and only when
        // no invalidation happened since dispatch), then release waiters.
        const finish = (
            vpkPath: string,
            paths: string[] | null,
            workerStat?: { mtimeMs: number; size: number }
        ): void => {
            if (
                workerStat &&
                globalEpoch === globalEpochAtDispatch &&
                (cacheEpochs.get(vpkPath) ?? 0) === epochsAtDispatch.get(vpkPath)
            ) {
                vpkParseCache.set(vpkPath, { mtimeMs: workerStat.mtimeMs, size: workerStat.size, paths });
            }
            inflightParses.delete(vpkPath);
            resolvers.get(vpkPath)?.(paths);
            resolvers.delete(vpkPath);
        };

        try {
            const workerResults = await parseVpksInWorkers(
                misses.map((vpkPath) => ({ id: vpkPath, vpkPath })),
                { signal }
            );
            for (const result of workerResults) {
                if (result.error) {
                    // Same cost as before this function existed, for this one file.
                    finish(result.vpkPath, parseVpkDirectoryCached(result.vpkPath));
                } else {
                    finish(result.vpkPath, result.paths, { mtimeMs: result.mtimeMs, size: result.size });
                }
            }
        } catch (error) {
            console.warn('[parseVpkDirectoriesAsync] worker pool failed, falling back to sync parse:', error);
            for (const vpkPath of misses) {
                if (!resolvers.has(vpkPath)) continue;
                finish(vpkPath, parseVpkDirectoryCached(vpkPath));
            }
        }
    }

    await Promise.all(pending);
    return results;
}

/**
 * Parse VPK directory tree to extract all file paths
 * Returns null if the file is not a valid VPK or can't be parsed
 */
export function parseVpkDirectory(vpkPath: string): string[] | null {
    if (!existsSync(vpkPath)) {
        return null;
    }

    try {
        const fd = openSync(vpkPath, 'r');

        // Read basic header first (12 bytes) to check signature and version
        const headerBuffer = Buffer.alloc(12);
        readSync(fd, headerBuffer, 0, 12, 0);

        const signature = headerBuffer.readUInt32LE(0);
        if (signature !== VPK_SIGNATURE) {
            closeSync(fd);
            return null;
        }

        const version = headerBuffer.readUInt32LE(4);
        const treeSize = headerBuffer.readUInt32LE(8);

        // VPK v2 has an extended header (28 bytes total vs 12 for v1)
        // After the first 12 bytes, v2 has: FileDataSectionSize(4) + ArchiveMD5SectionSize(4) + OtherMD5SectionSize(4) + SignatureSectionSize(4)
        const headerSize = version === 2 ? 28 : 12;

        // Read the directory tree (starts after the full header)
        const treeBuffer = Buffer.alloc(treeSize);
        readSync(fd, treeBuffer, 0, treeSize, headerSize);
        closeSync(fd);

        const paths: string[] = [];
        let offset = 0;
        let properlyTerminated = false;

        // Parse directory tree
        // Structure: extension\0 (path\0 (filename\0 entry_data)*)* until empty extension
        while (offset < treeBuffer.length) {
            // Read extension
            const extResult = readNullTerminatedString(treeBuffer, offset);
            offset += extResult.bytesRead;

            if (extResult.str === '') {
                properlyTerminated = true;
                break; // End of tree (empty extension = proper termination)
            }

            const extension = extResult.str;
            let extensionProperlyTerminated = false;

            // Read paths for this extension
            while (offset < treeBuffer.length) {
                const pathResult = readNullTerminatedString(treeBuffer, offset);
                offset += pathResult.bytesRead;

                if (pathResult.str === '') {
                    extensionProperlyTerminated = true;
                    break; // End of paths for this extension
                }

                // Space means root directory in VPK format
                const dirPath = pathResult.str === ' ' ? '' : pathResult.str;
                let pathProperlyTerminated = false;

                // Read filenames for this path
                while (offset < treeBuffer.length) {
                    const nameResult = readNullTerminatedString(treeBuffer, offset);
                    offset += nameResult.bytesRead;

                    if (nameResult.str === '') {
                        pathProperlyTerminated = true;
                        break; // End of filenames for this path
                    }

                    const filename = nameResult.str;

                    // Build full path
                    const fullPath = dirPath
                        ? `${dirPath}/${filename}.${extension}`
                        : `${filename}.${extension}`;

                    paths.push(fullPath);

                    // Skip the entry data (18 bytes for version 2)
                    // CRC (4) + PreloadBytes (2) + ArchiveIndex (2) + EntryOffset (4) + EntryLength (4) + Terminator (2)
                    offset += 18;

                    // Skip preload data if any
                    // PreloadBytes is at offset 4 in the entry (after CRC), so offset - 14 after skipping 18
                    if (offset - 14 >= 0 && offset - 14 < treeBuffer.length - 1) {
                        const preloadBytes = treeBuffer.readUInt16LE(offset - 14);
                        offset += preloadBytes;
                    }
                }

                // Warn if filename loop exited due to buffer exhaustion instead of proper termination
                if (!pathProperlyTerminated) {
                    console.warn(`[parseVpkDirectory] Warning: Filename section for path "${dirPath}" (ext: ${extension}) did not terminate properly - buffer exhausted at offset ${offset}/${treeBuffer.length}`);
                }
            }

            // Warn if path loop exited due to buffer exhaustion instead of proper termination
            if (!extensionProperlyTerminated) {
                console.warn(`[parseVpkDirectory] Warning: Path section for extension "${extension}" did not terminate properly - buffer exhausted at offset ${offset}/${treeBuffer.length}`);
            }
        }

        // Validate tree was properly terminated
        if (!properlyTerminated) {
            console.warn(`[parseVpkDirectory] ${vpkPath}: tree did not terminate properly (offset ${offset}/${treeBuffer.length}). Some files may be missing from conflict detection.`);
        }

        // Check if there's unexpected data after tree termination
        if (properlyTerminated && offset < treeBuffer.length) {
            const remainingBytes = treeBuffer.length - offset;
            // Small amount of padding is acceptable, but large amounts suggest parsing error
            if (remainingBytes > 16) {
                console.warn(`[parseVpkDirectory] ${vpkPath}: ${remainingBytes} bytes remaining after tree termination.`);
            }
        }

        return paths;
    } catch (error) {
        console.error(`[parseVpkDirectory] Error parsing ${vpkPath}:`, error);
        return null;
    }
}

/**
 * Extract hero name from a VPK file path if it's a hero-related file
 * Returns null if not a hero file
 */
export function extractHeroFromPath(filePath: string): string | null {
    // Hero path patterns for Source 2 games (including Deadlock which uses heroes_wip)
    const patterns = [
        // Standard Source 2 patterns
        /models\/heroes\/([^/]+)\//i,
        /materials\/models\/heroes\/([^/]+)\//i,
        /particles\/heroes\/([^/]+)\//i,
        /sounds\/heroes\/([^/]+)\//i,
        /scripts\/heroes\/([^/]+)/i,
        // Deadlock-specific patterns (uses heroes_wip instead of heroes)
        /models\/heroes_wip\/([^/]+)\//i,
        /materials\/models\/heroes_wip\/([^/]+)\//i,
        /materials\/heroes_wip\/([^/]+)\//i,
        /particles\/heroes_wip\/([^/]+)\//i,
        /sounds\/heroes_wip\/([^/]+)\//i,
        /scripts\/heroes_wip\/([^/]+)/i,
    ];

    for (const pattern of patterns) {
        const match = filePath.match(pattern);
        if (match) {
            return match[1].toLowerCase();
        }
    }

    return null;
}

/**
 * Sound mod path patterns. Sound mods don't live under `sounds/heroes/`
 * the way skin VPKs do: they live under `sounds/abilities/<codename>/aN_X/`
 * or, more rarely, under `sounds/heroes/<codename>/`. The codename is
 * Deadlock's sound-path namespace (e.g. `ghost` for Lady Geist, `hornet`
 * for Vindicta), translated via HERO_SOUND_CODENAMES below.
 *
 * `soundevents/` files (e.g. `soundevents/citadel/hero_ghost.vsndevts_c`)
 * are also a strong signal but live outside `sounds/`. We match those too.
 */
const SOUND_HERO_PATTERNS: RegExp[] = [
    /(?:^|\/)sounds\/abilities\/([a-z0-9_]+)\//i,
    /(?:^|\/)sounds\/heroes\/([a-z0-9_]+)\//i,
    /(?:^|\/)sounds\/[^/]+\/hero_([a-z0-9_]+)\//i,
    // `soundevents/citadel/hero_<codename>.vsndevts_c` (hero_ prefix on file).
    /(?:^|\/)soundevents\/[^/]*\/hero_([a-z0-9_]+)\.vsndevts/i,
    // `soundevents/hero/<codename>.vsndevts_c` (hero is the folder, file is
    // just the codename). Observed on pak04 "We don't talk Animal" which
    // ships soundevents/hero/werewolf.vsndevts_c.
    /(?:^|\/)soundevents\/hero\/([a-z0-9_]+)\.vsndevts/i,
];

/**
 * Inspect a VPK's path list for sound-mod payloads and return the display
 * name of the hero they target. Returns null when no recognized hero
 * codename appears, or when the VPK touches more than one hero (we'd
 * rather leave that case to manual tagging than pick the wrong one).
 */
export function inferHeroFromVpkPaths(paths: string[]): string | null {
    const heroes = new Set<string>();
    for (const filePath of paths) {
        for (const pattern of SOUND_HERO_PATTERNS) {
            const match = filePath.match(pattern);
            if (!match) continue;
            const hero = heroForSoundCodename(match[1]);
            if (hero) {
                heroes.add(hero);
                break;
            }
        }
        // Bail early once we've already seen a conflict: no point scanning
        // the rest of a large VPK if the answer is already "ambiguous."
        if (heroes.size > 1) return null;
    }
    return heroes.size === 1 ? [...heroes][0] : null;
}

/**
 * Convenience wrapper: parse the VPK directory and run the path-based
 * inference. Returns null when the VPK can't be parsed or no hero matches.
 *
 * Uses the cached parser because enrichMod calls this once per Sound mod on
 * every scan, and failed inferences are not persisted: without the cache we
 * re-open the same VPK on every get-mods, import, enable, and reorder.
 */
export function inferHeroFromVpk(vpkPath: string): string | null {
    const paths = parseVpkDirectoryCached(vpkPath);
    if (!paths || paths.length === 0) return null;
    return inferHeroFromVpkPaths(paths);
}

/**
 * Global (non-hero) cosmetic mod types the Locker groups on a second axis,
 * alongside the per-hero piles. Detected from the VPK file tree because
 * GameBanana's category labels are unreliable here: hideout portraits land in
 * "Other/Misc", icon packs split between "Character HUD" and the hero's own
 * name, and "QOL Lock" is tagged HUD but is really an announcer framework.
 * The path signals below were verified against real installed mods.
 * The GlobalModType union is shared from src/types/mod so the renderer's
 * Locker grouping/UI agrees with this classifier.
 */

/**
 * Hero skin / ability payload. A VPK touching any of these is a hero cosmetic
 * and belongs on the Locker's hero axis, NOT a global slide — even if it also
 * ships a few incidental icons. This guard is what keeps a skin bundle like
 * "Yamato redesign" (mostly models/heroes_staging + particles/abilities, with
 * 9 stray panorama/images/heroes icons) out of the Icons & Portraits bucket.
 */
const HERO_PAYLOAD_PATTERNS: RegExp[] = [
    /(?:^|\/)models\/heroes(?:_wip|_staging)?\//i,
    /(?:^|\/)materials\/(?:models\/)?heroes(?:_wip|_staging)?\//i,
    /(?:^|\/)particles\/(?:heroes(?:_wip|_staging)?|abilities)\//i,
];

/**
 * Model-based global signals are unambiguous: the file root names the type.
 *   soul-container  models/props_gameplay/soul_container/   (7/7 mods)
 *   hideout         models/hideout/                         (the 3D displays)
 *   hud             panorama/layout|styles|images/hud/       (.vxml_c/.vcss_c)
 * The icons case is special (see classifyGlobalModType) because the same
 * panorama/images/heroes/ folder holds both global packs and single-hero art.
 */
const SOUL_CONTAINER_PATTERN = /(?:^|\/)models\/props_gameplay\/soul_container\//i;
const URN_CONTAINER_PATTERN = /(?:^|\/)models\/props_gameplay\/idol_urn\//i;
// Compiled model file. Used to break a soul-container/urn tie by which prop's
// MODEL (not just incidental materials) the mod actually overrides.
const VMDL_PATTERN = /\.vmdl_c?$/i;
const HIDEOUT_PATTERN = /(?:^|\/)models\/hideout\//i;
const HUD_PATTERN = /(?:^|\/)panorama\/(?:layout|styles|images\/hud)\//i;
const HERO_IMAGE_PREFIX = /(?:^|\/)panorama\/images\/heroes\//i;
// `sounds/mods/` is the file-level home for global SFX / announcer frameworks
// (QOL Lock and its announcer packs). Distinct from hero SFX, which live under
// `sounds/abilities|heroes|vo/<codename>/` (SOUND_HERO_PATTERNS), so this never
// catches a hero-tied sound.
const ANNOUNCER_PATTERN = /(?:^|\/)sounds\/mods\//i;

/**
 * Distinct hero codenames referenced by panorama/images/heroes files. The
 * codename is the FILENAME prefix (before the first underscore), e.g.
 * `drifter_card_psd` -> `drifter` (`vampirebat` = Mina, `archer` = Grey Talon).
 * We key off the filename rather than the path segment after `heroes/` because
 * some packs nest art in subfolders like `heroes/backgrounds/drifter_bg_psd` —
 * counting the `backgrounds` folder as a hero would wrongly tip a single-hero
 * mod over into the multi-hero "pack" bucket.
 *
 * We only need the cardinality, never the display name: a file set spanning
 * many heroes is a global icon pack; a single hero's cards/portraits belong to
 * that hero.
 */
function heroImageCodenames(paths: string[]): Set<string> {
    const codenames = new Set<string>();
    for (const p of paths) {
        if (!HERO_IMAGE_PREFIX.test(p)) continue;
        const basename = p.split('/').pop() ?? '';
        const codename = basename.toLowerCase().split('_')[0];
        if (codename) codenames.add(codename);
    }
    return codenames;
}

/**
 * Classify a VPK's file tree as one of the global (non-hero) cosmetic types,
 * or null when it's a hero cosmetic / unrecognized. Mirrors
 * inferHeroFromVpkPaths: returns a single confident answer or nothing.
 *
 * The panorama/images/heroes case is decided by hero CARDINALITY, not the
 * folder alone: a pack that reskins MANY heroes' cards is a global "Icons &
 * Portraits" pack, but a file set for a SINGLE hero is that hero's portrait/
 * card (often shipped alongside a skin) and belongs on the hero axis — so we
 * return null and let the per-hero grouping claim it.
 */
/**
 * Bump when the global-type patterns above change. enrichMod re-runs
 * classification for mods whose stored result was a stale `null` stamped with
 * an older version, so pattern improvements (e.g. new HUD paths) reach
 * already-installed mods without a manual retag or a metadata migration.
 */
export const GLOBAL_CLASSIFIER_VERSION = 3;

export function classifyGlobalModType(paths: string[]): GlobalModType | null {
    if (paths.length === 0) return null;
    // Hero skin / ability payload wins outright: those belong on the hero axis.
    if (paths.some((p) => HERO_PAYLOAD_PATTERNS.some((re) => re.test(p)))) {
        return null;
    }
    // Soul containers and spirit urns are sibling props under props_gameplay.
    // A single VPK can touch BOTH folders (e.g. a urn reskin that ships a stray
    // soul_container material, or vice versa), so a plain soul-before-urn order
    // would mis-file it. When both match, break the tie by which prop's actual
    // MODEL (.vmdl_c) is overridden: that's the prop the mod really reskins.
    // Texture-only packs (a model in neither folder) keep the soul-first
    // precedence, preserving the existing texture-only soul-container behavior.
    const hasSoul = paths.some((p) => SOUL_CONTAINER_PATTERN.test(p));
    const hasUrn = paths.some((p) => URN_CONTAINER_PATTERN.test(p));
    if (hasSoul && hasUrn) {
        const soulModel = paths.some((p) => SOUL_CONTAINER_PATTERN.test(p) && VMDL_PATTERN.test(p));
        const urnModel = paths.some((p) => URN_CONTAINER_PATTERN.test(p) && VMDL_PATTERN.test(p));
        return urnModel && !soulModel ? 'spirit-urn' : 'soul-container';
    }
    if (hasSoul) return 'soul-container';
    if (hasUrn) return 'spirit-urn';
    if (paths.some((p) => HIDEOUT_PATTERN.test(p))) return 'hideout';

    const heroImages = heroImageCodenames(paths);
    if (heroImages.size >= 2) return 'icons'; // multi-hero pack = global
    if (heroImages.size === 1) return null; // one hero = that hero's content

    if (paths.some((p) => HUD_PATTERN.test(p))) return 'hud';
    if (paths.some((p) => ANNOUNCER_PATTERN.test(p))) return 'announcer';
    return null;
}

/**
 * Convenience wrapper: parse the VPK directory (cached) and classify. Returns
 * null when the VPK can't be parsed or matches no global type. Cached because,
 * like inferHeroFromVpk, this runs once per mod on every scan.
 */
export function classifyGlobalModFromVpk(vpkPath: string): GlobalModType | null {
    const paths = parseVpkDirectoryCached(vpkPath);
    if (!paths || paths.length === 0) return null;
    return classifyGlobalModType(paths);
}

/**
 * Ability-VFX layer roots. A hero's recolorable ability effects live in two
 * particle dirs, keyed by the model/particle codename (Paige = `bookworm`),
 * which is the namespace used by `models/`+`particles/abilities/`, NOT the
 * sound-path codename used by SOUND_HERO_PATTERNS:
 *   particles/abilities/<codename>/   (the 4 abilities + ult, melee, dash)
 *   particles/weapon_fx/<codename>/   (primary-fire muzzle/tracer/impact fx)
 * Isolating exactly these lets the recolor be layered onto a different body
 * skin. The ult-dragon material (models/heroes_wip/<codename>/materials/) and
 * ability sounds are deliberately out of scope here: the dragon has no path
 * convention separating it from the body model, so it's handled by a
 * regenerate-from-base hue shift instead of extraction (see docs).
 */
const VFX_LAYER_PATTERNS: RegExp[] = [
    /(?:^|\/)particles\/abilities\/([a-z0-9_]+)\//i,
    /(?:^|\/)particles\/weapon_fx\/([a-z0-9_]+)\//i,
];

export interface VfxLayer {
    /** Model/particle codename the VFX targets (e.g. `bookworm` = Paige). */
    codename: string;
    /** Every `particles/{abilities,weapon_fx}/<codename>/` entry in the VPK. */
    paths: string[];
    /** Split-plan prefixes that select exactly this layer (no leading slash,
     *  to match valve_pak entry paths and vpkmerge's starts_with predicate). */
    prefixes: string[];
}

/**
 * Detect a single-hero ability-VFX layer in a VPK's path list. Returns null
 * when no ability/weapon_fx particles are present, or when more than one
 * codename appears (we won't guess which hero owns a mixed VPK). Mirrors
 * inferHeroFromVpkPaths' "one confident answer or nothing" contract.
 */
export function detectVfxLayer(paths: string[]): VfxLayer | null {
    const byCodename = new Map<string, string[]>();
    for (const filePath of paths) {
        for (const re of VFX_LAYER_PATTERNS) {
            const match = filePath.match(re);
            if (!match) continue;
            const codename = match[1].toLowerCase();
            const list = byCodename.get(codename);
            if (list) list.push(filePath);
            else byCodename.set(codename, [filePath]);
            break;
        }
    }
    if (byCodename.size !== 1) return null;
    const [codename, vfxPaths] = [...byCodename][0];
    return {
        codename,
        paths: vfxPaths.sort(),
        prefixes: [
            `particles/abilities/${codename}/`,
            `particles/weapon_fx/${codename}/`,
        ],
    };
}

/**
 * Convenience wrapper: parse the VPK directory (cached) and detect a VFX layer.
 * Returns null when the VPK can't be parsed or carries no single-hero VFX.
 */
export function detectVfxLayerFromVpk(vpkPath: string): VfxLayer | null {
    const paths = parseVpkDirectoryCached(vpkPath);
    if (!paths || paths.length === 0) return null;
    return detectVfxLayer(paths);
}

/**
 * Best-effort label derived from a VPK's file tree (VPKs have no authored
 * title). Returns null when nothing distinctive matches — caller should
 * fall back to the filename rather than guess.
 */
export function getVpkLabel(vpkPath: string): string | null {
    const paths = parseVpkDirectory(vpkPath);
    if (!paths || paths.length === 0) return null;

    const titleCase = (s: string) =>
        s.replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()).trim();

    const heroes = new Set<string>();
    for (const p of paths) {
        const hero = extractHeroFromPath(p);
        if (hero) heroes.add(hero);
    }
    if (heroes.size > 0 && heroes.size <= 3) {
        return [...heroes].map(titleCase).join(', ');
    }

    const extractUnique = (pattern: RegExp): string[] => {
        const set = new Set<string>();
        for (const p of paths) {
            const m = p.match(pattern);
            if (m?.[1]) set.add(m[1].toLowerCase());
        }
        return [...set];
    };

    const skyboxes = extractUnique(/materials\/skybox\/([^/]+)\//i);
    if (skyboxes.length === 1) return `${titleCase(skyboxes[0])} skybox`;
    if (skyboxes.length > 1 && skyboxes.length <= 3) {
        return `${skyboxes.map(titleCase).join(', ')} skyboxes`;
    }

    const maps = extractUnique(/^maps\/([^/]+?)(?:\.|\/)/i);
    if (maps.length === 1) return `${titleCase(maps[0])} map`;

    const uiThemes = extractUnique(/panorama\/(?:images|layout|styles)\/(?:hud|themes?)\/([^/]+)\//i);
    if (uiThemes.length === 1) return `${titleCase(uiThemes[0])} UI`;

    return null;
}

/** Batch wrapper around getVpkLabel; omits entries with no label. */
export function getVpkLabels(vpkPaths: Array<{ fileName: string; absPath: string }>): Record<string, string> {
    const out: Record<string, string> = {};
    for (const { fileName, absPath } of vpkPaths) {
        try {
            const label = getVpkLabel(absPath);
            if (label) out[fileName] = label;
        } catch {
            // best-effort; missing label is fine
        }
    }
    return out;
}

/**
 * Get a summary of what a VPK modifies
 */
export function getVpkContentSummary(vpkPath: string): {
    heroes: Set<string>;
    fileCount: number;
    samplePaths: string[];
} {
    const paths = parseVpkDirectory(vpkPath);

    if (!paths) {
        return { heroes: new Set(), fileCount: 0, samplePaths: [] };
    }

    const heroes = new Set<string>();

    for (const path of paths) {
        const hero = extractHeroFromPath(path);
        if (hero) {
            heroes.add(hero);
        }
    }

    return {
        heroes,
        fileCount: paths.length,
        samplePaths: paths.slice(0, 5), // First 5 paths as sample
    };
}
