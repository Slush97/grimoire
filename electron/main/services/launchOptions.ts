// Steam Launch Options writer.
//
// Steam stores per-app launch options inside each user's
// `<SteamRoot>/userdata/<accountId>/config/localconfig.vdf`, at the path
//   UserLocalConfigStore -> Software -> Valve -> Steam -> apps -> <appId> -> LaunchOptions
//
// Constraints we MUST respect:
//   1. Steam must NOT be running when we write — Steam reloads on launch and
//      overwrites the file on clean shutdown, clobbering our edit otherwise.
//   2. localconfig.vdf is critical user data (per-game settings, friends, UI
//      prefs). Anything we don't fully understand we must NOT touch — corrupt
//      writes here can nuke the user's Steam config.
//
// Strategy: surgical byte-level edits.
//   - Parse the file with a depth-tracking tokenizer just enough to find the
//     exact byte range of the LaunchOptions value, the parent app block, or
//     the apps block (whichever exists deepest).
//   - Replace / insert at that range, leaving every other byte alone.
//   - Backup the original to `.bak` before any write. Use atomic temp+rename.
//   - Fail closed: if our scan can't find an expected structure, throw and
//     surface the error to the renderer rather than guessing.

import { promises as fs, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { spawn } from 'child_process';

export const DEADLOCK_STEAM_APP_ID = '1422450';

export interface LaunchOptionsLookup {
    /** Absolute path to the localconfig.vdf we'll be editing. */
    configPath: string;
    /** Steam account ID (32-bit) the file belongs to. */
    accountId: string;
    /** Currently stored launch options, or null if the key isn't set yet. */
    currentValue: string | null;
}

/** Per-platform candidate locations for Steam's `userdata` root. */
function getSteamUserdataRoots(): string[] {
    const paths: string[] = [];
    const home = homedir();
    if (process.platform === 'linux') {
        paths.push(join(home, '.steam/steam/userdata'));
        paths.push(join(home, '.local/share/Steam/userdata'));
        paths.push(join(home, '.var/app/com.valvesoftware.Steam/.steam/steam/userdata'));
    } else if (process.platform === 'win32') {
        paths.push('C:\\Program Files (x86)\\Steam\\userdata');
        paths.push('C:\\Program Files\\Steam\\userdata');
    } else if (process.platform === 'darwin') {
        paths.push(join(home, 'Library/Application Support/Steam/userdata'));
    }
    return paths;
}

/**
 * Locate the right localconfig.vdf for the current Steam user.
 *
 * Heuristic: pick the userdata subfolder whose `config/localconfig.vdf` has
 * the most recent mtime — this is the account Steam actually uses most. If
 * the caller passes an explicit accountId, prefer that one if it exists.
 */
async function findLocalConfigPath(preferredAccountId?: string): Promise<{ path: string; accountId: string } | null> {
    for (const root of getSteamUserdataRoots()) {
        if (!existsSync(root)) continue;
        let entries: string[];
        try {
            entries = await fs.readdir(root);
        } catch {
            continue;
        }
        const candidates: Array<{ accountId: string; configPath: string; mtime: number }> = [];
        for (const entry of entries) {
            // userdata subfolders are always numeric account IDs
            if (!/^\d+$/.test(entry)) continue;
            const configPath = join(root, entry, 'config', 'localconfig.vdf');
            if (!existsSync(configPath)) continue;
            try {
                const stat = await fs.stat(configPath);
                candidates.push({ accountId: entry, configPath, mtime: stat.mtimeMs });
            } catch {
                // ignore unreadable entries
            }
        }
        if (candidates.length === 0) continue;
        if (preferredAccountId) {
            const match = candidates.find((c) => c.accountId === preferredAccountId);
            if (match) return { path: match.configPath, accountId: match.accountId };
        }
        candidates.sort((a, b) => b.mtime - a.mtime);
        return { path: candidates[0].configPath, accountId: candidates[0].accountId };
    }
    return null;
}

/** Whether Steam.exe / steam is currently running. Best-effort, platform-aware. */
export async function isSteamRunning(): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
        if (process.platform === 'win32') {
            const proc = spawn('tasklist.exe', ['/FI', 'IMAGENAME eq steam.exe', '/NH'], {
                windowsHide: true,
            });
            let stdout = '';
            proc.stdout?.on('data', (chunk) => { stdout += chunk.toString(); });
            proc.on('close', () => resolve(/steam\.exe/i.test(stdout)));
            proc.on('error', () => resolve(false));
        } else if (process.platform === 'linux' || process.platform === 'darwin') {
            // pgrep returns 0 if any process matches. We look for the Steam
            // client binary, not just any "steam" string in argv.
            const proc = spawn('pgrep', ['-x', 'steam'], { stdio: ['ignore', 'pipe', 'ignore'] });
            proc.on('close', (code) => resolve(code === 0));
            proc.on('error', () => resolve(false));
        } else {
            resolve(false);
        }
    });
}

