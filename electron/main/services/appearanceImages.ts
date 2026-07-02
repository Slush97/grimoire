/**
 * Custom launcher / sidebar background images (issue: unify launcher backgrounds).
 *
 * The user can give any of four Sidebar surfaces (the Launch Modded button, the
 * Launch Vanilla button, the active-tab highlight, and the preview-volume popup)
 * a custom uploaded image instead of the built-in art or a hero render. This
 * service owns those uploads: it stores the bytes locally so the app stays
 * offline-capable and hands them back as base64 data URLs (CSP already allows
 * `data:` in img-src).
 *
 * The *choice* per surface (default / hero / custom / none) lives in AppSettings
 * (`appearanceBackgrounds`); this service only stores the custom image bytes.
 *
 * Layout: userData/appearance-backgrounds/<surface>.<ext>      (baked override)
 *         userData/appearance-backgrounds/sources/<surface>.<ext> + meta.json
 *                                                              (original + crop)
 *
 * The crop editor bakes the framed image client-side; we store that as the baked
 * override AND keep the original source + a normalized crop rect so the editor can
 * be reopened on the exact framing. This mirrors lockerModImages.ts, but keyed by
 * the four fixed surface ids instead of per-skin keys (so it's a sibling, not a
 * fourth Locker variant).
 */
import { promises as fs } from 'fs';
import { existsSync } from 'fs';
import { join, extname, basename } from 'path';
import { app } from 'electron';
import type { AppearanceSurface } from '../../../src/types/mod';
import type { CropRect } from './lockerModImages';

const MIME_BY_EXT: Record<string, string> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
};

const EXT_BY_MIME: Record<string, string> = {
    'image/png': '.png',
    'image/jpeg': '.jpg',
    'image/gif': '.gif',
    'image/webp': '.webp',
};

/** The four valid surface ids, guarded so a malformed renderer call can never
 *  write outside the expected filenames. */
const SURFACES: readonly AppearanceSurface[] = [
    'launchModded',
    'launchVanilla',
    'activeTab',
    'volume',
];

function isSurface(value: string): value is AppearanceSurface {
    return (SURFACES as readonly string[]).includes(value);
}

function rootDir(): string {
    return join(app.getPath('userData'), 'appearance-backgrounds');
}

function sourcesDir(): string {
    return join(rootDir(), 'sources');
}

function metaPath(): string {
    return join(rootDir(), 'meta.json');
}

async function ensureDir(dir: string): Promise<void> {
    await fs.mkdir(dir, { recursive: true });
}

async function readAsDataUrl(filePath: string): Promise<string> {
    const mime = MIME_BY_EXT[extname(filePath).toLowerCase()];
    if (!mime) throw new Error(`Unsupported image type: ${extname(filePath)}`);
    const buf = await fs.readFile(filePath);
    return `data:${mime};base64,${buf.toString('base64')}`;
}

/** Decode a `data:<mime>;base64,...` URL into bytes + a file extension. */
function decodeDataUrl(source: string): { buf: Buffer; ext: string } {
    const match = /^data:([^;,]+)(;base64)?,(.*)$/s.exec(source);
    if (!match) throw new Error('Malformed data URL');
    const mime = match[1].toLowerCase();
    const ext = EXT_BY_MIME[mime];
    if (!ext) throw new Error(`Unsupported image type: ${mime}`);
    const buf = match[2]
        ? Buffer.from(match[3], 'base64')
        : Buffer.from(decodeURIComponent(match[3]), 'utf8');
    return { buf, ext };
}

/** Resolve `source` (a `data:` URL) into bytes + a file extension. The renderer
 *  always supplies a data URL here (file picks are read via readImageDataUrl, the
 *  crop editor bakes a data URL), so remote fetching is intentionally not needed. */
function resolveImageBytes(source: string): { buf: Buffer; ext: string } {
    if (!source) throw new Error('Missing image source');
    if (source.startsWith('data:')) return decodeDataUrl(source);
    throw new Error('Unsupported image source');
}

