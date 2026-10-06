import { createHash, randomUUID } from 'crypto';
import { existsSync, promises as fs } from 'fs';
import { basename, join } from 'path';
import AdmZip from 'adm-zip';
import type { CursorImageFile, CursorPack, CursorPacksState, CursorPreview } from '../../../src/types/electron';
import { getUserDataPath } from '../utils/paths';
import {
    bmpWithExplicitAlpha,
    formatCursorRes,
    groupCursorFiles,
    isCursorFileName,
    isUsableCursorFile,
    parseCursorRes,
} from './cursorFiles';
import { getCitadelPath } from './deadlock';
import { extractArchive, type ExtractedVpk } from './extract';

interface StoredState {
    packs: CursorPack[];
    activeId: string | null;
    /** sha256 of each file Grimoire last wrote into the game's cursor folder.
     *  A file there with any other hash was put back by Steam (update or
     *  verify), so it is the current stock copy. */
    applied: Record<string, string>;
}

const rootDir = () => join(getUserDataPath(), 'cursor-packs');
const statePath = () => join(rootDir(), 'state.json');
const stockDir = () => join(rootDir(), 'stock');
const packDir = (id: string) => join(rootDir(), 'packs', id);

export function gameCursorsDir(deadlockPath: string): string {
    return join(getCitadelPath(deadlockPath), 'resource', 'cursors');
}

const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

// Only a missing file means a fresh start. Treating an unreadable one as empty
// would forget `applied`, and the next write would back up the applied pack's
// files as stock.
async function loadState(): Promise<StoredState> {
    let raw: string;
    try {
        raw = await fs.readFile(statePath(), 'utf-8');
    } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { packs: [], activeId: null, applied: {} };
        throw err;
    }
    const parsed = JSON.parse(raw) as Partial<StoredState>;
    return { packs: parsed.packs ?? [], activeId: parsed.activeId ?? null, applied: parsed.applied ?? {} };
}

async function saveState(state: StoredState): Promise<void> {
    await fs.mkdir(rootDir(), { recursive: true });
    const tmp = `${statePath()}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(state, null, 2));
    await fs.rename(tmp, statePath());
}

const toPublic = (state: StoredState): CursorPacksState => ({ packs: state.packs, activeId: state.activeId });

// Every mutation reads, rewrites the game folder, then saves, so two in flight
// (a double click, a download finishing mid-switch) must not interleave.
let queue: Promise<unknown> = Promise.resolve();
function exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = queue.then(fn, fn);
    queue = run.catch(() => {});
    return run;
}

async function requireCursorsDir(deadlockPath: string): Promise<string> {
    const dir = gameCursorsDir(deadlockPath);
    if (!existsSync(dir)) {
        throw new Error(`Deadlock's cursor folder was not found at ${dir}. Check the Deadlock path in Settings.`);
    }
    return dir;
}

/** Back up every cursor file in the game folder that Grimoire did not write. */
async function refreshStockBackup(dir: string, state: StoredState): Promise<void> {
    await fs.mkdir(stockDir(), { recursive: true });
    for (const name of await fs.readdir(dir)) {
        const lower = name.toLowerCase();
        if (!isCursorFileName(lower)) continue;
        const bytes = await fs.readFile(join(dir, name));
        if (state.applied[lower] === sha256(bytes)) continue;
        await fs.writeFile(join(stockDir(), lower), bytes);
    }
}

/**
 * The saved `applied` record must cover every pack file on disk at every point,
 * or refreshStockBackup would mistake one for stock after a failed write. So
 * the new pack is read in full first, the old one is restored while the old
 * record still stands, and the new record is saved before any of its files land.
 */
async function writeActive(dir: string, state: StoredState, pack: CursorPack | null): Promise<void> {
    const incoming = new Map<string, Buffer>();
    if (pack) {
        for (const name of pack.files) incoming.set(name, await fs.readFile(join(packDir(pack.id), name)));
    }

    for (const name of Object.keys(state.applied)) {
        const stock = join(stockDir(), name);
        if (existsSync(stock)) await fs.copyFile(stock, join(dir, name));
        else await fs.rm(join(dir, name), { force: true });
    }

    state.applied = Object.fromEntries([...incoming].map(([name, bytes]) => [name, sha256(bytes)]));
    state.activeId = pack?.id ?? null;
    await saveState(state);
    for (const [name, bytes] of incoming) await fs.writeFile(join(dir, name), bytes);
}

