import { promises as fs, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const harness = vi.hoisted(() => ({
    userData: '',
    stash: false,
    mutation: vi.fn((operation: () => Promise<unknown>) => operation()),
}));
vi.mock('electron', () => ({ app: { getPath: () => harness.userData } }));
vi.mock('./mods', () => ({ runExclusiveModMutation: harness.mutation }));
vi.mock('./launch', () => ({ readStash: async () => harness.stash ? { status: 'active' } : null }));
import { getCustomHeroCardsPath, getMetadataPath } from '../utils/paths';
import { copyModsToDev } from './devMods';
import * as metadata from './metadata';
import { loadSettings, type AppSettings } from './settings';
import { ensureReplayFolderLink } from './replayFolder';

let sandbox: string;
let normal: string;
let developer: string;

function put(path: string, bytes: string): void {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, bytes);
}

function configure(changes: Partial<AppSettings> = {}): void {
    put(join(harness.userData, 'settings.json'), JSON.stringify({
        devMode: true,
        deadlockPath: normal,
        devDeadlockPath: developer,
        ...changes,
    }));
}

function citadel(root: string, path: string): string {
    return join(root, 'game', 'citadel', path);
}

function customCardVpkPath(root: string, codename: string): string {
    return join(getCustomHeroCardsPath(root), `${codename}_dir.vpk`);
}

function snapshot(root: string): Record<string, string> {
    if (!existsSync(root)) return {};
    const files: Record<string, string> = {};
    const walk = (folder: string) => {
        for (const entry of readdirSync(folder, { withFileTypes: true })) {
            const path = join(folder, entry.name);
            if (entry.isSymbolicLink()) files[relative(root, path).replaceAll('\\', '/')] = `link:${readlinkSync(path)}`;
            else if (entry.isDirectory()) walk(path);
            else files[relative(root, path).replaceAll('\\', '/')] = readFileSync(path).toString('base64');
        }
    };
    walk(root);
    return files;
}

function populate(): void {
    put(citadel(normal, 'addons/pak01_dir.vpk'), 'normal primary');
    put(citadel(normal, 'addons/pak01_000.vpk'), 'normal chunk');
    put(citadel(normal, 'addons/.disabled/saved_dir.vpk'), 'disabled mod');
    put(citadel(normal, 'addons/.disabled/saved_000.vpk'), 'disabled chunk');
    put(citadel(normal, 'addons1/pak01_dir.vpk'), 'overflow mod');
    put(citadel(normal, 'grimoire/pak01_dir.vpk'), 'managed Locker cards');
    put(citadel(normal, 'grimoire/pak05_dir.vpk'), 'global user mod');
    put(citadel(normal, 'grimoire/pak05_000.vpk'), 'global chunk');
    put(citadel(normal, 'pak01_dir.vpk'), 'base game, never copied');
    put(citadel(normal, 'cfg/normal.cfg'), 'normal game config');
    put(customCardVpkPath(normal, 'hornet'), 'normal custom card staging');
    put(customCardVpkPath(developer, 'inferno'), 'old developer custom card');
    put(citadel(developer, 'addons/pak01_dir.vpk'), 'old developer mod');
    put(citadel(developer, 'addons/.disabled/old_dir.vpk'), 'old developer disabled mod');
    put(citadel(developer, 'addons1/pak01_dir.vpk'), 'old overflow mod');
    put(citadel(developer, 'addons2/pak01_dir.vpk'), 'extra developer overflow');
    put(citadel(developer, 'grimoire/pak05_dir.vpk'), 'old developer global');
    put(citadel(developer, 'cfg/developer.cfg'), 'developer config stays');
    put(getMetadataPath(false), JSON.stringify({
        'pak01_dir.vpk': { modName: 'Normal mod', gameBananaId: 123 },
        'saved_dir.vpk': { modName: 'Disabled mod', priorityMod: true },
        'addons1/pak01_dir.vpk': { modName: 'Overflow mod' },
        'grimoire/pak05_dir.vpk': { modName: 'Global mod', priorityMod: true },
        'locker:cards': { lockerCosmetics: { selections: [] } },
    }, null, 2));
    metadata.saveMetadata({ 'pak01_dir.vpk': { modName: 'Old developer identity' } });
    put(join(metadata.metadataBackupDirectory(getMetadataPath(true)), 'old_pre-prune.json'),
        JSON.stringify({ 'pak01_dir.vpk': { modName: 'Old developer identity', sha256: 'a'.repeat(64) } }));
    put(`${getMetadataPath(true)}.tmp`, 'old unfinished developer metadata');
    put(join(metadata.metadataBackupDirectory(getMetadataPath(false)), 'normal_pre-prune.json'), 'normal snapshot stays');
}

