import { EventEmitter } from 'events';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const fsMocks = vi.hoisted(() => ({
    stat: vi.fn(async () => ({ size: 128 })),
    open: vi.fn(async () => ({
        read: vi.fn(async (buffer: Buffer) => {
            buffer.writeUInt32LE(0x55aa1234, 0);
            return { bytesRead: 4, buffer };
        }),
        close: vi.fn(async () => undefined),
    })),
    writeFile: vi.fn(async () => undefined),
    rename: vi.fn(async () => undefined),
    unlink: vi.fn(async () => undefined),
}));

vi.mock('fs', () => ({
    promises: fsMocks,
    existsSync: vi.fn(() => true),
}));

const processMocks = vi.hoisted(() => ({
    exitCodes: [] as number[],
    spawnArgs: [] as string[][],
}));
vi.mock('child_process', () => ({
    spawn: vi.fn((_binary: string, args: string[]) => {
        processMocks.spawnArgs.push(args);
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
        const code = processMocks.exitCodes.shift() ?? 0;
        setImmediate(() => proc.emit('close', code));
        return proc;
    }),
}));

vi.mock('electron', () => ({
    app: {
        getVersion: () => '0.0.0-test',
        getAppPath: () => '/fake/app',
        isPackaged: false,
    },
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

const identityMocks = vi.hoisted(() => ({ resolveVpkIdentity: vi.fn() }));
vi.mock('./vpkIdentity', () => identityMocks);

const embeddedRecords = vi.hoisted(() => [] as unknown[]);
vi.mock('./modinfoFormat', () => ({
    computeOriginalIdentity: vi.fn(async () => ({
        sha256: 'f'.repeat(64),
        size: 4096,
        crc32: 'deadbeef',
    })),
    serializeAddonInfo: vi.fn(() => 'addoninfo-text'),
    serializeModinfo: vi.fn((record: unknown) => {
        embeddedRecords.push(record);
        return 'modinfo-text';
    }),
    hasLegacyGrimoireMergeMetaEntry: vi.fn(() => false),
    findImprintRepackMismatch: vi.fn(() => null),
    ADDONINFO_ENTRY: 'addoninfo.txt',
    MODINFO_ENTRY: 'modinfo.json',
    LEGACY_GRIMOIRE_META_ENTRY: 'grimoire_meta.json',
    MODINFO_FORMAT: 'vpk-modinfo',
    MODINFO_GAME: { name: 'Deadlock', steamAppId: 1422450, gameBananaGameId: 20948 },
    MODINFO_SCHEMA_VERSION: 1,
}));

const sessionMocks = vi.hoisted(() => ({
    assertCanMoveLoadedGameMod: vi.fn(),
    assertCanMoveLoadedGameMods: vi.fn(),
    syncRunningGameModSnapshotFromMods: vi.fn(),
}));
vi.mock('./gameSessionMods', () => sessionMocks);
vi.mock('./vpk', () => ({
    parseVpkEntryStats: vi.fn(() => [{ path: 'materials/example.vmat_c', size: 12 }]),
}));

const portableMocks = vi.hoisted(() => ({
    encodeShareCode: vi.fn((_payload: string) => 'mp1:flattened'),
}));
vi.mock('./portableProfile', () => portableMocks);

import { mergeMods } from './modMerger';

const hash = (letter: string) => letter.repeat(64);
const parentA = {
    id: 'parent-a',
    name: 'Parent A',
    fileName: 'pak09_dir.vpk',
    path: '/game/addons/pak09_dir.vpk',
    metaKey: 'pak09_dir.vpk',
    enabled: true,
    priority: 9,
    size: 100,
    installedAt: '2026-01-01',
};
const parentB = {
    ...parentA,
    id: 'parent-b',
    name: 'Parent B',
    fileName: 'pak10_dir.vpk',
    path: '/game/addons/pak10_dir.vpk',
    metaKey: 'pak10_dir.vpk',
    priority: 10,
};
const source = (letter: string, fileId: number) => ({
    id: `source-${letter}`,
    name: `Source ${letter.toUpperCase()}`,
    fileName: `source-${letter}_dir.vpk`,
    path: `/game/addons/.disabled/source-${letter}_dir.vpk`,
    metaKey: `source-${letter}_dir.vpk`,
    enabled: false,
    priority: 50,
    size: 10,
    installedAt: '2026-01-01',
    gameBananaId: fileId + 1000,
    gameBananaFileId: fileId,
});
const sourceA = source('a', 101);
const sourceB = source('b', 102);
const sourceC = source('c', 103);
const flattened = {
    ...parentA,
    id: 'flattened',
    name: 'Flattened',
    fileName: 'pak11_dir.vpk',
    path: '/game/addons/pak11_dir.vpk',
    metaKey: '/game/addons/pak11_dir.vpk',
    priority: 11,
};

const snapshot = (mod: typeof sourceA, priority: number) => ({
    fileName: mod.fileName,
    modName: mod.name,
    gameBananaId: mod.gameBananaId,
    gameBananaFileId: mod.gameBananaFileId,
    enabledAtMergeTime: true,
    priorityAtMergeTime: priority,
    sha256AtMergeTime: hash(mod.id.at(-1) ?? 'x'),
});

const manifestA = {
    id: 'merge-a',
    createdAt: '2026-01-01T00:00:00.000Z',
    shareCode: 'mp1:a',
    sources: [snapshot(sourceA, 3), snapshot(sourceB, 5)],
};
const manifestB = {
    id: 'merge-b',
    createdAt: '2026-01-02T00:00:00.000Z',
    shareCode: 'mp1:b',
    sources: [snapshot(sourceB, 5), snapshot(sourceC, 8)],
};

beforeEach(() => {
    vi.clearAllMocks();
    processMocks.exitCodes.length = 0;
    processMocks.spawnArgs.length = 0;
    embeddedRecords.length = 0;
    modMocks.scanMods
        .mockResolvedValueOnce([parentA, parentB, sourceA, sourceB, sourceC])
        .mockResolvedValueOnce([flattened, sourceA, sourceB, sourceC]);
    metadataMocks.getModMetadata.mockImplementation((key: string) => {
        if (key === parentA.metaKey) return { modName: parentA.name, merged: manifestA };
        if (key === parentB.metaKey) return { modName: parentB.name, merged: manifestB };
        if (key === sourceA.metaKey) return { sha256: hash('a'), vpkIndex: 1 };
        if (key === sourceB.metaKey) return { sha256: hash('b'), vpkIndex: 2 };
        if (key === sourceC.metaKey) return { sha256: hash('c'), vpkIndex: 3 };
        return undefined;
    });
    identityMocks.resolveVpkIdentity.mockImplementation(async (path: string) => {
        const match = path.match(/source-([a-c])/);
        return { sha256: hash(match?.[1] ?? 'x') };
    });
});

describe('mergeMods flattening', () => {
    it('flattens parent manifests, dedupes shared leaves, and consumes only parent shells', async () => {
        const result = await mergeMods('/game', [parentA.id, parentB.id], {
            name: 'Flattened',
        });

        expect(processMocks.spawnArgs[0]).toEqual([
            flattened.path,
            sourceC.path,
            sourceB.path,
            sourceA.path,
        ]);
        expect(processMocks.spawnArgs[0]).not.toContain(parentA.path);
        expect(processMocks.spawnArgs[0]).not.toContain(parentB.path);
        expect(result.disabledSources).toEqual([sourceC, sourceB, sourceA]);

        const sidecar = metadataMocks.setModMetadata.mock.calls[0]?.[1] as {
            merged: { sources: Array<{ fileName: string }> };
        };
        expect(sidecar.merged.sources.map((entry) => entry.fileName)).toEqual([
            sourceC.fileName,
            sourceB.fileName,
            sourceA.fileName,
        ]);
        const embedded = embeddedRecords.at(-1) as {
            sources: Array<{ fileNameAtMergeTime: string }>;
        };
        expect(embedded.sources.map((entry) => entry.fileNameAtMergeTime)).toEqual(
            sidecar.merged.sources.map((entry) => entry.fileName)
        );

        const portable = JSON.parse(portableMocks.encodeShareCode.mock.calls[0]?.[0] ?? '{}') as {
            mods: Array<{ priority: number }>;
        };
        expect(portable.mods.map((entry) => entry.priority)).toEqual([8, 5, 3]);

        expect(fsMocks.unlink).toHaveBeenCalledWith(parentA.path);
        expect(fsMocks.unlink).toHaveBeenCalledWith(parentB.path);
        expect(metadataMocks.removeModMetadata).toHaveBeenCalledWith(parentA.metaKey);
        expect(metadataMocks.removeModMetadata).toHaveBeenCalledWith(parentB.metaKey);
        expect(result.mod).toEqual(flattened);
    });

    it('keeps parent merges intact when the flattened build fails', async () => {
        processMocks.exitCodes.push(1);

        await expect(
            mergeMods('/game', [parentA.id, parentB.id], { name: 'Flattened', strict: true })
        ).rejects.toThrow(/vpkmerge exited with code 1/);

        expect(fsMocks.unlink).not.toHaveBeenCalledWith(parentA.path);
        expect(fsMocks.unlink).not.toHaveBeenCalledWith(parentB.path);
        expect(metadataMocks.removeModMetadata).not.toHaveBeenCalledWith(parentA.metaKey);
        expect(metadataMocks.removeModMetadata).not.toHaveBeenCalledWith(parentB.metaKey);
    });

    it('leaves parent merges intact when any original leaf is missing', async () => {
        modMocks.scanMods.mockReset()
            .mockResolvedValueOnce([parentA, parentB, sourceA, sourceB]);

        await expect(
            mergeMods('/game', [parentA.id, parentB.id], { name: 'Flattened' })
        ).rejects.toThrow(/source-c_dir\.vpk.*no longer on disk/);

        expect(processMocks.spawnArgs).toEqual([]);
        expect(metadataMocks.setModMetadata).not.toHaveBeenCalled();
        expect(fsMocks.unlink).not.toHaveBeenCalledWith(parentA.path);
        expect(fsMocks.unlink).not.toHaveBeenCalledWith(parentB.path);
    });
});
