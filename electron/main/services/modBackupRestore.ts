import { randomInt } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { basename, join } from 'node:path';
import { copyModBackupTo, deleteModBackup, getModBackupSummary } from './modBackups';
import { getDisabledPath, metaKeyFor, peekModFolders } from './deadlock';
import { removeModMetadata, setModMetadataWithHash } from './metadata';
import { assertVpkSafety, forgetSafetySnapshot } from './modSafety';
import { healModFolders, runExclusiveModMutation } from './mods';
import { getActiveDeadlockPath, loadSettings } from './settings';
import { findChunkSiblingNames } from './vpk';

async function restoreFileName(deadlockPath: string, original: string): Promise<string> {
    // Enabled and disabled base files share metadata keys, so reserve both.
    const { enabledRoots, disabledPath } = peekModFolders(deadlockPath);
    const taken = new Set<string>();
    for (const folder of [...enabledRoots, disabledPath]) {
        const names = await fs.readdir(folder).catch((error: NodeJS.ErrnoException) => {
            if (error.code === 'ENOENT') return [];
            throw error;
        });
        for (const name of names) taken.add(name.toLowerCase());
    }
    const extension = original.slice(/_dir\.vpk$/i.test(original) ? -8 : -4);
    const stem = original.slice(0, -extension.length);
    const siblings = [...taken];
    let name = original;
    while (taken.has(name.toLowerCase()) || findChunkSiblingNames(name, siblings).length > 0) {
        const suffix = randomInt(36 ** 5).toString(36).padStart(5, '0');
        name = `${stem}_${suffix}${extension}`;
    }
    return name;
}

/** Restore a retained file as a separate disabled install, preserving its provenance. */
export function restoreModBackup(deadlockPath: string, backupId: string): Promise<void> {
    const devMode = loadSettings().devMode;
    return runExclusiveModMutation(async () => {
        // Check before healing, since a mode switch also changes the sidecar.
        if (getActiveDeadlockPath() !== deadlockPath || loadSettings().devMode !== devMode) {
            throw new Error('MOD_BACKUP_INSTALL_CHANGED');
        }
        await healModFolders(deadlockPath);
        const folder = getDisabledPath(deadlockPath);
        await fs.mkdir(folder, { recursive: true });
        const backup = await getModBackupSummary(backupId);
        const destination = join(folder, await restoreFileName(deadlockPath, backup.fileName));
        const metaKey = metaKeyFor(destination);
        let copied = false;
        try {
            const { metadata, summary } = await copyModBackupTo(backupId, destination);
            copied = true;
            await assertVpkSafety(destination, { prompt: false, allowUntrusted: true });
            removeModMetadata(metaKey);
            await setModMetadataWithHash(metaKey, {
                ...metadata,
                modName: metadata.modName || summary.modName,
            }, destination);
        } catch (error) {
            if (copied) {
                const chunks = findChunkSiblingNames(basename(destination), await fs.readdir(folder));
                await fs.unlink(destination).catch(() => {});
                for (const chunk of chunks) await fs.unlink(join(folder, chunk)).catch(() => {});
                forgetSafetySnapshot(destination);
                removeModMetadata(metaKey);
            }
            throw error;
        }
        // Keep the committed restore if deleting the saved backup fails.
        await deleteModBackup(backupId);
    });
}