beforeEach(() => {
    sandbox = mkdtempSync(join(tmpdir(), 'dev-copy-'));
    harness.userData = join(sandbox, 'user-data');
    normal = join(sandbox, 'normal');
    developer = join(sandbox, 'developer');
    harness.stash = false;
    harness.mutation.mockReset();
    harness.mutation.mockImplementation((operation) => operation());
    put(citadel(normal, 'gameinfo.gi'), 'normal gameinfo');
    put(citadel(developer, 'gameinfo.gi'), 'developer gameinfo');
    configure();
});

afterEach(() => {
    vi.restoreAllMocks();
    rmSync(sandbox, { recursive: true, force: true });
});

describe('copying the normal mod library to developer mode', () => {
    it('replaces every developer mod root and metadata while leaving the normal installation untouched', async () => {
        populate();
        const sourceBefore = snapshot(normal);
        const settingsBefore = readFileSync(join(harness.userData, 'settings.json'), 'utf8');
        const metadataBefore = readFileSync(getMetadataPath(false), 'utf8');
        const sourceCards = snapshot(dirname(customCardVpkPath(normal, 'unused')));
        expect(metadata.loadMetadata()['pak01_dir.vpk'].modName).toBe('Old developer identity');

        await copyModsToDev();

        for (const folder of ['addons', 'addons1', 'grimoire']) {
            expect(snapshot(citadel(developer, folder))).toEqual(snapshot(citadel(normal, folder)));
        }
        expect(existsSync(citadel(developer, 'addons2'))).toBe(false);
        expect(snapshot(dirname(customCardVpkPath(developer, 'unused')))).toEqual(sourceCards);
        expect(metadata.loadMetadata()).toEqual(JSON.parse(metadataBefore));
        expect(readFileSync(getMetadataPath(false), 'utf8')).toBe(metadataBefore);
        expect(snapshot(normal)).toEqual(sourceBefore);
        expect(snapshot(dirname(customCardVpkPath(normal, 'unused')))).toEqual(sourceCards);
        expect(readFileSync(join(harness.userData, 'settings.json'), 'utf8')).toBe(settingsBefore);
        expect(readFileSync(citadel(developer, 'gameinfo.gi'), 'utf8')).toBe('developer gameinfo');
        expect(readFileSync(citadel(developer, 'cfg/developer.cfg'), 'utf8')).toBe('developer config stays');
        expect(existsSync(citadel(developer, 'cfg/normal.cfg'))).toBe(false);
        expect(existsSync(citadel(developer, 'pak01_dir.vpk'))).toBe(false);
        expect(harness.mutation).toHaveBeenCalledOnce();

        configure({ devMode: false });
        expect(metadata.loadMetadata()).toEqual(JSON.parse(metadataBefore));
    });

    it('copies an empty library without retaining old developer mods, cards or metadata', async () => {
        put(citadel(developer, 'addons/.disabled/old_dir.vpk'), 'old disabled mod');
        put(citadel(developer, 'addons2/pak01_dir.vpk'), 'old overflow mod');
        put(citadel(developer, 'grimoire/pak05_dir.vpk'), 'old global mod');
        put(customCardVpkPath(developer, 'inferno'), 'old custom card');
        metadata.saveMetadata({ 'old_dir.vpk': { modName: 'Old developer mod' } });

        await copyModsToDev();

        for (const folder of ['addons', 'addons2', 'grimoire']) {
            expect(snapshot(citadel(developer, folder))).toEqual({});
        }
        expect(snapshot(dirname(customCardVpkPath(developer, 'unused')))).toEqual({});
        expect(metadata.loadMetadata()).toEqual({});
        expect(existsSync(getMetadataPath(false))).toBe(false);
        expect(snapshot(normal)).toEqual({ 'game/citadel/gameinfo.gi': Buffer.from('normal gameinfo').toString('base64') });
    });

    it('copies a normal library with Grimoire replay shortcuts without copying recordings or changing either replay folder', async () => {
        populate();
        ensureReplayFolderLink(normal);
        ensureReplayFolderLink(developer);
        put(citadel(normal, 'replays/normal.dem'), 'normal recording');
        put(citadel(developer, 'replays/developer.dem'), 'developer recording');
        const sourceBefore = snapshot(normal);

        await copyModsToDev();

        expect(snapshot(normal)).toEqual(sourceBefore);
        expect(snapshot(citadel(developer, 'replays'))).toEqual({ 'developer.dem': Buffer.from('developer recording').toString('base64') });
        for (const folder of ['addons', 'addons1', 'grimoire']) {
            expect(existsSync(citadel(developer, `${folder}/replays`))).toBe(false);
            expect((await fs.lstat(citadel(normal, `${folder}/replays`))).isSymbolicLink()).toBe(true);
            expect(readFileSync(citadel(developer, `${folder}/pak01_dir.vpk`))).toEqual(readFileSync(citadel(normal, `${folder}/pak01_dir.vpk`)));
        }
    });

    it('excludes real replay folders at mod roots while preserving nested mod content', async () => {
        populate();
        put(citadel(normal, 'addons/Replays/normal.dem'), 'normal recording');
        put(citadel(normal, 'addons/nested/replays/source_dir.vpk'), 'nested mod content');

        await copyModsToDev();

        expect(existsSync(citadel(developer, 'addons/Replays'))).toBe(false);
        expect(readFileSync(citadel(developer, 'addons/nested/replays/source_dir.vpk'), 'utf8')).toBe('nested mod content');
        expect(readFileSync(citadel(normal, 'addons/Replays/normal.dem'), 'utf8')).toBe('normal recording');
    });

    it('ignores dangling replay shortcuts', async () => {
        populate();
        const link = citadel(normal, 'addons/replays');
        await fs.symlink(join(sandbox, 'missing-replays'), link, process.platform === 'win32' ? 'junction' : 'dir');

        await copyModsToDev();

        expect(existsSync(citadel(developer, 'addons/replays'))).toBe(false);
        expect((await fs.lstat(link)).isSymbolicLink()).toBe(true);
    });

    it('removes old developer metadata snapshots so their identities cannot return after copying', async () => {
        populate();
        const normalSnapshots = snapshot(metadata.metadataBackupDirectory(getMetadataPath(false)));
        const normalMetadata = { 'pak01_dir.vpk': { sha256: 'a'.repeat(64) } };
        put(getMetadataPath(false), JSON.stringify(normalMetadata));

        await copyModsToDev();

        expect(existsSync(metadata.metadataBackupDirectory(getMetadataPath(true)))).toBe(false);
        expect(existsSync(`${getMetadataPath(true)}.tmp`)).toBe(false);
        expect(metadata.recoverPrunedIdentities()).toBe(0);
        expect(metadata.loadMetadata()).toEqual(normalMetadata);
        expect(snapshot(metadata.metadataBackupDirectory(getMetadataPath(false)))).toEqual(normalSnapshots);
    });

    it('matches overflow roots with different folder casing as the same destination', async () => {
        populate();
        await fs.rename(citadel(normal, 'addons1'), citadel(normal, 'Addons1'));
        const normalMetadata = JSON.parse(readFileSync(getMetadataPath(false), 'utf8')) as metadata.ModMetadataMap;
        normalMetadata['Addons1/pak01_dir.vpk'] = normalMetadata['addons1/pak01_dir.vpk'];
        delete normalMetadata['addons1/pak01_dir.vpk'];
        put(getMetadataPath(false), JSON.stringify(normalMetadata));
        const sourceBefore = snapshot(normal);

        await copyModsToDev();

        expect(readdirSync(citadel(developer, '')).filter((name) => name.toLowerCase() === 'addons1')).toEqual(['Addons1']);
        expect(snapshot(citadel(developer, 'Addons1'))).toEqual(snapshot(citadel(normal, 'Addons1')));
        expect(snapshot(normal)).toEqual(sourceBefore);
        expect(metadata.loadMetadata()['Addons1/pak01_dir.vpk'].modName).toBe('Overflow mod');
    });

    it('preserves both libraries and developer metadata when staging a copy fails', async () => {
        populate();
        const before = snapshot(sandbox);
        const mkdir = fs.mkdir.bind(fs);
        vi.spyOn(fs, 'mkdir').mockImplementation(async (...args) => {
            if (String(args[0]).includes('incoming')) throw new Error('copy failed');
            return mkdir(...args);
        });
        const progress = vi.fn();

        await expect(copyModsToDev(progress)).rejects.toThrow('copy failed');

        expect(snapshot(sandbox)).toEqual(before);
        expect(metadata.loadMetadata()['pak01_dir.vpk'].modName).toBe('Old developer identity');
        expect(progress).not.toHaveBeenCalledWith(100);
        vi.restoreAllMocks();
        await expect(copyModsToDev()).resolves.toBeUndefined();
    });

    it('refuses duplicate copies even while the first is waiting for the mutation lock', async () => {
        populate();
        let release!: () => void;
        const gate = new Promise<void>((resolve) => { release = resolve; });
        harness.mutation.mockImplementationOnce(async (operation) => {
            await gate;
            return operation();
        });

        const pending = copyModsToDev();
        await expect(copyModsToDev()).rejects.toThrow('already being copied');
        expect(harness.mutation).toHaveBeenCalledOnce();
        release();
        await pending;
    });

    it('cleans up a failed file stream without changing either library or developer metadata', async () => {
        populate();
        const before = snapshot(sandbox);
        const mkdir = fs.mkdir.bind(fs);
        vi.spyOn(fs, 'mkdir').mockImplementation(async (...args) => {
            const result = await mkdir(...args);
            const path = String(args[0]);
            if (path.includes('incoming') && path.endsWith('addons')) {
                await mkdir(join(path, 'pak01_dir.vpk'));
            }
            return result;
        });
        const progress = vi.fn();

        await expect(copyModsToDev(progress)).rejects.toThrow();

        expect(snapshot(sandbox)).toEqual(before);
        expect(progress).not.toHaveBeenCalledWith(100);
    });

    it('rolls back already swapped roots if a later destination rename fails', async () => {
        populate();
        const before = snapshot(sandbox);
        const rename = fs.rename.bind(fs);
        let failed = false;
        vi.spyOn(fs, 'rename').mockImplementation(async (from, to) => {
            if (!failed && resolve(String(to)) === citadel(developer, 'addons1')) {
                failed = true;
                throw new Error('rename failed');
            }
            await rename(from, to);
        });

        await expect(copyModsToDev()).rejects.toThrow('rename failed');

        expect(failed).toBe(true);
        expect(snapshot(sandbox)).toEqual(before);
        expect(metadata.loadMetadata()['pak01_dir.vpk'].modName).toBe('Old developer identity');
    });

    it('rolls back copied files and custom card staging when the metadata commit fails', async () => {
        populate();
        const before = snapshot(sandbox);
        vi.spyOn(metadata, 'saveMetadata').mockImplementationOnce(() => { throw new Error('metadata write failed'); });

        await expect(copyModsToDev()).rejects.toThrow('metadata write failed');

        expect(snapshot(sandbox)).toEqual(before);
        expect(metadata.loadMetadata()['pak01_dir.vpk'].modName).toBe('Old developer identity');
    });

    it.each([
        ['normal mode', () => configure({ devMode: false })],
        ['missing normal path', () => configure({ deadlockPath: null })],
        ['missing developer path', () => configure({ devDeadlockPath: null })],
        ['identical paths', () => configure({ devDeadlockPath: normal })],
        ['nested developer path', () => {
            const nested = join(normal, 'developer');
            put(citadel(nested, 'gameinfo.gi'), 'nested developer gameinfo');
            configure({ devDeadlockPath: nested });
        }],
        ['nested normal path', () => {
            const nested = join(developer, 'normal');
            put(citadel(nested, 'gameinfo.gi'), 'nested normal gameinfo');
            configure({ deadlockPath: nested });
        }],
        ['missing normal gameinfo', () => rmSync(citadel(normal, 'gameinfo.gi'))],
        ['invalid normal metadata', () => put(getMetadataPath(false), '{ invalid JSON')],
        ['active vanilla stash', () => { harness.stash = true; }],
    ])('rejects %s before replacing any files', async (_name, setup) => {
        populate();
        setup();
        const before = snapshot(sandbox);

        await expect(copyModsToDev()).rejects.toThrow();

        expect(snapshot(sandbox)).toEqual(before);
    });

    it('rejects a changed install path while waiting for the mutation lock', async () => {
        populate();
        harness.mutation.mockImplementationOnce(async (operation) => {
            configure({ devDeadlockPath: join(sandbox, 'other-developer') });
            return operation();
        });
        const sourceBefore = snapshot(normal);
        const developerBefore = snapshot(developer);
        const devMetadataBefore = readFileSync(getMetadataPath(true), 'utf8');

        await expect(copyModsToDev()).rejects.toThrow();

        expect(snapshot(normal)).toEqual(sourceBefore);
        expect(snapshot(developer)).toEqual(developerBefore);
        expect(readFileSync(getMetadataPath(true), 'utf8')).toBe(devMetadataBefore);
        expect(loadSettings().devDeadlockPath).toBe(join(sandbox, 'other-developer'));
    });

    it('stops when developer mode changes during staging without writing normal metadata', async () => {
        populate();
        const sourceBefore = snapshot(normal);
        const developerBefore = snapshot(developer);
        const metadataBefore = readFileSync(getMetadataPath(false), 'utf8');
        const devMetadataBefore = readFileSync(getMetadataPath(true), 'utf8');
        const mkdir = fs.mkdir.bind(fs);
        vi.spyOn(fs, 'mkdir').mockImplementationOnce(async (...args) => {
            const result = await mkdir(...args);
            configure({ devMode: false });
            return result;
        });

        await expect(copyModsToDev()).rejects.toThrow();

        expect(snapshot(normal)).toEqual(sourceBefore);
        expect(snapshot(developer)).toEqual(developerBefore);
        expect(readFileSync(getMetadataPath(false), 'utf8')).toBe(metadataBefore);
        expect(readFileSync(getMetadataPath(true), 'utf8')).toBe(devMetadataBefore);
        expect(loadSettings().devMode).toBe(false);
    });

    it('reports byte progress within a large file and completes only after metadata is committed', async () => {
        populate();
        const largeFile = citadel(normal, 'addons/large_dir.vpk');
        writeFileSync(largeFile, Buffer.alloc(4 * 1024 * 1024, 0xab));
        put(citadel(normal, 'addons/empty_dir.vpk'), '');
        const progress: number[] = [];
        const save = metadata.saveMetadata;
        vi.spyOn(metadata, 'saveMetadata').mockImplementationOnce((value) => {
            expect(progress.at(-1)).toBe(99);
            save(value);
        });

        await copyModsToDev((percent) => progress.push(percent));

        expect(progress[0]).toBe(0);
        expect(progress.at(-1)).toBe(100);
        expect(progress.some((percent) => percent > 0 && percent < 90)).toBe(true);
        expect(progress).toEqual([...new Set(progress)].sort((a, b) => a - b));
        expect(progress.length).toBeLessThanOrEqual(101);
        expect(readFileSync(citadel(developer, 'addons/large_dir.vpk')).equals(readFileSync(largeFile))).toBe(true);
        expect(readFileSync(citadel(developer, 'addons/empty_dir.vpk')).length).toBe(0);
    });

    it('completes progress for an empty library', async () => {
        const progress = vi.fn();

        await copyModsToDev(progress);

        expect(progress.mock.calls).toEqual([[0], [100]]);
    });

    it('rejects a developer mod root linked to the normal installation', async () => {
        populate();
        rmSync(citadel(developer, 'addons'), { recursive: true });
        await fs.symlink(citadel(normal, 'addons'), citadel(developer, 'addons'), process.platform === 'win32' ? 'junction' : 'dir');
        const sourceBefore = snapshot(normal);
        const devMetadataBefore = readFileSync(getMetadataPath(true), 'utf8');

        await expect(copyModsToDev()).rejects.toThrow();

        expect(snapshot(normal)).toEqual(sourceBefore);
        expect((await fs.lstat(citadel(developer, 'addons'))).isSymbolicLink()).toBe(true);
        expect(readFileSync(getMetadataPath(true), 'utf8')).toBe(devMetadataBefore);
    });

    it('rejects linked content inside the normal library without touching developer mods', async () => {
        populate();
        const developerBefore = snapshot(developer);
        const devMetadataBefore = readFileSync(getMetadataPath(true), 'utf8');
        const link = citadel(normal, 'addons/.disabled/linked');
        await fs.symlink(citadel(normal, 'cfg'), link, process.platform === 'win32' ? 'junction' : 'dir');

        await expect(copyModsToDev()).rejects.toThrow();

        expect(snapshot(developer)).toEqual(developerBefore);
        expect(readFileSync(getMetadataPath(true), 'utf8')).toBe(devMetadataBefore);
        expect(readFileSync(citadel(normal, 'cfg/normal.cfg'), 'utf8')).toBe('normal game config');
        expect((await fs.lstat(link)).isSymbolicLink()).toBe(true);
    });

    it('rejects a custom-card parent linked into the normal installation and clears staging', async () => {
        populate();
        const cardsParent = dirname(getCustomHeroCardsPath(normal));
        rmSync(cardsParent, { recursive: true });
        await fs.symlink(citadel(normal, 'addons'), cardsParent, process.platform === 'win32' ? 'junction' : 'dir');
        const sourceBefore = snapshot(normal);
        const developerBefore = snapshot(developer);
        const developerEntries = readdirSync(citadel(developer, ''));
        const normalMetadataBefore = readFileSync(getMetadataPath(false), 'utf8');
        const devMetadataBefore = readFileSync(getMetadataPath(true), 'utf8');

        await expect(copyModsToDev()).rejects.toThrow();

        expect(snapshot(normal)).toEqual(sourceBefore);
        expect(snapshot(developer)).toEqual(developerBefore);
        expect(readdirSync(citadel(developer, ''))).toEqual(developerEntries);
        expect(readFileSync(getMetadataPath(false), 'utf8')).toBe(normalMetadataBefore);
        expect(readFileSync(getMetadataPath(true), 'utf8')).toBe(devMetadataBefore);
        expect((await fs.lstat(cardsParent)).isSymbolicLink()).toBe(true);
    });
});
