import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import { basename, join, relative } from 'node:path';
import { tmpdir } from 'node:os';

const h = vi.hoisted(() => ({
    userData: '',
    stash: null as unknown,
    isDeadlockRunning: vi.fn(async () => false),
}));
vi.mock('electron', () => ({ app: { getPath: () => h.userData } }));
vi.mock('./launch', () => ({ isDeadlockRunning: h.isDeadlockRunning, readStash: async () => h.stash }));
vi.mock('./modSafety', () => ({ assertVpkSafety: vi.fn(async () => {}), moveSafetySnapshot: vi.fn(), forgetSafetySnapshot: vi.fn() }));

import {
    healModFolders,
    healModFoldersExclusive,
    enableMod,
    runExclusiveModMutation,
    scanMods,
    scanModsAfterMutations,
} from './mods';
import * as metadata from './metadata';
import { getModMetadata, loadMetadata, saveMetadata } from './metadata';
import { beginVanillaWindow, endVanillaWindow } from './vanillaWindow';
import { modTempPath } from './modTemps';

let root: string;
let addons: string;
let disabled: string;
let grimoire: string;

beforeEach(async () => {
    root = await fs.mkdtemp(join(tmpdir(), 'mods-heal-'));
    addons = join(root, 'game', 'citadel', 'addons');
    disabled = join(addons, '.disabled');
    grimoire = join(root, 'game', 'citadel', 'grimoire');
    h.userData = join(root, 'userdata');
    h.stash = null;
    h.isDeadlockRunning.mockClear();
    for (const dir of [disabled, grimoire, h.userData]) await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(join(root, 'game', 'citadel', 'gameinfo.gi'), 'GameInfo {}\n');
    saveMetadata({});
});
afterEach(async () => {
    endVanillaWindow();
    await fs.rm(root, { recursive: true, force: true });
});

const put = (folder: string, files: Record<string, string>) =>
    Promise.all(Object.entries(files).map(([name, bytes]) => fs.writeFile(join(folder, name), bytes)));

describe('queued metadata mode changes', () => {
    it.each([
        { devMode: false, changeMode: true },
        { devMode: true, changeMode: true },
        { devMode: false, changeMode: false },
        { devMode: true, changeMode: false },
    ])('refuses a mutation queued behind an installation change: %j', async ({ devMode, changeMode }) => {
        const settingsPath = join(h.userData, 'settings.json');
        const settings = { devMode, deadlockPath: root, devDeadlockPath: join(root, 'developer') };
        await fs.writeFile(settingsPath, JSON.stringify(settings));
        await put(disabled, { 'original_dir.vpk': 'original mod' });
        const target = (await scanMods(root)).find(mod => !mod.enabled)!;
        const normal = JSON.stringify({ 'normal_dir.vpk': { modName: 'Normal identity' } });
        const developer = JSON.stringify({ 'developer_dir.vpk': { modName: 'Developer identity' } });
        await fs.writeFile(join(h.userData, 'mod-metadata.json'), normal);
        await fs.writeFile(join(h.userData, 'mod-metadata.dev.json'), developer);
        let release!: () => void;
        const held = runExclusiveModMutation(() => new Promise<void>(resolve => { release = resolve; }));
        // Wait until the first operation holds the lock before queueing both.
        await vi.waitFor(() => expect(release).toBeTypeOf('function'));
        const switching = runExclusiveModMutation(async () => {
            const patch = changeMode ? { devMode: !devMode }
                : devMode ? { devDeadlockPath: 'another-developer-path' } : { deadlockPath: 'another-normal-path' };
            await fs.writeFile(settingsPath, JSON.stringify({ ...settings, ...patch }));
        });
        const mutation = enableMod(root, target.id);
        const rejected = expect(mutation).rejects.toThrow('active mod installation changed');
        release();
        await held;
        await switching;
        await rejected;
        expect(await fs.readFile(join(disabled, 'original_dir.vpk'), 'utf8')).toBe('original mod');
        expect(await fs.readdir(addons)).toEqual(['.disabled']);
        expect(await fs.readFile(join(h.userData, 'mod-metadata.json'), 'utf8')).toBe(normal);
        expect(await fs.readFile(join(h.userData, 'mod-metadata.dev.json'), 'utf8')).toBe(developer);
    });
});

async function snapshotTree(dir: string, into: Record<string, string> = {}): Promise<Record<string, string>> {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) {
            into[`${relative(root, path)}/`] = '';
            await snapshotTree(path, into);
        } else {
            into[relative(root, path)] = await fs.readFile(path, 'utf8');
        }
    }
    return into;
}

