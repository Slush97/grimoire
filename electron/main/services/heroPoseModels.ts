/**
 * Per-hero static "pose" model store.
 *
 * The Locker's per-hero view shows a flat 2D portrait. This service produces a
 * lightweight 3D still of the hero striking their menu pose so the Locker can
 * render the actual model (and the actual active skin) instead.
 *
 * Built with the bundled `vpkmerge model export --pose`: it bakes one animation
 * frame into the mesh and emits a *static* `.glb` (no skeleton, skin, or clips)
 * with Deadlock's inverted-hull `*_outline` and additive `*_glow` shells
 * dropped (both collapse to an opaque white halo as plain glTF). For a skin the
 * pose clip is mapped from the base pak onto the skin's own rig by bone name
 * (same hero = same rig), so a skin VPK that ships zero clips still poses.
 *
 * Keyed per (hero, active skin) so each skin caches its own still and switching
 * skins is instant once generated. A texture-only skin (or no skin) falls back
 * to the base pak's mesh while the skin's textures still win.
 *
 * Layout: userData/hero-poses/<key>/model.glb
 *
 * The renderer can't read userData files directly under file:// + webSecurity,
 * so they're served through the registered `grimoire-hero:` scheme
 * (see registerHeroPoseProtocol).
 */
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { pathToFileURL } from 'url';
import { app, protocol, net } from 'electron';
import { runVpkmerge, verifyVpkOutput } from './modMerger';
import { codenamesForHero } from './heroPortraits';
import { getCitadelPath, getAddonsPath, getDisabledPath } from './deadlock';

export const HERO_POSE_SCHEME = 'grimoire-hero';

/**
 * Heroes whose body-model file basename diverges from their panorama codename,
 * so `--hero <panorama>` discovery (`<dir>/<codename>.vmdl_c` under
 * `models/heroes*`) misses them. Verified against the base pak: these names are
 * the actual `.vmdl_c` basenames. Every other hero resolves from its panorama
 * codename (codenamesForHero), so only the divergent ones are listed here.
 *
 * `--hero` matches by file basename regardless of the `_vN` dir, so e.g.
 * Vindicta's `hornet_v3/hornet.vmdl_c` is found by plain `hornet` and needs no
 * entry here.
 */
const MODEL_CODENAME_OVERRIDES: Readonly<Record<string, string[]>> = {
    Abrams: ['atlas_detective'],
    McGinnis: ['engineer'],
    'Grey Talon': ['archer'],
    'Mo & Krill': ['digger'],
    Seven: ['gigawatt_prisoner'],
};

/**
 * Heroes Valve reworked in the "6 hero update": the current body model moved to
 * `models/heroes_wip/<name>/<name>.vmdl_c` (a fresh dir keyed by the display
 * name) while the pre-rework model stayed behind under
 * `heroes_staging/<codename>[_vN]`. `--hero <codename>` discovery picks the
 * highest-`_vN` basename match, so for these heroes it lands on the STALE model
 * and the Locker showed the wrong body. Pin the exact current entry instead.
 *
 * An explicit `--entry` is also more correct than `--hero` once a skin is active:
 * a modern skin overrides the game's canonical path (these very paths), which a
 * codename/version mismatch in discovery could miss, silently falling back to
 * the vanilla base mesh.
 *
 * Verified against the installed pak (2026-05-29) and reconciled live in-game by
 * a community reporter (#bugs "3D Preview pulling wrong model"): each entry
 * decodes, carries a real menu pose, and is the current model. Viscous is a
 * no-op today (`--hero viscous` already resolves here) but pinned for the same
 * skin-path robustness. Rem is pinned to `familiar_wip`: the plain
 * `familiar.vmdl_c` exports a live skeleton/clip with every rendered vertex
 * weighted to pelvis, so the mixer advances while the mesh stays effectively
 * bind-posed. Deliberately NOT pinned: Infernus (its current
 * `heroes_wip/inferno` ships no menu/idle pose clip, so `--require-pose` would
 * drop it to a 2D portrait; `--hero inferno` already resolves to a poseable
 * same-size model) and Billy (`punkgoat` ships the rig but no pose clip and
 * already falls back to 2D).
 */
