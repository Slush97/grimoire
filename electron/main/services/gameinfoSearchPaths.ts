import { DEADWORKS_SEARCH_PATH } from './deadlock';

interface Token {
    value: string;
    start: number;
    end: number;
    brace: boolean;
}

interface Block {
    start: number;
    end: number;
    bodyStart: number;
    body: string;
}

interface SearchPath {
    key: string;
    path: string;
    start: number;
    end: number;
}

// Keep source offsets so edits preserve unknown paths, comments and formatting.
function tokens(content: string): Token[] {
    const result: Token[] = [];
    const pattern = /\/\/[^\r\n]*|\/\*[\s\S]*?\*\/|"(?:\\.|[^"\\])*"|[{}]|[^\s{}"]+/g;
    let end = 0;
    for (const match of content.matchAll(pattern)) {
        if (content.slice(end, match.index).trim()) throw new Error('Invalid gameinfo token');
        const raw = match[0];
        end = match.index + raw.length;
        if (raw.startsWith('//') || raw.startsWith('/*')) continue;
        result.push({
            value: raw.startsWith('"') ? raw.slice(1, -1) : raw,
            start: match.index,
            end,
            brace: raw === '{' || raw === '}',
        });
    }
    if (content.slice(end).trim()) throw new Error('Invalid gameinfo token');
    return result;
}

function findBlock(content: string, name: string): Block | null {
    let list: Token[];
    // An unterminated quote leaves no boundary that is safe to edit.
    try { list = tokens(content); } catch { return null; }
    for (let i = 0; i < list.length - 1; i++) {
        if (list[i].value.toLowerCase() !== name.toLowerCase() ||
            !list[i + 1].brace || list[i + 1].value !== '{') continue;
        const bodyStart = list[i + 1].end;
        let depth = 1;
        for (let j = i + 2; j < list.length; j++) {
            if (!list[j].brace) continue;
            depth += list[j].value === '{' ? 1 : -1;
            if (depth === 0) {
                return { start: list[i].start, end: list[j].end, bodyStart,
                    body: content.slice(bodyStart, list[j].start) };
            }
        }
        return null;
    }
    return null;
}

export function findSearchPathsBlock(content: string): Block | null {
    const fileSystem = findBlock(content, 'FileSystem');
    if (!fileSystem) return null;
    const block = findBlock(fileSystem.body, 'SearchPaths');
    if (!block) return null;
    return { ...block, start: block.start + fileSystem.bodyStart,
        end: block.end + fileSystem.bodyStart, bodyStart: block.bodyStart + fileSystem.bodyStart };
}

export function insertSearchPaths(content: string, block: string): string | null {
    const fileSystem = findBlock(content, 'FileSystem');
    if (!fileSystem) return null;
    const eol = content.includes('\r\n') ? '\r\n' : '\n';
    return content.slice(0, fileSystem.bodyStart) + eol + '\t\t' + block + content.slice(fileSystem.bodyStart);
}

// Null when the body is not flat key/path pairs, such as a nested block or a
// [$PLATFORM] conditional left by another tool. Repair then rebuilds the block.
function readPaths(body: string): SearchPath[] | null {
    const list = tokens(body);
    if (list.length % 2 !== 0 || list.some((token) => token.brace || token.value.startsWith('['))) {
        return null;
    }
    const paths: SearchPath[] = [];
    for (let i = 0; i < list.length; i += 2) {
        paths.push({ key: list[i].value.toLowerCase(), path: normalizePath(list[i + 1].value),
            start: list[i].start, end: list[i + 1].end });
    }
    return paths;
}

function normalizePath(path: string): string {
    return path.replace(/[\\/]+/g, '/').replace(/\/$/, '').toLowerCase();
}

export function hasActivePath(body: string, path: string, key = 'Game'): boolean {
    return !!readPaths(body)?.some((entry) => entry.key === key.toLowerCase() && entry.path === normalizePath(path));
}

// Valve's stock SearchPaths as of the 2026-09-29 update.
const STOCK_PATHS = [
    ['Game_UILanguage', 'citadel_*LANGUAGE*'],
    ['Game_LowViolence', 'citadel_lv'],
    ['Game', 'citadel'],
    ['Game', 'core'],
] as const;

// Valve's block declares no Mod or Write paths and boots fine, but with
// Grimoire's folders mounted ahead of citadel the game dies on launch with
// "Unable to read default keybinding configuration" (1.30.0 shipped that).
// Grimoire 1.29 and DMM always declared these.
const MOD_PATHS = [
    ['Mod', 'citadel'],
    ['Write', 'citadel'],
    ['Mod', 'core'],
    ['Write', 'core'],
] as const;

export function hasModSearchPaths(body: string): boolean {
    return MOD_PATHS.every(([key, path]) => hasActivePath(body, path, key));
}

export function hasRequiredSearchPaths(body: string): boolean {
    return hasActivePath(body, 'citadel/grimoire') && hasActivePath(body, 'citadel/addons');
}

// Grimoire 1.29.0 and earlier rewrote SearchPaths without these, which hid
// localized hero-name art even with every mod off.
export function hasLanguageSearchPaths(body: string): boolean {
    return hasActivePath(body, 'citadel_*LANGUAGE*', 'Game_UILanguage') &&
        hasActivePath(body, 'citadel_lv', 'Game_LowViolence');
}

// Replace only Grimoire's managed Game entries. Valve's optional mounts and
// third-party entries survive, in their original relative order. Mounts under
// citadel/addons (DMM profile folders) are dropped: their VPKs would load
// behind Grimoire's back. A body that doesn't parse is rebuilt from stock.
export function buildSearchPathsBlock(
    overflow: string[], includeDeadworks: boolean, body = '', eol = '\n'
): string {
    const paths = readPaths(body);
    const managed = (paths ?? []).filter(({ key, path }) => key === 'game' &&
        (/^citadel\/(grimoire|addons\d*)(\/|$)/.test(path) || path === DEADWORKS_SEARCH_PATH));
    let preserved = paths ? body : '';
    for (const { start, end } of [...managed].reverse()) {
        // Take the whole line when the entry is alone on it, so repeat repairs
        // don't leave blank lines behind.
        const lineStart = preserved.lastIndexOf('\n', start - 1) + 1;
        const newline = preserved.indexOf('\n', end);
        const lineEnd = newline === -1 ? preserved.length : newline + 1;
        const alone = !preserved.slice(lineStart, start).trim() && !preserved.slice(end, lineEnd).trim();
        preserved = alone
            ? preserved.slice(0, lineStart) + preserved.slice(lineEnd)
            : preserved.slice(0, start) + preserved.slice(end);
    }
    const gamePaths = ['citadel/grimoire', 'citadel/addons', ...overflow.map((name) => `citadel/${name}`)];
    if (includeDeadworks) gamePaths.push(DEADWORKS_SEARCH_PATH);
    const missing = [...STOCK_PATHS, ...MOD_PATHS].filter(([key, path]) => !hasActivePath(body, path, key));
    // Language and low-violence mounts must precede base game content.
    const optional = missing.filter(([key]) => key.startsWith('Game_'));
    const base = missing.filter(([key]) => !key.startsWith('Game_'));
    const line = ([key, path]: readonly string[]) => `\t\t\t${key}\t\t${path}`;
    const kept = preserved.replace(/^[^\S\r\n]*\r?\n/, '').trimEnd();
    const lines = [...gamePaths.map((path) => line(['Game', path])), ...optional.map(line),
        ...(kept ? [kept] : []), ...base.map(line)];
    return `SearchPaths${eol}\t\t{${eol}${lines.join(eol)}${eol}\t\t}`;
}
