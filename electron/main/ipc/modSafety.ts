import { ipcMain } from 'electron';
import { getMainWindow } from '../index';
import { getActiveDeadlockPath } from '../services/settings';
import { getModSafetyPrompts, respondToModSafety, inspectVpkSafety, isModSafetyTrusted, approveVpkSafety, modSafetySnapshot } from '../services/modSafety';
import { auditInstalledSafety, installedSafetyStatus, installedSafetyRunning, installedSafetyFailed, updateInstalledSafety } from '../services/modSafetyAudit';
import { enableMod, scanMods } from '../services/mods';

ipcMain.handle('get-mod-safety-prompts', () => getModSafetyPrompts());
ipcMain.handle('respond-mod-safety', (event, id: unknown, accepted: unknown) => {
    if (event.sender !== getMainWindow()?.webContents || typeof id !== 'string' || typeof accepted !== 'boolean') {
        throw new Error('Invalid mod safety decision');
    }
    respondToModSafety(id, accepted);
});
ipcMain.handle('get-installed-mod-safety', () => ({ mods: installedSafetyStatus(), running: installedSafetyRunning(), failed: installedSafetyFailed() }));
ipcMain.handle('inspect-mod-safety', async (_event, modId: unknown) => {
    if (typeof modId !== 'string') throw new Error('Invalid mod');
    const path = getActiveDeadlockPath();
    if (!path) throw new Error('No Deadlock path configured');
    const mod = (await scanMods(path)).find(m => m.id === modId);
    if (!mod) throw new Error('Mod not found');
    const report = await inspectVpkSafety(mod.path);
    return { report, trusted: await isModSafetyTrusted(report) };
});
ipcMain.handle('rescan-mod-safety', async () => {
    const path = getActiveDeadlockPath();
    if (!path) return [];
    return auditInstalledSafety(path);
});
ipcMain.handle('review-mod-safety', async (event, modId: string, fingerprint: string) => {
    if (event.sender !== getMainWindow()?.webContents || typeof modId !== 'string' || typeof fingerprint !== 'string') throw new Error('Invalid mod');
    const path = getActiveDeadlockPath();
    if (!path) throw new Error('No Deadlock path configured');
    const mod = (await scanMods(path)).find(m => m.id === modId);
    if (!mod) throw new Error('Mod not found');
    await approveVpkSafety(mod.path, fingerprint);
    const enabled = await enableMod(path, modId);
    const safety = modSafetySnapshot(enabled.path);
    if (safety) updateInstalledSafety(modId, { modId: enabled.id, name: enabled.name, enabled: enabled.enabled, ...safety });
    return { ...enabled, safety };
});
