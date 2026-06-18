/**
 * Per-mod (per-skin) Locker view images.
 *
 * Issue #208: a hero's Locker card should reflect the skin you actually run.
 * The user picks, per skin, which image represents it in the Locker, choosing
 * from the mod's own GameBanana gallery OR a custom upload. The Locker then
 * shows that image on the skin's card and uses the active skin's image as the
 * hero card / detail backdrop.
 *
 * This is a Grimoire-side display override only: it does NOT touch the game,
 * build a VPK, or change the in-game card art.
 *
 * Layout: userData/locker-mod-images/<encodeURIComponent(skinKey)>.<ext>
 *
 * The skin key is `getLockerSkinKey(mod)` (stable across folder/priority moves,
 * unlike metaKey), URL-encoded into the filename so it round-trips without a
 * separate index. One image per skin; re-picking replaces it. Whether the user
 * picked a gallery image (remote URL) or a custom file (data URL), the bytes
 * are copied in locally so the Locker stays offline-capable. Images are handed
 * back as base64 data URLs (CSP already allows `data:` in img-src).
 *
 * Per-skin display flags (e.g. "hide the hero name label because this art already
 * has the name on it") live alongside the images in a single `meta.json`, keyed by
 * the same skinKey. The flag is metadata about the override, so removing the image
 * also clears the flag.
 */
import { promises as fs } from 'fs';
import { existsSync } from 'fs';
import { join, extname, basename } from 'path';
import { app } from 'electron';

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

function imagesDir(): string {
    return join(app.getPath('userData'), 'locker-mod-images');
}

/** Issue #208: per-skin background images for the hero-detail backdrop. Same
 *  storage scheme as the card images, just a sibling directory. The backdrop
 *  is a wide full-bleed area, so these are framed to 16:9 instead of 3:4. */
function backgroundsDir(): string {
    return join(app.getPath('userData'), 'locker-mod-backgrounds');
}

/** Per-skin grid thumbnail images for the main Locker hero-grid card. Same
 *  storage scheme and 3:4 framing as the card images, but rendered on the hero
 *  grid card instead of the skin-panel card, so it's an independent override. */
function thumbnailsDir(): string {
    return join(app.getPath('userData'), 'locker-mod-thumbnails');
}

function metaPath(dir: string): string {
    return join(dir, 'meta.json');
}

/** Per-skin display flags. Currently just `hideHeroName`. Each image kind (card
 *  vs background) keeps its own flags in its own directory's meta.json. */
interface SkinImageFlags {
    hideHeroName?: boolean;
}

type FlagsFile = Record<string, SkinImageFlags>;

/** Read the flags map for `dir`; missing/corrupt file reads as empty (non-fatal). */
async function readFlags(dir: string): Promise<FlagsFile> {
    try {
        const raw = await fs.readFile(metaPath(dir), 'utf8');
        const parsed: unknown = JSON.parse(raw);
        return parsed && typeof parsed === 'object' ? (parsed as FlagsFile) : {};
    } catch {
        return {};
    }
}

async function writeFlags(dir: string, flags: FlagsFile): Promise<void> {
    await ensureDir(dir);
    await fs.writeFile(metaPath(dir), JSON.stringify(flags), 'utf8');
}

/** Only `hideHeroName: true` entries, as { skinKey -> true } (sparse). */
async function readHideNameMap(dir: string): Promise<Record<string, boolean>> {
    const flags = await readFlags(dir);
    const out: Record<string, boolean> = {};
    for (const [skinKey, value] of Object.entries(flags)) {
        if (value?.hideHeroName) out[skinKey] = true;
    }
    return out;
}

/** Set (or clear) the hide-name flag for `skinKey` under `dir`. */
async function setHideName(dir: string, skinKey: string, hide: boolean): Promise<void> {
    if (!skinKey.trim()) return;
    const flags = await readFlags(dir);
    if (hide) {
        flags[skinKey] = { ...flags[skinKey], hideHeroName: true };
    } else if (flags[skinKey]) {
        delete flags[skinKey].hideHeroName;
        if (Object.keys(flags[skinKey]).length === 0) delete flags[skinKey];
    }
    await writeFlags(dir, flags);
}

