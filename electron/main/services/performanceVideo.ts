// The video.txt half of a performance preset. Several upstream configs ship a
// video.txt next to their gameinfo.gi and look wrong without it, because the
// gameinfo.gi values assume those render settings. Grimoire writes the preset's
// `setting.*` values into the user's own game/citadel/cfg/video.txt in place;
// the header (Version, VendorID, DeviceID) and every display setting stay the
// user's (see `video.exclude` in scripts/performance-presets.json).
//
// Unlike gameinfo.gi, Deadlock rewrites video.txt itself whenever the user
// changes a graphics setting in game, and that rewrite keeps no comments. An
// inline marker would not survive it, so what Grimoire changed lives in the
// applied-state sidecar instead: per key, the value written and the value it
// replaced. Revert only touches a key that still holds the value Grimoire
// wrote; one the user or the game has changed since is theirs now.
import { join } from 'path';
import { getCitadelPath } from './deadlock';

export interface VideoState {
    /** Value each key had before Grimoire wrote it; null when it was absent. */
    original: Record<string, string | null>;
    /** Value Grimoire wrote, per key. */
    written: Record<string, string>;
}

export function getVideoPath(deadlockPath: string): string {
    return join(getCitadelPath(deadlockPath), 'cfg', 'video.txt');
}

const SETTING_RE = /^([ \t]*)"setting\.([A-Za-z_]\w*)"([ \t]+)"([^"\r\n]*)"/;

function toLines(text: string): { lines: string[]; crlf: boolean } {
    const crlf = text.includes('\r\n');
    return { lines: (crlf ? text.split('\r\n').join('\n') : text).split('\n'), crlf };
}

function fromLines(lines: string[], crlf: boolean): string {
    const text = lines.join('\n');
    return crlf ? text.split('\n').join('\r\n') : text;
}

/** setting.* values as the engine reads them (the last occurrence wins). */
function currentValues(lines: string[]): Map<string, string> {
    const values = new Map<string, string>();
    for (const line of lines) {
        const m = SETTING_RE.exec(line);
        if (m) values.set(m[2], m[4]);
    }
    return values;
}

/** Set every occurrence of `key` to `value`, or delete them all for null.
 *  Returns whether the key had any line. */
function setValue(lines: string[], key: string, value: string | null): boolean {
    let found = false;
    for (let i = lines.length - 1; i >= 0; i--) {
        const m = SETTING_RE.exec(lines[i]);
        if (!m || m[2] !== key) continue;
        found = true;
        if (value === null) lines.splice(i, 1);
        else lines[i] = `${m[1]}"setting.${key}"${m[3]}"${value}"${lines[i].slice(m[0].length)}`;
    }
    return found;
}

/** Put back the value each key had before Grimoire wrote it, where the file
 *  still holds what Grimoire wrote. */
export function revertVideo(text: string, state: VideoState): string {
    const { lines, crlf } = toLines(text);
    const current = currentValues(lines);
    for (const [key, value] of Object.entries(state.written)) {
        if (current.get(key) !== value) continue;
        setValue(lines, key, state.original[key] ?? null);
    }
    return fromLines(lines, crlf);
}

export type ApplyVideoResult =
    | { ok: true; text: string; state: VideoState }
    | { ok: false; error: string };

/** Write `settings` into a video.txt that has no Grimoire values in it (revert
 *  first). Existing entries are edited in place; missing ones go in before the
 *  closing brace, formatted like the file's own entries. */
export function applyVideo(
    text: string,
    settings: ReadonlyArray<readonly [string, string]>
): ApplyVideoResult {
    const { lines, crlf } = toLines(text);
    let close = -1;
    for (let i = lines.length - 1; i >= 0; i--) {
        if (lines[i].trim() === '}') {
            close = i;
            break;
        }
        if (lines[i].trim()) break;
    }
    if (close < 0 || !lines.some((line) => line.includes('{'))) {
        return { ok: false, error: 'video.txt is not in the format Deadlock writes' };
    }

    const current = currentValues(lines);
    const sample = lines.map((line) => SETTING_RE.exec(line)).find(Boolean);
    const indent = sample?.[1] ?? '\t';
    const gap = sample?.[3] ?? '\t\t';

    const state: VideoState = { original: {}, written: {} };
    const missing: string[] = [];
    for (const [key, value] of settings) {
        const before = current.get(key) ?? null;
        if (before === value) continue;
        state.original[key] = before;
        state.written[key] = value;
        if (!setValue(lines, key, value)) missing.push(`${indent}"setting.${key}"${gap}"${value}"`);
    }
    lines.splice(close, 0, ...missing);
    return { ok: true, text: fromLines(lines, crlf), state };
}

/** How many of the values Grimoire wrote the file still holds. */
export function videoApplied(text: string, state: VideoState): number {
    const current = currentValues(toLines(text).lines);
    return Object.entries(state.written).filter(([key, value]) => current.get(key) === value).length;
}
