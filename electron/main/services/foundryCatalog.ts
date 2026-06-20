/**
 * Foundry catalog service: the bridge between the bundled `vpkmerge catalog *`
 * sidecar and the renderer's Foundry tab.
 *
 * The catalog engine scans the user's installed `citadel/pak01_dir.vpk` offline
 * and emits JSON (hero roster, texture/icon index, voice-line index). This module
 * spawns those subcommands in `--json` mode, parses typed results, and (for the
 * browse grid) batch-decodes per-category thumbnails via the CLI's `--thumbs`,
 * serving the cached PNGs to the renderer over the `grimoire-foundry:` scheme
 * (the renderer can't read userData files directly under file:// + webSecurity,
 * the same constraint that drove `grimoire-soul:`).
 *
 * Caches live under userData, keyed by the pak's build fingerprint so a Deadlock
 * update invalidates them:
 *   userData/foundry-thumbs/<fingerprint>/<category>/  (PNG set + manifest.json)
 *   userData/foundry-catalog-cache/                    (the engine's own index cache)
 */
import { promises as fs } from 'fs';
import { join } from 'path';
import { pathToFileURL } from 'url';
import { app, protocol, net } from 'electron';
import { runVpkmerge, runVpkmergeStdout } from './modMerger';
import { getCitadelPath } from './deadlock';
import type {
    HeroInfo,
    TextureCategory,
    TextureEntry,
    TextureFilters,
    TextureGridItem,
    ThumbManifestEntry,
} from '../../../src/types/foundry';

export const FOUNDRY_THUMB_SCHEME = 'grimoire-foundry';

/** Thumbnail longest-edge in px. 128 matches the manifest probe and keeps the
 *  per-category PNG set small (icon categories are a few hundred entries). */
const THUMB_SIZE = 128;

/** Categories the browse-grid foundation thumbnails on demand. Bounded and
 *  visual; `hero-model` (2k+) / `ability-vfx` / `other` (8k+) are deferred. */
const THUMBNAILABLE: ReadonlySet<TextureCategory> = new Set([
    'ability-icon',
    'item-icon',
    'hero-image',
]);

function pak01Path(deadlockPath: string): string {
    return join(getCitadelPath(deadlockPath), 'pak01_dir.vpk');
}

function thumbsRoot(): string {
    return join(app.getPath('userData'), 'foundry-thumbs');
}

function catalogCacheDir(): string {
    return join(app.getPath('userData'), 'foundry-catalog-cache');
}

/**
 * Run a `vpkmerge catalog <args> --json` subcommand and parse stdout as JSON.
 * The CLI prints the JSON payload to stdout and a human summary to stderr (see
 * runVpkmergeStdout), so the stdout is clean to parse.
 */
async function runCatalogJson<T>(args: string[]): Promise<T> {
    const stdout = await runVpkmergeStdout(['catalog', ...args, '--json']);
    try {
        return JSON.parse(stdout) as T;
    } catch (err) {
        throw new Error(
            `Foundry catalog returned malformed JSON for \`${args.join(' ')}\`: ${
                err instanceof Error ? err.message : String(err)
            }`
        );
    }
}

/**
 * The full hero roster (selectable + in-development), codename -> display name.
 * `--all` so WIP heroes referenced by texture paths still resolve a name; the
 * renderer filters/labels as it sees fit.
 */
export async function getHeroRoster(deadlockPath: string): Promise<HeroInfo[]> {
    return runCatalogJson<HeroInfo[]>(['heroes', '--vpk', pak01Path(deadlockPath), '--all']);
}

/** The texture/icon index, optionally filtered (all filters AND-combined). */
export async function getTextures(
    deadlockPath: string,
    filters: TextureFilters = {}
): Promise<TextureEntry[]> {
    const args = ['texture', '--vpk', pak01Path(deadlockPath)];
    if (filters.category) args.push('--category', filters.category);
    if (filters.hero) args.push('--hero', filters.hero);
    if (filters.search) args.push('--search', filters.search);
    if (typeof filters.limit === 'number') args.push('--limit', String(filters.limit));
    return runCatalogJson<TextureEntry[]>(args);
}

interface BuildFingerprint {
    vpkLen: number;
    vpkMtimeSecs: number;
    vpkMtimeNanos: number;
}

interface CacheReport {
    dir: string;
    schema: number;
    fingerprint: BuildFingerprint;
    voiceline: { count: number; cacheHit: boolean };
    texture: { count: number; cacheHit: boolean };
}

/** Stable, filesystem-safe directory segment naming this pak build. */
function fingerprintKey(fp: BuildFingerprint): string {
    return `${fp.vpkLen}-${fp.vpkMtimeSecs}-${fp.vpkMtimeNanos}`;
}

/**
 * Read the pak's build fingerprint via `catalog cache` (a single stat under the
 * hood) so thumbnail dirs invalidate on a real game update. Also warms the
 * engine's own index cache as a side effect, which is fine.
 */
async function buildFingerprint(deadlockPath: string): Promise<BuildFingerprint> {
    const report = await runCatalogJson<CacheReport>([
        'cache',
        '--vpk',
        pak01Path(deadlockPath),
        '--dir',
        catalogCacheDir(),
    ]);
    return report.fingerprint;
}

