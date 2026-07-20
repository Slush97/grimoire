import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'events';

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
    runExclusiveModMutation: vi.fn(<T,>(fn: () => Promise<T>) => fn()),
}));
vi.mock('./mods', () => ({
    ...modMocks,
    allocateEnabledVpkPath: vi.fn(),
}));

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
    encodeShareCode: vi.fn((_payload: string) => 'mp1:updated'),
}));
vi.mock('./portableProfile', () => portableMocks);

import { addMergeSources } from './modMerger';

const hash = (letter: string) => letter.repeat(64);
const target = {
    id: 'merge-mod-id',
    name: 'Existing Merge',
    fileName: 'pak09_dir.vpk',
    path: '/game/addons/pak09_dir.vpk',
    metaKey: 'pak09_dir.vpk',
    enabled: true,
    priority: 9,
    size: 100,
    installedAt: '2026-01-01',
};
const sourceA = {
    id: 'source-a',
    name: 'Source A',
    fileName: 'source-a_dir.vpk',
    path: '/game/addons/.disabled/source-a_dir.vpk',
    metaKey: 'source-a_dir.vpk',
    enabled: false,
    priority: 50,
    size: 10,
    installedAt: '2026-01-01',
};
const sourceB = {
    id: 'source-b',
    name: 'Source B',
    fileName: 'source-b_dir.vpk',
    path: '/game/addons/.disabled/source-b_dir.vpk',
    metaKey: 'source-b_dir.vpk',
    enabled: false,
    priority: 50,
    size: 10,
    installedAt: '2026-01-01',
};
const addition = {
    id: 'addition',
    name: 'New Source',
    fileName: 'pak04_dir.vpk',
    path: '/game/addons/pak04_dir.vpk',
    metaKey: 'pak04_dir.vpk',
    enabled: true,
    priority: 4,
    size: 10,
    installedAt: '2026-01-01',
};
const disabledAddition = {
    ...addition,
    id: 'addition-disabled',
    fileName: 'new-source_dir.vpk',
    path: '/game/addons/.disabled/new-source_dir.vpk',
    metaKey: 'new-source_dir.vpk',
    enabled: false,
};
const oldManifest = {
    id: 'stable-merge-id',
    createdAt: '2026-01-01T00:00:00.000Z',
    shareCode: 'mp1:old',
    sources: [
        {
            fileName: sourceA.fileName,
            modName: sourceA.name,
            gameBananaId: 41,
            gameBananaFileId: 101,
            enabledAtMergeTime: true,
            priorityAtMergeTime: 3,
            sha256AtMergeTime: hash('a'),
        },
        {
            fileName: sourceB.fileName,
            modName: sourceB.name,
            gameBananaId: 42,
            gameBananaFileId: 102,
            enabledAtMergeTime: true,
            priorityAtMergeTime: 8,
            sha256AtMergeTime: hash('b'),
        },
    ],
};
beforeEach(() => {
    vi.clearAllMocks();
    processMocks.exitCodes.length = 0;
    processMocks.spawnArgs.length = 0;
    embeddedRecords.length = 0;
    modMocks.scanMods.mockResolvedValue([target, sourceA, sourceB, addition]);
    modMocks.disableModUnlocked.mockResolvedValue(disabledAddition);
    modMocks.enableModUnlocked.mockResolvedValue(addition);
    metadataMocks.getModMetadata.mockImplementation((key: string) => {
        if (key === target.metaKey) return { modName: target.name, merged: oldManifest };
        if (key === sourceA.metaKey) return { gameBananaFileId: 101, sha256: hash('a') };
        if (key === sourceB.metaKey) return { gameBananaFileId: 102, sha256: hash('b') };
        if (key === addition.metaKey) {
            return { modName: addition.name, gameBananaId: 50, gameBananaFileId: 103, sha256: hash('c') };
        }
        if (key === disabledAddition.metaKey) {
            return { modName: addition.name, gameBananaId: 50, gameBananaFileId: 103, sha256: hash('c') };
        }
        return undefined;
    });
    identityMocks.resolveVpkIdentity.mockImplementation(async (path: string) => {
        if (path.includes('source-a')) return { sha256: hash('a') };
        if (path.includes('source-b')) return { sha256: hash('b') };
        return { sha256: hash('c') };
    });
});

