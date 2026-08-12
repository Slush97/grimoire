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
    rename: vi.fn(async (_from: string, _to: string) => undefined),
    unlink: vi.fn(async (_path: string) => undefined),
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

import { replaceMergeSources } from './modMerger';

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
// Absorbed at merge-time priority 10, i.e. it LOSES collisions to sourceB.
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
// The freshly downloaded replacement for Source A. It installed ENABLED into
// pak01, a priority that has nothing to do with where it belongs in the merge:
// inheriting sourceA's 10 (not its own 1) is what these tests pin down.
const replacement = {
    id: 'replacement',
    name: 'Source A v2',
    fileName: 'pak01_dir.vpk',
    path: '/game/addons/pak01_dir.vpk',
    metaKey: 'pak01_dir.vpk',
    enabled: true,
    priority: 1,
    size: 12,
    installedAt: '2026-02-01',
};
const disabledReplacement = {
    ...replacement,
    id: 'replacement',
    fileName: 'source-a-v2_dir.vpk',
    path: '/game/addons/.disabled/source-a-v2_dir.vpk',
    metaKey: 'source-a-v2_dir.vpk',
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
            thumbnailUrl: 'https://example.invalid/a.png',
            gameBananaId: 41,
            gameBananaFileId: 101,
            section: 'Mod',
            enabledAtMergeTime: false,
            priorityAtMergeTime: 10,
            sha256AtMergeTime: hash('a'),
        },
        {
            fileName: sourceB.fileName,
            modName: sourceB.name,
            gameBananaId: 42,
            gameBananaFileId: 102,
            section: 'Mod',
            enabledAtMergeTime: true,
            priorityAtMergeTime: 8,
            sha256AtMergeTime: hash('b'),
        },
    ],
};

const swap = [{ oldFileName: sourceA.fileName, newModId: replacement.id }];

beforeEach(() => {
    vi.clearAllMocks();
    processMocks.exitCodes.length = 0;
    processMocks.spawnArgs.length = 0;
    embeddedRecords.length = 0;
    modMocks.scanMods.mockResolvedValue([target, sourceA, sourceB, replacement]);
    modMocks.disableModUnlocked.mockResolvedValue(disabledReplacement);
    modMocks.enableModUnlocked.mockResolvedValue(replacement);
    metadataMocks.getModMetadata.mockImplementation((key: string) => {
        if (key === target.metaKey) return { modName: target.name, merged: oldManifest };
        if (key === sourceA.metaKey) return { gameBananaFileId: 101, sha256: hash('a') };
        if (key === sourceB.metaKey) return { gameBananaFileId: 102, sha256: hash('b') };
        if (key === replacement.metaKey || key === disabledReplacement.metaKey) {
            return {
                modName: replacement.name,
                thumbnailUrl: 'https://example.invalid/a-v2.png',
                gameBananaId: 41,
                gameBananaFileId: 999,
                sourceSection: 'Mod',
                sha256: hash('c'),
            };
        }
        return undefined;
    });
    identityMocks.resolveVpkIdentity.mockImplementation(async (path: string) => {
        if (path.includes('source-a-v2')) return { sha256: hash('c') };
        if (path.includes('source-a')) return { sha256: hash('a') };
        if (path.includes('source-b')) return { sha256: hash('b') };
        return { sha256: hash('c') };
    });
});

