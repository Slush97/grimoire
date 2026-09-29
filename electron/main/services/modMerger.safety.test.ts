/**
 * Safety gates inside merge flows: a declined source review must not strand a
 * half-restored unmerge, a refused rebuild must not leak its build temp or
 * claim a live slot, and a merge of trusted sources must not ask again.
 */
import { EventEmitter } from 'events';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const fsMocks = vi.hoisted(() => ({
    stat: vi.fn(async () => ({ size: 128 })),
    open: vi.fn(async (..._args: unknown[]) => ({
        read: vi.fn(async (buffer: Buffer) => {
            buffer.writeUInt32LE(0x55aa1234, 0);
            return { bytesRead: 4, buffer };
        }),
        close: vi.fn(async () => undefined),
    })),
    writeFile: vi.fn(async () => undefined),
    rename: vi.fn(async (..._args: unknown[]) => undefined),
    unlink: vi.fn(async (..._args: unknown[]) => undefined),
}));
vi.mock('fs', () => ({ promises: fsMocks, existsSync: vi.fn(() => true) }));

vi.mock('child_process', () => ({
    spawn: vi.fn(() => {
        const proc = new EventEmitter() as EventEmitter & {
            stdout: EventEmitter;
            stderr: EventEmitter;
            kill: () => void;
            killed: boolean;
        };
        proc.stdout = new EventEmitter();
        proc.stderr = new EventEmitter();
        proc.kill = () => undefined;
        proc.killed = false;
        setImmediate(() => proc.emit('close', 0));
        return proc;
    }),
}));
vi.mock('electron', () => ({
    app: { getVersion: () => '0.0.0-test', getAppPath: () => '/fake/app', isPackaged: false },
}));
vi.mock('./deadlock', () => ({ metaKeyFor: vi.fn((path: string) => path) }));
vi.mock('./settings', () => ({ loadSettings: vi.fn(() => ({})) }));

const modMocks = vi.hoisted(() => ({
    scanMods: vi.fn(),
    disableModUnlocked: vi.fn(),
    enableModUnlocked: vi.fn(),
    allocateEnabledVpkPath: vi.fn(async () => '/game/addons/pak11_dir.vpk'),
    runExclusiveModMutation: vi.fn(<T,>(fn: () => Promise<T>) => fn()),
}));
vi.mock('./mods', () => modMocks);

const metadataMocks = vi.hoisted(() => ({
    getModMetadata: vi.fn(),
    setModMetadata: vi.fn(),
    removeModMetadata: vi.fn(),
}));
vi.mock('./metadata', () => metadataMocks);
vi.mock('./vpkIdentity', () => ({
    resolveVpkIdentity: vi.fn(async (path: string) => ({ sha256: (path.match(/source-([a-c])/)?.[1] ?? 'x').repeat(64) })),
}));
vi.mock('./modinfoFormat', () => ({
    computeOriginalIdentity: vi.fn(async () => ({ sha256: 'f'.repeat(64), size: 4096, crc32: 'deadbeef' })),
    serializeAddonInfo: vi.fn(() => 'addoninfo-text'),
    serializeModinfo: vi.fn(() => 'modinfo-text'),
    hasLegacyGrimoireMergeMetaEntry: vi.fn(() => false),
    findImprintRepackMismatch: vi.fn(() => null),
    ADDONINFO_ENTRY: 'addoninfo.txt',
    MODINFO_ENTRY: 'modinfo.json',
    LEGACY_GRIMOIRE_META_ENTRY: 'grimoire_meta.json',
    MODINFO_FORMAT: 'vpk-modinfo',
    MODINFO_GAME: { name: 'Deadlock', steamAppId: 1422450, gameBananaGameId: 20948 },
    MODINFO_SCHEMA_VERSION: 1,
}));
vi.mock('./gameSessionMods', () => ({
    assertCanMoveLoadedGameMod: vi.fn(),
    assertCanMoveLoadedGameMods: vi.fn(),
    syncRunningGameModSnapshotFromMods: vi.fn(),
}));
vi.mock('./vpk', () => ({
    parseVpkDirectoryCached: vi.fn((path: string) => [`materials/${path.split('/').pop()}.vmat_c`]),
    parseVpkEntryStats: vi.fn(() => [{ path: 'materials/example.vmat_c', size: 12 }]),
}));
vi.mock('./portableProfile', () => ({ encodeShareCode: vi.fn(() => 'mp1:code') }));
const safetyMocks = vi.hoisted(() => ({
    assertVpkSafety: vi.fn(async (..._args: unknown[]) => {}),
    carryVpkSafety: vi.fn(async (..._args: unknown[]): Promise<'trusted' | 'untrusted' | 'differs'> => 'trusted'),
    moveSafetySnapshot: vi.fn(),
}));
vi.mock('./modSafety', () => safetyMocks);

import { addMergeSources, extractMergeSource, mergeMods, unmergeMod } from './modMerger';

const hash = (letter: string) => letter.repeat(64);
const target = {
    id: 'merge', name: 'HUD Pack', fileName: 'pak09_dir.vpk', path: '/game/addons/pak09_dir.vpk',
    metaKey: 'pak09_dir.vpk', enabled: true, priority: 9, size: 100, installedAt: '2026-01-01',
};
const source = (letter: string) => ({
    id: `source-${letter}`, name: `Source ${letter}`, fileName: `source-${letter}_dir.vpk`,
    path: `/game/addons/.disabled/source-${letter}_dir.vpk`, metaKey: `source-${letter}_dir.vpk`,
    enabled: false, priority: 50, size: 10, installedAt: '2026-01-01',
});
const enabled = (mod: ReturnType<typeof source>, slot: number) => ({
    ...mod, id: `${mod.id}-on`, enabled: true, priority: slot,
    fileName: `pak0${slot}_dir.vpk`, path: `/game/addons/pak0${slot}_dir.vpk`, metaKey: `pak0${slot}_dir.vpk`,
});
const [a, b, c] = ['a', 'b', 'c'].map(source);
const snapshot = (mod: ReturnType<typeof source>, priority: number) => ({
    fileName: mod.fileName, modName: mod.name, enabledAtMergeTime: true,
    priorityAtMergeTime: priority, sha256AtMergeTime: hash(mod.id.slice(-1)),
});
const keptDisabled = new Error('MOD_SAFETY_TRUST_REQUIRED: This version must be trusted before activation.');