const MODEL_ENTRY_OVERRIDES: Readonly<Record<string, string>> = {
    Abrams: 'models/heroes_wip/abrams/abrams.vmdl_c',
    McGinnis: 'models/heroes_wip/mcginnis/mcginnis.vmdl_c',
    Pocket: 'models/heroes_wip/pocket/pocket.vmdl_c',
    Ivy: 'models/heroes_wip/ivy/ivy.vmdl_c',
    'Lady Geist': 'models/heroes_wip/geist/geist.vmdl_c',
    Rem: 'models/heroes_wip/familiar/familiar_wip.vmdl_c',
    Viscous: 'models/heroes_staging/viscous/viscous.vmdl_c',
};

/** Model codenames to try for a hero, most-specific first: any divergent
 *  body-model basename, then the panorama codename(s) that cover the rest of
 *  the roster. De-duplicated, order preserved. */
function modelCodenamesForHero(heroName: string): string[] {
    const ordered = [...(MODEL_CODENAME_OVERRIDES[heroName] ?? []), ...codenamesForHero(heroName)];
    return [...new Set(ordered)];
}

/**
 * The vpkmerge `model export` selectors to try for a hero, in order. A reworked
 * hero with a pinned entry resolves to a single exact `--entry`; everyone else
 * falls back to `--hero <codename>` auto-discovery for each candidate codename.
 * Each element is the discriminating arg pair spliced into the export command.
 */
function modelSelectorsForHero(heroName: string): string[][] {
    const entry = MODEL_ENTRY_OVERRIDES[heroName];
    if (entry) return [['--entry', entry]];
    return modelCodenamesForHero(heroName).map((codename) => ['--hero', codename]);
}

function sanitize(value: string): string {
    return value.replace(/[^a-zA-Z0-9_-]+/g, '_');
}

/** Storage key for a hero's pose still. Combines the hero with the active skin
 *  (a skin metaKey, or `vanilla` for the base look) so each skin caches its own
 *  still. Lowercased because the skin half is a VPK name, unique case-
 *  insensitively. */
export interface HeroPoseSkinSource {
    metaKey: string;
    priority: number;
}

function poseKey(heroName: string, skinSources: HeroPoseSkinSource[] = []): string {
    if (skinSources.length === 0) return `${heroName}::vanilla`;
    if (skinSources.length === 1) return `${heroName}::${skinSources[0].metaKey}`;
    const stack = skinSources
        .map((source) => `${source.priority}:${source.metaKey}`)
        .join('+');
    return `${heroName}::stack::${stack}`;
}

function modelDir(key: string): string {
    return join(app.getPath('userData'), 'hero-poses', sanitize(key.toLowerCase()));
}

/** Static (`--pose`) baked still. The legacy/default glb. */
const STATIC_MODEL_FILENAME = 'model.glb';
/** Rigged (no `--pose`, single idle-clip) SkinnedMesh + animated glb. Sibling of
 *  the static glb in the same entry dir; served over the same scheme. */
const RIGGED_MODEL_FILENAME = 'model-rigged.glb';

function modelFile(key: string): string {
    return join(modelDir(key), STATIC_MODEL_FILENAME);
}

function riggedModelFile(key: string): string {
    return join(modelDir(key), RIGGED_MODEL_FILENAME);
}

