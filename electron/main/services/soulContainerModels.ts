/**
 * Per-mod soul-container model store.
 *
 * Soul containers are a global (non-hero) Deadlock cosmetic: a small static
 * prop. The Locker's Global view shows them as flat GameBanana thumbnails,
 * which are often poor. This service produces a clean `.glb` per installed
 * soul-container mod via the bundled `vpkmerge model export`, so the Locker can
 * render the actual model.
 *
 * Keyed per-mod by the mod's metaKey (folder-qualified for overflow mods, so a
 * `pakNN_dir.vpk` name that recurs across addon folders stays distinct). Uses an
 * explicit `--entry` (soul containers are props, not heroes, so there is no
 * `--hero` discovery).
 *
 * Layout: userData/soul-models/<key>/model.glb
 *
 * The renderer can't read userData files directly under file:// + webSecurity,
 * so they're served through the registered `grimoire-soul:` scheme
 * (see registerSoulModelProtocol).
 */
import { promises as fs } from 'fs';
import { join } from 'path';
import { pathToFileURL } from 'url';
import { app, protocol, net } from 'electron';
import { runVpkmerge } from './modMerger';
import { getCitadelPath, getAddonsPath, getDisabledPath } from './deadlock';

export const SOUL_MODEL_SCHEME = 'grimoire-soul';
// v1: the original pipeline (vpkmerge export + stripGlbSkins patch). Pre-sidecar
// GLBs are treated as v1 in getSoulModelInfo, so introducing the sidecar did not
// invalidate existing caches.
// v2: vpkmerge fixed draw-call index offsets for resourcecompiler/global-index
// meshes, invalidating any model-export GLBs written by the broken binary.
const SOUL_CACHE_VERSION = '2';

/**
 * Canonical soul-container model entry. Present in the base pak01 and in the
 * soul-container mods inspected so far. A texture-only mod ships no model, so
 * this resolves from --base while the mod's overriding textures still win. A
 * mod that replaces the mesh under a different entry name (e.g. only
 * `_noskins`) would fall back to the base mesh; robust per-mod entry discovery
 * is a later refinement.
 */
export const SOUL_CONTAINER_ENTRY = 'models/props_gameplay/soul_container/soul_container.vmdl_c';

/**
 * Canonical Idol/urn model entry. A Spirit Urn import overrides this slot (its
 * VPK packs the cloned model here), so the Locker tile exports THIS entry for an
 * urn mod instead of the soul-container entry. See exportSoulModel's `entry` arg.
 */
export const URN_CONTAINER_ENTRY = 'models/props_gameplay/idol_urn/idol_urn.vmdl_c';

function sanitize(value: string): string {
    return value.replace(/[^a-zA-Z0-9_-]+/g, '_');
}

function modelDir(key: string): string {
    // The key (a mod metaKey) is the storage name; sanitize it to a single flat
    // directory segment. Lowercased because VPK file names are unique
    // case-insensitively and the read path may differ in case.
    return join(app.getPath('userData'), 'soul-models', sanitize(key.toLowerCase()));
}

function modelFile(key: string): string {
    return join(modelDir(key), 'model.glb');
}

function versionFile(key: string): string {
    return join(modelDir(key), '.cache-version');
}

/**
 * Drop any cached export GLB for a metaKey. Called when a slot's VPK is replaced
 * (a re-imported soul container reusing the previous slot), so the Locker tile
 * re-exports the new model instead of serving the stale cached mesh.
 */
export async function clearSoulModelCache(key: string): Promise<void> {
    try {
        await fs.rm(modelDir(key), { recursive: true, force: true });
    } catch {
        /* best-effort: a missing cache dir is fine */
    }
}

/**
 * Resolve a mod's metaKey (see metaKeyFor) to its on-disk VPK path. An overflow
 * mod's key is folder-qualified (`addons{N}/<file>`); a base-addons or .disabled
 * mod's key is a bare filename. Resolving by metaKey (not a bare filename) is
 * required because each addon folder carries its own pak01-99 namespace, so the
 * same `pakNN_dir.vpk` name can exist in several folders at once.
 */
