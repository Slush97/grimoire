import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ModMetadata } from './metadata';

const state = vi.hoisted(() => ({
    userData: '',
    activePath: '',
    devMode: false,
    keepModBackups: true,
    metadata: new Map<string, ModMetadata>(),
    setMetadata: vi.fn(),
    removeMetadata: vi.fn(),
    assertSafety: vi.fn(),
    forgetSafety: vi.fn(),
    mutation: vi.fn(),
    heal: vi.fn(),
}));

vi.mock('../utils/paths', () => ({ getUserDataPath: () => state.userData }));
vi.mock('./settings', () => ({
    loadSettings: () => ({ keepModBackups: state.keepModBackups, devMode: state.devMode }),
    getActiveDeadlockPath: () => state.activePath,
}));
vi.mock('./deadlock', async () => {
    const { basename, join } = await import('node:path');
    return {
        getDisabledPath: (path: string) => join(path, 'citadel', 'addons', '.disabled'),
        metaKeyFor: (path: string) => basename(path),
        peekModFolders: (path: string) => ({
            enabledRoots: [join(path, 'citadel', 'addons'), join(path, 'citadel', 'grimoire')],
            disabledPath: join(path, 'citadel', 'addons', '.disabled'),
        }),
    };
});
vi.mock('./metadata', () => ({
    setModMetadataWithHash: state.setMetadata,
    removeModMetadata: state.removeMetadata,
}));
vi.mock('./modSafety', () => ({
    assertVpkSafety: state.assertSafety,
    forgetSafetySnapshot: state.forgetSafety,
}));
vi.mock('./mods', () => ({ runExclusiveModMutation: state.mutation, healModFolders: state.heal }));

import { captureModBackup, listModBackups } from './modBackups';
import { restoreModBackup } from './modBackupRestore';

let deadlockPath: string;
let sourcePath: string;
let disabledPath: string;

beforeEach(async () => {
    vi.resetAllMocks();
    state.metadata.clear();
    state.userData = await fs.mkdtemp(join(tmpdir(), 'grimoire-backup-restore-'));
    state.keepModBackups = true;
    deadlockPath = join(state.userData, 'game');
    state.activePath = deadlockPath;
    state.devMode = false;
    const addonsPath = join(deadlockPath, 'citadel', 'addons');
    disabledPath = join(addonsPath, '.disabled');
    await fs.mkdir(addonsPath, { recursive: true });
    sourcePath = join(addonsPath, 'pak01_dir.vpk');
    await fs.writeFile(sourcePath, 'old version bytes');
    state.mutation.mockImplementation((operation: () => Promise<unknown>) => operation());
    state.assertSafety.mockResolvedValue(undefined);
    state.removeMetadata.mockImplementation((key: string) => { state.metadata.delete(key); });
    state.setMetadata.mockImplementation(async (key: string, metadata: ModMetadata, path: string) => {
        const sha256 = createHash('sha256').update(await fs.readFile(path)).digest('hex');
        state.metadata.set(key, { ...metadata, sha256 });
    });
});

afterEach(async () => {
    vi.restoreAllMocks();
    await fs.rm(state.userData, { recursive: true, force: true });
});