/**
 * Cache schema version for stored poses. Bump when the export pipeline changes
 * in a way that invalidates cached GLBs: a bundled-vpkmerge fix, a shell-drop
 * rule change, or a Deadlock patch that reworks a hero's model. A cached GLB is
 * served only when its sidecar marker matches this; on a mismatch the pose is
 * treated as absent and regenerated in place (the new GLB overwrites the old, so
 * no per-version directories pile up on disk).
 *
 * v2: bundled vpkmerge gained deterministic hero-model discovery, `--require-pose`
 * (so clipless WIP heroes fall back to the 2D portrait instead of a T-pose), and
 * the comic-outline (`*jitter*`) shell drop. Pre-v2 GLBs (unversioned) are stale.
 *
 * v3: reworked heroes (Abrams, McGinnis, Pocket, Ivy, Lady Geist, ...) now pin
 * their exact current `heroes_wip` entry instead of `--hero` discovery, which had
 * been resolving to the stale pre-rework body. Pre-v3 GLBs cached the wrong model.
 *
 * v4: Rem now pins `familiar_wip.vmdl_c`; old cached Familiar GLBs targeted
 * `familiar.vmdl_c`, whose rendered vertices are all pelvis-weighted.
 *
 * v5: glb.rs material-export fixes (roughness from the normal texture's BLUE
 * channel not its constant alpha, normal-Z reconstruction, and constant
 * metalness/roughness/color-tint fallbacks), so PBR reads correctly under the
 * new IBL. Old GLBs baked fully-rough/matte surfaces; forces a re-export.
 *
 * v6: sheen now reads TextureSheenColor1 * tint and binds the g_tSheen texture
 * (was white sheen on most cloth), and glass honors the authored g_flIOR.
 *
 * v7: vpkmerge fixed draw-call index offsets for resourcecompiler/global-index
 * meshes. Pre-v7 cached GLBs can contain out-of-range primitive indices, which
 * renders shredded in three.js even after the bundled binary is fixed.
 *
 * v8: vpkmerge static pose baking keeps Source 2 secondary-motion cloth/fabric
 * chains bind-relative instead of freezing their authored sim tracks mid-pose.
 * Pre-v8 GLBs can show detached coat tails, skirts, and cloth panels.
 *
 * v9: same static-pose fabric fix, with old dev preview caches force-expired
 * after confirming one-frame menu poses can carry unsolved cloth state.
 */
const POSE_CACHE_VERSION = '9';

const POSE_VERSION_FILENAME = '.cache-version';

function versionFile(key: string): string {
    return join(modelDir(key), POSE_VERSION_FILENAME);
}

/**
 * Cache schema version for stored RIGGED (animated, skinned) hero glbs. Bumped
 * INDEPENDENTLY of POSE_CACHE_VERSION so a change to one export pipeline never
 * invalidates the other's cache. v1: initial rigged-export spine: no `--pose`,
 * filtered to a single looping idle clip, emitting skin + per-bone nodes + one
 * glTF animation.
 *
 * v2: same vpkmerge index-offset fix as POSE_CACHE_VERSION v7.
 */
const RIGGED_CACHE_VERSION = '2';

const RIGGED_VERSION_FILENAME = '.rigged-cache-version';

function riggedVersionFile(key: string): string {
    return join(modelDir(key), RIGGED_VERSION_FILENAME);
}

/**
 * The single idle clip kept in a rigged export. Pass EXACTLY ONE `--clip`: the
 * CLI's `--clip` is ADDITIVE (retains EVERY matching clip), so a candidate LIST
 * would keep two competing idle loops on heroes that carry more than one
 * (verified: abrams with 4 candidates = 52 MB / 2 anims vs 50.7 MB / 1 anim for
 * the single clip). `primary_stand_idle` is the universal idle: present on every
 * resolvable hero tested (haze, abrams, astro, bebop, ...; 81-91 keyframes,
 * ~3.0s loop). A model lacking it exports a valid skinned BIND-POSE glb
 * (anims=0), which the viewer renders without a mixer (the graceful fallback).
 */
const RIGGED_IDLE_CLIP = 'primary_stand_idle';

