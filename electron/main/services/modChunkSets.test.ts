import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import { basename, join } from 'node:path';
import { tmpdir } from 'node:os';

// Real mods.ts file moves on real folders. Only the content check is faked.
const h = vi.hoisted(() => ({ userData: '', assertVpkSafety: vi.fn(), running: false }));
vi.mock('electron', () => ({ app: { getPath: () => h.userData } }));
vi.mock('./launch', () => ({ isDeadlockRunning: async () => h.running, readStash: async () => null }));
vi.mock('./modSafety', () => ({ assertVpkSafety: h.assertVpkSafety, moveSafetySnapshot: vi.fn(), forgetSafetySnapshot: vi.fn() }));

import { deleteMods, disableMod, enableMod, healModFolders, installEnabledVpk, reorderMods, scanMods, setModPriority, swapModPriority } from './mods';
import { getModMetadata, saveMetadata, setModMetadata, type ModMetadata } from './metadata';
import { captureEmptyGameMods, captureLoadedGameMods, clearLoadedGameMods, getLoadedGameModIds, markLaunchGrace, syncKnownRunningGameModSnapshot } from './gameSessionMods';
import { copyModBackupTo, listModBackups } from './modBackups';
import { restoreModBackup } from './modBackupRestore';
import type { DeleteModsProgress } from '../../../src/types/mod';

let root: string;
let addons: string;
let disabled: string;
beforeEach(async () => {
    root = await fs.mkdtemp(join(tmpdir(), 'chunk-sets-test-'));
    addons = join(root, 'game', 'citadel', 'addons');
    disabled = join(addons, '.disabled');
    h.userData = join(root, 'userdata');
    for (const dir of [disabled, join(root, 'game', 'citadel', 'grimoire'), h.userData]) await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(join(root, 'game', 'citadel', 'gameinfo.gi'), 'GameInfo {}\n');
    saveMetadata({});
    h.running = false;
    clearLoadedGameMods();
    h.assertVpkSafety.mockReset();
    h.assertVpkSafety.mockResolvedValue(undefined);
});
afterEach(async () => { await fs.rm(root, { recursive: true, force: true }); });

const put = (folder: string, files: Record<string, string>) =>
    Promise.all(Object.entries(files).map(([name, bytes]) => fs.writeFile(join(folder, name), bytes)));
const contents = async (folder: string) => {
    const out: Record<string, string> = {};
    for (const entry of await fs.readdir(folder, { withFileTypes: true })) {
        if (entry.isFile()) out[entry.name] = await fs.readFile(join(folder, entry.name), 'utf8');
    }
    return out;
};
const idAt = async (path: string) => (await scanMods(root)).find((m) => m.path === path)!.id;
const entryAt = async (path: string) => (await scanMods(root)).find((m) => m.path === path)!;