describe('addMergeSources', () => {
    it('keeps merge identity/slot and writes matching sidecar and embedded source lists', async () => {
        const result = await addMergeSources('/game', target.id, [addition.id], { strict: true });

        expect(sessionMocks.assertCanMoveLoadedGameMods).toHaveBeenCalledWith([target, addition]);
        expect(modMocks.disableModUnlocked).toHaveBeenCalledWith('/game', addition.id);
        expect(processMocks.spawnArgs[0]?.[0]).toBe('--strict');
        expect(processMocks.spawnArgs[0]).toContain(disabledAddition.path);
        expect(fsMocks.rename).toHaveBeenLastCalledWith(
            expect.stringMatching(/\.merge-rebuild-.*\.vpk$/),
            target.path
        );

        const sidecarPatch = metadataMocks.setModMetadata.mock.calls.at(-1)?.[1] as {
            merged: typeof oldManifest;
            sha256: string;
        };
        const embedded = embeddedRecords.at(-1) as { sources: Array<{ fileNameAtMergeTime: string }> };
        expect(sidecarPatch.merged.id).toBe(oldManifest.id);
        expect(sidecarPatch.merged.createdAt).toBe(oldManifest.createdAt);
        expect(sidecarPatch.sha256).toBe(hash('f'));
        expect(sidecarPatch.merged.sources.map((source) => source.fileName)).toEqual(
            embedded.sources.map((source) => source.fileNameAtMergeTime)
        );
        expect(result.merged).toEqual(sidecarPatch.merged);
        expect(result.addedFileNames).toEqual([disabledAddition.fileName]);

        const portable = JSON.parse(portableMocks.encodeShareCode.mock.calls[0]?.[0] ?? '{}') as {
            mods: Array<{ priority: number }>;
        };
        expect(portable.mods.map((entry) => entry.priority)).toEqual([8, 4, 3]);
    });

    it('leaves the merge untouched when an existing source is missing', async () => {
        modMocks.scanMods.mockResolvedValue([target, sourceA, addition]);

        await expect(
            addMergeSources('/game', target.id, [addition.id])
        ).rejects.toThrow(/source-b_dir\.vpk.*no longer on disk/);

        expect(modMocks.disableModUnlocked).not.toHaveBeenCalled();
        expect(processMocks.spawnArgs).toEqual([]);
        expect(fsMocks.rename).not.toHaveBeenCalledWith(expect.any(String), target.path);
        expect(metadataMocks.setModMetadata).not.toHaveBeenCalled();
    });

    it('rejects an absorbed source passed directly as an addition', async () => {
        await expect(
            addMergeSources('/game', target.id, [sourceA.id])
        ).rejects.toThrow(/already present in this merge/);

        expect(modMocks.disableModUnlocked).not.toHaveBeenCalled();
        expect(processMocks.spawnArgs).toEqual([]);
        expect(metadataMocks.setModMetadata).not.toHaveBeenCalled();
    });

    it('restores newly disabled sources and never swaps or stamps metadata on strict failure', async () => {
        processMocks.exitCodes.push(1);

        await expect(
            addMergeSources('/game', target.id, [addition.id], { strict: true })
        ).rejects.toThrow(/vpkmerge exited with code 1/);

        expect(modMocks.enableModUnlocked).toHaveBeenCalledWith('/game', disabledAddition.id);
        expect(fsMocks.rename).not.toHaveBeenCalledWith(expect.any(String), target.path);
        expect(metadataMocks.setModMetadata).not.toHaveBeenCalled();
    });
});