describe('restoreModBackup', () => {
    it.each(['path', 'mode'] as const)('preserves the backup without touching either install when the queued %s changes', async (change) => {
        const backup = (await captureModBackup(sourcePath, { modName: 'Skin' }))!;
        state.metadata.set('pak01_dir.vpk', { modName: 'Existing skin' });
        state.mutation.mockImplementationOnce(async (operation: () => Promise<unknown>) => {
            if (change === 'path') state.activePath = join(state.userData, 'other-game');
            else state.devMode = true;
            return operation();
        });

        await expect(restoreModBackup(deadlockPath, backup.id)).rejects.toThrow('MOD_BACKUP_INSTALL_CHANGED');

        expect(state.heal).not.toHaveBeenCalled();
        expect(state.assertSafety).not.toHaveBeenCalled();
        expect(state.removeMetadata).not.toHaveBeenCalled();
        expect(state.setMetadata).not.toHaveBeenCalled();
        expect(state.metadata.get('pak01_dir.vpk')).toEqual({ modName: 'Existing skin' });
        expect(await listModBackups()).toEqual([backup]);
        expect(await fs.readFile(sourcePath, 'utf8')).toBe('old version bytes');
        await expect(fs.stat(disabledPath)).rejects.toMatchObject({ code: 'ENOENT' });
    });

    it('keeps the original filename when no installed file occupies it', async () => {
        const backup = (await captureModBackup(sourcePath, { modName: 'Skin' }))!;
        await fs.unlink(sourcePath);

        await restoreModBackup(deadlockPath, backup.id);

        expect(await fs.readdir(disabledPath)).toEqual(['pak01_dir.vpk']);
        expect(await fs.readFile(join(disabledPath, 'pak01_dir.vpk'), 'utf8')).toBe('old version bytes');
    });

    it('adds five alphanumeric characters when the original disabled filename is occupied', async () => {
        const backup = (await captureModBackup(sourcePath, { modName: 'Skin' }))!;
        await fs.unlink(sourcePath);
        await fs.mkdir(disabledPath);
        await fs.writeFile(join(disabledPath, 'pak01_dir.vpk'), 'other disabled version');
        state.metadata.set('pak01_dir.vpk', { modName: 'Other skin' });

        await restoreModBackup(deadlockPath, backup.id);

        const restoredName = (await fs.readdir(disabledPath)).find((name) => name !== 'pak01_dir.vpk')!;
        expect(restoredName).toMatch(/^pak01_[a-z0-9]{5}_dir\.vpk$/);
        expect(await fs.readFile(join(disabledPath, 'pak01_dir.vpk'), 'utf8')).toBe('other disabled version');
        expect(state.metadata.get('pak01_dir.vpk')?.modName).toBe('Other skin');
    });

    it('avoids case-insensitive filename collisions and orphaned split chunks', async () => {
        const backup = (await captureModBackup(sourcePath, { modName: 'Skin' }))!;
        await fs.unlink(sourcePath);
        await fs.mkdir(disabledPath);
        await fs.writeFile(join(disabledPath, 'PAK01_000.VPK'), 'orphaned chunk');

        await restoreModBackup(deadlockPath, backup.id);

        const restoredName = (await fs.readdir(disabledPath)).find((name) => /_dir\.vpk$/i.test(name))!;
        expect(restoredName).toMatch(/^pak01_[a-z0-9]{5}_dir\.vpk$/);
        expect(await fs.readFile(join(disabledPath, 'PAK01_000.VPK'), 'utf8')).toBe('orphaned chunk');
    });

    it('adds the collision suffix before the extension of a standalone VPK', async () => {
        const standalone = join(deadlockPath, 'citadel', 'addons', 'skin.vpk');
        await fs.writeFile(standalone, 'standalone bytes');
        const backup = (await captureModBackup(standalone, { modName: 'Skin' }))!;

        await restoreModBackup(deadlockPath, backup.id);

        const [restoredName] = await fs.readdir(disabledPath);
        expect(restoredName).toMatch(/^skin_[a-z0-9]{5}\.vpk$/);
        expect(await fs.readFile(join(disabledPath, restoredName), 'utf8')).toBe('standalone bytes');
    });

    it('restores a separate disabled copy with provenance and renamed split chunks', async () => {
        const oldMetadata: ModMetadata = {
            modName: 'Older skin',
            gameBananaId: 123,
            gameBananaFileId: 45,
            fileDescription: 'Classic style',
            sourceFileName: 'classic.zip',
            variantLabel: 'My favorite version',
            archiveVpkPath: 'old/style_dir.vpk',
            lastPriority: 1,
            priorityMod: true,
        };
        const chunkPath = join(deadlockPath, 'citadel', 'addons', 'pak01_000.vpk');
        await fs.writeFile(chunkPath, 'old archive chunk');
        const backup = (await captureModBackup(sourcePath, oldMetadata))!;
        await fs.writeFile(sourcePath, 'currently installed version');
        await fs.writeFile(chunkPath, 'currently installed chunk');
        const currentMetadata = { modName: 'Newer skin', gameBananaId: 123, gameBananaFileId: 67 };
        state.metadata.set(basename(sourcePath), currentMetadata);
        state.keepModBackups = false;

        await restoreModBackup(deadlockPath, backup.id);

        const files = await fs.readdir(disabledPath);
        expect(files).toHaveLength(2);
        const restoredName = files.find((file) => file.endsWith('_dir.vpk'))!;
        expect(restoredName).toMatch(/^pak01_[a-z0-9]{5}_dir\.vpk$/);
        const restoredPath = join(disabledPath, restoredName);
        const restoredChunk = restoredName.replace(/_dir\.vpk$/, '_000.vpk');
        expect(await fs.readFile(restoredPath, 'utf8')).toBe('old version bytes');
        expect(await fs.readFile(join(disabledPath, restoredChunk), 'utf8')).toBe('old archive chunk');
        expect(state.metadata.get(restoredName)).toEqual({
            ...oldMetadata,
            sha256: createHash('sha256').update('old version bytes').digest('hex'),
        });
        expect(await fs.readFile(sourcePath, 'utf8')).toBe('currently installed version');
        expect(await fs.readFile(chunkPath, 'utf8')).toBe('currently installed chunk');
        expect(state.metadata.get(basename(sourcePath))).toEqual(currentMetadata);
        expect(await listModBackups()).toEqual([]);
        await expect(fs.stat(join(state.userData, 'mod-backups', backup.id))).rejects.toMatchObject({ code: 'ENOENT' });
        expect(state.assertSafety).toHaveBeenCalledWith(restoredPath, { prompt: false, allowUntrusted: true });
        expect(state.mutation).toHaveBeenCalledWith(expect.any(Function));
        expect(state.heal).toHaveBeenCalledWith(deadlockPath);
    });

    it('uses the backup display name when the captured mod had no sidecar name', async () => {
        const backup = (await captureModBackup(sourcePath, undefined, 'Local costume'))!;
        await restoreModBackup(deadlockPath, backup.id);
        const [restoredName] = await fs.readdir(disabledPath);
        expect(state.metadata.get(restoredName)?.modName).toBe('Local costume');
        expect(await listModBackups()).toEqual([]);
    });

    it('cleans copied VPKs and chunks after a failed safety check while preserving the backup', async () => {
        await fs.writeFile(join(deadlockPath, 'citadel', 'addons', 'pak01_000.vpk'), 'old chunk');
        const backup = (await captureModBackup(sourcePath, { modName: 'Blocked skin' }))!;
        const safetyError = new Error('MOD_SAFETY_BLOCKED');
        state.assertSafety.mockRejectedValueOnce(safetyError);

        await expect(restoreModBackup(deadlockPath, backup.id)).rejects.toBe(safetyError);

        expect(await fs.readdir(disabledPath)).toEqual([]);
        expect(state.setMetadata).not.toHaveBeenCalled();
        expect(state.metadata.size).toBe(0);
        expect(state.forgetSafety).toHaveBeenCalledWith(expect.stringMatching(/pak01_[a-z0-9]{5}_dir\.vpk$/));
        expect(await fs.readFile(sourcePath, 'utf8')).toBe('old version bytes');
        expect(await listModBackups()).toEqual([backup]);
        await restoreModBackup(deadlockPath, backup.id);
        expect(await fs.readdir(disabledPath)).toHaveLength(2);
        expect(await listModBackups()).toEqual([]);
    });

    it('removes restored bytes and any partial sidecar row after metadata persistence fails', async () => {
        await fs.writeFile(join(deadlockPath, 'citadel', 'addons', 'pak01_000.vpk'), 'old chunk');
        const backup = (await captureModBackup(sourcePath, { modName: 'Skin' }))!;
        const persistError = new Error('Unable to write metadata');
        state.setMetadata.mockImplementationOnce(async (key: string, metadata: ModMetadata) => {
            state.metadata.set(key, metadata);
            throw persistError;
        });

        await expect(restoreModBackup(deadlockPath, backup.id)).rejects.toBe(persistError);

        expect(await fs.readdir(disabledPath)).toEqual([]);
        expect(state.metadata.size).toBe(0);
        expect(state.forgetSafety).toHaveBeenCalledOnce();
        expect(await listModBackups()).toEqual([backup]);
        expect(await fs.readFile(sourcePath, 'utf8')).toBe('old version bytes');
    });

    it('rejects corrupted backup bytes without invoking safety or writing metadata', async () => {
        const backup = (await captureModBackup(sourcePath, { modName: 'Skin' }))!;
        await fs.writeFile(join(state.userData, 'mod-backups', backup.id, backup.fileName), 'damaged bytes');

        await expect(restoreModBackup(deadlockPath, backup.id)).rejects.toThrow('integrity');

        expect(await fs.readdir(disabledPath)).toEqual([]);
        expect(state.assertSafety).not.toHaveBeenCalled();
        expect(state.setMetadata).not.toHaveBeenCalled();
        expect(await listModBackups()).toEqual([backup]);
    });

    it('consumes only the restored backup and refuses to restore it twice', async () => {
        const backup = (await captureModBackup(sourcePath, { localGroupId: 'local-skin', modName: 'Skin' }))!;
        const other = (await captureModBackup(sourcePath, { modName: 'Another backup' }))!;
        await restoreModBackup(deadlockPath, backup.id);
        const files = await fs.readdir(disabledPath);
        expect(files).toHaveLength(1);
        expect(state.metadata.get(files[0])?.localGroupId).toBe('local-skin');
        expect(await listModBackups()).toEqual([other]);
        await expect(restoreModBackup(deadlockPath, backup.id)).rejects.toMatchObject({ code: 'ENOENT' });
        expect(await fs.readdir(disabledPath)).toEqual(files);
        expect(await fs.readFile(sourcePath, 'utf8')).toBe('old version bytes');
    });

    it('keeps the restored file and metadata if backup deletion fails', async () => {
        const backup = (await captureModBackup(sourcePath, { modName: 'Skin' }))!;
        const backupPath = join(state.userData, 'mod-backups', backup.id);
        const remove = fs.rm.bind(fs);
        const cleanupError = new Error('Unable to delete backup');
        vi.spyOn(fs, 'rm').mockImplementation(async (path, options) => {
            if (path === backupPath) throw cleanupError;
            await remove(path, options);
        });

        await expect(restoreModBackup(deadlockPath, backup.id)).rejects.toBe(cleanupError);

        const [restoredName] = await fs.readdir(disabledPath);
        expect(await fs.readFile(join(disabledPath, restoredName), 'utf8')).toBe('old version bytes');
        expect(state.metadata.get(restoredName)?.modName).toBe('Skin');
        expect(await listModBackups()).toEqual([backup]);
    });
});