describe('get-mods read path', () => {
    it('writes nothing: no renames, deletes, metadata saves or created folders', async () => {
        await put(addons, { 'pak01_dir.vpk': 'enabled', 'pak02_dir.vpk': 'b' });
        await put(disabled, { 'pak01_dir.vpk': 'other', 'pak02_dir.vpk': 'b' });
        await put(grimoire, { 'pak06_dir.vpk': 'global' });
        await put(addons, { [`.merge-rebuild-0f8fad5b-d9cb-469f-a165-70867728950e.vpk`]: 'stale' });
        saveMetadata({ 'ghost_dir.vpk': { modName: 'Gone' } });
        const before = await snapshotTree(root);

        const mods = await scanModsAfterMutations(root);

        expect(mods.map((m) => m.metaKey).sort()).toEqual(
            ['grimoire/pak06_dir.vpk', 'pak01_dir.vpk', 'pak01_dir.vpk', 'pak02_dir.vpk', 'pak02_dir.vpk']
        );
        expect(await snapshotTree(root)).toEqual(before);
        expect(getModMetadata('grimoire/pak06_dir.vpk')).toBeUndefined();
        expect(getModMetadata('ghost_dir.vpk')).toEqual({ modName: 'Gone' });
    });

    it('does not fabricate mod folders under a path that does not resolve', async () => {
        const missing = join(root, 'not-steam-yet');
        await fs.mkdir(missing);

        expect(await scanModsAfterMutations(missing)).toEqual([]);
        expect(await fs.readdir(missing)).toEqual([]);
    });

    it('waits for a mutation in progress and returns the post-mutation state', async () => {
        await put(addons, { 'pak01_dir.vpk': 'a' });
        let release!: () => void;
        const gate = new Promise<void>((resolve) => { release = resolve; });
        const batch = runExclusiveModMutation(async () => {
            await gate;
            await fs.rename(join(addons, 'pak01_dir.vpk'), join(addons, 'pak07_dir.vpk'));
        });
        const read = scanModsAfterMutations(root);
        let settled = false;
        void read.then(() => { settled = true; });
        await new Promise((resolve) => setTimeout(resolve, 30));
        expect(settled).toBe(false);

        release();
        await batch;

        expect((await read).map((m) => m.fileName)).toEqual(['pak07_dir.vpk']);
    });

    it('falls back to the pure read after the bound when a long batch holds the lock', async () => {
        await put(addons, { 'pak01_dir.vpk': 'a' });
        let release!: () => void;
        const gate = new Promise<void>((resolve) => { release = resolve; });
        const batch = runExclusiveModMutation(async () => {
            await gate;
            await fs.rename(join(addons, 'pak01_dir.vpk'), join(addons, 'pak07_dir.vpk'));
        });
        await new Promise((resolve) => setTimeout(resolve, 10));

        const mods = await scanModsAfterMutations(root, 30);

        expect(mods.map((m) => m.fileName)).toEqual(['pak01_dir.vpk']);
        release();
        await batch;
        const probes = h.isDeadlockRunning.mock.calls.length;
        await scanModsAfterMutations(root);
        expect(h.isDeadlockRunning.mock.calls.length).toBe(probes);
    });

    it('is not refused by the Launch Vanilla window, does not probe for the game', async () => {
        await put(addons, { 'pak01_dir.vpk': 'a' });
        beginVanillaWindow();

        await expect(runExclusiveModMutation(async () => 'ran')).rejects.toThrow();
        h.isDeadlockRunning.mockClear();
        const mods = await scanModsAfterMutations(root);

        expect(mods).toHaveLength(1);
        expect(h.isDeadlockRunning).not.toHaveBeenCalled();
    });
});

