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
import { createHash, randomUUID } from 'crypto';
import { join, dirname } from 'path';
import { tmpdir } from 'os';
import { pathToFileURL } from 'url';
import { app, protocol, net } from 'electron';
import { runVpkmerge, runVpkmergeStdout, verifyVpkOutput } from './modMerger';
import { getCitadelPath } from './deadlock';
import { soundCodenameForHero } from './heroSoundCodenames';
import type {
    HeroInfo,
    HeroSound,
    HeroSoundFilters,
    TextureCategory,
    TextureEntry,
    TextureFilters,
    TextureGridItem,
    ThumbManifestEntry,
    VoiceLine,
    VoicelineFilters,
} from '../../../src/types/foundry';

export const FOUNDRY_THUMB_SCHEME = 'grimoire-foundry';

/** Thumbnail longest-edge in px. 128 matches the manifest probe and keeps the
 *  per-category PNG set small (icon categories are a few hundred entries). */
const THUMB_SIZE = 128;

/** Longest-edge in px for the lightbox (enlarge-on-click) decode. Never upscales,
 *  so small icons stay at their native size; this is just an upper bound. */
const FULL_SIZE = 1024;

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

/** The VO sound-event index, scoped by `hero` (the ~76K-event corpus is too large
 *  to surface unfiltered) and optionally `search`. All filters AND-combined. */
export async function getVoicelines(
    deadlockPath: string,
    filters: VoicelineFilters = {}
): Promise<VoiceLine[]> {
    const args = ['voiceline', '--vpk', pak01Path(deadlockPath)];
    if (filters.hero) args.push('--hero', filters.hero);
    if (filters.search) args.push('--search', filters.search);
    if (typeof filters.limit === 'number') args.push('--limit', String(filters.limit));
    return runCatalogJson<VoiceLine[]>(args);
}

/**
 * Resolve a roster codename (the engine/script namespace the renderer's hero
 * picker uses, e.g. `atlas`) to the sound-path codename the `soundevents/hero/`
 * tree is keyed by (e.g. `abrams`). The two namespaces coincide for most heroes
 * but diverge for a handful (Abrams, Mo & Krill, ...), so we bridge through the
 * display name: roster `atlas` -> "Abrams" -> sound codename `abrams`.
 *
 * The roster (codename -> display name) is fetched once per game path and memoized
 * (the engine caches the underlying scan anyway). A roster codename whose display
 * name isn't in the sound-codename table falls back to itself, since the two
 * namespaces are identical for the large majority of heroes.
 */
const soundCodenameMapCache = new Map<string, Promise<Map<string, string>>>();

async function rosterToSoundCodename(deadlockPath: string, rosterCodename: string): Promise<string> {
    let mapPromise = soundCodenameMapCache.get(deadlockPath);
    if (!mapPromise) {
        mapPromise = getHeroRoster(deadlockPath)
            .then((roster) => {
                const map = new Map<string, string>();
                for (const h of roster) {
                    const sound = soundCodenameForHero(h.name);
                    if (sound) map.set(h.codename.toLowerCase(), sound);
                }
                return map;
            })
            .catch(() => new Map<string, string>());
        soundCodenameMapCache.set(deadlockPath, mapPromise);
    }
    const map = await mapPromise;
    return map.get(rosterCodename.toLowerCase()) ?? rosterCodename.toLowerCase();
}

/** The hero gameplay-sound index (weapon / ability / movement / melee), scoped by
 *  `hero` (a roster codename, translated here to the sound-path codename the tree
 *  is keyed by) and optionally `category` / `search`. All filters AND-combined. */
export async function getHeroSounds(
    deadlockPath: string,
    filters: HeroSoundFilters = {}
): Promise<HeroSound[]> {
    const args = ['herosounds', '--vpk', pak01Path(deadlockPath)];
    if (filters.hero) {
        const soundCode = await rosterToSoundCodename(deadlockPath, filters.hero);
        args.push('--hero', soundCode);
    }
    if (filters.category) args.push('--category', filters.category);
    if (filters.search) args.push('--search', filters.search);
    if (typeof filters.limit === 'number') args.push('--limit', String(filters.limit));
    return runCatalogJson<HeroSound[]>(args);
}

// ----- Hero sound-swap build (drop your own audio onto a sound event) --------

export type SoundSwapLoop = 'auto' | 'on' | 'off';

