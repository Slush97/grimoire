import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
    handlers: new Map<string, (...args: unknown[]) => Promise<unknown>>(), sender: {},
    approve: vi.fn(), enable: vi.fn(), audit: vi.fn(), update: vi.fn(),
    snapshot: { report: { fingerprint: 'a'.repeat(64) }, trusted: true },
}));
vi.mock('electron', () => ({ ipcMain: { handle: (name: string, handler: (...args: unknown[]) => Promise<unknown>) => h.handlers.set(name, handler) } }));
vi.mock('../index', () => ({ getMainWindow: () => ({ webContents: h.sender }) }));
vi.mock('../services/settings', () => ({ getActiveDeadlockPath: () => 'game' }));
vi.mock('../services/modSafety', () => ({
    getModSafetyPrompts: vi.fn(), respondToModSafety: vi.fn(),
    approveVpkSafety: h.approve, modSafetySnapshot: () => h.snapshot,
}));
vi.mock('../services/modSafetyAudit', () => ({
    auditInstalledSafety: h.audit, installedSafetyStatus: vi.fn(), installedSafetyRunning: vi.fn(), installedSafetyFailed: vi.fn(),
    updateInstalledSafety: h.update,
}));
vi.mock('../services/mods', () => ({
    scanMods: async () => [{ id: 'disabled', path: 'disabled.vpk' }], enableMod: h.enable,
}));
import './modSafety';

beforeEach(() => {
    vi.clearAllMocks();
    h.approve.mockResolvedValue(false);
    h.enable.mockResolvedValue({ id: 'enabled', path: 'pak01.vpk', name: 'Test', enabled: true });
});
describe('inline mod approval', () => {
    it('returns the enabled mod and updates only its status without auditing the library', async () => {
        const result = await h.handlers.get('review-mod-safety')!({ sender: h.sender }, 'disabled', 'a'.repeat(64));
        expect(h.approve).toHaveBeenCalledWith('disabled.vpk', 'a'.repeat(64));
        expect(h.enable).toHaveBeenCalledWith('game', 'disabled');
        expect(h.update).toHaveBeenCalledWith('disabled', { modId: 'enabled', name: 'Test', enabled: true, ...h.snapshot });
        expect(result).toMatchObject({ id: 'enabled', safety: h.snapshot });
        expect(h.audit).not.toHaveBeenCalled();
    });
    it('leaves activation to an operation that was waiting on the approved version', async () => {
        h.approve.mockResolvedValue(true);
        const result = await h.handlers.get('review-mod-safety')!({ sender: h.sender }, 'disabled', 'a'.repeat(64));
        expect(h.enable).not.toHaveBeenCalled();
        expect(result).toMatchObject({ id: 'disabled', safety: h.snapshot });
    });
    it('does not enable or update a mod whose reviewed content changed', async () => {
        h.approve.mockRejectedValue(new Error('MOD_SAFETY_CHANGED'));
        await expect(h.handlers.get('review-mod-safety')!({ sender: h.sender }, 'disabled', 'a'.repeat(64))).rejects.toThrow('MOD_SAFETY_CHANGED');
        expect(h.enable).not.toHaveBeenCalled();
        expect(h.update).not.toHaveBeenCalled();
        expect(h.audit).not.toHaveBeenCalled();
    });
    it('rejects decisions from another renderer', async () => {
        await expect(h.handlers.get('review-mod-safety')!({ sender: {} }, 'disabled', 'a'.repeat(64))).rejects.toThrow('Invalid mod');
        expect(h.approve).not.toHaveBeenCalled();
    });
});