describe('chunked mods move and delete as one set', () => {
    it('rejects direct and indirect moves of loaded mods without changing files', async () => {
        await put(addons, { 'pak01_dir.vpk': 'a', 'pak02_dir.vpk': 'b', 'pak02_000.vpk': 'b0' });
        const mods = await scanMods(root);
        captureLoadedGameMods(mods);
        h.running = true;
        const [a, b] = mods.sort((a, b) => a.priority - b.priority);
        const before = await contents(addons);

        await expect(reorderMods(root, [b.id, a.id])).rejects.toThrow('Game is running');
        await expect(setModPriority(root, a.id, 3)).rejects.toThrow('Game is running');
        await expect(swapModPriority(root, a.id, b.id)).rejects.toThrow('Game is running');
        expect(await contents(addons)).toEqual(before);
    });

    it('allows reordering newly enabled mods while leaving loaded mods in place', async () => {
        await put(addons, { 'pak01_dir.vpk': 'loaded' });
        const [loaded] = await scanMods(root);
        captureLoadedGameMods([loaded]);
        h.running = true;
        await put(addons, { 'pak02_dir.vpk': 'b', 'pak03_dir.vpk': 'c' });
        const b = await idAt(join(addons, 'pak02_dir.vpk'));
        const c = await idAt(join(addons, 'pak03_dir.vpk'));

        await reorderMods(root, [loaded.id, c, b]);

        expect(await contents(addons)).toEqual({ 'pak01_dir.vpk': 'loaded', 'pak02_dir.vpk': 'c', 'pak03_dir.vpk': 'b' });
        expect(getLoadedGameModIds()).toEqual([loaded.id]);
    });

    it('reports locks through launch grace and releases them after the game exits', async () => {
        await put(addons, { 'pak01_dir.vpk': 'loaded' });
        const [loaded] = await scanMods(root);
        captureLoadedGameMods([loaded]);
        markLaunchGrace();
        syncKnownRunningGameModSnapshot(false, []);
        expect(getLoadedGameModIds()).toEqual([loaded.id]);

        syncKnownRunningGameModSnapshot(true, []);
        syncKnownRunningGameModSnapshot(false, []);
        expect(getLoadedGameModIds()).toEqual([]);
    });

    it('blocks disabling throughout launch grace but unlocks if the game never starts', async () => {
        await put(addons, { 'pak01_dir.vpk': 'loaded' });
        const [loaded] = await scanMods(root);
        captureLoadedGameMods([loaded]);
        markLaunchGrace();

        await expect(disableMod(root, loaded.id)).rejects.toThrow('Game is running');
        expect(await contents(addons)).toEqual({ 'pak01_dir.vpk': 'loaded' });

        markLaunchGrace(0);
        expect((await disableMod(root, loaded.id)).enabled).toBe(false);
        expect(getLoadedGameModIds()).toEqual([]);
    });

    it.each([false, true])('allows disabling later-enabled mods in a running session (vanilla: %s)', async (vanilla) => {
        await put(addons, { 'pak01_dir.vpk': 'loaded' });
        await put(disabled, { 'later_dir.vpk': 'later' });
        const [loaded] = (await scanMods(root)).filter((mod) => mod.enabled);
        if (vanilla) captureEmptyGameMods();
        else captureLoadedGameMods([loaded]);
        markLaunchGrace();
        syncKnownRunningGameModSnapshot(false, []);
        h.running = true;

        const later = await enableMod(root, await idAt(join(disabled, 'later_dir.vpk')));
        expect((await disableMod(root, later.id)).enabled).toBe(false);
        expect(getLoadedGameModIds()).toEqual(vanilla ? [] : [loaded.id]);
        if (!vanilla) await expect(disableMod(root, loaded.id)).rejects.toThrow('Game is running');
    });

    it('reorder swaps a chunked mod with a single-file one', async () => {
        await put(addons, { 'pak01_dir.vpk': 'a', 'pak02_dir.vpk': 'b', 'PAK02_000.vpk': 'b0', 'pak02_001.VPK': 'b1' });
        const a = await idAt(join(addons, 'pak01_dir.vpk'));
        const b = await idAt(join(addons, 'pak02_dir.vpk'));

        await reorderMods(root, [b, a]);

        expect(await contents(addons)).toEqual({
            'pak01_000.vpk': 'b0', 'pak01_001.VPK': 'b1', 'pak01_dir.vpk': 'b', 'pak02_dir.vpk': 'a',
        });
    });

    it.each([2, 12])('reorder inventories %i mods once and keeps directory reads bounded', async (count) => {
        const files: Record<string, string> = {};
        for (let slot = 1; slot <= count; slot++) {
            const stem = `pak${String(slot).padStart(2, '0')}`;
            files[`${stem}_dir.vpk`] = `mod ${slot}`;
            files[`${stem}_000.vpk`] = `chunk ${slot}`;
        }
        await put(addons, files);
        const mods = await scanMods(root);
        const stat = vi.spyOn(fs, 'stat');
        const readdir = vi.spyOn(fs, 'readdir');
        try {
            await reorderMods(root, mods.map(mod => mod.id).reverse());

            const inventoryReads = stat.mock.calls.filter(([path]) => String(path).endsWith('_dir.vpk'));
            expect(inventoryReads).toHaveLength(count);
            // Healing and slot reservation may list a folder, but staging and
            // placing another mod must not add directory reads per move.
            expect(readdir.mock.calls.filter(([path]) => path === addons).length).toBeLessThanOrEqual(4);
        } finally {
            stat.mockRestore();
            readdir.mockRestore();
        }
        expect(await fs.readFile(join(addons, 'pak01_dir.vpk'), 'utf8')).toBe(`mod ${count}`);
        expect(await fs.readFile(join(addons, 'pak01_000.vpk'), 'utf8')).toBe(`chunk ${count}`);
    });

    it.each(['staging', 'placement'])('rolls back chunks and metadata after a failure during %s', async (phase) => {
        await put(addons, { 'pak01_dir.vpk': 'a', 'PAK01_000.vpk': 'a0', 'pak01_001.VPK': 'a1',
            'pak02_dir.vpk': 'b', 'PAK02_000.vpk': 'b0' });
        setModMetadata('pak01_dir.vpk', { modName: 'A' });
        setModMetadata('pak02_dir.vpk', { modName: 'B' });
        const mods = await scanMods(root);
        const before = await contents(addons);
        const rename = fs.rename;
        let failed = false;
        const spy = vi.spyOn(fs, 'rename').mockImplementation(async (from, to) => {
            const staging = from === join(addons, 'pak01_dir.vpk') && basename(String(to)).startsWith('tmp');
            const placement = basename(String(from)).startsWith('tmp') && to === join(addons, 'pak02_dir.vpk');
            if (!failed && (phase === 'staging' ? staging : placement)) {
                failed = true;
                throw Object.assign(new Error('No space left'), { code: 'ENOSPC' });
            }
            return rename(from, to);
        });
        try {
            await expect(reorderMods(root, mods.map(mod => mod.id).reverse())).rejects.toThrow('No space left');
        } finally {
            spy.mockRestore();
        }

        expect(failed).toBe(true);
        expect(await contents(addons)).toEqual(before);
        expect(getModMetadata('pak01_dir.vpk')).toMatchObject({ modName: 'A' });
        expect(getModMetadata('pak02_dir.vpk')).toMatchObject({ modName: 'B' });
    });

    it('reuses chunk plans while retrying a transient Windows lock', async () => {
        await put(addons, { 'pak01_dir.vpk': 'a', 'pak02_dir.vpk': 'b', 'pak02_000.vpk': 'b0' });
        const mods = await scanMods(root);
        const rename = fs.rename;
        let failed = false;
        const spy = vi.spyOn(fs, 'rename').mockImplementation(async (from, to) => {
            if (!failed && from === join(addons, 'pak02_000.vpk')) {
                failed = true;
                throw Object.assign(new Error('Temporarily locked'), { code: 'EBUSY' });
            }
            return rename(from, to);
        });
        try {
            await reorderMods(root, mods.map(mod => mod.id).reverse());
        } finally {
            spy.mockRestore();
        }
        expect(failed).toBe(true);
        expect(await contents(addons)).toEqual({ 'pak01_dir.vpk': 'b', 'pak01_000.vpk': 'b0', 'pak02_dir.vpk': 'a' });
    });

    it('retries transient Windows locks while rolling back a partially staged chunk set', async () => {
        await put(addons, { 'pak01_dir.vpk': 'a', 'pak01_000.vpk': 'a0', 'pak02_dir.vpk': 'b' });
        const mods = await scanMods(root);
        const before = await contents(addons);
        const rename = fs.rename;
        let rejectedPrimary = false;
        let rejectedRollback = false;
        const spy = vi.spyOn(fs, 'rename').mockImplementation(async (from, to) => {
            if (!rejectedPrimary && from === join(addons, 'pak01_dir.vpk') && basename(String(to)).startsWith('tmp')) {
                rejectedPrimary = true;
                throw Object.assign(new Error('No space left'), { code: 'ENOSPC' });
            }
            if (!rejectedRollback && basename(String(from)).startsWith('tmp') && to === join(addons, 'pak01_000.vpk')) {
                rejectedRollback = true;
                throw Object.assign(new Error('Temporarily locked'), { code: 'EPERM' });
            }
            return rename(from, to);
        });
        try {
            await expect(reorderMods(root, mods.map(mod => mod.id).reverse())).rejects.toThrow('No space left');
        } finally {
            spy.mockRestore();
        }
        expect(rejectedPrimary).toBe(true);
        expect(rejectedRollback).toBe(true);
        expect(await contents(addons)).toEqual(before);
    });

    it('moves chunks and metadata across overflow roots while reserving orphaned slots', async () => {
        const overflow = join(root, 'game', 'citadel', 'addons1');
        await fs.mkdir(overflow);
        await fs.writeFile(join(root, 'game', 'citadel', 'gameinfo.gi'),
            'GameInfo { FileSystem { SearchPaths { Game citadel } } }');
        const reserved: Record<string, string> = {};
        for (let slot = 1; slot < 99; slot++) reserved[`pak${String(slot).padStart(2, '0')}_000.vpk`] = 'orphan';
        await put(addons, { ...reserved, 'pak99_dir.vpk': 'a', 'pak99_000.vpk': 'a0' });
        await put(overflow, { 'pak01_dir.vpk': 'b', 'pak01_000.vpk': 'b0' });
        setModMetadata('pak99_dir.vpk', { modName: 'A' });
        setModMetadata('addons1/pak01_dir.vpk', { modName: 'B' });
        const mods = await scanMods(root);

        await reorderMods(root, mods.map(mod => mod.id).reverse());

        expect(await contents(addons)).toEqual({ ...reserved, 'pak99_dir.vpk': 'b', 'pak99_000.vpk': 'b0' });
        expect(await contents(overflow)).toEqual({ 'pak01_dir.vpk': 'a', 'pak01_000.vpk': 'a0' });
        expect(getModMetadata('pak99_dir.vpk')).toMatchObject({ modName: 'B' });
        expect(getModMetadata('addons1/pak01_dir.vpk')).toMatchObject({ modName: 'A' });
    });

    it('reorder treats a slot holding only chunk files as taken', async () => {
        await put(addons, { 'pak01_000.vpk': 'orphan', 'pak03_dir.vpk': 'c', 'pak03_000.vpk': 'c0' });

        await reorderMods(root, [await idAt(join(addons, 'pak03_dir.vpk'))]);

        expect(await contents(addons)).toEqual({ 'pak01_000.vpk': 'orphan', 'pak02_000.vpk': 'c0', 'pak02_dir.vpk': 'c' });
    });

    it('swap with a disabled legacy slot carries the chunks', async () => {
        await put(addons, { 'pak02_dir.vpk': 'a', 'pak02_000.vpk': 'a0' });
        await put(disabled, { 'pak07_dir.vpk': 'b' });

        await swapModPriority(root, await idAt(join(addons, 'pak02_dir.vpk')), await idAt(join(disabled, 'pak07_dir.vpk')));

        expect(await contents(addons)).toEqual({ 'pak07_000.vpk': 'a0', 'pak07_dir.vpk': 'a' });
        expect(await contents(disabled)).toEqual({ 'pak02_dir.vpk': 'b' });
    });

    it('setModPriority carries the chunks and refuses a chunk-only slot', async () => {
        await put(addons, { 'pak02_dir.vpk': 'b', 'pak02_000.vpk': 'b0', 'pak05_000.vpk': 'orphan' });
        const b = await idAt(join(addons, 'pak02_dir.vpk'));

        await expect(setModPriority(root, b, 5)).rejects.toThrow('Priority 5 is already in use');
        await setModPriority(root, b, 7);

        expect(await contents(addons)).toEqual({ 'pak05_000.vpk': 'orphan', 'pak07_000.vpk': 'b0', 'pak07_dir.vpk': 'b' });
    });

    it('delete removes the chunks with the directory file', async () => {
        await put(addons, { 'pak04_dir.vpk': 'd', 'pak04_000.vpk': 'd0', 'pak04_001.vpk': 'd1' });

        await deleteMods(root, [await entryAt(join(addons, 'pak04_dir.vpk'))]);

        expect(await contents(addons)).toEqual({});
        await expect(fs.stat(join(h.userData, 'mod-backups'))).rejects.toMatchObject({ code: 'ENOENT' });
    });

    it('the enabled/disabled collision heal renames or drops a disabled twin with its chunks', async () => {
        await put(addons, { 'pak05_dir.vpk': 'enabled', 'pak06_dir.vpk': 'same', 'pak06_000.vpk': 'same0' });
        await put(disabled, { 'pak05_dir.vpk': 'other', 'pak05_000.vpk': 'other0', 'pak06_dir.vpk': 'same', 'pak06_000.vpk': 'same0' });

        await healModFolders(root);

        const parked = await contents(disabled);
        const [dir] = Object.keys(parked).filter((name) => name.endsWith('_dir.vpk'));
        expect(parked).toEqual({ [dir.replace(/_dir\.vpk$/, '_000.vpk')]: 'other0', [dir]: 'other' });
        expect(dir).not.toMatch(/^pak/);
    });
});

