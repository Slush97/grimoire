import { promises as fs } from 'fs';
import { randomUUID } from 'crypto';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ userData: '', keepModBackups: false }));
vi.mock('../utils/paths', () => ({ getUserDataPath: () => state.userData }));
vi.mock('./settings', () => ({ loadSettings: () => ({ keepModBackups: state.keepModBackups }) }));

import {
    captureModBackup,
    cleanupExpiredModBackups,
    copyModBackupTo,
    deleteModBackup,
    listModBackups,
    MOD_BACKUP_RETENTION_MS,
    observeModBackupChanges,
} from './modBackups';
import { getModBackupIdentity } from '../../../src/lib/modBackupIdentity';

let sourcePath: string;
let unsubscribe: (() => void) | undefined;

beforeEach(async () => {
    state.userData = await fs.mkdtemp(join(tmpdir(), 'grimoire-mod-backups-'));
    state.keepModBackups = true;
    const sourceDirectory = join(state.userData, 'source');
    await fs.mkdir(sourceDirectory);
    sourcePath = join(sourceDirectory, 'old_skin_dir.vpk');
    await fs.writeFile(sourcePath, 'original VPK bytes');
});

afterEach(async () => {
    unsubscribe?.();
    unsubscribe = undefined;
    vi.useRealTimers();
    vi.restoreAllMocks();
    await fs.rm(state.userData, { recursive: true, force: true });
});

