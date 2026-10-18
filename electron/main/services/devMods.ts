import { createReadStream, createWriteStream, promises as fs } from 'fs';
import { basename, dirname, isAbsolute, join, relative, sep } from 'path';
import { pipeline } from 'node:stream/promises';
import { getCustomHeroCardsPath, getMetadataPath } from '../utils/paths';
import { isValidDeadlockPath, peekModFolders } from './deadlock';
import { readStash } from './launch';
import { metadataBackupDirectory, saveMetadata, type ModMetadataMap } from './metadata';
import { runExclusiveModMutation } from './mods';
import { REPLAYS_FOLDER_NAME } from './replayFolder';
import { loadSettings } from './settings';

async function lstatIfPresent(path: string) {
    return fs.lstat(path).catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return null;
        throw error;
    });
}

function assertSeparatePaths(source: string, destination: string): void {
    const contains = (parent: string, child: string) => {
        const path = relative(parent, child);
        return path === '' || (path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path));
    };
    if (contains(source, destination) || contains(destination, source)) {
        throw new Error('Normal and developer mod folders must be separate.');
    }
}

async function modRoots(deadlockPath: string): Promise<Map<string, string>> {
    const { addonsPath, enabledRoots } = peekModFolders(deadlockPath);
    // Check discovery errors instead of treating an unreadable tree as empty.
    const entries = await fs.readdir(dirname(addonsPath), { withFileTypes: true });
    if (entries.some((entry) => entry.isSymbolicLink() && /^(?:addons\d*|grimoire)$/i.test(entry.name))) {
        throw new Error('Linked mod folders cannot be copied into developer mode.');
    }
    const roots = new Map<string, string>();
    for (const path of enabledRoots) {
        const stat = await lstatIfPresent(path);
        if (stat) {
            if (!stat.isDirectory()) throw new Error('Mod roots must be directories.');
            const name = basename(path).toLowerCase();
            if (roots.has(name)) throw new Error('Mod folder names differ only by letter case.');
            roots.set(name, path);
        }
    }
    return roots;
}

interface StagedPath {
    destination: string;
    original: string;
    incoming: string | null;
    previous: string;
    backedUp: boolean;
    installed: boolean;
}

interface CopyPlan {
    directories: string[];
    files: Array<{ source: string; destination: string; size: number }>;
}

async function planCopy(source: string, destination: string, plan: CopyPlan, skipReplays = false): Promise<void> {
    const stat = await fs.lstat(source);
    if (stat.isSymbolicLink()) throw new Error(`Linked mod files cannot be copied: ${source}`);
    if (stat.isDirectory()) {
        plan.directories.push(destination);
        for (const name of await fs.readdir(source)) {
            // Mod roots contain replay shortcuts managed by replayFolder.ts.
            if (skipReplays && name.toLowerCase() === REPLAYS_FOLDER_NAME) continue;
            await planCopy(join(source, name), join(destination, name), plan);
        }
    } else if (stat.isFile()) {
        plan.files.push({ source, destination, size: stat.size });
    } else {
        throw new Error('Only regular mod files and directories can be copied.');
    }
}

let copying = false;

export function isCopyingModsToDev(): boolean {
    return copying;
}

/** Explicitly replace the sandbox library without changing the normal install. */
export async function copyModsToDev(onProgress?: (percent: number) => void): Promise<void> {
    if (copying) throw new Error('Mods are already being copied to developer mode.');
    copying = true;
    try {
        await copyModsToDevImpl(onProgress);
    } finally {
        copying = false;
    }
}

