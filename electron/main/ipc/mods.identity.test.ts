import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ModMetadata } from '../services/metadata';
import type { Mod } from '../services/mods';

const h = vi.hoisted(() => ({
    handlers: new Map<string, (...args: unknown[]) => Promise<unknown>>(),
    path: '/normal', devMode: false, locked: false,
    lockGate: null as Promise<void> | null,
    metadata: new Map<string, ModMetadata>(),
    ignoredConflicts: [] as string[],
    reorder: vi.fn(), priority: vi.fn(), swap: vi.fn(), migrateConflicts: vi.fn(), saveSettings: vi.fn(),
    scan: vi.fn(), parse: vi.fn(), heal: vi.fn(), enterLock: vi.fn(), write: vi.fn(), refresh: vi.fn(), download: vi.fn(), remove: vi.fn(), enable: vi.fn(),
    patch: vi.fn(), paths: vi.fn(), categoryPaths: vi.fn(), localHero: vi.fn(),
}));
vi.mock('electron', () => ({
    ipcMain: { handle: (name: string, handler: (...args: unknown[]) => Promise<unknown>) => h.handlers.set(name, handler) },
}));
vi.mock('../index', () => ({ getMainWindow: () => null }));
vi.mock('../services/settings', () => ({
    loadSettings: () => ({ devMode: h.devMode, ignoredConflicts: h.ignoredConflicts }),
    getActiveDeadlockPath: () => h.path,
    saveSettings: h.saveSettings,
}));
vi.mock('../services/mods', () => ({
    scanMods: h.scan,
    scanModsAfterMutations: h.scan,
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
    reorderMods: h.reorder,
    setModPriority: h.priority,
    swapModPriority: h.swap,
}));
vi.mock('../services/metadata', () => ({
    getModMetadata: (key: string) => h.metadata.get(key),
    setModMetadataWithHash: h.write,
    setModMetadata: h.patch,
}));
vi.mock('../services/modReplacement', async original => ({
    ...await original<typeof import('../services/modReplacement')>(), refreshEmbedAfterMetadataChange: h.refresh,
}));
vi.mock('../services/download', () => ({ downloadMod: h.download }));
vi.mock('../services/vpk', async original => ({
    ...await original<typeof import('../services/vpk')>(),
    parseVpkDirectoriesAsync: h.parse, parseVpkDirectoryCached: h.paths,
}));
vi.mock('../services/gamebanana', () => ({
    readCachedCategoryPaths: h.categoryPaths,
    fetchCategoryTreeCached: async () => [],
    observeCategoryTreeChanges: () => () => {},
}));
vi.mock('../services/modSafety', () => ({ modSafetySnapshot: () => undefined }));
vi.mock('../services/vdataCheck', () => ({ outdatedVdataSnapshot: () => undefined, staleModelsSnapshot: () => undefined,
    checkOutdatedVdata: () => {} }));
vi.mock('../services/attachmentHeal', () => ({}));
vi.mock('../services/importDisabledVpk', () => ({}));
vi.mock('../services/deadlock', () => ({}));
vi.mock('../services/abilitySounds', () => ({ classifyAbilitySoundsFromVpk: () => null }));
vi.mock('../services/modChangeObservation', () => ({ notifyModChanges: () => {} }));
vi.mock('../services/conflicts', () => ({ migrateIgnoredConflictKeysForMods: h.migrateConflicts }));
vi.mock('../services/lockerVpk', () => ({ isLockerManaged: () => false }));
vi.mock('../services/profiles', () => ({}));
vi.mock('../services/unknownModDetection', () => ({ inferHeroFromVpkTree: h.localHero }));
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
import './mods';
import { toLocalVariantGroupMember } from '../services/modReplacement';

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
    h.ignoredConflicts = [];
    h.reorder.mockResolvedValue(undefined);
    h.priority.mockResolvedValue(source);
    h.swap.mockResolvedValue(undefined);
    h.migrateConflicts.mockImplementation(keys => keys);
    h.metadata.clear();
    h.metadata.set(source.metaKey, { globalType: null, globalTypeClassifierVersion: 4, abilitySounds: null });
    h.metadata.set(replacement.metaKey, { modName: 'Matched mod', globalType: null, globalTypeClassifierVersion: 4, abilitySounds: null });
    h.scan.mockResolvedValue([source]);
    h.parse.mockResolvedValue(undefined);
    h.paths.mockReturnValue([]);
    h.localHero.mockReturnValue(null);
    h.categoryPaths.mockReturnValue(undefined);
    h.patch.mockImplementation((key: string, patch: ModMetadata) => {
        h.metadata.set(key, { ...h.metadata.get(key), ...patch });
    });
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