describe('deleteMods', () => {
    it('restores the original filename and keeps its identity through developer mode switches', async () => {
        const settingsPath = join(h.userData, 'settings.json');
        const devRoot = join(root, 'dev-deadlock');
        const devDisabled = join(devRoot, 'game', 'citadel', 'addons', '.disabled');
        await fs.mkdir(devDisabled, { recursive: true });
        await fs.writeFile(join(devRoot, 'game', 'citadel', 'gameinfo.gi'), 'GameInfo {}\n');
        await put(addons, { 'pak04_dir.vpk': 'normal skin' });
        setModMetadata('pak04_dir.vpk', { modName: 'Normal skin', gameBananaId: 1 });
        const normalMetadataPath = join(h.userData, 'mod-metadata.json');
        const normalMetadata = await fs.readFile(normalMetadataPath, 'utf8');
        const settings = { keepModBackups: true, deadlockPath: root, devDeadlockPath: devRoot };
        await fs.writeFile(settingsPath, JSON.stringify({ ...settings, devMode: true }));
        await put(devDisabled, { 'pak04_dir.vpk': 'sandbox skin', 'pak04_000.vpk': 'sandbox chunk' });
        setModMetadata('pak04_dir.vpk', { modName: 'Sandbox skin', gameBananaId: 2, fileDescription: 'Classic style' });
        const [mod] = await scanMods(devRoot);
        await deleteMods(devRoot, [mod]);
        const [backup] = await listModBackups();

        await restoreModBackup(devRoot, backup.id);

        expect(await contents(devDisabled)).toEqual({ 'pak04_dir.vpk': 'sandbox skin', 'pak04_000.vpk': 'sandbox chunk' });
        expect(await fs.readFile(normalMetadataPath, 'utf8')).toBe(normalMetadata);
        expect(await listModBackups()).toEqual([]);
        await fs.writeFile(settingsPath, JSON.stringify({ ...settings, devMode: false }));
        await healModFolders(root);
        expect(getModMetadata('pak04_dir.vpk')).toMatchObject({ modName: 'Normal skin', gameBananaId: 1 });
        await fs.writeFile(settingsPath, JSON.stringify({ ...settings, devMode: true }));
        await healModFolders(devRoot);
        const [restored] = await scanMods(devRoot);
        expect(restored).toMatchObject({ fileName: 'pak04_dir.vpk', enabled: false });
        expect(getModMetadata(restored.metaKey)).toMatchObject({
            modName: 'Sandbox skin', gameBananaId: 2, fileDescription: 'Classic style',
        });
    });

    it('retains deleted bytes, split chunks and metadata when backups are enabled', async () => {
        await fs.writeFile(join(h.userData, 'settings.json'), JSON.stringify({ keepModBackups: true }));
        await put(addons, { 'pak04_dir.vpk': 'old skin', 'pak04_000.vpk': 'old chunk', 'pak05_dir.vpk': 'other mod' });
        const metadata = {
            modName: 'Skin', gameBananaId: 12, gameBananaFileId: 34,
            fileDescription: 'Original appearance', sourceFileName: 'old_skin',
            sourceSection: 'Mod', localGroupId: 'my-variants', sha256: 'a'.repeat(64),
            archiveVpkPath: 'old/skin.vpk', vpkIndex: 2,
        };
        setModMetadata('pak04_dir.vpk', metadata);

        await deleteMods(root, [await entryAt(join(addons, 'pak04_dir.vpk'))]);

        expect(await contents(addons)).toEqual({ 'pak05_dir.vpk': 'other mod' });
        expect(getModMetadata('pak04_dir.vpk')).toBeUndefined();
        const backups = await listModBackups();
        expect(backups).toHaveLength(1);
        expect(backups[0]).toMatchObject({ fileName: 'pak04_dir.vpk', description: 'Original appearance' });
        const restored = join(root, 'restored');
        expect(await copyModBackupTo(backups[0].id, join(restored, 'skin_dir.vpk'))).toMatchObject({ metadata });
        expect(await contents(restored)).toEqual({ 'skin_dir.vpk': 'old skin', 'skin_000.vpk': 'old chunk' });
    });

    it('preserves a Global mod placement flag in its deleted backup', async () => {
        await fs.writeFile(join(h.userData, 'settings.json'), JSON.stringify({ keepModBackups: true }));
        const globalFolder = join(root, 'game', 'citadel', 'grimoire');
        await put(globalFolder, { 'pak05_dir.vpk': 'global skin' });
        setModMetadata('grimoire/pak05_dir.vpk', { modName: 'Global skin' });

        await deleteMods(root, [await entryAt(join(globalFolder, 'pak05_dir.vpk'))]);

        const [backup] = await listModBackups();
        const restored = await copyModBackupTo(backup.id, join(root, 'restored_dir.vpk'));
        expect(restored.metadata).toMatchObject({ modName: 'Global skin', priorityMod: true });
        expect(await contents(globalFolder)).toEqual({});
    });

    it('leaves the mod, chunks and metadata untouched if its backup cannot be stored', async () => {
        await fs.writeFile(join(h.userData, 'settings.json'), JSON.stringify({ keepModBackups: true }));
        await fs.writeFile(join(h.userData, 'mod-backups'), 'a file blocks the backup folder');
        const files = { 'pak04_dir.vpk': 'old skin', 'pak04_000.vpk': 'old chunk' };
        await put(addons, files);
        const metadata = { modName: 'Skin', gameBananaId: 12, gameBananaFileId: 34 };
        setModMetadata('pak04_dir.vpk', metadata);

        await expect(deleteMods(root, [await entryAt(join(addons, 'pak04_dir.vpk'))])).rejects.toThrow();

        expect(await contents(addons)).toEqual(files);
        expect(getModMetadata('pak04_dir.vpk')).toEqual(metadata);
    });

    it('deletes every target with its chunks and metadata, one tick per entry', async () => {
        await put(addons, { 'pak01_dir.vpk': 'a', 'pak02_dir.vpk': 'b', 'pak02_000.vpk': 'b0', 'pak03_dir.vpk': 'keep' });
        await put(disabled, { 'skin_dir.vpk': 's' });
        const a = await entryAt(join(addons, 'pak01_dir.vpk'));
        const b = await entryAt(join(addons, 'pak02_dir.vpk'));
        const skin = await entryAt(join(disabled, 'skin_dir.vpk'));
        setModMetadata('pak01_dir.vpk', { modName: 'A' });
        const ticks: DeleteModsProgress[] = [];

        const result = await deleteMods(root, [a, b, skin], (progress) => ticks.push(progress));

        expect(result).toEqual({ skipped: [] });
        expect(await contents(addons)).toEqual({ 'pak03_dir.vpk': 'keep' });
        expect(await contents(disabled)).toEqual({});
        expect(getModMetadata('pak01_dir.vpk')).toBeUndefined();
        expect(ticks).toEqual([1, 2, 3].map((done) => ({ done, total: 3 })));
    });

    it('skips and reports an entry that is gone or whose mod changed behind the same id', async () => {
        await put(addons, { 'pak01_dir.vpk': 'a', 'pak02_dir.vpk': 'b', 'pak03_dir.vpk': 'c', 'pak04_dir.vpk': 'd' });
        const a = await entryAt(join(addons, 'pak01_dir.vpk'));
        const swappedSize = await entryAt(join(addons, 'pak02_dir.vpk'));
        const swappedTime = await entryAt(join(addons, 'pak03_dir.vpk'));
        const d = await entryAt(join(addons, 'pak04_dir.vpk'));
        setModMetadata('pak02_dir.vpk', { modName: 'B' });
        await fs.writeFile(join(addons, 'pak02_dir.vpk'), 'a different mod');
        const later = new Date(Date.parse(swappedTime.installedAt) + 60_000);
        await fs.utimes(join(addons, 'pak03_dir.vpk'), later, later);
        const ticks: DeleteModsProgress[] = [];

        const result = await deleteMods(
            root,
            [a, swappedSize, swappedTime, { id: 'already-gone', size: 1, installedAt: d.installedAt }, d],
            (progress) => ticks.push(progress),
        );

        expect(result).toEqual({ skipped: [swappedSize.id, swappedTime.id, 'already-gone'] });
        expect(await contents(addons)).toEqual({ 'pak02_dir.vpk': 'a different mod', 'pak03_dir.vpk': 'c' });
        expect(getModMetadata('pak02_dir.vpk')).toEqual(expect.objectContaining({ modName: 'B' }));
        expect(ticks).toEqual([1, 2, 3, 4, 5].map((done) => ({ done, total: 5 })));
    });

    it('refuses the whole batch before deleting anything when the game has a target loaded', async () => {
        await put(addons, { 'pak01_dir.vpk': 'loaded' });
        await put(disabled, { 'skin_dir.vpk': 's' });
        const loaded = await entryAt(join(addons, 'pak01_dir.vpk'));
        const skin = await entryAt(join(disabled, 'skin_dir.vpk'));
        h.running = true;

        await expect(deleteMods(root, [skin, loaded])).rejects.toThrow('Game is running');

        expect(await contents(addons)).toEqual({ 'pak01_dir.vpk': 'loaded' });
        expect(await contents(disabled)).toEqual({ 'skin_dir.vpk': 's' });
    });
});