export interface BuildHeroSoundSwapOptions {
    /** Roster codename from the Foundry hero picker (e.g. `atlas`); resolved here
     *  to the sound-path codename the `soundevents/hero/` tree is keyed by. */
    heroCodename: string;
    /** The soundevent to swap, verbatim from the catalog (a `HeroSound.event`,
     *  e.g. `Gigawatt.LightningBall.Damage`). Event mode (gameplay). Omit when
     *  using `clipPaths` (VO / single-clip mode). */
    event?: string;
    /** Clip mode (voice lines): explicit clip entries to override in place.
     *  `.vsnd` paths are normalized to `.vsnd_c`. VO has no per-hero soundevents
     *  file, so event mode does not apply. When set, `event` is ignored. */
    clipPaths?: string[];
    /** Absolute path to the user's MP3 (validated by the caller). */
    audioPath: string;
    /** Loop handling for the minted clip. */
    loop: SoundSwapLoop;
    /** Optional trim window in milliseconds (frame-snapped, ~26 ms). Both ends
     *  must be set together; omitted = use the whole clip. */
    trimStartMs?: number;
    trimEndMs?: number;
    /** Optional loudness gain in decibels applied losslessly before minting (the
     *  "match volume" normalizer). Omitted / 0 = no gain. */
    gainDb?: number;
}

export interface HeroSoundSwapBuild {
    /** The built addon VPK on disk (temp staging path; the caller installs the
     *  copy into the managed mod list and then cleans this up). */
    vpkPath: string;
    /** The sound-path codename the event was resolved under (e.g. `gigawatt`),
     *  recorded in the installed mod's metadata. */
    soundCodename: string;
}

/** Normalize a clip path to its compiled `.vsnd_c` entry (the catalog hands out
 *  `.vsnd` source paths; the pak entry + soundswap `--clip` target is `.vsnd_c`). */
function toVsndcEntry(p: string): string {
    const s = p.trim();
    if (!s) return '';
    if (s.endsWith('.vsnd_c')) return s;
    return s.endsWith('.vsnd') ? `${s}_c` : s;
}

/**
 * Build a hero sound-swap addon VPK via `vpkmerge soundswap --event --pool all`:
 * every clip in the event's randomizer pool is overridden with the user's MP3,
 * each minted around that clip's own donor container so loop/format/GUID are
 * preserved. Returns a temp staging VPK the caller installs into the managed mod
 * list (mirrors buildSoulContainerVpk's build-to-temp contract). The audio must
 * be an MP3 (the mint path parses rate/channels/duration from the MP3 frame
 * headers, no ffmpeg); transcoding other formats is a caller concern.
 */
export async function buildHeroSoundSwapVpk(
    deadlockPath: string,
    opts: BuildHeroSoundSwapOptions
): Promise<HeroSoundSwapBuild> {
    const soundCodename = await rosterToSoundCodename(deadlockPath, opts.heroCodename);
    const dir = join(tmpdir(), `grimoire-soundswap-${randomUUID()}`);
    await fs.mkdir(dir, { recursive: true });
    const vpkPath = join(dir, 'soundswap_dir.vpk');

    // Shared mint options for either mode: the source audio, loop handling, and
    // the optional pre-mint trim (both ends together) + loudness gain.
    const mintArgs: string[] = ['--audio', opts.audioPath, '--loop', opts.loop];
    if (
        typeof opts.trimStartMs === 'number' &&
        typeof opts.trimEndMs === 'number' &&
        opts.trimEndMs > opts.trimStartMs
    ) {
        mintArgs.push(
            '--trim-start', String(Math.round(opts.trimStartMs)),
            '--trim-end', String(Math.round(opts.trimEndMs))
        );
    }
    if (typeof opts.gainDb === 'number' && Number.isFinite(opts.gainDb) && opts.gainDb !== 0) {
        mintArgs.push('--gain-db', opts.gainDb.toFixed(2));
    }

    const clips = (opts.clipPaths ?? []).map(toVsndcEntry).filter(Boolean);
    try {
        if (clips.length > 0) {
            // Clip mode (voice lines): override each clip `.vsnd_c` in place. One
            // soundswap per clip; merge the per-clip override VPKs (disjoint entry
            // paths) when a line carries a multi-clip randomizer pool.
            if (clips.length === 1) {
                await runVpkmerge([
                    'soundswap', '--from-vpk', pak01Path(deadlockPath),
                    '--clip', clips[0], ...mintArgs, '--encode-vpk', vpkPath,
                ]);
            } else {
                const parts: string[] = [];
                for (let i = 0; i < clips.length; i++) {
                    const part = join(dir, `part-${i}_dir.vpk`);
                    await runVpkmerge([
                        'soundswap', '--from-vpk', pak01Path(deadlockPath),
                        '--clip', clips[i], ...mintArgs, '--encode-vpk', part,
                    ]);
                    parts.push(part);
                }
                await runVpkmerge([vpkPath, ...parts]);
            }
        } else if (opts.event) {
            // Event mode (gameplay): override every clip in the event's pool.
            await runVpkmerge([
                'soundswap', '--from-vpk', pak01Path(deadlockPath),
                '--event', opts.event, '--hero', soundCodename, '--pool', 'all',
                ...mintArgs, '--encode-vpk', vpkPath,
            ]);
        } else {
            throw new Error('Sound swap needs either an event (gameplay) or clip paths (voice lines)');
        }
        await verifyVpkOutput(vpkPath);
    } catch (err) {
        await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
        throw err;
    }
    return { vpkPath, soundCodename };
}