/** Delete any stored image for `stem` (any extension) directly under `dir`. */
async function clearKey(dir: string, stem: string): Promise<void> {
    let entries: string[] = [];
    try {
        entries = await fs.readdir(dir);
    } catch {
        return;
    }
    await Promise.all(
        entries
            .filter(
                (name) =>
                    name !== 'sources' &&
                    MIME_BY_EXT[extname(name).toLowerCase()] &&
                    basename(name, extname(name)) === stem
            )
            .map((name) => fs.rm(join(dir, name), { force: true }))
    );
}

type FlagsFile = Partial<Record<AppearanceSurface, { crop?: CropRect }>>;

async function readFlags(): Promise<FlagsFile> {
    try {
        const raw = await fs.readFile(metaPath(), 'utf8');
        const parsed: unknown = JSON.parse(raw);
        return parsed && typeof parsed === 'object' ? (parsed as FlagsFile) : {};
    } catch {
        return {};
    }
}

async function writeFlags(flags: FlagsFile): Promise<void> {
    await ensureDir(rootDir());
    await fs.writeFile(metaPath(), JSON.stringify(flags), 'utf8');
}

/** All stored baked overrides as { surface -> data URL }. */
export async function getAppearanceImages(): Promise<Partial<Record<AppearanceSurface, string>>> {
    const dir = rootDir();
    if (!existsSync(dir)) return {};
    const entries = await fs.readdir(dir);
    const out: Partial<Record<AppearanceSurface, string>> = {};
    for (const name of entries) {
        const ext = extname(name).toLowerCase();
        if (!MIME_BY_EXT[ext]) continue;
        const stem = basename(name, ext);
        if (!isSurface(stem)) continue;
        try {
            out[stem] = await readAsDataUrl(join(dir, name));
        } catch {
            // unreadable file; leave the surface without a custom override
        }
    }
    return out;
}

/** Store `source` (a `data:` URL) as the baked override for `surface`, replacing
 *  any existing one. Returns the new data URL. */
export async function setAppearanceImage(
    surface: AppearanceSurface,
    source: string
): Promise<string> {
    if (!isSurface(surface)) throw new Error(`Unknown appearance surface: ${surface}`);
    const { buf, ext } = resolveImageBytes(source);
    const dir = rootDir();
    await ensureDir(dir);
    await clearKey(dir, surface);
    const dest = join(dir, `${surface}${ext}`);
    await fs.writeFile(dest, buf);
    return readAsDataUrl(dest);
}

/** Remove the baked override, the stored original source, and the crop rect for
 *  `surface` (called when the surface switches away from `custom`). */
export async function removeAppearanceImage(surface: AppearanceSurface): Promise<void> {
    if (!isSurface(surface)) return;
    await clearKey(rootDir(), surface);
    await clearKey(sourcesDir(), surface);
    const flags = await readFlags();
    if (flags[surface]) {
        delete flags[surface];
        await writeFlags(flags);
    }
}

/** Persist the editable state for `surface`: the ORIGINAL source bytes (under
 *  `sources/`) plus a normalized crop rect (in meta.json), so the crop editor can
 *  reopen on the exact framing. Independent of the baked-override write. */
export async function setAppearanceImageEdit(
    surface: AppearanceSurface,
    source: string,
    crop: CropRect
): Promise<void> {
    if (!isSurface(surface)) throw new Error(`Unknown appearance surface: ${surface}`);
    const { buf, ext } = resolveImageBytes(source);
    const sub = sourcesDir();
    await ensureDir(sub);
    await clearKey(sub, surface);
    await fs.writeFile(join(sub, `${surface}${ext}`), buf);
    const flags = await readFlags();
    flags[surface] = { crop };
    await writeFlags(flags);
}

/** Read back the editable state for `surface` (original source data URL + crop
 *  rect), or null if either piece is missing. */
export async function getAppearanceImageEdit(
    surface: AppearanceSurface
): Promise<{ source: string; crop: CropRect } | null> {
    if (!isSurface(surface)) return null;
    const sub = sourcesDir();
    let entries: string[] = [];
    try {
        entries = await fs.readdir(sub);
    } catch {
        return null;
    }
    const match = entries.find(
        (name) => MIME_BY_EXT[extname(name).toLowerCase()] && basename(name, extname(name)) === surface
    );
    if (!match) return null;
    const crop = (await readFlags())[surface]?.crop;
    if (!crop) return null;
    try {
        const source = await readAsDataUrl(join(sub, match));
        return { source, crop };
    } catch {
        return null;
    }
}