describe('replaceMergeSources', () => {
    it('gives the replacement the OLD source\'s merge-time priority and enabled state', async () => {
        const result = await replaceMergeSources('/game', target.id, swap);

        const sidecarPatch = metadataMocks.setModMetadata.mock.calls.at(-1)?.[1] as {
            merged: typeof oldManifest;
            sha256: string;
        };
        const swapped = sidecarPatch.merged.sources.find(
            (source) => source.priorityAtMergeTime === 10
        )!;

        // Inherited from the retired snapshot, not from the download's pak01 slot.
        expect(swapped.priorityAtMergeTime).toBe(10);
        expect(swapped.enabledAtMergeTime).toBe(false);
        // Taken from the replacement.
        expect(swapped.fileName).toBe(disabledReplacement.fileName);
        expect(swapped.gameBananaFileId).toBe(999);
        expect(swapped.sha256AtMergeTime).toBe(hash('c'));
        expect(swapped.modName).toBe(replacement.name);
        // The untouched source is carried over verbatim.
        expect(sidecarPatch.merged.sources.find((s) => s.gameBananaFileId === 102)).toMatchObject({
            fileName: sourceB.fileName,
            priorityAtMergeTime: 8,
            enabledAtMergeTime: true,
        });
        expect(result.replacedFileNames).toEqual([disabledReplacement.fileName]);
    });

    it('orders vpkmerge argv by inherited priority so collision order is preserved', async () => {
        await replaceMergeSources('/game', target.id, swap);

        // Descending priority => lowest pakNN last (vpkmerge is last-input-wins).
        // Inherited 10 outranks sourceB's 8, so the replacement comes FIRST and
        // still loses collisions to sourceB, exactly as sourceA did. Using the
        // download's own priority of 1 would flip this order.
        const args = processMocks.spawnArgs[0]!;
        const buildIndex = args.findIndex((arg) => arg.includes('.merge-rebuild-'));
        expect(args.slice(buildIndex + 1)).toEqual([
            disabledReplacement.path,
            sourceB.path,
        ]);
    });

    it('preserves merge identity and slot, and keeps sidecar and embed in sync', async () => {
        await replaceMergeSources('/game', target.id, swap);

        expect(fsMocks.rename).toHaveBeenLastCalledWith(
            expect.stringMatching(/\.merge-rebuild-.*\.vpk$/),
            target.path
        );
        const sidecarPatch = metadataMocks.setModMetadata.mock.calls.at(-1)?.[1] as {
            merged: typeof oldManifest;
            sha256: string;
        };
        const embedded = embeddedRecords.at(-1) as {
            sources: Array<{ fileNameAtMergeTime: string; priorityAtMergeTime: number }>;
        };
        expect(sidecarPatch.merged.id).toBe(oldManifest.id);
        expect(sidecarPatch.merged.createdAt).toBe(oldManifest.createdAt);
        expect(sidecarPatch.sha256).toBe(hash('f'));
        expect(sidecarPatch.merged.sources.map((source) => source.fileName)).toEqual(
            embedded.sources.map((source) => source.fileNameAtMergeTime)
        );
        expect(embedded.sources.map((source) => source.priorityAtMergeTime)).toEqual([10, 8]);
    });

    it('moves an enabled replacement out of its live slot before building', async () => {
        await replaceMergeSources('/game', target.id, swap);

        expect(sessionMocks.assertCanMoveLoadedGameMods).toHaveBeenCalledWith([target, replacement]);
        expect(modMocks.disableModUnlocked).toHaveBeenCalledWith('/game', replacement.id);
        expect(processMocks.spawnArgs[0]).toContain(disabledReplacement.path);
        expect(processMocks.spawnArgs[0]).not.toContain(replacement.path);
    });

    it('deletes the retired source only after the swap lands', async () => {
        const result = await replaceMergeSources('/game', target.id, swap);

        expect(fsMocks.unlink).toHaveBeenCalledWith(sourceA.path);
        expect(metadataMocks.removeModMetadata).toHaveBeenCalledWith(sourceA.metaKey);
        expect(result.retiredFileNames).toEqual([sourceA.fileName]);

        const renameOrder = fsMocks.rename.mock.invocationCallOrder.at(-1)!;
        const retireOrder = fsMocks.unlink.mock.invocationCallOrder.find(
            (_order, index) => fsMocks.unlink.mock.calls[index]?.[0] === sourceA.path
        )!;
        expect(retireOrder).toBeGreaterThan(renameOrder);
    });

    it('keeps the retired source and the old merge on a pre-swap failure', async () => {
        processMocks.exitCodes.push(1);

        await expect(replaceMergeSources('/game', target.id, swap)).rejects.toThrow(
            /vpkmerge exited with code 1/
        );

        expect(modMocks.enableModUnlocked).toHaveBeenCalledWith('/game', disabledReplacement.id);
        expect(fsMocks.rename).not.toHaveBeenCalledWith(expect.any(String), target.path);
        expect(metadataMocks.setModMetadata).not.toHaveBeenCalled();
        expect(fsMocks.unlink).not.toHaveBeenCalledWith(sourceA.path);
        expect(metadataMocks.removeModMetadata).not.toHaveBeenCalled();
    });

    it('leaves the merge untouched when a source that is NOT being replaced is missing', async () => {
        modMocks.scanMods.mockResolvedValue([target, sourceA, replacement]);

        await expect(replaceMergeSources('/game', target.id, swap)).rejects.toThrow(
            /source-b_dir\.vpk.*no longer on disk/
        );

        expect(modMocks.disableModUnlocked).not.toHaveBeenCalled();
        expect(processMocks.spawnArgs).toEqual([]);
        expect(metadataMocks.setModMetadata).not.toHaveBeenCalled();
        expect(fsMocks.unlink).not.toHaveBeenCalledWith(sourceA.path);
    });

    it('still rebuilds when the source being replaced is already gone from disk', async () => {
        modMocks.scanMods.mockResolvedValue([target, sourceB, replacement]);

        const result = await replaceMergeSources('/game', target.id, swap);

        expect(result.replacedFileNames).toEqual([disabledReplacement.fileName]);
        expect(result.retiredFileNames).toEqual([]);
        expect(fsMocks.rename).toHaveBeenLastCalledWith(expect.any(String), target.path);
    });

    it('rejects a fileName that is not a source of this merge', async () => {
        await expect(
            replaceMergeSources('/game', target.id, [
                { oldFileName: 'not-a-source_dir.vpk', newModId: replacement.id },
            ])
        ).rejects.toThrow(/is not a source of this merge/);

        expect(processMocks.spawnArgs).toEqual([]);
        expect(metadataMocks.setModMetadata).not.toHaveBeenCalled();
    });

    it('rejects a replacement that is itself a merged mod', async () => {
        metadataMocks.getModMetadata.mockImplementation((key: string) => {
            if (key === target.metaKey) return { modName: target.name, merged: oldManifest };
            if (key === replacement.metaKey) {
                return { modName: replacement.name, merged: oldManifest };
            }
            return undefined;
        });

        await expect(replaceMergeSources('/game', target.id, swap)).rejects.toThrow(
            /is a merged mod and can't be used as a source/
        );

        expect(processMocks.spawnArgs).toEqual([]);
        expect(metadataMocks.setModMetadata).not.toHaveBeenCalled();
    });

    it('rejects duplicate old sources and duplicate replacements before touching disk', async () => {
        await expect(
            replaceMergeSources('/game', target.id, [swap[0], swap[0]])
        ).rejects.toThrow(/same source was selected more than once/);

        await expect(
            replaceMergeSources('/game', target.id, [
                swap[0],
                { oldFileName: sourceB.fileName, newModId: replacement.id },
            ])
        ).rejects.toThrow(/same replacement mod was selected more than once/);

        await expect(replaceMergeSources('/game', target.id, [])).rejects.toThrow(
            /Select at least one source/
        );

        expect(modMocks.scanMods).not.toHaveBeenCalled();
        expect(processMocks.spawnArgs).toEqual([]);
    });
});