/**
 * Ensure the per-category thumbnail set exists on disk and return the texture
 * entries enriched with `grimoire-foundry:` thumbnail URLs. Idempotent: if the
 * category's PNG set for this build fingerprint already exists, it is reused
 * without re-decoding. Only bounded icon categories are thumbnailed; anything
 * else returns entries with `thumbUrl: null`.
 *
 * `--thumbs` writes a PNG per matching entry plus a `manifest.json`
 * (entry -> file + dims); the URL maps each texture path to its PNG via that
 * manifest rather than reconstructing the mangled filename.
 */
export async function ensureCategoryThumbnails(
    deadlockPath: string,
    category: TextureCategory
): Promise<TextureGridItem[]> {
    const entries = await getTextures(deadlockPath, { category });

    if (!THUMBNAILABLE.has(category)) {
        return entries.map((e) => ({ ...e, thumbUrl: null }));
    }

    const fp = await buildFingerprint(deadlockPath);
    const key = fingerprintKey(fp);
    const dir = join(thumbsRoot(), key, category);
    const manifestPath = join(dir, 'manifest.json');

    let manifest: ThumbManifestEntry[];
    const existing = await readManifest(manifestPath);
    if (existing) {
        manifest = existing;
    } else {
        // Stale fingerprints for this pak are dead weight; drop them before the
        // fresh decode so the thumbs root doesn't grow unbounded across updates.
        await pruneStaleFingerprints(key);
        await fs.mkdir(dir, { recursive: true });
        await runVpkmerge([
            'catalog',
            'texture',
            '--vpk',
            pak01Path(deadlockPath),
            '--category',
            category,
            '--thumbs',
            dir,
            '--thumb-size',
            String(THUMB_SIZE),
        ]);
        manifest = (await readManifest(manifestPath)) ?? [];
    }

    const byEntry = new Map(manifest.map((m) => [m.entry, m]));
    return entries.map((e) => {
        const m = byEntry.get(e.path);
        return {
            ...e,
            thumbUrl: m ? thumbUrl(key, category, m.file) : null,
            sourceWidth: m?.sourceWidth,
            sourceHeight: m?.sourceHeight,
        };
    });
}

async function readManifest(path: string): Promise<ThumbManifestEntry[] | null> {
    try {
        return JSON.parse(await fs.readFile(path, 'utf8')) as ThumbManifestEntry[];
    } catch {
        return null;
    }
}

/** Remove thumbnail dirs for any fingerprint other than the current one. */
async function pruneStaleFingerprints(currentKey: string): Promise<void> {
    try {
        const root = thumbsRoot();
        const dirs = await fs.readdir(root);
        await Promise.all(
            dirs
                .filter((d) => d !== currentKey)
                .map((d) => fs.rm(join(root, d), { recursive: true, force: true }))
        );
    } catch {
        /* best-effort: a missing thumbs root is fine */
    }
}

function thumbUrl(key: string, category: string, file: string): string {
    // Host is a fixed `t`; the build/category/file ride in the path so a `/`-free
    // standard-scheme host parser is happy (same shape as grimoire-soul://m/...).
    return `${FOUNDRY_THUMB_SCHEME}://t/${encodeURIComponent(key)}/${encodeURIComponent(
        category
    )}/${encodeURIComponent(file)}`;
}

/**
 * Pre-warm the engine's index cache (notably the ~76K-event voice-line index,
 * ~1.2s cold) so a later Sound tool opens instantly. Fire-and-forget: a failure
 * (no pak, binary lacks `catalog`) is swallowed; the UI rebuilds on demand.
 */
export async function warmCache(deadlockPath: string): Promise<void> {
    try {
        await runCatalogJson<CacheReport>([
            'cache',
            '--vpk',
            pak01Path(deadlockPath),
            '--dir',
            catalogCacheDir(),
        ]);
    } catch {
        /* best-effort warm; the catalog rebuilds lazily if this missed */
    }
}

/**
 * Register the `grimoire-foundry:` scheme handler. URLs look like
 * `grimoire-foundry://t/<fingerprint>/<category>/<png>`; the three path segments
 * are decoded and joined under the thumbs root. Must be paired with a
 * registerSchemesAsPrivileged({ scheme, privileges }) call before app-ready
 * (done in index.ts). Mirrors registerSoulModelProtocol.
 */
export function registerFoundryThumbnailProtocol(): void {
    protocol.handle(FOUNDRY_THUMB_SCHEME, async (request) => {
        try {
            const url = new URL(request.url);
            const segments = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
            // segments = [fingerprint, category, file]
            if (segments.length !== 3) return new Response(null, { status: 404 });
            const [key, category, file] = segments;
            // Reject path traversal: each segment must be a single safe component.
            if ([key, category, file].some((s) => s.includes('/') || s.includes('..'))) {
                return new Response(null, { status: 400 });
            }
            const filePath = join(thumbsRoot(), key, category, file);
            await fs.access(filePath);
            return net.fetch(pathToFileURL(filePath).toString());
        } catch {
            return new Response(null, { status: 404 });
        }
    });
}