describe('mod backups', () => {
    it('does not store anything unless capture is enabled', async () => {
        state.keepModBackups = false;
        expect(await captureModBackup(sourcePath, { modName: 'Old skin' })).toBeNull();
        expect(await listModBackups()).toEqual([]);
        expect(await fs.readdir(state.userData)).toEqual(['source']);
    });

    it('stores real bytes and metadata without consuming them during the copy stage', async () => {
        const metadata = { modName: 'Skin', gameBananaId: 12, gameBananaFileId: 3, fileDescription: 'Old style', sha256: 'a'.repeat(64) };
        const backup = (await captureModBackup(sourcePath, metadata))!;
        expect(backup).toMatchObject({ fileName: 'old_skin_dir.vpk', description: 'Old style', modName: 'Skin', identityKey: 'gamebanana:Mod:12' });
        expect(backup.expiresAt - backup.createdAt).toBe(MOD_BACKUP_RETENTION_MS);
        await fs.unlink(sourcePath);
        state.keepModBackups = false;
        expect(await listModBackups()).toEqual([backup]);
        const restoredPath = join(state.userData, 'restored', 'different_dir.vpk');
        expect(await copyModBackupTo(backup.id, restoredPath)).toEqual({ summary: backup, metadata });
        expect(await fs.readFile(restoredPath, 'utf8')).toBe('original VPK bytes');
        expect(await listModBackups()).toEqual([backup]);
    });

    it('captures and renames every chunk sibling without unrelated archives', async () => {
        const sourceDirectory = join(state.userData, 'source');
        await fs.writeFile(join(sourceDirectory, 'old_skin_000.vpk'), 'chunk zero');
        await fs.writeFile(join(sourceDirectory, 'old_skin_001.VPK'), 'chunk one');
        await fs.writeFile(join(sourceDirectory, 'other_000.vpk'), 'unrelated');
        const backup = (await captureModBackup(sourcePath, undefined, 'Local skin'))!;
        const restoredDirectory = join(state.userData, 'restored');
        await copyModBackupTo(backup.id, join(restoredDirectory, 'restored_dir.vpk'));
        expect((await fs.readdir(restoredDirectory)).sort()).toEqual(['restored_000.vpk', 'restored_001.VPK', 'restored_dir.vpk']);
        expect(await fs.readFile(join(restoredDirectory, 'restored_001.VPK'), 'utf8')).toBe('chunk one');
    });

    it('keeps backups readable when existing metadata uses uppercase SHA-256', async () => {
        const metadata = { modName: 'Skin', sha256: 'A'.repeat(64) };
        const backup = (await captureModBackup(sourcePath, metadata))!;

        expect(await listModBackups()).toEqual([backup]);
        const target = join(state.userData, 'restored_dir.vpk');
        expect((await copyModBackupTo(backup.id, target)).metadata).toEqual(metadata);
        expect(await fs.readFile(target, 'utf8')).toBe('original VPK bytes');
    });

    it.each([
        [{ archiveVpkPath: 'variants/old_skin_dir.vpk', sourceFileName: 'download.zip' }, 'old_skin_dir.vpk'],
        [{ archiveVpkPath: 'variants\\old_skin_dir.vpk', sourceFileName: 'download.zip' }, 'old_skin_dir.vpk'],
        [{ sourceFileName: 'old_download.zip' }, 'old_download.zip'],
        [{}, 'old_skin_dir.vpk'],
    ])('preserves the useful original filename for menus: %j', async (metadata, displayFileName) => {
        const backup = (await captureModBackup(sourcePath, metadata))!;
        expect(backup.displayFileName).toBe(displayFileName);
        expect(backup.fileName).toBe('old_skin_dir.vpk');
        expect((await listModBackups())[0].displayFileName).toBe(displayFileName);
        await copyModBackupTo(backup.id, join(state.userData, 'restored_dir.vpk'));
        expect(await fs.readFile(join(state.userData, 'restored_dir.vpk'), 'utf8')).toBe('original VPK bytes');
    });

    it('cleans abandoned captures after a day with capture off and preserves fresh or unrelated folders', async () => {
        state.keepModBackups = false;
        const root = join(state.userData, 'mod-backups');
        const abandoned = join(root, `.pending-${randomUUID()}`);
        const freshName = `.pending-${randomUUID()}`;
        const untouched = [freshName, '.pending-not-a-uuid', 'unrelated-folder'];
        await fs.mkdir(abandoned, { recursive: true });
        await fs.writeFile(join(abandoned, 'unfinished_dir.vpk'), 'unfinished bytes');
        const yesterday = new Date(Date.now() - MOD_BACKUP_RETENTION_MS - 1_000);
        await fs.utimes(abandoned, yesterday, yesterday);
        for (const name of untouched) {
            const path = join(root, name);
            await fs.mkdir(path);
            if (name !== freshName) await fs.utimes(path, yesterday, yesterday);
        }
        await cleanupExpiredModBackups();
        expect(await listModBackups()).toEqual([]);
        expect((await fs.readdir(root)).sort()).toEqual(untouched.sort());
    });

    it('removes expired backups at startup even after capture is disabled', async () => {
        const backup = (await captureModBackup(sourcePath, undefined))!;
        state.keepModBackups = false;
        vi.spyOn(Date, 'now').mockReturnValue(backup.expiresAt);
        await cleanupExpiredModBackups();
        expect(await listModBackups()).toEqual([]);
        expect(await fs.readdir(join(state.userData, 'mod-backups'))).toEqual([]);
    });

    it('keeps expired backups available for listing, capture and restore until startup cleanup', async () => {
        const backup = (await captureModBackup(sourcePath, undefined))!;
        vi.spyOn(Date, 'now').mockReturnValue(backup.expiresAt + 1);
        expect(await listModBackups()).toEqual([backup]);
        const newer = (await captureModBackup(sourcePath, undefined))!;
        const target = join(state.userData, 'restored_dir.vpk');
        await copyModBackupTo(backup.id, target);
        expect(await fs.readFile(target, 'utf8')).toBe('original VPK bytes');
        expect(await listModBackups()).toEqual([newer, backup]);
        await cleanupExpiredModBackups();
        expect(await listModBackups()).toEqual([newer]);
        expect(await fs.readFile(target, 'utf8')).toBe('original VPK bytes');
    });

    it('does not overwrite a live file or orphaned chunk', async () => {
        const backup = (await captureModBackup(sourcePath, undefined))!;
        await expect(copyModBackupTo(backup.id, sourcePath)).rejects.toThrow('already occupies');
        expect(await fs.readFile(sourcePath, 'utf8')).toBe('original VPK bytes');
        const target = join(state.userData, 'new_dir.vpk');
        await fs.writeFile(join(state.userData, 'new_009.vpk'), 'belongs to another set');
        await expect(copyModBackupTo(backup.id, target)).rejects.toThrow('already occupies');
        await expect(fs.stat(target)).rejects.toMatchObject({ code: 'ENOENT' });
    });

    it('verifies hashes before exposing any restored files', async () => {
        await fs.writeFile(join(state.userData, 'source', 'old_skin_000.vpk'), 'chunk zero');
        const backup = (await captureModBackup(sourcePath, undefined))!;
        await fs.writeFile(join(state.userData, 'mod-backups', backup.id, 'old_skin_000.vpk'), 'corruption');
        const directory = join(state.userData, 'restored');
        await expect(copyModBackupTo(backup.id, join(directory, 'new_dir.vpk'))).rejects.toThrow('integrity');
        expect(await fs.readdir(directory)).toEqual([]);
    });

    it('rolls back only files created by a partially failed restore', async () => {
        await fs.writeFile(join(state.userData, 'source', 'old_skin_000.vpk'), 'chunk zero');
        const backup = (await captureModBackup(sourcePath, undefined))!;
        const directory = join(state.userData, 'restored');
        const target = join(directory, 'new_dir.vpk');
        const originalCopy = fs.copyFile.bind(fs);
        vi.spyOn(fs, 'copyFile').mockImplementation(async (from, to, mode) => {
            if (to === target) await fs.writeFile(target, 'new competing file');
            await originalCopy(from, to, mode);
        });
        await expect(copyModBackupTo(backup.id, target)).rejects.toMatchObject({ code: 'EEXIST' });
        expect(await fs.readdir(directory)).toEqual(['new_dir.vpk']);
        expect(await fs.readFile(target, 'utf8')).toBe('new competing file');
    });

    it('cleans up an unsuccessful capture and lets later operations proceed', async () => {
        const sourceDirectory = join(state.userData, 'source');
        await fs.mkdir(join(sourceDirectory, 'old_skin_000.vpk'));
        await expect(captureModBackup(sourcePath, undefined)).rejects.toThrow('regular file');
        expect(await fs.readdir(join(state.userData, 'mod-backups'))).toEqual([]);
        await fs.rmdir(join(sourceDirectory, 'old_skin_000.vpk'));
        expect(await captureModBackup(sourcePath, undefined)).not.toBeNull();
        expect(await listModBackups()).toHaveLength(1);
    });

    it('rejects path traversal in IDs and manifest payload names', async () => {
        const backup = (await captureModBackup(sourcePath, undefined))!;
        await expect(deleteModBackup('../source')).rejects.toThrow('Invalid mod backup ID');
        await expect(copyModBackupTo('../source', sourcePath)).rejects.toThrow('Invalid mod backup ID');
        const manifestPath = join(state.userData, 'mod-backups', backup.id, 'manifest.json');
        const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
        manifest.files[0].name = '../source/old_skin_dir.vpk';
        await fs.writeFile(manifestPath, JSON.stringify(manifest));
        await expect(copyModBackupTo(backup.id, sourcePath)).rejects.toThrow('Invalid mod backup file');
        expect(await fs.readFile(sourcePath, 'utf8')).toBe('original VPK bytes');
    });

    it('deletes one backup without changing the source or other versions', async () => {
        const first = (await captureModBackup(sourcePath, undefined))!;
        const second = (await captureModBackup(sourcePath, undefined))!;
        await deleteModBackup(first.id);
        await deleteModBackup(first.id);
        expect((await listModBackups()).map((backup) => backup.id)).toEqual([second.id]);
        expect(await fs.readFile(sourcePath, 'utf8')).toBe('original VPK bytes');
    });

    it('notifies only after committed changes, including expiry', async () => {
        const listener = vi.fn();
        unsubscribe = observeModBackupChanges(listener);
        state.keepModBackups = false;
        await captureModBackup(sourcePath, undefined);
        expect(listener).not.toHaveBeenCalled();
        state.keepModBackups = true;
        const first = (await captureModBackup(sourcePath, undefined))!;
        const second = (await captureModBackup(sourcePath, undefined))!;
        expect(listener).toHaveBeenCalledTimes(2);
        await copyModBackupTo(first.id, join(state.userData, 'restored_dir.vpk'));
        expect(listener).toHaveBeenCalledTimes(2);
        await deleteModBackup(first.id);
        expect(listener).toHaveBeenCalledTimes(3);
        vi.spyOn(Date, 'now').mockReturnValue(second.expiresAt);
        await cleanupExpiredModBackups();
        expect(listener).toHaveBeenCalledTimes(4);
    });

    it('preserves backups that expire during a session until the next startup cleanup', async () => {
        const first = (await captureModBackup(sourcePath, undefined))!;
        state.keepModBackups = false;
        vi.useFakeTimers();
        vi.setSystemTime(first.expiresAt - 30_000);
        await cleanupExpiredModBackups();
        await vi.advanceTimersByTimeAsync(MOD_BACKUP_RETENTION_MS);
        expect(await listModBackups()).toEqual([first]);
        expect(await fs.readdir(join(state.userData, 'mod-backups'))).toEqual([first.id]);
        await cleanupExpiredModBackups();
        expect(await fs.readdir(join(state.userData, 'mod-backups'))).toEqual([]);
    });

    it('keeps backup identities stable through renames and slot changes', () => {
        expect(getModBackupIdentity({ localGroupId: 'a' }, 'pak01_dir.vpk')).toBe('local:a');
        expect(getModBackupIdentity({ gameBananaId: 12 }, 'pak01_dir.vpk')).toBe('gamebanana:Mod:12');
        expect(getModBackupIdentity({ gameBananaId: 12, sourceSection: 'Sound' }, 'pak02_dir.vpk')).toBe('gamebanana:Sound:12');
        expect(getModBackupIdentity({ modName: 'Local skin' }, 'pak01_dir.vpk')).toBe(getModBackupIdentity(undefined, 'pak02_dir.vpk', 'Local skin'));
    });
});
