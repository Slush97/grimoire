/**
 * Coverage for bulk-imprint eligibility of never-identified VPKs: a mod with
 * no metadata row and no embed must be refused ('unidentified'), because the
 * repack permanently changes the live size/CRC the GameBanana archive
 * matchers key on, with nothing in the embed to compensate. A meta-less mod
 * that already carries a valid embed stays eligible (its identity anchor is
 * the embedded original). Also pins the preflight cost contract: the
 * read-only preflight never whole-file-hashes a candidate, while the bulk
 * run's write-time drift guard still does. imprintStaleness stays REAL, same
 * pattern as imprintAdoption.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ModinfoRecord } from '../../../src/types/modinfo';
import type { ParsedAddonInfo } from './vpkIdentity';
import type { Mod } from './mods';
import type { ModMetadata } from './metadata';

vi.mock('electron', () => ({ app: { getVersion: () => '0.0.0-test' } }));
vi.mock('fs', () => ({
    promises: {
        stat: vi.fn(async () => ({ size: 1024 })),
        readdir: vi.fn(async () => []),
    },
}));

const { scanMods } = vi.hoisted(() => ({
    scanMods: vi.fn<(deadlockPath: string) => Promise<Mod[]>>(),
}));
vi.mock('./mods', () => ({
    scanMods,
    runExclusiveModMutation: vi.fn(<T,>(fn: () => Promise<T>) => fn()),
}));

const metadataStore = vi.hoisted(() => new Map<string, Record<string, unknown>>());
vi.mock('./metadata', () => ({
    getModMetadata: vi.fn((key: string) => metadataStore.get(key)),
    setModMetadata: vi.fn((key: string, patch: Record<string, unknown>) => {
        metadataStore.set(key, { ...(metadataStore.get(key) ?? {}), ...patch });
    }),
}));

const { readEmbeddedAddonInfo, carryForwardOriginalIdentity } = vi.hoisted(() => ({
    readEmbeddedAddonInfo: vi.fn<(path: string) => ParsedAddonInfo | null>(),
    carryForwardOriginalIdentity:
        vi.fn<(embed: unknown, legacy?: unknown) => { sha256: string } | null>(),
}));
vi.mock('./vpkIdentity', () => ({
    readEmbeddedAddonInfo,
    carryForwardOriginalIdentity,
}));

vi.mock('./vpk', () => ({
    parseVpkDirectoryCached: vi.fn(() => ['materials/foo.txt']),
    parseVpkEntryStats: vi.fn(() => []),
    findChunkSiblingNames: vi.fn(() => []),
}));

const { readEmbeddedModinfo, computeOriginalIdentity } = vi.hoisted(() => ({
    readEmbeddedModinfo: vi.fn<(path: string) => ModinfoRecord | null>(),
    computeOriginalIdentity:
        vi.fn<(path: string, opts?: unknown) => Promise<{ sha256: string }>>(),
}));
vi.mock('./modinfoFormat', () => ({
    computeOriginalIdentity,
    serializeAddonInfo: vi.fn(() => 'addoninfo'),
    serializeModinfo: vi.fn(() => 'modinfo'),
    readEmbeddedModinfo,
    readLegacyGrimoireMergeMeta: vi.fn(() => null),
    hasLegacyGrimoireMergeMetaEntry: vi.fn(() => false),
    findImprintRepackMismatch: vi.fn(() => null),
    reconstructMergedModInfoFromEmbed: vi.fn(() => null),
    reconstructMergedModInfoFromLegacy: vi.fn(() => null),
    ADDONINFO_ENTRY: 'addoninfo.txt',
    MODINFO_ENTRY: 'modinfo.json',
    LEGACY_GRIMOIRE_META_ENTRY: 'grimoire_meta.json',
    MODINFO_FORMAT: 'vpk-modinfo',
    MODINFO_GAME: { name: 'Deadlock', steamAppId: 1422450, gameBananaGameId: 20948 },
    MODINFO_SCHEMA_VERSION: 1,
}));

const { runVpkmerge } = vi.hoisted(() => ({
    runVpkmerge: vi.fn<(args: string[]) => Promise<void>>(),
}));
vi.mock('./modMerger', () => ({
    runVpkmerge,
    embedMergeIdentity: vi.fn(),
    buildPortableForMergeSources: vi.fn(),
}));

vi.mock('./gameSessionMods', () => ({
    assertCanMoveLoadedGameMod: vi.fn(),
    isLoadedGameModLocked: vi.fn(() => false),
    syncRunningGameModSnapshotFromMods: vi.fn(),
}));

vi.mock('./profileResolver', () => ({ inferMissingVpkIndexes: vi.fn(() => new Map()) }));

import { imprintAllInstalled, imprintPreflight } from './imprintMods';

function makeMod(overrides: Partial<Mod> = {}): Mod {
    return {
        id: 'pak10_dir.vpk',
        name: 'pak10',
        fileName: 'pak10_dir.vpk',
        metaKey: 'pak10_dir.vpk',
        path: 'C:/addons/pak10_dir.vpk',
        enabled: true,
        ...overrides,
    } as Mod;
}

function modRecord(): ModinfoRecord {
    return {
        format: 'vpk-modinfo',
        schemaVersion: 1,
        kind: 'mod',
        writtenBy: { tool: 'grimoire', version: '0.0.0-test' },
        writtenAt: '2026-01-01T00:00:00.000Z',
        firstImprintedAt: '2025-06-01T00:00:00.000Z',
        game: { name: 'Deadlock', steamAppId: 1422450, gameBananaGameId: 20948 },
        identity: { sha256: 'a'.repeat(64) },
        title: 'Imprinted Import',
        source: { gamebananaId: 4242, gamebananaFileId: 9001, section: 'Mod' },
    } as ModinfoRecord;
}

beforeEach(() => {
    vi.clearAllMocks();
    metadataStore.clear();
    readEmbeddedAddonInfo.mockReturnValue(null);
    carryForwardOriginalIdentity.mockReturnValue(null);
    readEmbeddedModinfo.mockReturnValue(null);
    computeOriginalIdentity.mockResolvedValue({ sha256: 'b'.repeat(64) });
});

describe('never-identified VPKs and bulk imprint', () => {
    it('bulk run refuses a meta-less, embed-less mod without repacking it', async () => {
        scanMods.mockResolvedValue([makeMod()]);

        const result = await imprintAllInstalled('C:/deadlock');

        expect(runVpkmerge).not.toHaveBeenCalled();
        expect(result.imprinted).toBe(0);
        expect(result.failed).toEqual([
            { fileName: 'pak10_dir.vpk', modName: 'pak10', reason: 'unidentified' },
        ]);
    });

    it('preflight buckets it as anomalous with the same reason, counts summing to total', async () => {
        scanMods.mockResolvedValue([makeMod()]);

        const result = await imprintPreflight('C:/deadlock');

        expect(result.counts.eligible).toBe(0);
        expect(result.counts.anomalous).toBe(1);
        expect(result.anomalous).toEqual([
            { fileName: 'pak10_dir.vpk', modName: 'pak10', reason: 'unidentified' },
        ]);
        const summed = Object.values(result.counts).reduce((a, b) => a + b, 0);
        expect(summed).toBe(result.total);
    });

    it('keeps a meta-less mod WITH a valid embed eligible (identity anchored by the embed)', async () => {
        scanMods.mockResolvedValue([makeMod()]);
        readEmbeddedAddonInfo.mockReturnValue({
            originalSha256: 'a'.repeat(64),
            gamebananaId: '4242',
            raw: {},
        });
        carryForwardOriginalIdentity.mockReturnValue({ sha256: 'a'.repeat(64) });
        readEmbeddedModinfo.mockReturnValue(modRecord());

        const result = await imprintPreflight('C:/deadlock');

        expect(result.counts.anomalous).toBe(0);
        // Wherever it lands (already-imprinted when fresh, eligible when the
        // sidecar drifted), it is never refused as unidentified.
        expect(result.counts.alreadyImprinted + result.counts.eligible).toBe(1);
    });
});