/**
 * Cap on total bytes stored under hero-poses/. Each entry is a 50-95 MB GLB
 * and every distinct hero+stack combination gets its own entry, so without a
 * cap the cache grows unbounded as users toggle mods (observed 1.7 GB after a
 * single day of Locker browsing). Sweeps run at startup and after each export:
 * stale-version entries go first, then least-recently-used entries until the
 * total is back under the cap.
 */
const POSE_CACHE_MAX_BYTES = 2 * 1024 * 1024 * 1024;

/**
 * Entries touched within this window are never evicted. This protects a
 * mid-export directory (its version sidecar lands only after the GLB is fully
 * written, so to the sweep it looks stale) and the model a viewer just
 * requested.
 */
const POSE_SWEEP_MIN_AGE_MS = 5 * 60 * 1000;

interface PoseCacheEntry {
    dir: string;
    bytes: number;
    /** Newest file mtime in the entry dir. Export writes bump it; the protocol
     *  handler touches the version sidecar on every serve, so this doubles as
     *  a last-used marker for LRU eviction. */
    lastUsedMs: number;
    stale: boolean;
}

let poseSweepInFlight: Promise<void> | null = null;

/** Sweep the pose cache: drop stale-version entries, then evict LRU entries
 *  until the total size is under POSE_CACHE_MAX_BYTES. Concurrent calls share
 *  one run. Never throws: a failed sweep only delays cleanup. */
export function sweepHeroPoseCache(): Promise<void> {
    if (!poseSweepInFlight) {
        poseSweepInFlight = runPoseCacheSweep()
            .catch((err) => {
                console.warn('[heroPoseModels] pose cache sweep failed:', err);
            })
            .finally(() => {
                poseSweepInFlight = null;
            });
    }
    return poseSweepInFlight;
}

async function runPoseCacheSweep(): Promise<void> {
    const root = join(app.getPath('userData'), 'hero-poses');
    let names: string[];
    try {
        names = await fs.readdir(root);
    } catch {
        return; // no cache yet
    }

    const now = Date.now();
    const entries: PoseCacheEntry[] = [];
    for (const name of names) {
        const dir = join(root, name);
        let bytes = 0;
        let lastUsedMs = 0;
        try {
            if (!(await fs.stat(dir)).isDirectory()) continue;
            for (const file of await fs.readdir(dir)) {
                const stat = await fs.stat(join(dir, file));
                bytes += stat.size;
                lastUsedMs = Math.max(lastUsedMs, stat.mtimeMs);
            }
        } catch {
            continue; // raced a concurrent delete; skip
        }
        const version = await fs
            .readFile(join(dir, POSE_VERSION_FILENAME), 'utf8')
            .catch(() => '');
        entries.push({
            dir,
            bytes,
            lastUsedMs,
            stale: version.trim() !== POSE_CACHE_VERSION,
        });
    }

    const protectedSince = now - POSE_SWEEP_MIN_AGE_MS;
    const doomed: PoseCacheEntry[] = [];
    const kept: PoseCacheEntry[] = [];
    for (const entry of entries) {
        if (entry.stale && entry.lastUsedMs < protectedSince) {
            doomed.push(entry);
        } else {
            kept.push(entry);
        }
    }

    let total = kept.reduce((sum, entry) => sum + entry.bytes, 0);
    if (total > POSE_CACHE_MAX_BYTES) {
        kept.sort((a, b) => a.lastUsedMs - b.lastUsedMs);
        for (const entry of kept) {
            if (total <= POSE_CACHE_MAX_BYTES) break;
            if (entry.lastUsedMs >= protectedSince) continue;
            doomed.push(entry);
            total -= entry.bytes;
        }
    }

    if (doomed.length === 0) return;
    let freed = 0;
    for (const entry of doomed) {
        await fs.rm(entry.dir, { recursive: true, force: true });
        freed += entry.bytes;
    }
    console.log(
        `[heroPoseModels] pose cache sweep: removed ${doomed.length} entries, freed ${Math.round(freed / 1024 / 1024)} MB`
    );
}