/** Drop all flags for `skinKey` under `dir` (called when its image is removed). */
async function clearFlags(dir: string, skinKey: string): Promise<void> {
    const flags = await readFlags(dir);
    if (flags[skinKey]) {
        delete flags[skinKey];
        await writeFlags(dir, flags);
    }
}

async function ensureDir(dir: string): Promise<string> {
    await fs.mkdir(dir, { recursive: true });
    return dir;
}

function keyStem(skinKey: string): string {
    return encodeURIComponent(skinKey.trim());
}

async function readAsDataUrl(filePath: string): Promise<string> {
    const mime = MIME_BY_EXT[extname(filePath).toLowerCase()];
    if (!mime) throw new Error(`Unsupported image type: ${extname(filePath)}`);
    const buf = await fs.readFile(filePath);
    return `data:${mime};base64,${buf.toString('base64')}`;
}

/** Delete any stored image for this skin (any extension). */
async function clearKey(dir: string, stem: string): Promise<void> {
    let entries: string[] = [];
    try {
        entries = await fs.readdir(dir);
    } catch {
        return;
    }
    await Promise.all(
        entries
            .filter((name) => basename(name, extname(name)) === stem)
            .map((name) => fs.rm(join(dir, name), { force: true }))
    );
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

/** Fetch a remote image URL into bytes + a file extension. */
async function fetchImage(url: string): Promise<{ buf: Buffer; ext: string }> {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Image fetch failed: ${res.status}`);
    const contentType = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
    // Prefer the URL's own extension (GameBanana serves .jpg/.png/.webp); fall
    // back to the response content-type.
    const urlExt = extname(new URL(url).pathname).toLowerCase();
    const ext = MIME_BY_EXT[urlExt] ? urlExt : EXT_BY_MIME[contentType];
    if (!ext) throw new Error(`Unsupported image type: ${contentType || urlExt || 'unknown'}`);
    const buf = Buffer.from(await res.arrayBuffer());
    return { buf, ext };
}

/** Fetch a remote gallery image and return it as a base64 data URL WITHOUT
 *  storing it. Used to seed the crop editor: a renderer canvas can't read pixels
 *  from a cross-origin <img> (it taints the canvas), but a data URL is safe. The
 *  cropped result is what actually gets stored, via setLockerModImage. */
export async function fetchLockerImageAsDataUrl(url: string): Promise<string> {
    if (!/^https?:\/\//i.test(url)) throw new Error('Unsupported image source');
    const { buf, ext } = await fetchImage(url);
    const mime = MIME_BY_EXT[ext];
    return `data:${mime};base64,${buf.toString('base64')}`;
}

/** All stored images in `dir` as { skinKey -> data URL }. */
async function readImageMap(dir: string): Promise<Record<string, string>> {
    if (!existsSync(dir)) return {};
    const entries = await fs.readdir(dir);
    const out: Record<string, string> = {};
    for (const name of entries) {
        const ext = extname(name).toLowerCase();
        if (!MIME_BY_EXT[ext]) continue;
        let skinKey: string;
        try {
            skinKey = decodeURIComponent(basename(name, ext));
        } catch {
            continue; // malformed filename; skip rather than fail the whole load
        }
        try {
            out[skinKey] = await readAsDataUrl(join(dir, name));
        } catch {
            // unreadable file; leave the skin without an override
        }
    }
    return out;
}

/** Store `source` (a `data:` URL or an `http(s)` URL to download) under `dir` for
 *  this skin, replacing any existing one. Returns the new data URL. */
async function storeImage(dir: string, skinKey: string, source: string): Promise<string> {
    if (!skinKey.trim()) throw new Error('Missing skin key');
    if (!source) throw new Error('Missing image source');

    const { buf, ext } = source.startsWith('data:')
        ? decodeDataUrl(source)
        : /^https?:\/\//i.test(source)
          ? await fetchImage(source)
          : (() => {
                throw new Error('Unsupported image source');
            })();

    await ensureDir(dir);
    const stem = keyStem(skinKey);
    await clearKey(dir, stem);
    const dest = join(dir, `${stem}${ext}`);
    await fs.writeFile(dest, buf);
    return readAsDataUrl(dest);
}

/** All stored skin card images as { skinKey -> data URL }. */
export async function getLockerModImages(): Promise<Record<string, string>> {
    return readImageMap(imagesDir());
}

/** All stored skin backdrop images as { skinKey -> data URL }. */
export async function getLockerModBackgrounds(): Promise<Record<string, string>> {
    return readImageMap(backgroundsDir());
}

/** Store this skin's Locker card image, replacing any existing one. Returns the
 *  new data URL for immediate display. */
export async function setLockerModImage(skinKey: string, source: string): Promise<string> {
    return storeImage(imagesDir(), skinKey, source);
}

/** Store this skin's hero-detail backdrop image, replacing any existing one. */
export async function setLockerModBackground(skinKey: string, source: string): Promise<string> {
    return storeImage(backgroundsDir(), skinKey, source);
}

/** Remove this skin's stored Locker card image AND its display flags, if any. */
export async function removeLockerModImage(skinKey: string): Promise<void> {
    if (!skinKey.trim()) return;
    await clearKey(imagesDir(), keyStem(skinKey));
    await clearFlags(imagesDir(), skinKey);
}

/** Remove this skin's stored backdrop image AND its display flags, if any. */
export async function removeLockerModBackground(skinKey: string): Promise<void> {
    if (!skinKey.trim()) return;
    await clearKey(backgroundsDir(), keyStem(skinKey));
    await clearFlags(backgroundsDir(), skinKey);
}

/** All stored skin grid-thumbnail images as { skinKey -> data URL }. */
export async function getLockerModThumbnails(): Promise<Record<string, string>> {
    return readImageMap(thumbnailsDir());
}

/** Store this skin's hero-grid thumbnail image, replacing any existing one. */
export async function setLockerModThumbnail(skinKey: string, source: string): Promise<string> {
    return storeImage(thumbnailsDir(), skinKey, source);
}

/** Remove this skin's stored grid-thumbnail image AND its display flags, if any. */
export async function removeLockerModThumbnail(skinKey: string): Promise<void> {
    if (!skinKey.trim()) return;
    await clearKey(thumbnailsDir(), keyStem(skinKey));
    await clearFlags(thumbnailsDir(), skinKey);
}

/** Per-skin thumbnail hide-name flags as { skinKey -> true } (sparse). */
export async function getLockerModThumbnailFlags(): Promise<Record<string, boolean>> {
    return readHideNameMap(thumbnailsDir());
}

/** Set (or clear) the grid-thumbnail's "hide the hero name label" flag. */
export async function setLockerModThumbnailHideName(skinKey: string, hide: boolean): Promise<void> {
    return setHideName(thumbnailsDir(), skinKey, hide);
}

/** Per-skin card-image hide-name flags as { skinKey -> true } (sparse). */
export async function getLockerModImageFlags(): Promise<Record<string, boolean>> {
    return readHideNameMap(imagesDir());
}

/** Per-skin backdrop-image hide-name flags as { skinKey -> true } (sparse). */
export async function getLockerModBackgroundFlags(): Promise<Record<string, boolean>> {
    return readHideNameMap(backgroundsDir());
}

/** Set (or clear) the card image's "hide the hero name label" flag for this skin. */
export async function setLockerModImageHideName(skinKey: string, hide: boolean): Promise<void> {
    return setHideName(imagesDir(), skinKey, hide);
}

/** Set (or clear) the backdrop image's "hide the hero name label" flag. */
export async function setLockerModBackgroundHideName(skinKey: string, hide: boolean): Promise<void> {
    return setHideName(backgroundsDir(), skinKey, hide);
}
