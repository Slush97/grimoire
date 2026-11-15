import { promises as fs } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { basename, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { getDisabledPath } from './deadlock';
import { assertVpkSafety, moveSafetySnapshot } from './modSafety';
import { modTempPath } from './modTemps';
import { extractArchive, isArchive, type ExtractedVpk } from './extract';
import { parseVpkDirectoriesAsync, validateImportVpk } from './vpk';

interface LocalImportPreparation {
    id: string;
    owner: number;
    requestId: string;
    path: string;
    size: number;
    modifiedAt: number;
    sources: ExtractedVpk[];
    tempDir?: string;
    released: boolean;
    ready: boolean;
    users: number;
}

const preparations = new Map<string, LocalImportPreparation>();
let preparationQueue: Promise<unknown> = Promise.resolve();

async function disposePreparation(preparation: LocalImportPreparation): Promise<void> {
    preparations.delete(preparation.id);
    if (preparation.tempDir) await fs.rm(preparation.tempDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
}

/** Preparation is read-only outside its own temporary extraction directory. */
export function prepareLocalImport(path: string, owner: number, requestId: string): Promise<LocalImportPreparation> {
    const preparation: LocalImportPreparation = {
        id: randomUUID(), owner, requestId, path: resolve(path), size: 0, modifiedAt: 0,
        sources: [], released: false, ready: false, users: 0,
    };
    preparations.set(preparation.id, preparation);
    const work = preparationQueue.then(async () => {
        try {
            if (preparation.released) throw new Error('Import inspection cancelled');
            const stat = await fs.stat(preparation.path);
            if (!stat.isFile()) throw new Error('Selected path is not a file');
            preparation.size = stat.size;
            preparation.modifiedAt = stat.mtimeMs;
            if (preparation.path.toLowerCase().endsWith('.vpk')) {
                preparation.sources = [{ path: preparation.path, fileName: basename(preparation.path) }];
            } else {
                if (!isArchive(preparation.path)) throw new Error('Selected file is not a .vpk or supported archive');
                preparation.tempDir = await fs.mkdtemp(join(tmpdir(), 'grimoire-import-'));
                preparation.sources = await extractArchive(preparation.path, preparation.tempDir);
            }
            if (!preparation.sources.length) throw new Error('No .vpk file was found inside the archive.');
            const parsed = await parseVpkDirectoriesAsync(preparation.sources.map(source => source.path));
            for (const source of preparation.sources) {
                if (preparation.released) throw new Error('Import inspection cancelled');
                const entries = parsed.get(source.path);
                if (!entries?.length) {
                    throw new Error(`Cannot read VPK contents: ${source.fileName}`);
                }
                try { validateImportVpk(source.path); }
                catch (error) { throw new Error(`${source.fileName}: ${error instanceof Error ? error.message : String(error)}`, { cause: error }); }
                await assertVpkSafety(source.path, { prompt: false, allowUntrusted: true });
            }
            if (preparation.released) throw new Error('Import inspection cancelled');
            preparation.ready = true;
            return preparation;
        } catch (error) {
            await disposePreparation(preparation).catch(cleanupError => console.warn('[import] Temporary cleanup failed:', cleanupError));
            throw error;
        }
    });
    // A single extraction at a time bounds both memory and disk pressure.
    preparationQueue = work.catch(() => {});
    return work;
}

export async function getPreparedLocalImport(id: string, owner: number, path: string): Promise<LocalImportPreparation> {
    const preparation = preparations.get(id);
    if (!preparation || preparation.owner !== owner || preparation.released || !preparation.ready
        || preparation.path !== resolve(path)) throw new Error(`${basename(path)}: Import inspection expired. Add the file again.`);
    const stat = await fs.stat(preparation.path);
    if (preparation.released) throw new Error(`${basename(path)}: Import inspection expired. Add the file again.`);
    if (stat.size !== preparation.size || stat.mtimeMs !== preparation.modifiedAt) {
        throw new Error(`${basename(path)}: The file changed after inspection. Remove it and add it again.`);
    }
    return preparation;
}

/** Keep extracted members alive if the renderer closes during the copy. */
export async function withPreparedLocalImport<T>(id: string, owner: number, path: string,
    operation: (preparation: LocalImportPreparation) => Promise<T>): Promise<T> {
    const preparation = await getPreparedLocalImport(id, owner, path);
    if (preparation.released) throw new Error(`${basename(path)}: Import inspection expired. Add the file again.`);
    preparation.users++;
    try { return await operation(preparation); }
    finally {
        preparation.users--;
        if (preparation.released && preparation.users === 0) {
            await disposePreparation(preparation).catch(error => console.warn('[import] Temporary cleanup failed:', error));
        }
    }
}

export async function releaseLocalImport(owner: number, requestId?: string): Promise<void> {
    for (const preparation of preparations.values()) {
        if (preparation.owner !== owner || requestId !== undefined && preparation.requestId !== requestId) continue;
        preparation.released = true;
        if (!preparation.ready || preparation.users > 0) continue;
        await disposePreparation(preparation);
    }
}

/** Commit an inspected copy outside the game's search paths, without asking for activation consent. */
export async function importDisabledVpk(deadlockPath: string, source: string): Promise<string> {
    const folder = getDisabledPath(deadlockPath);
    await fs.mkdir(folder, { recursive: true });
    const destination = join(folder, `local_${randomUUID()}_dir.vpk`);
    const staged = modTempPath(folder, 'import-copy');
    let claimed = false;
    try {
        await fs.copyFile(source, staged);
        await assertVpkSafety(staged, { prompt: false, allowUntrusted: true });
        // Validate the bytes actually copied, even if the source changed after inspection.
        validateImportVpk(staged);
        const reservation = await fs.open(destination, 'wx');
        claimed = true;
        await reservation.close();
        await fs.rename(staged, destination);
        moveSafetySnapshot(staged, destination);
        return destination;
    } catch (err) {
        if (claimed) await fs.unlink(destination).catch(() => {});
        throw err;
    } finally {
        await fs.unlink(staged).catch(() => {});
    }
}