/** Remove a sound-swap build's temp staging dir (call after installing the copy). */
export async function cleanupHeroSoundSwapBuild(vpkPath: string): Promise<void> {
    await fs.rm(dirname(vpkPath), { recursive: true, force: true }).catch(() => {});
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

/**
 * Decode a single texture entry at a larger edge (FULL_SIZE) on demand and return
 * its `grimoire-foundry:` URL: the backbone for the Foundry lightbox. Reuses the
 * CLI's `--path` single-entry filter + the same `--thumbs` manifest pipeline,
 * caching one PNG per entry under `<fingerprint>/<category>@full/` keyed by build,
 * so re-opening the same asset is instant.
 *
 * Returns null when the entry fails to decode (the lightbox falls back to the
 * 128px grid thumbnail rather than erroring).
 */
export async function ensureFullImage(
    deadlockPath: string,
    category: TextureCategory,
    entryPath: string
): Promise<string | null> {
    const fp = await buildFingerprint(deadlockPath);
    const key = fingerprintKey(fp);
    const fullCategory = `${category}@full`;
    const dir = join(thumbsRoot(), key, fullCategory);
    const indexPath = join(dir, 'index.json');

    // Accumulated entry -> file map (one PNG per opened asset). Decoding a second
    // entry overwrites the transient `manifest.json`, so the durable lookup lives
    // in this index rather than depending on the CLI's filename mangling.
    const index = await readFullIndex(indexPath);
    const cachedFile = index[entryPath];
    if (cachedFile) {
        try {
            await fs.access(join(dir, cachedFile));
            return thumbUrl(key, fullCategory, cachedFile);
        } catch {
            delete index[entryPath]; // cache entry lost its PNG; re-decode below
        }
    }

    await fs.mkdir(dir, { recursive: true });
    await runVpkmerge([
        'catalog',
        'texture',
        '--vpk',
        pak01Path(deadlockPath),
        '--path',
        entryPath,
        '--thumbs',
        dir,
        '--thumb-size',
        String(FULL_SIZE),
    ]);

    const manifest = (await readManifest(join(dir, 'manifest.json'))) ?? [];
    const decoded = manifest.find((m) => m.entry === entryPath);
    if (!decoded) return null;

    index[entryPath] = decoded.file;
    await fs.writeFile(indexPath, JSON.stringify(index)).catch(() => {});
    return thumbUrl(key, fullCategory, decoded.file);
}

function voiceclipsRoot(): string {
    return join(app.getPath('userData'), 'foundry-voiceclips');
}

/**
 * Extract a VO clip's MP3 on demand and return it as a `data:audio/mpeg` URL the
 * renderer can drop straight into an `<audio>` element. Deadlock VO clips are a
 * plain MP3 appended in the `.vsnd_c` container, so the CLI slices it out (no
 * decode). The MP3 is cached on disk keyed by build fingerprint + clip path, so
 * replaying a line never re-spawns the sidecar. Clips are tiny (tens of KB), so a
 * data URL is cheaper than standing up another protocol scheme.
 *
 * Returns null when the clip can't be auditioned (missing entry, or a non-MP3
 * codec); the renderer hides the play affordance rather than erroring.
 */
export async function ensureVoiceclip(
    deadlockPath: string,
    vsndPath: string
): Promise<string | null> {
    const fp = await buildFingerprint(deadlockPath);
    const key = fingerprintKey(fp);
    const dir = join(voiceclipsRoot(), key);
    const hash = createHash('sha1').update(vsndPath).digest('hex');
    const file = join(dir, `${hash}.mp3`);

    let mp3: Buffer;
    try {
        mp3 = await fs.readFile(file);
    } catch {
        await pruneStaleVoiceclips(key);
        await fs.mkdir(dir, { recursive: true });
        try {
            await runVpkmerge([
                'catalog',
                'voiceclip',
                '--vpk',
                pak01Path(deadlockPath),
                '--entry',
                vsndPath,
                '--out',
                file,
            ]);
            mp3 = await fs.readFile(file);
        } catch {
            return null; // missing entry or unsupported codec; no audition
        }
    }
    return `data:audio/mpeg;base64,${mp3.toString('base64')}`;
}

/** Remove voiceclip caches for any fingerprint other than the current one. */
async function pruneStaleVoiceclips(currentKey: string): Promise<void> {
    try {
        const root = voiceclipsRoot();
        const dirs = await fs.readdir(root);
        await Promise.all(
            dirs
                .filter((d) => d !== currentKey)
                .map((d) => fs.rm(join(root, d), { recursive: true, force: true }))
        );
    } catch {
        /* best-effort: a missing root is fine */
    }
}

async function readFullIndex(path: string): Promise<Record<string, string>> {
    try {
        return JSON.parse(await fs.readFile(path, 'utf8')) as Record<string, string>;
    } catch {
        return {};
    }
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