export async function resolveModVpk(deadlockPath: string, metaKey: string): Promise<string | null> {
    const candidates = metaKey.includes('/')
        ? [join(getCitadelPath(deadlockPath), metaKey)] // enabled overflow folder
        : [
              join(getAddonsPath(deadlockPath), metaKey), // enabled base addons
              join(getDisabledPath(deadlockPath), metaKey), // disabled (single shared parking lot)
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

const GLB_MAGIC = 0x46546c67; // 'glTF'
const GLB_JSON_CHUNK = 0x4e4f534a; // 'JSON'

/**
 * Strip skins from a GLB.
 *
 * morphic attaches a degenerate single-joint skin to these static props but
 * emits no JOINTS_0/WEIGHTS_0 on the mesh. three.js then builds a SkinnedMesh
 * and crashes in normalizeSkinWeights (reads `geometry.attributes.skinWeight.count`
 * on an undefined attribute). Soul containers are static, so dropping the skin
 * (and each node's `skin` ref) turns them into plain meshes with no visual
 * change. Only the JSON chunk is rewritten; the BIN chunk is preserved verbatim
 * and accessors/bufferViews are left untouched (the now-unreferenced inverse-bind
 * accessor is harmless).
 *
 * Returns the patched bytes, or the input unchanged when there are no skins or
 * the container can't be parsed as a GLB.
 */
export function stripGlbSkins(glb: Buffer): Buffer {
    if (glb.length < 20 || glb.readUInt32LE(0) !== GLB_MAGIC) return glb;
    const jsonLen = glb.readUInt32LE(12);
    if (glb.readUInt32LE(16) !== GLB_JSON_CHUNK) return glb;
    const jsonStart = 20;
    const jsonEnd = jsonStart + jsonLen;
    if (jsonEnd > glb.length) return glb;

    let json: { skins?: unknown[]; nodes?: Array<{ skin?: number }> };
    try {
        json = JSON.parse(glb.toString('utf8', jsonStart, jsonEnd));
    } catch {
        return glb;
    }
    if (!json.skins || json.skins.length === 0) return glb;

    delete json.skins;
    for (const node of json.nodes ?? []) delete node.skin;

    // Re-serialize and pad the JSON chunk to a 4-byte boundary with spaces.
    let jsonBuf = Buffer.from(JSON.stringify(json), 'utf8');
    const pad = (4 - (jsonBuf.length % 4)) % 4;
    if (pad) jsonBuf = Buffer.concat([jsonBuf, Buffer.alloc(pad, 0x20)]);

    const rest = glb.subarray(jsonEnd);
    const header = Buffer.alloc(20);
    header.writeUInt32LE(GLB_MAGIC, 0);
    header.writeUInt32LE(2, 4); // glTF version
    header.writeUInt32LE(20 + jsonBuf.length + rest.length, 8); // total length
    header.writeUInt32LE(jsonBuf.length, 12); // JSON chunk length
    header.writeUInt32LE(GLB_JSON_CHUNK, 16);
    return Buffer.concat([header, jsonBuf, rest]);
}

export interface SoulModelInfo {
    hasModel: boolean;
    /** mtime of the stored GLB, used to cache-bust the renderer URL on re-export. */
    mtimeMs: number | null;
}

/** Whether a soul-container mod has an exported model, plus its mtime. */
export async function getSoulModelInfo(key: string): Promise<SoulModelInfo> {
    try {
        const stat = await fs.stat(modelFile(key));
        // A GLB without a sidecar predates cache versioning and counts as v1:
        // the export pipeline is unchanged since those were written (vpkmerge
        // v0.11.0 still emits the degenerate static skin, which stripGlbSkins
        // already patched at write time), so they stay valid. Bump
        // SOUL_CACHE_VERSION only when the export output actually changes.
        const raw = await fs.readFile(versionFile(key), 'utf8').catch(() => '');
        const version = raw.trim() || '1';
        if (version !== SOUL_CACHE_VERSION) {
            return { hasModel: false, mtimeMs: null };
        }
        return { hasModel: true, mtimeMs: stat.mtimeMs };
    } catch {
        return { hasModel: false, mtimeMs: null };
    }
}

/**
 * Export a soul-container mod's model to a `.glb` by running the bundled
 * `vpkmerge model export` against the mod's VPK (mesh + textures) with the base
 * pak as the fallback resolver.
 *
 * The SOURCE VPK is resolved by `metaKey` (its on-disk location, which changes
 * as a mod is enabled/disabled), but the CACHE is keyed by `cacheKey` (the mod's
 * content-stable sha256). Keying the cache by metaKey was wrong: enabling a soul
 * renames it to a `pakNN_dir.vpk` slot, and that slot name is reused by other
 * soul containers over time, so a lookup by the slot name could serve a stale
 * GLB exported for whatever soul last occupied it (the "wrong/white model on
 * select" bug). Content addressing also means a toggle (same content, new
 * metaKey) is a cache hit, so enabling/disabling no longer re-exports or flickers.
 */
export async function exportSoulModel(
    deadlockPath: string,
    metaKey: string,
    cacheKey: string,
    entry: string = SOUL_CONTAINER_ENTRY
): Promise<SoulModelInfo> {
    const vpk = await resolveModVpk(deadlockPath, metaKey);
    if (!vpk) {
        throw new Error(`Prop-container VPK not found: ${metaKey}`);
    }
    const pak01 = join(getCitadelPath(deadlockPath), 'pak01_dir.vpk');

    const dir = modelDir(cacheKey);
    await fs.mkdir(dir, { recursive: true });
    const out = modelFile(cacheKey);

    await runVpkmerge([
        'model',
        'export',
        '--vpk',
        vpk,
        '--entry',
        entry,
        '--base',
        pak01,
        '--out',
        out,
    ]);

    // Drop the degenerate skin emitted on this static prop so three.js loads
    // it as a plain mesh (see stripGlbSkins). Still required: as of vpkmerge
    // v0.11.0 the export carries 1 skin and 0 animations (verified 2026-06-09
    // against both the bundled and a fresh release build).
    const raw = await fs.readFile(out);
    const patched = stripGlbSkins(raw);
    if (patched !== raw) await fs.writeFile(out, patched);
    await fs.writeFile(versionFile(cacheKey), SOUL_CACHE_VERSION);

    return getSoulModelInfo(cacheKey);
}

/**
 * Register the `grimoire-soul:` scheme handler. URLs look like
 * `grimoire-soul://m/<encoded-metaKey>/model.glb` (the `?v=` cache-buster is
 * ignored). The key rides in the path under a fixed `m` host, not in the host
 * itself: it's a mod metaKey, which for overflow mods contains a `/` that a
 * standard scheme's host parser forbids. Must be paired with a
 * registerSchemesAsPrivileged({ scheme, privileges }) call before app-ready
 * (done in index.ts).
 */
export function registerSoulModelProtocol(): void {
    protocol.handle(SOUL_MODEL_SCHEME, async (request) => {
        try {
            const url = new URL(request.url);
            // Path is /<encodeURIComponent(metaKey)>/model.glb; the first
            // segment is the (still-encoded) key.
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
