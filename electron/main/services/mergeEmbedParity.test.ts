/**
 * Coverage for the unified embed writer: embedMergeIdentity now routes
 * through repackWithEmbeddedEntries, so the merge embed pass gains the same
 * repack parity check the single-mod imprint always had. A parity mismatch
 * must reject, unlink the temp output, and never rename over the original; a
 * clean parity must atomically rename the temp output into place. vpkmerge
 * itself is stubbed at the child_process boundary.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'events';

const fsMocks = vi.hoisted(() => ({
    writeFile: vi.fn(async () => undefined),
    rename: vi.fn(async () => undefined),
    unlink: vi.fn(async () => undefined),
}));
vi.mock('fs', () => ({
    promises: fsMocks,
    existsSync: vi.fn(() => true),
}));

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
    app: {
        getVersion: () => '0.0.0-test',
        getAppPath: () => '/fake/app',
        isPackaged: false,
    },
}));
vi.mock('./deadlock', () => ({ metaKeyFor: vi.fn((p: string) => p) }));
vi.mock('./settings', () => ({ loadSettings: vi.fn(() => ({})) }));
vi.mock('./mods', () => ({
    scanMods: vi.fn(),
    disableModUnlocked: vi.fn(),
    enableModUnlocked: vi.fn(),
    allocateEnabledVpkPath: vi.fn(),
    runExclusiveModMutation: vi.fn(),
}));
vi.mock('./metadata', () => ({
    getModMetadata: vi.fn(),
    setModMetadata: vi.fn(),
    removeModMetadata: vi.fn(),
}));
vi.mock('./vpkIdentity', () => ({ resolveVpkIdentity: vi.fn() }));

const { parseVpkEntryStats } = vi.hoisted(() => ({
    parseVpkEntryStats: vi.fn<(path: string) => Array<{ path: string; size: number }> | null>(),
}));
vi.mock('./vpk', () => ({ parseVpkEntryStats }));

const { findImprintRepackMismatch } = vi.hoisted(() => ({
    findImprintRepackMismatch: vi.fn<(...args: unknown[]) => string | null>(),
}));
vi.mock('./modinfoFormat', () => ({
    computeOriginalIdentity: vi.fn(),
    serializeAddonInfo: vi.fn(() => 'addoninfo-text'),
    serializeModinfo: vi.fn(() => 'modinfo-text'),
    hasLegacyGrimoireMergeMetaEntry: vi.fn(() => false),
    findImprintRepackMismatch,
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

import { embedMergeIdentity } from './modMerger';

const MERGED_PATH = '/fake/addons/pak09_dir.vpk';
const ORIGINAL = { sha256: 'a'.repeat(64), size: 1234, crc32: 'deadbeef' };

beforeEach(() => {
    vi.clearAllMocks();
    parseVpkEntryStats.mockReturnValue([{ path: 'materials/foo.txt', size: 10 }]);
});

describe('embedMergeIdentity repack parity', () => {
    it('renames the verified temp output over the merged VPK on clean parity', async () => {
        findImprintRepackMismatch.mockReturnValue(null);

        await embedMergeIdentity(MERGED_PATH, 'My Merge', '2026-01-01T00:00:00.000Z', ORIGINAL, []);

        expect(findImprintRepackMismatch).toHaveBeenCalledTimes(1);
        expect(fsMocks.rename).toHaveBeenCalledTimes(1);
        const [from, to] = fsMocks.rename.mock.calls[0] as unknown as [string, string];
        expect(from).toMatch(/\.imprint-embed-.*\.vpk$/);
        expect(to).toBe(MERGED_PATH);
    });

    it('rejects, unlinks the temp output, and never renames on a parity mismatch', async () => {
        findImprintRepackMismatch.mockReturnValue('materials/foo.txt missing from output');

        await expect(
            embedMergeIdentity(MERGED_PATH, 'My Merge', '2026-01-01T00:00:00.000Z', ORIGINAL, [])
        ).rejects.toThrow(/parity check failed/);

        expect(fsMocks.rename).not.toHaveBeenCalled();
        const unlinked = fsMocks.unlink.mock.calls.map((c) => c[0] as unknown as string);
        expect(unlinked.some((p) => /\.imprint-embed-.*\.vpk$/.test(p))).toBe(true);
    });

    it('rejects without renaming when the repacked output is unreadable', async () => {
        parseVpkEntryStats
            .mockReturnValueOnce([{ path: 'materials/foo.txt', size: 10 }])
            .mockReturnValueOnce(null);

        await expect(
            embedMergeIdentity(MERGED_PATH, 'My Merge', '2026-01-01T00:00:00.000Z', ORIGINAL, [])
        ).rejects.toThrow(/unreadable/);

        expect(fsMocks.rename).not.toHaveBeenCalled();
    });
});