describe('healModFolders', () => {
    it('drops an identical disabled twin and renames a differing one', async () => {
        await put(addons, { 'pak05_dir.vpk': 'enabled', 'pak06_dir.vpk': 'same' });
        await put(disabled, { 'pak05_dir.vpk': 'other', 'pak06_dir.vpk': 'same' });

        await healModFolders(root);

        const parked = await fs.readdir(disabled);
        expect(parked).toHaveLength(1);
        expect(parked[0]).not.toMatch(/^pak/);
        expect(await fs.readFile(join(disabled, parked[0]), 'utf8')).toBe('other');
    });

    it('removes stale staging temps and keeps the current run\'s', async () => {
        const stale = join(addons, `.merge-rebuild-0f8fad5b-d9cb-469f-a165-70867728950e.vpk`);
        const current = modTempPath(addons, 'merge-rebuild');
        await put(addons, { 'pak01_dir.vpk': 'a' });
        await fs.writeFile(stale, 'x');
        await fs.writeFile(current, 'x');

        await healModFolders(root);

        expect(await fs.readdir(addons).then((names) => names.sort())).toEqual(['.disabled', basename(current), 'pak01_dir.vpk'].sort());
    });

    it('stamps priorityMod on a flagless resident of the priority root', async () => {
        await put(grimoire, { 'pak06_dir.vpk': 'global', 'pak01_dir.vpk': 'locker-managed' });

        await healModFolders(root);

        expect(getModMetadata('grimoire/pak06_dir.vpk')?.priorityMod).toBe(true);
        expect(getModMetadata('grimoire/pak01_dir.vpk')).toBeUndefined();
    });

    describe('orphan prune', () => {
        beforeEach(async () => {
            await put(addons, { 'pak01_dir.vpk': 'a' });
            saveMetadata({ 'pak01_dir.vpk': { modName: 'Kept' }, 'ghost_dir.vpk': { modName: 'Gone' } });
        });

        it('drops rows whose VPK is gone', async () => {
            await healModFolders(root);

            expect(Object.keys(loadMetadata())).toEqual(['pak01_dir.vpk']);
        });

        it('keeps every row when the install path has no gameinfo.gi', async () => {
            await fs.rm(join(root, 'game', 'citadel', 'gameinfo.gi'));

            await healModFolders(root);

            expect(Object.keys(loadMetadata()).sort()).toEqual(['ghost_dir.vpk', 'pak01_dir.vpk']);
        });

        it('prunes developer orphans without changing normal metadata', async () => {
            await fs.writeFile(join(h.userData, 'settings.json'), JSON.stringify({ devMode: true }));
            saveMetadata({ 'pak01_dir.vpk': { modName: 'Developer mod' }, 'dev_ghost_dir.vpk': { modName: 'Developer orphan' } });

            await healModFolders(root);

            expect(loadMetadata()).toEqual({ 'pak01_dir.vpk': { modName: 'Developer mod' } });
            await fs.writeFile(join(h.userData, 'settings.json'), JSON.stringify({ devMode: false }));
            expect(Object.keys(loadMetadata()).sort()).toEqual(['ghost_dir.vpk', 'pak01_dir.vpk']);
        });

        it('does nothing at all while a Launch Vanilla stash exists', async () => {
            h.stash = { version: 1, status: 'active', startedAt: '', mods: [] };
            await put(disabled, { 'pak01_dir.vpk': 'parked' });

            await healModFolders(root);

            expect(Object.keys(loadMetadata()).sort()).toEqual(['ghost_dir.vpk', 'pak01_dir.vpk']);
            expect(await fs.readdir(disabled)).toEqual(['pak01_dir.vpk']);
        });

        it('keeps every row when the scan comes back empty', async () => {
            await fs.rm(join(addons, 'pak01_dir.vpk'));

            await healModFolders(root);

            expect(Object.keys(loadMetadata()).sort()).toEqual(['ghost_dir.vpk', 'pak01_dir.vpk']);
        });
    });
});

describe('mutation batches heal first', () => {
    it('a locked batch that names its folder sees healed state', async () => {
        await put(grimoire, { 'pak06_dir.vpk': 'global' });
        let flagInsideBatch: boolean | undefined;

        await runExclusiveModMutation(async () => {
            await scanMods(root);
            flagInsideBatch = getModMetadata('grimoire/pak06_dir.vpk')?.priorityMod;
        }, { healPath: root });

        expect(flagInsideBatch).toBe(true);
    });

    it('a batch without healPath (the vanilla restore) leaves the folders alone', async () => {
        await put(grimoire, { 'pak06_dir.vpk': 'global' });

        await runExclusiveModMutation(async () => {}, { exemptFromVanillaWindow: true });

        expect(getModMetadata('grimoire/pak06_dir.vpk')).toBeUndefined();
    });

    it('a failed metadata write in the heal does not fail the batch', async () => {
        await put(grimoire, { 'pak06_dir.vpk': 'global' });
        const eperm = () => {
            throw Object.assign(new Error('EPERM'), { code: 'EPERM' });
        };
        const stamp = vi.spyOn(metadata, 'setModMetadata').mockImplementation(eperm);
        const prune = vi.spyOn(metadata, 'pruneOrphanMetadata').mockImplementation(eperm);
        const error = vi.spyOn(console, 'error').mockImplementation(() => {});
        try {
            await expect(runExclusiveModMutation(async () => 'done', { healPath: root })).resolves.toBe('done');
            expect(stamp).toHaveBeenCalled();
            expect(prune).toHaveBeenCalled();
        } finally {
            stamp.mockRestore();
            prune.mockRestore();
            error.mockRestore();
        }
    });

    it('the startup heal runs through the queue behind a batch in progress', async () => {
        await put(grimoire, { 'pak06_dir.vpk': 'global' });
        let release!: () => void;
        const gate = new Promise<void>((resolve) => { release = resolve; });
        const batch = runExclusiveModMutation(() => gate);
        const healed = healModFoldersExclusive(root);
        await new Promise((resolve) => setTimeout(resolve, 30));
        expect(getModMetadata('grimoire/pak06_dir.vpk')).toBeUndefined();

        release();
        await Promise.all([batch, healed]);

        expect(getModMetadata('grimoire/pak06_dir.vpk')?.priorityMod).toBe(true);
    });
});
