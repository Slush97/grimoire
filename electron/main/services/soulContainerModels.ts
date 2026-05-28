/**
 * Per-mod soul-container model store.
 *
 * Soul containers are a global (non-hero) Deadlock cosmetic: a small static
 * prop. The Locker's Global view shows them as flat GameBanana thumbnails,
 * which are often poor. This service produces a clean `.glb` per installed
 * soul-container mod via the bundled `vpkmerge model export`, so the Locker can
 * render the actual model.
 *
 * Keyed per-mod by the VPK file name. Uses an explicit `--entry` (soul
 * containers are props, not heroes, so there is no `--hero` discovery).
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
import { getCitadelPath, getAddonsPath } from './deadlock';

export const SOUL_MODEL_SCHEME = 'grimoire-soul';

/**
 * Canonical soul-container model entry. Present in the base pak01 and in the
 * soul-container mods inspected so far. A texture-only mod ships no model, so
 * this resolves from --base while the mod's overriding textures still win. A
 * mod that replaces the mesh under a different entry name (e.g. only
 * `_noskins`) would fall back to the base mesh; robust per-mod entry discovery
 * is a later refinement.
 */
const SOUL_CONTAINER_ENTRY = 'models/props_gameplay/soul_container/soul_container.vmdl_c';

function sanitize(value: string): string {
    return value.replace(/[^a-zA-Z0-9_-]+/g, '_');
}

function modelDir(key: string): string {
    // The key is both the storage name and the `grimoire-soul:` URL host.
    // Chromium lowercases the host of a registered scheme, so canonicalize to
    // lowercase here; VPK file names are unique case-insensitively.
    return join(app.getPath('userData'), 'soul-models', sanitize(key.toLowerCase()));
}

function modelFile(key: string): string {
    return join(modelDir(key), 'model.glb');
}

/** Resolve a mod VPK file name to its on-disk path (enabled or disabled). */
async function resolveModVpk(deadlockPath: string, fileName: string): Promise<string | null> {
    const addons = getAddonsPath(deadlockPath);
    for (const candidate of [join(addons, fileName), join(addons, '.disabled', fileName)]) {
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
function stripGlbSkins(glb: Buffer): Buffer {
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
        return { hasModel: true, mtimeMs: stat.mtimeMs };
    } catch {
        return { hasModel: false, mtimeMs: null };
    }
}

/**
 * Export a soul-container mod's model to a `.glb` by running the bundled
 * `vpkmerge model export` against the mod's VPK (mesh + textures) with the base
 * pak as the fallback resolver. Keyed by the mod's VPK file name.
 */
export async function exportSoulModel(
    deadlockPath: string,
    fileName: string
): Promise<SoulModelInfo> {
    const vpk = await resolveModVpk(deadlockPath, fileName);
    if (!vpk) {
        throw new Error(`Soul-container VPK not found: ${fileName}`);
    }
    const pak01 = join(getCitadelPath(deadlockPath), 'pak01_dir.vpk');

    const dir = modelDir(fileName);
    await fs.mkdir(dir, { recursive: true });
    const out = modelFile(fileName);

    await runVpkmerge([
        'model',
        'export',
        '--vpk',
        vpk,
        '--entry',
        SOUL_CONTAINER_ENTRY,
        '--base',
        pak01,
        '--out',
        out,
    ]);

    // Drop the degenerate skin morphic emits on these static props so three.js
    // loads them as plain meshes (see stripGlbSkins).
    const raw = await fs.readFile(out);
    const patched = stripGlbSkins(raw);
    if (patched !== raw) await fs.writeFile(out, patched);

    return getSoulModelInfo(fileName);
}

/** Delete a soul-container mod's exported model. */
export async function clearSoulModel(key: string): Promise<void> {
    await fs.rm(modelDir(key), { recursive: true, force: true });
}

/**
 * Register the `grimoire-soul:` scheme handler. URLs look like
 * `grimoire-soul://<key>/model.glb` (the `?v=` cache-buster is ignored). Must
 * be paired with a registerSchemesAsPrivileged({ scheme, privileges }) call
 * before app-ready (done in index.ts).
 */
export function registerSoulModelProtocol(): void {
    protocol.handle(SOUL_MODEL_SCHEME, async (request) => {
        try {
            const url = new URL(request.url);
            const key = decodeURIComponent(url.hostname);
            const file = modelFile(key);
            await fs.access(file);
            return net.fetch(pathToFileURL(file).toString());
        } catch {
            return new Response(null, { status: 404 });
        }
    });
}