/**
 * Resolve a skin mod's metaKey to its on-disk VPK path. An overflow mod's key
 * is folder-qualified (`addons{N}/<file>`); a base-addons or .disabled mod's
 * key is a bare filename. Mirrors soulContainerModels.resolveModVpk: resolving
 * by metaKey (not a bare filename) is required because each addon folder
 * carries its own pak01-99 namespace, so the same `pakNN_dir.vpk` name can
 * exist in several folders at once.
 */
async function resolveSkinVpk(deadlockPath: string, metaKey: string): Promise<string | null> {
    const candidates = metaKey.includes('/')
        ? [join(getCitadelPath(deadlockPath), metaKey)] // enabled overflow folder
        : [
              join(getAddonsPath(deadlockPath), metaKey), // enabled base addons
              join(getDisabledPath(deadlockPath), metaKey), // disabled parking lot
          ];
    for (const candidate of candidates) {
        try {
            await fs.access(candidate);
            return candidate;
        } catch {
            /* try next */
        }
    }
    return null;
}

function normalizeSkinSources(skinSources: HeroPoseSkinSource[] = []): HeroPoseSkinSource[] {
    const byKey = new Map<string, HeroPoseSkinSource>();
    for (const source of skinSources) {
        const metaKey = source.metaKey.trim();
        if (!metaKey) continue;
        byKey.set(metaKey, {
            metaKey,
            priority: Number.isFinite(source.priority) ? source.priority : 0,
        });
    }
    return [...byKey.values()].sort(
        (a, b) => b.priority - a.priority || a.metaKey.localeCompare(b.metaKey)
    );
}

interface PoseSource {
    vpk: string;
    sources: HeroPoseSkinSource[];
    tempDir?: string;
}

async function resolvePoseSource(
    deadlockPath: string,
    pak01: string,
    skinSources: HeroPoseSkinSource[]
): Promise<PoseSource> {
    const resolved: Array<HeroPoseSkinSource & { path: string }> = [];
    for (const source of skinSources) {
        const path = await resolveSkinVpk(deadlockPath, source.metaKey);
        if (path) resolved.push({ ...source, path });
    }

    if (resolved.length === 0) {
        return { vpk: pak01, sources: [] };
    }

    if (resolved.length === 1) {
        return {
            vpk: resolved[0].path,
            sources: [{ metaKey: resolved[0].metaKey, priority: resolved[0].priority }],
        };
    }

    const tempDir = await fs.mkdtemp(join(tmpdir(), 'grimoire-hero-pose-'));
    const merged = join(tempDir, 'stack_dir.vpk');
    try {
        await runVpkmerge([merged, ...resolved.map((source) => source.path)], 120000);
        await verifyVpkOutput(merged);
        return {
            vpk: merged,
            tempDir,
            sources: resolved.map((source) => ({
                metaKey: source.metaKey,
                priority: source.priority,
            })),
        };
    } catch (err) {
        await fs.rm(tempDir, { recursive: true, force: true });
        throw err;
    }
}

export interface HeroPoseInfo {
    hasModel: boolean;
    /** mtime of the stored GLB, used to cache-bust the renderer URL on re-export. */
    mtimeMs: number | null;
    /** The resolved storage key the renderer builds its `grimoire-hero:` URL
     *  from. Returned (rather than recomputed in the renderer) because export
     *  may fall back from a skin to vanilla, which changes the key. */
    key: string;
}

