/**
 * Cursor mods are not VPKs. The game loads its cursors as loose BMPs from
 * game/citadel/resource/cursors through SDL (inputsystem.dll), so a cursor mod
 * is a set of replacement files for that folder: cursor.bmp, cursor_ping.bmp,
 * cursor_shop.bmp, cursor_commend.bmp, optional `_vsz<N>` size variants, and an
 * optional cursor.res holding the hotspots.
 */

import type { CursorHotspot } from '../../../src/types/electron';

const CURSOR_IMAGE_RE = /^cursor(?:_[a-z0-9]+)*\.bmp$/;

export const MAX_CURSOR_FILE_BYTES = 4 * 1024 * 1024;

export function isCursorFileName(fileName: string): boolean {
    const name = fileName.toLowerCase();
    return name === 'cursor.res' || CURSOR_IMAGE_RE.test(name);
}

export function isUsableCursorFile(fileName: string, bytes: Uint8Array): boolean {
    if (bytes.length === 0 || bytes.length > MAX_CURSOR_FILE_BYTES) return false;
    if (fileName.toLowerCase().endsWith('.res')) return true;
    return bytes[0] === 0x42 && bytes[1] === 0x4d;
}

/**
 * The hotspots in a cursor.res, keyed by cursor name. The game looks a BMP up
 * by its file stem (cursor_ping.bmp reads `cursor_ping`) and uses 0, 0 for a
 * cursor the file does not list.
 */
export function parseCursorRes(text: string): Map<string, CursorHotspot> {
    const hotspots = new Map<string, CursorHotspot>();
    const body = text.replace(/\/\/[^\n]*/g, '');
    for (const [, name, entry] of body.matchAll(/"?([\w.-]+)"?\s*\{([^{}]*)\}/g)) {
        const x = /"hotx"\s+"(-?\d+)"/i.exec(entry);
        const y = /"hoty"\s+"(-?\d+)"/i.exec(entry);
        hotspots.set(name.toLowerCase(), { x: x ? Number(x[1]) : 0, y: y ? Number(y[1]) : 0 });
    }
    return hotspots;
}

export function formatCursorRes(hotspots: ReadonlyMap<string, CursorHotspot>): string {
    const entries = [...hotspots].map(
        ([name, { x, y }]) => `\t${name}\n\t{\n\t\t"hotx"\t\t"${x}"\n\t\t"hoty"\t\t"${y}"\n\t}\n`
    );
    return `"resource/cursor/cursor.res"\n{\n${entries.join('\n')}}\n`;
}

const FILE_HEADER = 14;
const V5_HEADER = 124;

/**
 * The stock cursors are 32-bit BI_RGB BMPs whose reserved fourth byte is alpha.
 * SDL reads it, but Chromium treats it as padding and paints the transparent
 * pixels (stored white) opaque. Re-header those as BITMAPV5 with an explicit
 * alpha mask so a preview matches the game. Anything else passes through.
 */
export function bmpWithExplicitAlpha(bytes: Buffer): Buffer {
    if (bytes.length < FILE_HEADER + 40) return bytes;
    if (bytes.readUInt32LE(14) !== 40 || bytes.readUInt16LE(28) !== 32 || bytes.readUInt32LE(30) !== 0) return bytes;
    const pixels = bytes.subarray(bytes.readUInt32LE(10));
    // SDL loads an all-zero alpha channel as opaque, which the file already previews as.
    let hasAlpha = false;
    for (let i = 3; i < pixels.length; i += 4) {
        if (pixels[i] !== 0) {
            hasAlpha = true;
            break;
        }
    }
    if (!hasAlpha) return bytes;

    const offset = FILE_HEADER + V5_HEADER;
    const out = Buffer.alloc(offset + pixels.length);
    bytes.copy(out, 0, 0, FILE_HEADER + 40);
    out.writeUInt32LE(out.length, 2);
    out.writeUInt32LE(offset, 10);
    out.writeUInt32LE(V5_HEADER, 14);
    out.writeUInt32LE(3, 30); // BI_BITFIELDS
    out.writeUInt32LE(0x00ff0000, 54);
    out.writeUInt32LE(0x0000ff00, 58);
    out.writeUInt32LE(0x000000ff, 62);
    out.writeUInt32LE(0xff000000, 66);
    out.write('BGRs', 70, 'latin1'); // LCS_sRGB, little-endian
    pixels.copy(out, offset);
    return out;
}

export interface CursorSourceFile {
    path: string;
    fileName: string;
    archiveFolder?: string;
}

export interface CursorFileGroup {
    /** Archive folder the files came from, when the archive shipped several sets. */
    variant?: string;
    /** Lowercased destination name -> extracted path. */
    files: Map<string, string>;
}

/**
 * Split extracted cursor files into installable sets. An archive with one
 * folder of cursors (or none) is one set; sibling folders each holding their
 * own cursor.bmp (e.g. `Large/`, `Small/`) are variants. A set needs at least
 * one image: a lone cursor.res changes nothing visible.
 */
export function groupCursorFiles(files: readonly CursorSourceFile[]): CursorFileGroup[] {
    const byFolder = new Map<string, Map<string, string>>();
    for (const file of files) {
        if (!isCursorFileName(file.fileName)) continue;
        const key = file.archiveFolder ?? '';
        let group = byFolder.get(key);
        if (!group) {
            group = new Map();
            byFolder.set(key, group);
        }
        group.set(file.fileName.toLowerCase(), file.path);
    }
    const groups = [...byFolder.entries()].filter(([, group]) =>
        [...group.keys()].some((name) => name.endsWith('.bmp'))
    );
    const isVariantSet = groups.length > 1;
    return groups
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([folder, group]) => ({
            variant: isVariantSet && folder ? folder : undefined,
            files: group,
        }));
}
