import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ModMetadata } from '../services/metadata';
import type { Mod } from '../services/mods';

const h = vi.hoisted(() => ({
    handlers: new Map<string, (...args: unknown[]) => Promise<unknown>>(),
    path: '/normal', devMode: false, locked: false,
    lockGate: null as Promise<void> | null,
    metadata: new Map<string, ModMetadata>(),
    scan: vi.fn(), heal: vi.fn(), enterLock: vi.fn(), write: vi.fn(), refresh: vi.fn(), download: vi.fn(), remove: vi.fn(), enable: vi.fn(),
}));
vi.mock('electron', () => ({
    ipcMain: { handle: (name: string, handler: (...args: unknown[]) => Promise<unknown>) => h.handlers.set(name, handler) },
}));
vi.mock('../index', () => ({ getMainWindow: () => null }));
vi.mock('../services/settings', () => ({
    loadSettings: () => ({ devMode: h.devMode }),
    getActiveDeadlockPath: () => h.path,
}));
vi.mock('../services/mods', () => ({
    scanMods: h.scan,
    healModFolders: h.heal,
    runExclusiveModMutation: async (operation: () => Promise<unknown>) => {
        h.enterLock();
        if (h.lockGate) await h.lockGate;
        expect(h.locked).toBe(false);
        h.locked = true;
        try { return await operation(); }
        finally { h.locked = false; }
    },
    deleteModsUnlocked: h.remove,
    enableModUnlocked: h.enable,
}));
vi.mock('../services/metadata', () => ({
    getModMetadata: (key: string) => h.metadata.get(key),
    setModMetadataWithHash: h.write,
}));
vi.mock('../services/modReplacement', () => ({ refreshEmbedAfterMetadataChange: h.refresh }));
vi.mock('../services/download', () => ({ downloadMod: h.download }));
vi.mock('../services/vpk', () => ({ GLOBAL_CLASSIFIER_VERSION: 4 }));
vi.mock('../services/modSafety', () => ({ modSafetySnapshot: () => undefined }));
vi.mock('../services/vdataCheck', () => ({ outdatedVdataSnapshot: () => undefined, staleModelsSnapshot: () => undefined }));
vi.mock('../services/attachmentHeal', () => ({}));
vi.mock('../services/importDisabledVpk', () => ({}));
vi.mock('../services/deadlock', () => ({}));
vi.mock('../services/abilitySounds', () => ({}));
vi.mock('../services/modChangeObservation', () => ({}));
vi.mock('../services/conflicts', () => ({}));
vi.mock('../services/lockerVpk', () => ({}));
vi.mock('../services/profiles', () => ({}));
vi.mock('../services/unknownModDetection', () => ({}));
vi.mock('../services/adoptedThumbnail', () => ({}));
vi.mock('../services/modDatabase', () => ({}));
vi.mock('../services/extract', () => ({}));
vi.mock('../services/importVariantGroups', () => ({}));
vi.mock('../services/localImportTransaction', () => ({}));
vi.mock('../services/modMerger', () => ({}));
vi.mock('../services/imprintMods', () => ({}));
vi.mock('../services/vpkIdentity', () => ({}));
vi.mock('../services/modinfoFormat', () => ({}));
vi.mock('../services/foundryCatalog', () => ({}));
vi.mock('../services/soulContainerImport', () => ({}));
vi.mock('../services/spiritUrnImport', () => ({}));
vi.mock('../services/soulContainerModels', () => ({}));
vi.mock('../services/foundryExport', () => ({}));
vi.mock('../services/localVariantGroup', () => ({}));
import './mods';

const source: Mod = {
    id: 'unknown', metaKey: 'pak01_dir.vpk', fileName: 'pak01_dir.vpk',
    name: 'Unknown', path: '/normal/pak01_dir.vpk', enabled: true,
    size: 100, installedAt: '2026-10-18T00:00:00.000Z', priority: 1,
};
const replacement = { ...source, id: 'replacement', metaKey: 'fresh_dir.vpk', fileName: 'fresh_dir.vpk', enabled: false };
const match = { gameBananaId: 7, gameBananaFileId: 20, sourceFileName: 'fresh.zip', modName: 'Matched mod' };
const invoke = (channel: string, args: unknown) => h.handlers.get(channel)!({}, source.id, args);
function deferred() {
    let resolve!: () => void;
    const promise = new Promise<void>((done) => { resolve = done; });
    return { promise, resolve };
}