export function getCursorPacks(): Promise<CursorPacksState> {
    return loadState().then(toPublic);
}

export function setActiveCursorPack(deadlockPath: string, id: string | null): Promise<CursorPacksState> {
    return exclusive(async () => {
        const state = await loadState();
        const pack = id === null ? null : state.packs.find((p) => p.id === id);
        if (pack === undefined) throw new Error('That cursor pack is no longer installed.');
        const dir = await requireCursorsDir(deadlockPath);
        await refreshStockBackup(dir, state);
        await writeActive(dir, state, pack);
        return toPublic(state);
    });
}

export function deleteCursorPack(deadlockPath: string, id: string): Promise<CursorPacksState> {
    return exclusive(async () => {
        const state = await loadState();
        if (state.activeId === id) {
            // A missing folder (Deadlock moved or uninstalled) leaves nothing
            // to restore, and must not block removing the pack.
            const dir = gameCursorsDir(deadlockPath);
            if (existsSync(dir)) {
                await refreshStockBackup(dir, state);
                await writeActive(dir, state, null);
            } else {
                state.applied = {};
                state.activeId = null;
            }
        }
        state.packs = state.packs.filter((p) => p.id !== id);
        await saveState(state);
        await fs.rm(packDir(id), { recursive: true, force: true });
        return toPublic(state);
    });
}

/**
 * Put the active pack back if a game update or file verification restored the
 * stock cursors since it was applied. Runs at startup; a no-op otherwise.
 */
export function reconcileCursorPack(deadlockPath: string): Promise<void> {
    return exclusive(async () => {
        const state = await loadState();
        if (!state.activeId) return;
        const dir = gameCursorsDir(deadlockPath);
        if (!existsSync(dir)) return;
        let intact = true;
        for (const [name, hash] of Object.entries(state.applied)) {
            const path = join(dir, name);
            if (!existsSync(path) || sha256(await fs.readFile(path)) !== hash) {
                intact = false;
                break;
            }
        }
        if (intact) return;
        console.log('[cursors] Stock cursors were restored by the game; reapplying the active pack');
        await refreshStockBackup(dir, state);
        await writeActive(dir, state, state.packs.find((p) => p.id === state.activeId) ?? null);
    });
}

async function readPreviewDir(dir: string, names: readonly string[]): Promise<CursorPreview> {
    const preview: CursorPreview = {};
    for (const name of names) {
        if (!name.endsWith('.bmp')) continue;
        const path = join(dir, name);
        if (!existsSync(path)) continue;
        preview[name] = `data:image/bmp;base64,${bmpWithExplicitAlpha(await fs.readFile(path)).toString('base64')}`;
    }
    return preview;
}

// With no pack applied the game folder holds the stock set; otherwise the
// backup taken before the first apply does.
const stockSourceDir = (state: StoredState, deadlockPath: string | null) =>
    state.activeId === null && deadlockPath ? gameCursorsDir(deadlockPath) : stockDir();

/** Data URLs of a pack's cursor images, or of the stock set when `id` is null. */
export async function getCursorPreview(deadlockPath: string | null, id: string | null): Promise<CursorPreview> {
    const state = await loadState();
    if (id !== null) {
        const pack = state.packs.find((p) => p.id === id);
        return pack ? readPreviewDir(packDir(id), pack.files) : {};
    }
    const dir = stockSourceDir(state, deadlockPath);
    if (!existsSync(dir)) return {};
    const names = (await fs.readdir(dir)).map((n) => n.toLowerCase()).filter(isCursorFileName).sort();
    return readPreviewDir(dir, names);
}

export interface CursorPackSource {
    name: string;
    gameBananaId?: number;
    gameBananaFileId?: number;
}

interface CursorSet {
    variant?: string;
    /** Lowercased destination name -> usable file bytes. */
    files: Map<string, Buffer>;
}