async function infoForKey(key: string): Promise<HeroPoseInfo> {
    try {
        const stat = await fs.stat(modelFile(key));
        const version = await fs.readFile(versionFile(key), 'utf8').catch(() => '');
        if (version.trim() !== POSE_CACHE_VERSION) {
            // Pre-versioning or stale-version GLB (e.g. a T-pose baked before
            // --require-pose, or pre-rework textures): report absent so it
            // regenerates with the current pipeline.
            return { hasModel: false, mtimeMs: null, key };
        }
        return { hasModel: true, mtimeMs: stat.mtimeMs, key };
    } catch {
        return { hasModel: false, mtimeMs: null, key };
    }
}

/** Whether a hero's pose still exists for the given active skin, plus its mtime
 *  and storage key. */
export async function getHeroPoseInfo(
    heroName: string,
    skinSources?: HeroPoseSkinSource[]
): Promise<HeroPoseInfo> {
    return infoForKey(poseKey(heroName, normalizeSkinSources(skinSources)));
}

async function infoForRiggedKey(key: string): Promise<HeroPoseInfo> {
    try {
        const stat = await fs.stat(riggedModelFile(key));
        const version = await fs.readFile(riggedVersionFile(key), 'utf8').catch(() => '');
        if (version.trim() !== RIGGED_CACHE_VERSION) {
            return { hasModel: false, mtimeMs: null, key };
        }
        return { hasModel: true, mtimeMs: stat.mtimeMs, key };
    } catch {
        return { hasModel: false, mtimeMs: null, key };
    }
}

/** Whether a hero's RIGGED (animated, skinned) glb exists for the given active
 *  skin stack, plus its mtime and storage key. Mirrors getHeroPoseInfo. */
export async function getRiggedHeroPose(
    heroName: string,
    skinSources?: HeroPoseSkinSource[]
): Promise<HeroPoseInfo> {
    return infoForRiggedKey(poseKey(heroName, normalizeSkinSources(skinSources)));
}

/**
 * In-flight pose exports, keyed by the requested (hero, skin) so concurrent
 * identical requests collapse onto one vpkmerge run. Without this, a rapid 3D
 * toggle or React's strict-mode double-invoke can launch two processes writing
 * the same `model.glb` at once and corrupt it.
 */
const inFlightExports = new Map<string, Promise<HeroPoseInfo>>();

/**
 * Generate a hero's pose still by running the bundled `vpkmerge model export
 * --pose`. The body model is selected by modelSelectorsForHero: a reworked hero
 * uses its pinned exact `--entry`, otherwise the model is auto-discovered from
 * the hero's codename (`--hero`), trying any divergent body-model basename first
 * and falling back to the panorama codename(s). `skinMetaKey` (the active skin
 * VPK) supplies the
 * mesh + textures; a texture-only or absent skin falls back to the base pak's
 * mesh while the skin's textures still win. Falls back to a vanilla pose if the
 * skin VPK can't be resolved.
 *
 * Concurrent identical requests share one run (see inFlightExports).
 */
export async function exportHeroPose(
    deadlockPath: string,
    heroName: string,
    skinSources?: HeroPoseSkinSource[],
    fallbackSkinMetaKey?: string
): Promise<HeroPoseInfo> {
    const normalized = normalizeSkinSources(skinSources);
    const requestKey = poseKey(heroName, normalized);
    const existing = inFlightExports.get(requestKey);
    if (existing) return existing;

    const work = runHeroPoseExport(deadlockPath, heroName, normalized, fallbackSkinMetaKey);
    inFlightExports.set(requestKey, work);
    try {
        const info = await work;
        // The cache only grows through exports; sweep opportunistically so it
        // can't creep past the cap between app launches.
        void sweepHeroPoseCache();
        return info;
    } finally {
        inFlightExports.delete(requestKey);
    }
}

async function runHeroPoseExport(
    deadlockPath: string,
    heroName: string,
    skinSources: HeroPoseSkinSource[],
    fallbackSkinMetaKey?: string
): Promise<HeroPoseInfo> {
    try {
        return await runHeroPoseExportForSources(deadlockPath, heroName, skinSources);
    } catch (err) {
        if (skinSources.length <= 1 || !fallbackSkinMetaKey) throw err;
        const fallback =
            skinSources.find((source) => source.metaKey === fallbackSkinMetaKey) ?? {
                metaKey: fallbackSkinMetaKey,
                priority: 0,
            };
        return runHeroPoseExportForSources(deadlockPath, heroName, [fallback]);
    }
}