beforeEach(() => {
    vi.clearAllMocks();
    h.path = '/normal';
    h.devMode = false;
    h.locked = false;
    h.lockGate = null;
    h.metadata.clear();
    h.metadata.set(source.metaKey, { globalType: null, globalTypeClassifierVersion: 4, abilitySounds: null });
    h.metadata.set(replacement.metaKey, { modName: 'Matched mod', globalType: null, globalTypeClassifierVersion: 4, abilitySounds: null });
    h.scan.mockResolvedValue([source]);
    h.heal.mockImplementation(async () => { expect(h.locked).toBe(true); });
    h.write.mockImplementation(async (key: string, patch: ModMetadata) => {
        expect(h.locked).toBe(true);
        h.metadata.set(key, { ...h.metadata.get(key), ...patch });
    });
    h.refresh.mockImplementation(async () => { expect(h.locked).toBe(false); });
    h.download.mockResolvedValue({ installedVpks: [replacement.fileName] });
    h.remove.mockImplementation(async () => {
        expect(h.locked).toBe(true);
        return { skipped: [] };
    });
    h.enable.mockImplementation(async () => {
        expect(h.locked).toBe(true);
        return { ...replacement, enabled: true };
    });
});

describe.each([
    ['apply-unknown-custom-mod', { name: 'Custom identity' }],
    ['associate-unknown-mod', { gameBananaId: 7, modName: 'Linked identity' }],
])('%s installation isolation', (channel, args) => {
    it('writes identity while locked and refreshes the imprint after releasing the lock', async () => {
        const updated = await invoke(channel, args);
        expect(h.write).toHaveBeenCalledOnce();
        expect(h.refresh).toHaveBeenCalledWith('/normal', source.id, source.metaKey, source.path);
        expect(updated).toMatchObject({ id: source.id, name: 'name' in args ? args.name : args.modName });
    });

    it.each(['mode', 'path'])('refuses a changed %s before scanning or writing after waiting for the lock', async (change) => {
        const gate = deferred();
        h.lockGate = gate.promise;
        const pending = invoke(channel, args);
        if (change === 'mode') h.devMode = true;
        else h.path = '/different';
        gate.resolve();

        await expect(pending).rejects.toThrow('active installation changed');
        expect(h.scan).not.toHaveBeenCalled();
        expect(h.write).not.toHaveBeenCalled();
        expect(h.refresh).not.toHaveBeenCalled();
    });
});

describe('apply-unknown-mod-match installation isolation', () => {
    it('refuses a changed installation during the initial scan before enqueueing a download', async () => {
        h.scan.mockImplementationOnce(async () => {
            h.devMode = true;
            return [source];
        });
        await expect(invoke('apply-unknown-mod-match', match)).rejects.toThrow('active installation changed');
        expect(h.download).not.toHaveBeenCalled();
        expect(h.remove).not.toHaveBeenCalled();
    });

    it('keeps the predecessor if the installation changes before download completion is handled', async () => {
        h.download.mockImplementationOnce(async () => {
            h.devMode = true;
            return { installedVpks: [replacement.fileName] };
        });
        await expect(invoke('apply-unknown-mod-match', match)).rejects.toThrow('active installation changed');
        expect(h.remove).not.toHaveBeenCalled();
        expect(h.enable).not.toHaveBeenCalled();
    });

    it('checks the path again after waiting for finalization before healing or removing the predecessor', async () => {
        const gate = deferred();
        h.download.mockImplementationOnce(async () => {
            h.lockGate = gate.promise;
            return { installedVpks: [replacement.fileName] };
        });
        const pending = invoke('apply-unknown-mod-match', match);
        await vi.waitFor(() => expect(h.enterLock).toHaveBeenCalledOnce());
        h.path = '/different';
        gate.resolve();

        await expect(pending).rejects.toThrow('active installation changed');
        expect(h.heal).not.toHaveBeenCalled();
        expect(h.remove).not.toHaveBeenCalled();
    });

    it('finalizes deletion, enabling and metadata enrichment under one mutation lock', async () => {
        h.scan.mockResolvedValue([source, replacement]);
        await expect(invoke('apply-unknown-mod-match', match)).resolves.toMatchObject({ id: replacement.id });
        expect(h.remove).toHaveBeenCalledWith('/normal', [source]);
        expect(h.enable).toHaveBeenCalledWith('/normal', replacement.id);
    });
});