describe('library enrichment installation isolation', () => {
    it('does not classify unrelated cold files while creating a local group under the mutation lock', async () => {
        const peer = { ...source, id: 'peer', metaKey: 'peer.vpk', fileName: 'peer.vpk', path: '/normal/peer.vpk' };
        const unrelated = { ...source, id: 'unrelated', metaKey: 'unrelated.vpk', fileName: 'unrelated.vpk', path: '/normal/unrelated.vpk' };
        h.scan.mockResolvedValue([source, peer, unrelated]);
        for (const mod of [source, peer]) h.metadata.set(mod.metaKey, {
            modName: 'My pack', lockerHero: 'Ivy', lockerHeroSource: 'manual', abilitySounds: null, sha256: 'a'.repeat(64),
        });
        h.metadata.set(unrelated.metaKey, { modName: 'Cold local file', abilitySounds: null });
        h.paths.mockImplementation((path: string) => {
            if (h.locked) expect(path).not.toBe(unrelated.path);
            return [];
        });
        await expect(h.handlers.get('set-local-variant-group')!({}, [source.id, peer.id], { mode: 'mint' })).resolves.toBeDefined();
    });

    it('does not resolve payload classifications when clearing local group membership', async () => {
        const peer = { ...source, id: 'peer', metaKey: 'peer.vpk', fileName: 'peer.vpk', path: '/normal/peer.vpk' };
        h.scan.mockResolvedValue([source, peer]);
        for (const mod of [source, peer]) h.metadata.set(mod.metaKey, { modName: 'Local pack', localGroupId: 'group', abilitySounds: null });
        h.paths.mockImplementation(() => {
            expect(h.locked).toBe(false);
            return [];
        });
        await expect(h.handlers.get('set-local-variant-group')!({}, [source.id], { mode: 'clear' })).resolves.toBeDefined();
    });

    it('keeps named custom local skins visible through the same identity used by group checks', async () => {
        h.metadata.set(source.metaKey, { modName: 'Custom outfit', abilitySounds: null });
        h.localHero.mockReturnValue({ name: 'Ivy', strongestSignal: 'medium' });
        const mods = await h.handlers.get('get-mods')!({}) as Array<Mod & { lockerHeroes: string[] }>;
        expect(mods[0].lockerHeroes).toEqual(['Ivy']);
        expect(toLocalVariantGroupMember(source).resolvedHeroes).toEqual(mods[0].lockerHeroes);
        expect(h.localHero).toHaveBeenCalledTimes(1);
        await h.handlers.get('get-mods')!({});
        expect(h.localHero).toHaveBeenCalledTimes(1);
    });

    it.each([
        { globalType: 'hud' as const, lockerHero: 'Ivy', lockerHeroSource: 'manual' as const },
        { globalType: 'hud' as const, globalTypeSource: 'manual' as const, lockerHero: 'Ivy', lockerHeroSource: 'manual' as const },
        { globalType: 'hud' as const, lockerHero: 'Ivy', lockerHeroSource: 'vpk' as const },
    ])('uses the same manual/legacy precedence for display and local groups (%j)', async metadata => {
        h.metadata.set(source.metaKey, { ...metadata, modName: 'Local mod', abilitySounds: null });
        const mods = await h.handlers.get('get-mods')!({}) as Array<Mod & { lockerHeroes: string[]; globalType?: string }>;
        const member = toLocalVariantGroupMember(source);
        expect(member.resolvedHeroes).toEqual(mods[0].lockerHeroes);
        expect(member.resolvedGlobalType).toBe(mods[0].globalType);
        if (mods[0].globalType === 'hud') expect(h.paths).toHaveBeenCalled();
        else expect(h.paths).not.toHaveBeenCalled();
    });

    it('reads each cached category model once for a library batch, including absent trees', async () => {
        const other = { ...source, id: 'other', metaKey: 'other.vpk' };
        h.scan.mockResolvedValue([source, other]);
        for (const mod of [source, other]) h.metadata.set(mod.metaKey, {
            gameBananaId: 7, modName: 'Installed skin', categoryName: 'Skins > Ivy', abilitySounds: null,
        });
        const mods = await h.handlers.get('get-mods')!({}) as Array<Mod & { lockerHeroes: string[] }>;
        expect(mods.map(mod => mod.lockerHeroes)).toEqual([['Ivy'], ['Ivy']]);
        expect(h.categoryPaths).toHaveBeenCalledTimes(1);
    });

    it('captures developer mode before the initial inventory scan', async () => {
        h.scan.mockImplementationOnce(async () => {
            h.devMode = true;
            return [source];
        });
        await expect(h.handlers.get('get-mods')!({})).rejects.toThrow('active installation changed');
        expect(h.write).not.toHaveBeenCalled();
    });

    it('does not persist detection against another mode after worker parsing', async () => {
        h.metadata.set(source.metaKey, { sourceSection: 'Sound', abilitySounds: null });
        h.parse.mockImplementationOnce(async () => { h.devMode = true; });
        await expect(h.handlers.get('get-mods')!({})).rejects.toThrow('active installation changed');
        expect(h.parse).toHaveBeenCalledWith([source.path]);
        expect(h.write).not.toHaveBeenCalled();
    });
});

describe('rename conflict migration inventories', () => {
    beforeEach(() => {
        h.metadata.set(source.metaKey, { ...h.metadata.get(source.metaKey), lockerHeroVpkChecked: true });
    });

    it.each([
        ['reorder-mods', 1],
        ['set-mod-priority', 0],
        ['swap-mod-priority', 1],
    ] as const)('%s skips the migration scan without ignored conflicts', async (channel, responseScans) => {
        await h.handlers.get(channel)!({}, source.id, 2);

        expect(h.scan).toHaveBeenCalledTimes(responseScans);
        expect(h.migrateConflicts).not.toHaveBeenCalled();
    });

    it.each([
        ['reorder-mods', h.reorder, 2],
        ['set-mod-priority', h.priority, 1],
        ['swap-mod-priority', h.swap, 2],
    ] as const)('%s migrates existing ignored conflicts before renaming', async (channel, mutation, scans) => {
        h.ignoredConflicts = ['legacy conflict'];
        h.migrateConflicts.mockReturnValue(['stable conflict']);
        mutation.mockImplementation(async () => {
            expect(h.migrateConflicts).toHaveBeenCalledWith(['legacy conflict'], [source]);
            expect(h.saveSettings).toHaveBeenCalledWith(expect.objectContaining({ ignoredConflicts: ['stable conflict'] }));
            return source;
        });

        await h.handlers.get(channel)!({}, source.id, 2);

        expect(h.scan).toHaveBeenCalledTimes(scans);
        expect(mutation).toHaveBeenCalledOnce();
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