async function installSets(sets: readonly CursorSet[], source: CursorPackSource): Promise<CursorPack[]> {
    // A lone cursor.res changes nothing visible.
    const usable = sets.filter(({ files }) => [...files.keys()].some((name) => name.endsWith('.bmp')));
    if (usable.length === 0) return [];
    return exclusive(async () => {
        const state = await loadState();
        const installed: CursorPack[] = [];
        for (const { variant, files } of usable) {
            const label = variant?.replace(/[_-]+/g, ' ').trim();
            const name = label ? `${source.name} (${label})` : source.name;
            // Reinstalling the same GameBanana file replaces its pack in place.
            const existing = source.gameBananaFileId === undefined
                ? undefined
                : state.packs.find((p) =>
                    p.gameBananaFileId === source.gameBananaFileId && p.variant === variant);
            const pack: CursorPack = {
                id: existing?.id ?? randomUUID(),
                name,
                variant,
                files: [...files.keys()].sort(),
                installedAt: new Date().toISOString(),
                gameBananaId: source.gameBananaId,
                gameBananaFileId: source.gameBananaFileId,
            };
            await fs.rm(packDir(pack.id), { recursive: true, force: true });
            await fs.mkdir(packDir(pack.id), { recursive: true });
            for (const [file, bytes] of files) await fs.writeFile(join(packDir(pack.id), file), bytes);
            state.packs = [...state.packs.filter((p) => p.id !== pack.id), pack];
            installed.push(pack);
        }
        await saveState(state);
        return installed;
    });
}

async function installGroups(
    extracted: readonly ExtractedVpk[],
    source: CursorPackSource
): Promise<CursorPack[]> {
    const sets: CursorSet[] = [];
    for (const group of groupCursorFiles(extracted)) {
        const files = new Map<string, Buffer>();
        for (const [name, path] of group.files) {
            const bytes = await fs.readFile(path);
            if (isUsableCursorFile(name, bytes)) files.set(name, bytes);
        }
        sets.push({ variant: group.variant, files });
    }
    return installSets(sets, source);
}

/**
 * BMPs built in the renderer plus a cursor.res with their hotspots. The game
 * reads every cursor's hotspot from that one file, so it starts from the stock
 * copy: cursors left alone keep theirs (the commend one is not at 0, 0).
 */
async function builtCursorFiles(
    deadlockPath: string | null,
    images: readonly CursorImageFile[]
): Promise<Map<string, Buffer>> {
    const files = new Map<string, Buffer>();
    const stockRes = join(stockSourceDir(await loadState(), deadlockPath), 'cursor.res');
    const hotspots = parseCursorRes(existsSync(stockRes) ? await fs.readFile(stockRes, 'utf-8') : '');
    for (const { fileName, bytes, hotspot } of images) {
        const lower = fileName.toLowerCase();
        if (!lower.endsWith('.bmp') || !isCursorFileName(lower) || !isUsableCursorFile(lower, bytes)) continue;
        files.set(lower, Buffer.from(bytes));
        hotspots.set(lower.slice(0, -'.bmp'.length), hotspot);
    }
    if (files.size > 0) files.set('cursor.res', Buffer.from(formatCursorRes(hotspots)));
    return files;
}

/** Install BMPs built in the renderer (the Create cursor dialog) as one pack. */
export async function createCursorPack(
    deadlockPath: string | null,
    name: string,
    images: readonly CursorImageFile[]
): Promise<CursorPack[]> {
    return installSets([{ files: await builtCursorFiles(deadlockPath, images) }], { name });
}

/** Zip BMPs built in the renderer so they can be shared and imported elsewhere. */
export async function exportCursorZip(
    deadlockPath: string | null,
    destPath: string,
    images: readonly CursorImageFile[]
): Promise<void> {
    const files = await builtCursorFiles(deadlockPath, images);
    if (files.size === 0) throw new Error('None of the cursor images could be used.');
    const zip = new AdmZip();
    for (const [name, bytes] of files) zip.addFile(name, bytes);
    await fs.writeFile(destPath, zip.toBuffer());
}

/**
 * Install the cursor sets inside an archive that shipped no VPK. Resolves to
 * the installed packs, empty when the archive holds no cursor images either.
 */
export async function installCursorArchive(
    archivePath: string,
    workDir: string,
    source: CursorPackSource
): Promise<CursorPack[]> {
    const extractDir = join(workDir, 'cursors');
    await fs.mkdir(extractDir, { recursive: true });
    return installGroups(await extractArchive(archivePath, extractDir, isCursorFileName), source);
}

/** Install loose cursor files the user picked from disk as one pack. */
export function installCursorFiles(paths: readonly string[], name: string): Promise<CursorPack[]> {
    const files = paths.map((path) => ({ path, fileName: basename(path) }));
    return installGroups(files, { name });
}