/**
 * Skip whitespace and `// comments` from `i` onward. Returns the new index.
 * Comments-to-EOL is a Valve VDF convention; Steam itself emits no comments
 * but third-party tools sometimes add them, so we tolerate them on read.
 */
function skipWhitespace(text: string, i: number): number {
    while (i < text.length) {
        const c = text[i];
        if (c === ' ' || c === '\t' || c === '\n' || c === '\r') {
            i++;
        } else if (c === '/' && text[i + 1] === '/') {
            // Skip to end of line
            const eol = text.indexOf('\n', i);
            if (eol === -1) return text.length;
            i = eol + 1;
        } else {
            break;
        }
    }
    return i;
}

interface QuotedToken {
    /** Inclusive byte offset of the opening `"`. */
    start: number;
    /** Inclusive byte offset of the closing `"`. */
    end: number;
    /** Decoded value (escape sequences resolved). */
    value: string;
}

/**
 * Read a quoted VDF string starting at `i` (which must point to `"`). Handles
 * `\"` and `\\` escape sequences — Steam writes these when LaunchOptions
 * contains a literal quote or backslash.
 */
function readQuoted(text: string, i: number): QuotedToken | null {
    if (text[i] !== '"') return null;
    const start = i;
    let j = i + 1;
    let value = '';
    while (j < text.length) {
        const c = text[j];
        if (c === '\\' && j + 1 < text.length) {
            const next = text[j + 1];
            if (next === '"' || next === '\\') {
                value += next;
                j += 2;
                continue;
            }
            // Unknown escape — pass through verbatim so we don't lose info.
            value += c;
            j++;
            continue;
        }
        if (c === '"') {
            return { start, end: j, value };
        }
        value += c;
        j++;
    }
    return null;
}