function useMerge(sources: Array<ReturnType<typeof source>>): void {
    modMocks.scanMods.mockResolvedValue([target, ...sources]);
    metadataMocks.getModMetadata.mockImplementation((key: string) => {
        if (key === target.metaKey) {
            return {
                modName: target.name, sha256: hash('e'),
                merged: { id: 'm1', createdAt: '2026-01-01T00:00:00.000Z', shareCode: 'mp1:old',
                    sources: sources.map((mod, i) => snapshot(mod, i + 1)) },
            };
        }
        const mod = sources.find((candidate) => candidate.metaKey === key);
        return mod ? { sha256: hash(mod.id.slice(-1)) } : undefined;
    });
}

beforeEach(() => {
    vi.clearAllMocks();
    safetyMocks.carryVpkSafety.mockResolvedValue('trusted');
    safetyMocks.assertVpkSafety.mockResolvedValue(undefined);
    modMocks.enableModUnlocked.mockImplementation(async (_dl: string, id: string) => {
        if (id === b.id) throw keptDisabled;
        return enabled([a, b, c].find((mod) => mod.id === id)!, id === a.id ? 1 : 3);
    });
});

describe('unmerge with a source the user keeps disabled', () => {
    it('restores the others, leaves that one disabled and still removes the merge', async () => {
        useMerge([a, b, c]);

        const result = await unmergeMod('/game', target.id);

        expect(result.recovered).toEqual([enabled(a, 1), b, enabled(c, 3)]);
        expect(fsMocks.unlink).toHaveBeenCalledWith(target.path);
        expect(metadataMocks.removeModMetadata).toHaveBeenCalledWith(target.metaKey);
    });

    it('collapses an extract even when the survivor stays disabled', async () => {
        useMerge([a, b]);

        const result = await extractMergeSource('/game', target.id, a.fileName);

        expect(result).toEqual({ collapsed: true, merged: null, restored: [b, enabled(a, 1)] });
        expect(fsMocks.unlink).toHaveBeenCalledWith(target.path);
        expect(metadataMocks.removeModMetadata).toHaveBeenCalledWith(target.metaKey);
    });

    it('finishes a rebuild when the extracted source stays disabled', async () => {
        useMerge([b, a, c]);

        const result = await extractMergeSource('/game', target.id, b.fileName);

        expect(result).toEqual({ collapsed: false, merged: target, restored: [b] });
        expect(fsMocks.rename).toHaveBeenCalledWith(expect.stringMatching(/\.merge-rebuild-.*\.tmp$/), target.path);
    });
});

describe('refused merge outputs', () => {
    it('removes the rebuild temp when the rebuilt merge is kept disabled', async () => {
        useMerge([a, b, c]);
        safetyMocks.carryVpkSafety.mockResolvedValue('untrusted');
        safetyMocks.assertVpkSafety.mockRejectedValueOnce(keptDisabled);

        await expect(extractMergeSource('/game', target.id, a.fileName)).rejects.toThrow('MOD_SAFETY_TRUST_REQUIRED');

        const buildPath = String(safetyMocks.assertVpkSafety.mock.calls[0][0]);
        expect(buildPath).toMatch(/^\/game\/addons\/\.merge-rebuild-.*\.tmp$/);
        expect(fsMocks.unlink).toHaveBeenCalledWith(buildPath);
        expect(fsMocks.rename).not.toHaveBeenCalled();
        expect(metadataMocks.setModMetadata).not.toHaveBeenCalled();
    });

    it('claims no live slot while the merged output is under review', async () => {
        modMocks.scanMods.mockResolvedValue([a, b]);
        metadataMocks.getModMetadata.mockReturnValue(undefined);
        safetyMocks.carryVpkSafety.mockResolvedValue('untrusted');
        safetyMocks.assertVpkSafety.mockRejectedValueOnce(keptDisabled);

        await expect(mergeMods('/game', [a.id, b.id], { name: 'HUD Pack' })).rejects.toThrow('MOD_SAFETY_TRUST_REQUIRED');

        expect(fsMocks.open).not.toHaveBeenCalledWith('/game/addons/pak11_dir.vpk', 'wx');
        expect(fsMocks.unlink).toHaveBeenCalledWith(expect.stringMatching(/\.safety-merge-.*\.tmp$/));
        expect(fsMocks.unlink).not.toHaveBeenCalledWith('/game/addons/pak11_dir.vpk');
    });
});

describe('merge outputs built from trusted sources', () => {
    it('carries their approval without asking again', async () => {
        useMerge([a, b]);
        modMocks.scanMods.mockResolvedValue([target, a, b, c]);
        modMocks.disableModUnlocked.mockImplementation(async () => c);

        await addMergeSources('/game', target.id, [c.id]);

        expect(safetyMocks.assertVpkSafety).not.toHaveBeenCalled();
        const [sources, output] = safetyMocks.carryVpkSafety.mock.calls.at(-1)!;
        expect(output).toMatch(/\.merge-rebuild-.*\.tmp$/);
        expect(sources).toEqual([c.path, b.path, a.path]);
    });
});
