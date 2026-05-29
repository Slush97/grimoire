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
import { pathToFileURL } from 'url';
import { app, protocol, net } from 'electron';
import { runVpkmerge } from './modMerger';
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

/** Model codenames to try for a hero, most-specific first: any divergent
 *  body-model basename, then the panorama codename(s) that cover the rest of
 *  the roster. De-duplicated, order preserved. */
function modelCodenamesForHero(heroName: string): string[] {
    const ordered = [...(MODEL_CODENAME_OVERRIDES[heroName] ?? []), ...codenamesForHero(heroName)];
    return [...new Set(ordered)];
}

function sanitize(value: string): string {
    return value.replace(/[^a-zA-Z0-9_-]+/g, '_');
}

/** Storage key for a hero's pose still. Combines the hero with the active skin
 *  (a skin metaKey, or `vanilla` for the base look) so each skin caches its own
 *  still. Lowercased because the skin half is a VPK name, unique case-
 *  insensitively. */
function poseKey(heroName: string, skinMetaKey?: string): string {
    return `${heroName}::${skinMetaKey ?? 'vanilla'}`;
}

function modelDir(key: string): string {
    return join(app.getPath('userData'), 'hero-poses', sanitize(key.toLowerCase()));
}

function modelFile(key: string): string {
    return join(modelDir(key), 'model.glb');
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
 */
const POSE_CACHE_VERSION = '2';

function versionFile(key: string): string {
    return join(modelDir(key), '.cache-version');
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
    skinMetaKey?: string
): Promise<HeroPoseInfo> {
    return infoForKey(poseKey(heroName, skinMetaKey));
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
 * --pose`. The body model is auto-discovered from the hero's codename
 * (`--hero`), trying any divergent body-model basename first and falling back
 * to the panorama codename(s). `skinMetaKey` (the active skin VPK) supplies the
 * mesh + textures; a texture-only or absent skin falls back to the base pak's
 * mesh while the skin's textures still win. Falls back to a vanilla pose if the
 * skin VPK can't be resolved.
 *
 * Concurrent identical requests share one run (see inFlightExports).
 */
export async function exportHeroPose(
    deadlockPath: string,
    heroName: string,
    skinMetaKey?: string
): Promise<HeroPoseInfo> {
    const requestKey = poseKey(heroName, skinMetaKey);
    const existing = inFlightExports.get(requestKey);
    if (existing) return existing;

    const work = runHeroPoseExport(deadlockPath, heroName, skinMetaKey);
    inFlightExports.set(requestKey, work);
    try {
        return await work;
    } finally {
        inFlightExports.delete(requestKey);
    }
}

async function runHeroPoseExport(
    deadlockPath: string,
    heroName: string,
    skinMetaKey?: string
): Promise<HeroPoseInfo> {
    const codenames = modelCodenamesForHero(heroName);
    if (codenames.length === 0) {
        throw new Error(`No known model codename for hero "${heroName}".`);
    }

    const pak01 = join(getCitadelPath(deadlockPath), 'pak01_dir.vpk');
    const skinVpk = skinMetaKey ? await resolveSkinVpk(deadlockPath, skinMetaKey) : null;
    const sourceVpk = skinVpk ?? pak01;
    // Key reflects what actually sourced the pose: the skin only when its VPK
    // resolved, else vanilla. The renderer reads the key off the returned info.
    const key = poseKey(heroName, skinVpk ? skinMetaKey : undefined);

    const dir = modelDir(key);
    await fs.mkdir(dir, { recursive: true });
    const out = modelFile(key);

    let lastError: unknown;
    for (const codename of codenames) {
        try {
            await runVpkmerge([
                'model',
                'export',
                '--vpk',
                sourceVpk,
                '--hero',
                codename,
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
            const segment = url.pathname.split('/').filter(Boolean)[0] ?? '';
            const key = decodeURIComponent(segment);
            const file = modelFile(key);
            await fs.access(file);
            return net.fetch(pathToFileURL(file).toString());
        } catch {
            return new Response(null, { status: 404 });
        }
    });
}