function copyModsToDevImpl(onProgress?: (percent: number) => void): Promise<void> {
    const requested = loadSettings();
    const assertCurrentSettings = (): void => {
        const current = loadSettings();
        if (!current.devMode || current.devMode !== requested.devMode ||
            current.deadlockPath !== requested.deadlockPath || current.devDeadlockPath !== requested.devDeadlockPath) {
            throw new Error('The selected mod folders changed during copying.');
        }
    };
    return runExclusiveModMutation(async () => {
        assertCurrentSettings();
        onProgress?.(0);
        const source = requested.deadlockPath;
        const destination = requested.devDeadlockPath;
        if (!source || !destination) {
            throw new Error('Enable developer mode and configure a normal Deadlock install before copying mods.');
        }
        if (!isValidDeadlockPath(source) || await readStash()) {
            throw new Error('The normal mod library is unavailable or waiting for a vanilla-launch restore.');
        }
        const sourceRealPath = await fs.realpath(source);
        const destinationRealPath = await fs.realpath(destination);
        assertSeparatePaths(sourceRealPath, destinationRealPath);
        const sourceCitadel = join(source, 'game', 'citadel');
        const destinationCitadel = join(destination, 'game', 'citadel');
        assertSeparatePaths(await fs.realpath(sourceCitadel), await fs.realpath(destinationCitadel));
        for (const path of [destination, join(destination, 'game'), destinationCitadel]) {
            if ((await fs.lstat(path)).isSymbolicLink()) throw new Error('Developer folders must not be links.');
        }

        const metadataText = await fs.readFile(getMetadataPath(false), 'utf8').catch((error: NodeJS.ErrnoException) => {
            if (error.code === 'ENOENT') return '{}';
            throw error;
        });
        const metadata: unknown = JSON.parse(metadataText);
        if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
            throw new Error('The normal mod metadata is invalid.');
        }
        const devMetadataPath = getMetadataPath(true);
        if ((await lstatIfPresent(devMetadataPath))?.isSymbolicLink()) {
            throw new Error('Developer metadata must not be a link.');
        }

        const sourceRoots = await modRoots(source);
        const destinationRoots = await modRoots(destination);
        const names = new Set([...sourceRoots.keys(), ...destinationRoots.keys()]);
        const stages = new Map<string, string>();
        const stagedPaths: StagedPath[] = [];
        const plan: CopyPlan = { directories: [], files: [] };
        let keepStages = false;
        const stagePath = async (from: string | undefined, to: string, original = to, skipReplays = false): Promise<void> => {
            if ((await lstatIfPresent(original))?.isSymbolicLink()) throw new Error(`Developer paths must not be links: ${original}`);
            const parent = dirname(to);
            let stage = stages.get(parent);
            if (!stage) {
                await fs.mkdir(parent, { recursive: true });
                stage = await fs.mkdtemp(join(parent, '.grimoire-dev-copy-'));
                stages.set(parent, stage);
            }
            const incoming = from ? join(stage, 'incoming', basename(to)) : null;
            const previous = join(stage, 'previous', basename(to));
            await fs.mkdir(dirname(previous), { recursive: true });
            if (from && incoming) {
                await planCopy(from, incoming, plan, skipReplays);
            }
            stagedPaths.push({ destination: to, original, incoming, previous, backedUp: false, installed: false });
        };

        try {
            for (const name of names) {
                const from = sourceRoots.get(name);
                const to = join(destinationCitadel, from ? basename(from) : name);
                await stagePath(from, to, destinationRoots.get(name) ?? to, true);
            }
            const sourceCards = getCustomHeroCardsPath(source);
            const destinationCards = getCustomHeroCardsPath(destination);
            assertSeparatePaths(sourceCards, destinationCards);
            const cardsParent = dirname(destinationCards);
            const cardsStat = await lstatIfPresent(cardsParent);
            if (cardsStat?.isSymbolicLink()) throw new Error('Custom card folders must not be links.');
            const cardsRealPath = cardsStat ? await fs.realpath(cardsParent) :
                join(await fs.realpath(dirname(cardsParent)), basename(cardsParent));
            assertSeparatePaths(sourceRealPath, cardsRealPath);
            assertSeparatePaths(destinationRealPath, cardsRealPath);
            await stagePath(await lstatIfPresent(sourceCards) ? sourceCards : undefined, destinationCards);
            // Old snapshots must not restore identities from the previous dev library.
            await stagePath(undefined, metadataBackupDirectory(devMetadataPath));
            await stagePath(undefined, `${devMetadataPath}.tmp`);

            const totalBytes = plan.files.reduce((sum, file) => sum + file.size, 0);
            let copiedBytes = 0;
            let lastPercent = 0;
            for (const path of plan.directories) await fs.mkdir(path, { recursive: true });
            for (const file of plan.files) {
                const input = createReadStream(file.source);
                input.on('data', (chunk) => {
                    copiedBytes += Buffer.byteLength(chunk);
                    // Leave the final percent for the directory and metadata commit.
                    const percent = totalBytes > 0 ? Math.min(99, Math.floor(copiedBytes / totalBytes * 100)) : 0;
                    if (percent !== lastPercent) {
                        lastPercent = percent;
                        onProgress?.(percent);
                    }
                });
                await pipeline(input, createWriteStream(file.destination, { flags: 'wx' }));
            }

            assertCurrentSettings();
            for (const entry of stagedPaths) {
                if (await lstatIfPresent(entry.original)) {
                    await fs.rename(entry.original, entry.previous);
                    entry.backedUp = true;
                }
                if (entry.incoming) {
                    await fs.rename(entry.incoming, entry.destination);
                    entry.installed = true;
                }
            }
            // The mode cannot change while this mutation holds the queue. The
            // existing writer commits atomically and refreshes the metadata cache.
            assertCurrentSettings();
            saveMetadata(metadata as ModMetadataMap);
        } catch (error) {
            const rollbackErrors: unknown[] = [];
            for (const entry of stagedPaths.toReversed()) {
                try {
                    if (entry.installed) await fs.rm(entry.destination, { recursive: true, force: true });
                    if (entry.backedUp) await fs.rename(entry.previous, entry.original);
                } catch (rollbackError) {
                    rollbackErrors.push(rollbackError);
                }
            }
            if (rollbackErrors.length > 0) {
                keepStages = true;
                throw new AggregateError([error, ...rollbackErrors], 'Developer library rollback failed. Temporary copies were kept.', { cause: error });
            }
            throw error;
        } finally {
            if (!keepStages) {
                for (const stage of stages.values()) {
                    await fs.rm(stage, { recursive: true, force: true }).catch((error) => {
                        console.warn('[DevMods] Could not remove temporary copies:', stage, error);
                    });
                }
            }
        }
        onProgress?.(100);
    });
}