async function runHeroPoseExportForSources(
    deadlockPath: string,
    heroName: string,
    skinSources: HeroPoseSkinSource[]
): Promise<HeroPoseInfo> {
    const selectors = modelSelectorsForHero(heroName);
    if (selectors.length === 0) {
        throw new Error(`No known model codename for hero "${heroName}".`);
    }

    const pak01 = join(getCitadelPath(deadlockPath), 'pak01_dir.vpk');
    const source = await resolvePoseSource(deadlockPath, pak01, skinSources);
    try {
        const key = poseKey(heroName, source.sources);
        const dir = modelDir(key);
        await fs.mkdir(dir, { recursive: true });
        const out = modelFile(key);

        let lastError: unknown;
        for (const selector of selectors) {
            try {
                await runVpkmerge([
                    'model',
                    'export',
                    '--vpk',
                    source.vpk,
                    ...selector,
                    '--base',
                    pak01,
                    '--pose',
                    // Refuse to bake a static bind/T-pose: a clipless WIP hero
                    // (Apollo, Billy, Celeste, Mina, Paige, Rem) errors here and the
                    // Locker falls back to the 2D portrait instead of an unposed model.
                    '--require-pose',
                    '--out',
                    out,
                ]);
                await fs.writeFile(versionFile(key), POSE_CACHE_VERSION);
                return infoForKey(key);
            } catch (err) {
                lastError = err;
            }
        }
        throw lastError instanceof Error
            ? lastError
            : new Error(`Failed to export pose for "${heroName}".`);
    } finally {
        if (source.tempDir) {
            await fs.rm(source.tempDir, { recursive: true, force: true });
        }
    }
}

/** In-flight rigged exports. Separate map from inFlightExports: a rigged and a
 *  static export for the same key are independent and may run concurrently. */
const inFlightRiggedExports = new Map<string, Promise<HeroPoseInfo>>();

/**
 * Generate a hero's RIGGED glb: identical model/skin selection to exportHeroPose
 * but WITHOUT `--pose`, filtered to the single RIGGED_IDLE_CLIP, so the output
 * keeps its skeleton, skin (JOINTS_0/WEIGHTS_0) and one glTF idle animation.
 * Writes the sibling `model-rigged.glb` + `.rigged-cache-version` next to the
 * static `model.glb`. The static export is untouched.
 */
export async function exportRiggedHeroPose(
    deadlockPath: string,
    heroName: string,
    skinSources?: HeroPoseSkinSource[],
    fallbackSkinMetaKey?: string
): Promise<HeroPoseInfo> {
    const normalized = normalizeSkinSources(skinSources);
    const requestKey = poseKey(heroName, normalized);
    const existing = inFlightRiggedExports.get(requestKey);
    if (existing) return existing;

    const work = runRiggedHeroExport(deadlockPath, heroName, normalized, fallbackSkinMetaKey);
    inFlightRiggedExports.set(requestKey, work);
    try {
        const info = await work;
        void sweepHeroPoseCache();
        return info;
    } finally {
        inFlightRiggedExports.delete(requestKey);
    }
}

async function runRiggedHeroExport(
    deadlockPath: string,
    heroName: string,
    skinSources: HeroPoseSkinSource[],
    fallbackSkinMetaKey?: string
): Promise<HeroPoseInfo> {
    try {
        return await runRiggedHeroExportForSources(deadlockPath, heroName, skinSources);
    } catch (err) {
        if (skinSources.length <= 1 || !fallbackSkinMetaKey) throw err;
        const fallback =
            skinSources.find((source) => source.metaKey === fallbackSkinMetaKey) ?? {
                metaKey: fallbackSkinMetaKey,
                priority: 0,
            };
        return runRiggedHeroExportForSources(deadlockPath, heroName, [fallback]);
    }
}

