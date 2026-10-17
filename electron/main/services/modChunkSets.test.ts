import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Real mods.ts file moves on real folders. Only the content check is faked.
const h = vi.hoisted(() => ({ userData: '', assertVpkSafety: vi.fn(), running: false }));
vi.mock('electron', () => ({ app: { getPath: () => h.userData } }));
vi.mock('./launch', () => ({ isDeadlockRunning: async () => h.running, readStash: async () => null }));
vi.mock('./modSafety', () => ({ assertVpkSafety: h.assertVpkSafety, moveSafetySnapshot: vi.fn(), forgetSafetySnapshot: vi.fn() }));

import { deleteMods, enableMod, healModFolders, installEnabledVpk, reorderMods, scanMods, setModPriority, swapModPriority } from './mods';
import { getModMetadata, saveMetadata, setModMetadata, type ModMetadata } from './metadata';
import { clearLoadedGameMods } from './gameSessionMods';
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
    for (const name of (await fs.readdir(folder)).sort()) {
        if (name !== '.disabled') out[name] = await fs.readFile(join(folder, name), 'utf8');
    }
    return out;
};
const idAt = async (path: string) => (await scanMods(root)).find((m) => m.path === path)!.id;
const entryAt = async (path: string) => (await scanMods(root)).find((m) => m.path === path)!;

describe('chunked mods move and delete as one set', () => {
    it('reorder swaps a chunked mod with a single-file one', async () => {
        await put(addons, { 'pak01_dir.vpk': 'a', 'pak02_dir.vpk': 'b', 'pak02_000.vpk': 'b0', 'pak02_001.vpk': 'b1' });
        const a = await idAt(join(addons, 'pak01_dir.vpk'));
        const b = await idAt(join(addons, 'pak02_dir.vpk'));

        await reorderMods(root, [b, a]);

        expect(await contents(addons)).toEqual({
            'pak01_000.vpk': 'b0', 'pak01_001.vpk': 'b1', 'pak01_dir.vpk': 'b', 'pak02_dir.vpk': 'a',
        });
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