/** Encode a string for VDF: escape `\` and `"`. */
function quoteVdfString(s: string): string {
    return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

interface BlockHandle {
    /** Offset of the opening `{`. */
    braceOpen: number;
    /** Offset of the matching closing `}`. */
    braceClose: number;
}

/**
 * From just after a parent's opening `{`, scan its direct children and find
 * the named block. Returns the brace offsets if found, or null if not.
 *
 * Direct children only — we don't recurse into grandchildren, callers chain
 * calls explicitly so the traversal mirrors the VDF path they're walking.
 */
function findChildBlock(text: string, parentBodyStart: number, parentBodyEnd: number, targetKey: string): BlockHandle | null {
    let i = parentBodyStart;
    const targetLower = targetKey.toLowerCase();
    while (i < parentBodyEnd) {
        i = skipWhitespace(text, i);
        if (i >= parentBodyEnd) break;
        if (text[i] === '}') break;
        const keyTok = readQuoted(text, i);
        if (!keyTok) {
            // Unrecognized syntax at this position — abort rather than guess.
            return null;
        }
        i = keyTok.end + 1;
        i = skipWhitespace(text, i);
        if (text[i] === '"') {
            // Leaf value — not a block, skip
            const valTok = readQuoted(text, i);
            if (!valTok) return null;
            i = valTok.end + 1;
            continue;
        }
        if (text[i] !== '{') {
            // Bare key with no value — Valve allows this but it's nonsense
            // here. Abort.
            return null;
        }
        const braceOpen = i;
        // Scan to matching close, respecting nested braces and strings
        let depth = 1;
        let j = i + 1;
        while (j < parentBodyEnd && depth > 0) {
            const c = text[j];
            if (c === '"') {
                const strTok = readQuoted(text, j);
                if (!strTok) return null;
                j = strTok.end + 1;
            } else if (c === '/' && text[j + 1] === '/') {
                const eol = text.indexOf('\n', j);
                j = eol === -1 ? text.length : eol + 1;
            } else if (c === '{') {
                depth++;
                j++;
            } else if (c === '}') {
                depth--;
                if (depth === 0) break;
                j++;
            } else {
                j++;
            }
        }
        if (depth !== 0) return null; // Unmatched braces in file
        const braceClose = j;
        if (keyTok.value.toLowerCase() === targetLower) {
            return { braceOpen, braceClose };
        }
        i = braceClose + 1;
    }
    return null;
}

/**
 * Within the body of a block, find a leaf "key" "value" entry. Returns the
 * byte range of the value token (inclusive of quotes) so callers can splice
 * a replacement in place.
 */
function findChildLeaf(text: string, bodyStart: number, bodyEnd: number, targetKey: string): QuotedToken | null {
    let i = bodyStart;
    const targetLower = targetKey.toLowerCase();
    while (i < bodyEnd) {
        i = skipWhitespace(text, i);
        if (i >= bodyEnd) break;
        if (text[i] === '}') break;
        const keyTok = readQuoted(text, i);
        if (!keyTok) return null;
        i = keyTok.end + 1;
        i = skipWhitespace(text, i);
        if (text[i] === '{') {
            // It's a block, skip past it
            let depth = 1;
            let j = i + 1;
            while (j < bodyEnd && depth > 0) {
                const c = text[j];
                if (c === '"') {
                    const strTok = readQuoted(text, j);
                    if (!strTok) return null;
                    j = strTok.end + 1;
                } else if (c === '{') {
                    depth++; j++;
                } else if (c === '}') {
                    depth--;
                    if (depth === 0) break;
                    j++;
                } else {
                    j++;
                }
            }
            if (depth !== 0) return null;
            i = j + 1;
            continue;
        }
        if (text[i] !== '"') return null;
        const valTok = readQuoted(text, i);
        if (!valTok) return null;
        if (keyTok.value.toLowerCase() === targetLower) {
            return valTok;
        }
        i = valTok.end + 1;
    }
    return null;
}

interface AppBlockLocation {
    text: string;
    /** Root config path the text came from. */
    sourcePath: string;
    /** Brace bounds of the appId block. Null if it doesn't exist yet. */
    appBlock: BlockHandle | null;
    /** Brace bounds of the apps parent block. Always non-null on success
     *  because we require apps to exist before doing anything else. */
    appsBlock: BlockHandle;
}

/**
 * Walk down to `UserLocalConfigStore -> Software -> Valve -> Steam -> apps`,
 * then look for our app inside it. Returns whatever boundary info we have so
 * the caller can either splice an existing LaunchOptions value, insert one,
 * or insert the whole appId block.
 */
function locateAppBlock(text: string, sourcePath: string, appId: string): AppBlockLocation {
    // Locate the root object's body. The file starts with
    //   "UserLocalConfigStore"\n{\n ... \n}
    // so the body of the root is everything between the first { and its
    // matching }.
    const rootKey = readQuoted(text, skipWhitespace(text, 0));
    if (!rootKey || rootKey.value !== 'UserLocalConfigStore') {
        throw new Error('localconfig.vdf does not start with UserLocalConfigStore — refusing to edit.');
    }
    const rootBraceIdx = text.indexOf('{', rootKey.end + 1);
    if (rootBraceIdx === -1) {
        throw new Error('Malformed localconfig.vdf — no opening brace after root key.');
    }
    // Find matching close for root.
    let depth = 1;
    let j = rootBraceIdx + 1;
    while (j < text.length && depth > 0) {
        const c = text[j];
        if (c === '"') {
            const strTok = readQuoted(text, j);
            if (!strTok) throw new Error('Malformed localconfig.vdf — unterminated string.');
            j = strTok.end + 1;
        } else if (c === '{') {
            depth++; j++;
        } else if (c === '}') {
            depth--;
            if (depth === 0) break;
            j++;
        } else {
            j++;
        }
    }
    if (depth !== 0) throw new Error('Malformed localconfig.vdf — unmatched root braces.');
    const rootBlock: BlockHandle = { braceOpen: rootBraceIdx, braceClose: j };

    const software = findChildBlock(text, rootBlock.braceOpen + 1, rootBlock.braceClose, 'Software');
    if (!software) throw new Error('localconfig.vdf missing Software block — refusing to edit.');
    const valve = findChildBlock(text, software.braceOpen + 1, software.braceClose, 'Valve');
    if (!valve) throw new Error('localconfig.vdf missing Software/Valve block — refusing to edit.');
    const steam = findChildBlock(text, valve.braceOpen + 1, valve.braceClose, 'Steam');
    if (!steam) throw new Error('localconfig.vdf missing Software/Valve/Steam block — refusing to edit.');
    const apps = findChildBlock(text, steam.braceOpen + 1, steam.braceClose, 'apps');
    if (!apps) throw new Error('localconfig.vdf missing apps block — user may have never launched a Steam game.');

    const appBlock = findChildBlock(text, apps.braceOpen + 1, apps.braceClose, appId);
    return { text, sourcePath, appBlock, appsBlock: apps };
}

/**
 * Public: read the currently-stored launch options for Deadlock. Returns
 * null when the file or path doesn't exist (e.g. fresh Steam install). Does
 * NOT throw on missing structure — those are normal "no options set" states.
 */
export async function readLaunchOptions(appId: string = DEADLOCK_STEAM_APP_ID): Promise<LaunchOptionsLookup | null> {
    const found = await findLocalConfigPath();
    if (!found) return null;
    let text: string;
    try {
        text = await fs.readFile(found.path, 'utf-8');
    } catch {
        return null;
    }
    try {
        const loc = locateAppBlock(text, found.path, appId);
        if (!loc.appBlock) {
            return { configPath: found.path, accountId: found.accountId, currentValue: null };
        }
        const leaf = findChildLeaf(text, loc.appBlock.braceOpen + 1, loc.appBlock.braceClose, 'LaunchOptions');
        return {
            configPath: found.path,
            accountId: found.accountId,
            currentValue: leaf ? leaf.value : null,
        };
    } catch {
        // Structural problem — surface as "no current value" so the UI can
        // still let the user save (the write path will surface a clearer
        // error if the structure remains broken at write time).
        return { configPath: found.path, accountId: found.accountId, currentValue: null };
    }
}

/**
 * Indent inferred from how the existing file formats its blocks. Steam's
 * own writes use `\t`, but a Steam Beta build briefly used 2-space indents,
 * and some user tools rewrite the file. We sniff one line of the file to
 * match its style instead of forcing tabs.
 */
function sniffIndent(text: string): string {
    // Look at the first indented line — the line after the root `{`.
    const rootBrace = text.indexOf('{');
    if (rootBrace === -1) return '\t';
    const nextLineStart = text.indexOf('\n', rootBrace);
    if (nextLineStart === -1) return '\t';
    let i = nextLineStart + 1;
    let indent = '';
    while (i < text.length && (text[i] === '\t' || text[i] === ' ')) {
        indent += text[i];
        i++;
    }
    return indent || '\t';
}

/**
 * Atomically write `content` to `path`. Writes to `<path>.tmp` first, then
 * renames. Creates a `<path>.bak` backup beforehand on first call (or if no
 * backup exists yet) so the user can recover from a bad write.
 */
async function safeAtomicWrite(path: string, content: string): Promise<void> {
    const backupPath = `${path}.grimoire.bak`;
    if (!existsSync(backupPath)) {
        try {
            await fs.copyFile(path, backupPath);
        } catch (err) {
            console.warn('[launchOptions] Backup copy failed (continuing):', err);
        }
    }
    const tmpPath = `${path}.grimoire.tmp`;
    await fs.writeFile(tmpPath, content, 'utf-8');
    await fs.rename(tmpPath, path);
}

/**
 * Write the launch options string into localconfig.vdf. Must NOT be called
 * while Steam is running — the caller is responsible for enforcing that
 * (we expose isSteamRunning so they can prompt the user / wait).
 *
 * Returns the path that was written so the caller can log / surface it.
 */
export async function writeLaunchOptions(
    options: string,
    appId: string = DEADLOCK_STEAM_APP_ID
): Promise<{ configPath: string; accountId: string }> {
    const found = await findLocalConfigPath();
    if (!found) {
        throw new Error('Could not locate a Steam userdata folder — is Steam installed and have you logged in at least once?');
    }
    const text = await fs.readFile(found.path, 'utf-8');
    const loc = locateAppBlock(text, found.path, appId);

    const indent = sniffIndent(text);
    let updated: string;

    if (loc.appBlock) {
        // The app block exists. Either replace an existing LaunchOptions
        // value or add the key inside the block body.
        const existing = findChildLeaf(text, loc.appBlock.braceOpen + 1, loc.appBlock.braceClose, 'LaunchOptions');
        if (existing) {
            // Replace just the value token (between its outer quotes).
            updated =
                text.slice(0, existing.start) +
                quoteVdfString(options) +
                text.slice(existing.end + 1);
        } else {
            // Insert LaunchOptions right after the opening `{`. depth needs
            // to match: appBlock body is 5 levels deep from root indent
            // (Software/Valve/Steam/apps/<appId>) → depth 6 from file's
            // root indent unit.
            //
            // Rather than counting depth manually, look at the leading
            // whitespace of the line containing the `{` and add one more
            // indent.
            const lineStart = text.lastIndexOf('\n', loc.appBlock.braceOpen) + 1;
            const leading = text.slice(lineStart, loc.appBlock.braceOpen).match(/^[\t ]*/)?.[0] ?? '';
            const innerIndent = leading + indent;
            const insertion = `\n${innerIndent}${quoteVdfString('LaunchOptions')}${indent}${quoteVdfString(options)}`;
            updated =
                text.slice(0, loc.appBlock.braceOpen + 1) +
                insertion +
                text.slice(loc.appBlock.braceOpen + 1);
        }
    } else {
        // The app block doesn't exist. Insert a new "<appId>" { ... } block
        // just before the closing `}` of the apps block, matching the
        // indent of the apps block's other children.
        const lineStart = text.lastIndexOf('\n', loc.appsBlock.braceOpen) + 1;
        const appsLeading = text.slice(lineStart, loc.appsBlock.braceOpen).match(/^[\t ]*/)?.[0] ?? '';
        const childIndent = appsLeading + indent;
        const grandIndent = childIndent + indent;
        const insertion =
            `\n${childIndent}${quoteVdfString(appId)}\n` +
            `${childIndent}{\n` +
            `${grandIndent}${quoteVdfString('LaunchOptions')}${indent}${quoteVdfString(options)}\n` +
            `${childIndent}}`;
        updated =
            text.slice(0, loc.appsBlock.braceClose) +
            insertion +
            `\n${appsLeading}` +
            text.slice(loc.appsBlock.braceClose);
    }

    await safeAtomicWrite(found.path, updated);
    return { configPath: found.path, accountId: found.accountId };
}