async function runRiggedHeroExportForSources(
    deadlockPath: string,
    heroName: string,
    skinSources: HeroPoseSkinSource[]
): Promise<HeroPoseInfo> {
    const selectors = modelSelectorsForHero(heroName);
    if (selectors.length === 0) {
        throw new Error(`No known model codename for hero "${heroName}".`);
    }

    const pak01 = join(getCitadelPath(deadlockPath), 'pak01_dir.vpk');
    const source = await resolvePoseSource(deadlockPath, pak01, skinSources);
    try {
        const key = poseKey(heroName, source.sources);
        const dir = modelDir(key);
        await fs.mkdir(dir, { recursive: true });
        const out = riggedModelFile(key);

        let lastError: unknown;
        for (const selector of selectors) {
            try {
                await runVpkmerge([
                    'model',
                    'export',
                    '--vpk',
                    source.vpk,
                    ...selector,
                    '--base',
                    pak01,
                    // NO --pose: keep the skeleton + skin + clip. Exactly ONE
                    // --clip: --clip is additive, so a candidate LIST would keep
                    // multiple competing idle loops on heroes carrying more than
                    // one (verified abrams: 2 anims w/ a list vs 1 w/ one clip).
                    '--clip',
                    RIGGED_IDLE_CLIP,
                    '--out',
                    out,
                ]);
                await fs.writeFile(riggedVersionFile(key), RIGGED_CACHE_VERSION);
                return infoForRiggedKey(key);
            } catch (err) {
                lastError = err;
            }
        }
        throw lastError instanceof Error
            ? lastError
            : new Error(`Failed to export rigged model for "${heroName}".`);
    } finally {
        if (source.tempDir) {
            await fs.rm(source.tempDir, { recursive: true, force: true });
        }
    }
}

/**
 * Register the `grimoire-hero:` scheme handler. URLs look like
 * `grimoire-hero://m/<encoded-key>/model.glb` (the `?v=` cache-buster is
 * ignored). The key rides in the path under a fixed `m` host, not in the host
 * itself: it contains characters (`::`, and a `/` for overflow skins) a
 * standard scheme's host parser forbids. Must be paired with a
 * registerSchemesAsPrivileged({ scheme, privileges }) call before app-ready
 * (done in index.ts).
 */
export function registerHeroPoseProtocol(): void {
    protocol.handle(HERO_POSE_SCHEME, async (request) => {
        try {
            const url = new URL(request.url);
            const parts = url.pathname.split('/').filter(Boolean);
            const key = decodeURIComponent(parts[0] ?? '');
            // The trailing segment names which glb: the static `model.glb`
            // (default; legacy URLs omit it) or the rigged `model-rigged.glb`.
            // Allowlist the two known basenames so the key segment can never be
            // used to escape the entry dir.
            const requested = parts[1] ?? STATIC_MODEL_FILENAME;
            const filename =
                requested === RIGGED_MODEL_FILENAME ? RIGGED_MODEL_FILENAME : STATIC_MODEL_FILENAME;
            const file = join(modelDir(key), filename);
            await fs.access(file);
            // LRU touch for the cache sweep, which uses the newest file mtime
            // in the entry dir as last-used. Touch the tiny static sidecar, not
            // a GLB: the GLB mtime feeds the renderer's ?v= cache-buster and
            // must keep meaning "export time". Both glbs share the dir, so
            // touching the one sidecar protects the whole entry.
            const now = new Date();
            void fs.utimes(versionFile(key), now, now).catch(() => {});
            return net.fetch(pathToFileURL(file).toString());
        } catch {
            return new Response(null, { status: 404 });
        }
    });
}
