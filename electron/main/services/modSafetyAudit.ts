import { promises as fs } from 'node:fs';
import { join, basename } from 'node:path';
import { randomUUID } from 'node:crypto';
import { getDisabledPath, getModScanRootPaths } from './deadlock';
import { scanMods, disableModUnlocked, runExclusiveModMutation } from './mods';
import { isDeadlockRunning } from './launch';
import { getModMetadata } from './metadata';
import { inspectVpkSafety, isModSafetyTrusted, announceUnsafeMod, assertVpkSafety, moveSafetySnapshot, notifyModSafetyChanged } from './modSafety';
import type { InstalledModSafety } from '../../../src/types/modSafety';

let status: InstalledModSafety[] = [];
let auditing: Promise<InstalledModSafety[]> | null = null;
let failed = false;
export function installedSafetyStatus(): InstalledModSafety[] { return status; }
export function installedSafetyRunning(): boolean { return auditing !== null; }
export function installedSafetyFailed(): boolean { return failed; }
export function updateInstalledSafety(previousId: string, updated: InstalledModSafety): void {
    status = status.map(item => item.modId === previousId ? { ...updated, name: item.name } : item);
    notifyModSafetyChanged();
}

async function candidates(root: string): Promise<string[]> {
    let names: string[];
    try { names = await fs.readdir(root); }
    catch (err) { if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []; throw err; }
    const dirs = new Set(names.filter(n => /_dir\.vpk$/i.test(n)).map(n => n.slice(0, -8).toLowerCase()));
    return names.filter(n => /\.vpk$/i.test(n) && !(/_\d{3}\.vpk$/i.test(n) && dirs.has(n.slice(0, -8).toLowerCase())))
        .map(n => join(root, n));
}

/** Includes reserved/generated slots and hand-placed VPKs, irrespective of metadata. */
export async function assertActiveModsSafety(deadlockPath: string): Promise<void> {
    for (const root of getModScanRootPaths(deadlockPath)) {
        for (const path of await candidates(root)) await assertVpkSafety(path);
    }
}

export function auditInstalledSafety(deadlockPath: string): Promise<InstalledModSafety[]> {
    if (auditing) return auditing;
    failed = false;
    auditing = runExclusiveModMutation(async () => {
        const mods = await scanMods(deadlockPath);
        const byPath = new Map(mods.map(m => [m.path, m]));
        const disabled = getDisabledPath(deadlockPath);
        await fs.mkdir(disabled, { recursive: true });
        const results: InstalledModSafety[] = [];
        let noticeSent = false;
        // Snapshot candidates first so moving an enabled file into .disabled
        // cannot make it appear twice in this audit.
        const roots = [...getModScanRootPaths(deadlockPath), disabled];
        const files = await Promise.all(roots.map(async root => ({ root, paths: await candidates(root) })));
        for (const { root, paths } of files) {
            for (let path of paths) {
                let mod = byPath.get(path);
                const name = (mod && getModMetadata(mod.metaKey)?.modName) || mod?.name || basename(path);
                let enabled = root !== disabled;
                const report = await inspectVpkSafety(path);
                const trusted = await isModSafetyTrusted(report);
                if (enabled && !trusted) {
                    const running = await isDeadlockRunning();
                    if (!running) {
                        try {
                            if (mod) { mod = await disableModUnlocked(deadlockPath, mod.id); path = mod.path; }
                            else {
                                // Unknown/reserved slots also leave the engine's search paths.
                                const dest = join(disabled, `safety_${randomUUID()}_${basename(path)}`);
                                await fs.rename(path, dest);
                                moveSafetySnapshot(path, dest);
                                path = dest;
                            }
                            enabled = false;
                        } catch { /* Retain the enabled flag; the launch gate still refuses it. */ }
                    }
                    if (!noticeSent) {
                        announceUnsafeMod(name, report, running || enabled);
                        noticeSent = true;
                    }
                }
                if (report.verdict !== 'no-findings') results.push({
                    modId: mod?.id ?? '', name, enabled, trusted, report,
                });
            }
        }
        status = results;
        notifyModSafetyChanged();
        return results;
    }).catch(err => { failed = true; throw err; })
        .finally(() => { auditing = null; notifyModSafetyChanged(); });
    notifyModSafetyChanged();
    return auditing;
}
