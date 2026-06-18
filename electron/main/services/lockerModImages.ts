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

async function ensureDir(): Promise<string> {
    const dir = imagesDir();
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

/** All stored skin images as { skinKey -> data URL }. */
export async function getLockerModImages(): Promise<Record<string, string>> {
    const dir = imagesDir();
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

/** Store `source` (a `data:` URL from a custom upload, or an `http(s)` gallery
 *  image URL to download) as this skin's Locker image, replacing any existing
 *  one. Returns the new data URL for immediate display. */
export async function setLockerModImage(skinKey: string, source: string): Promise<string> {
    if (!skinKey.trim()) throw new Error('Missing skin key');
    if (!source) throw new Error('Missing image source');

    const { buf, ext } = source.startsWith('data:')
        ? decodeDataUrl(source)
        : /^https?:\/\//i.test(source)
          ? await fetchImage(source)
          : (() => {
                throw new Error('Unsupported image source');
            })();

    const dir = await ensureDir();
    const stem = keyStem(skinKey);
    await clearKey(dir, stem);
    const dest = join(dir, `${stem}${ext}`);
    await fs.writeFile(dest, buf);
    return readAsDataUrl(dest);
}

/** Remove this skin's stored Locker image, if any. */
export async function removeLockerModImage(skinKey: string): Promise<void> {
    if (!skinKey.trim()) return;
    await clearKey(imagesDir(), keyStem(skinKey));
}
