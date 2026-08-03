import { promises as fs } from 'fs';
import { join } from 'path';
import {
    getDisabledPath,
    getModScanRootPaths,
    isReservedPriorityVpkPath,
    metaKeyFor,
} from './deadlock';

/** A user-installed directory VPK found in an enabled root or .disabled. */
export interface InstalledUserVpk {
    fileName: string;
    path: string;
    metaKey: string;
    enabled: boolean;
}

/**
 * List every user-installed directory VPK, regardless of placement.
 *
 * This is the inventory view shared by features that inspect source VPKs
 * (metadata identity, Locker cards/sounds/portraits). It deliberately differs
 * from getAddonFolderPaths, which is allocation-only and must never hand out
 * slots in citadel/grimoire.
 *
 * The priority root also contains Locker-managed artifacts in pak01-pak04.
 * Those use synthetic metadata keys and are not user mods, so they are filtered
 * once here rather than at every consumer.
 */
export async function listInstalledUserVpks(deadlockPath: string): Promise<InstalledUserVpk[]> {
    const roots: Array<{ path: string; enabled: boolean }> = [
        ...getModScanRootPaths(deadlockPath).map((path) => ({ path, enabled: true })),
        { path: getDisabledPath(deadlockPath), enabled: false },
    ];
    const vpks: InstalledUserVpk[] = [];

    for (const root of roots) {
        const entries = await fs.readdir(root.path, { withFileTypes: true }).catch(() => []);
        for (const entry of entries) {
            if (!entry.isFile() || !entry.name.toLowerCase().endsWith('_dir.vpk')) continue;
            const path = join(root.path, entry.name);
            if (isReservedPriorityVpkPath(path)) continue;
            vpks.push({
                fileName: entry.name,
                path,
                metaKey: metaKeyFor(path),
                enabled: root.enabled,
            });
        }
    }

    return vpks;
}