describe('installEnabledVpk', () => {
    it('backs up the old local import before replacing its bytes', async () => {
        await fs.writeFile(join(h.userData, 'settings.json'), JSON.stringify({ keepModBackups: true }));
        await put(addons, { 'pak08_dir.vpk': 'previous build' });
        const metadata: ModMetadata = {
            modName: 'Custom container',
            soulImport: { glbFileName: 'container.glb', orient: 'auto', glow: 'off', status: 'untested' },
        };
        setModMetadata('pak08_dir.vpk', metadata);
        const source = join(root, 'new.vpk');
        await fs.writeFile(source, 'new build');
        const destination = join(addons, 'pak08_dir.vpk');

        expect(await installEnabledVpk(root, source, destination)).toBe(destination);

        expect(await fs.readFile(destination, 'utf8')).toBe('new build');
        const [backup] = await listModBackups();
        const restoredPath = join(root, 'restored_dir.vpk');
        expect(await copyModBackupTo(backup.id, restoredPath)).toMatchObject({ metadata });
        expect(await fs.readFile(restoredPath, 'utf8')).toBe('previous build');
    });

    it('keeps the old local import when its backup fails', async () => {
        await fs.writeFile(join(h.userData, 'settings.json'), JSON.stringify({ keepModBackups: true }));
        await fs.writeFile(join(h.userData, 'mod-backups'), 'a file blocks the backup folder');
        await put(addons, { 'pak08_dir.vpk': 'previous build' });
        const source = join(root, 'new.vpk');
        await fs.writeFile(source, 'new build');

        await expect(installEnabledVpk(root, source, join(addons, 'pak08_dir.vpk'))).rejects.toThrow();

        expect(await contents(addons)).toEqual({ 'pak08_dir.vpk': 'previous build' });
    });

    it('allocates after the check, so installs and enables finishing first cannot take its slot', async () => {
        const src = join(root, 'src');
        await fs.mkdir(src);
        await put(src, { 'slow.vpk': 'slow', 'fast.vpk': 'fast' });
        await put(disabled, { 'skin_dir.vpk': 'skin' });
        let release!: () => void;
        h.assertVpkSafety.mockImplementationOnce(() => new Promise<void>((resolve) => { release = resolve; }));

        const slow = installEnabledVpk(root, join(src, 'slow.vpk'));
        await vi.waitFor(() => expect(h.assertVpkSafety).toHaveBeenCalledTimes(1));
        const fast = await installEnabledVpk(root, join(src, 'fast.vpk'));
        const skin = await enableMod(root, await idAt(join(disabled, 'skin_dir.vpk')));
        release();

        expect([fast, skin.path, await slow]).toEqual(['pak01_dir.vpk', 'pak02_dir.vpk', 'pak03_dir.vpk'].map((n) => join(addons, n)));
        expect(await contents(addons)).toEqual({ 'pak01_dir.vpk': 'fast', 'pak02_dir.vpk': 'skin', 'pak03_dir.vpk': 'slow' });
    });
});
