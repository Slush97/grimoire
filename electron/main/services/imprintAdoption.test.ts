/**
 * Coverage for the adoption wiring in imprintMods.ts: readAdoptionEmbedFields
 * and computeAdoptionPatchAt. imprintStaleness.ts (deriveAdoptionPatch et al.)
 * stays REAL, since the whole point is exercising the actual merge-exclusion
 * and legacy-fallback wiring against it; every fs/electron/vpkmerge dependency
 * is stubbed inert, same pattern as imprintVpkIndexFreeze.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ModinfoRecord } from '../../../src/types/modinfo';
import type { ParsedAddonInfo } from './vpkIdentity';

vi.mock('electron', () => ({ app: { getVersion: () => '0.0.0-test' } }));
vi.mock('./mods', () => ({ scanMods: vi.fn(), runExclusiveModMutation: vi.fn() }));
vi.mock('./metadata', () => ({ getModMetadata: vi.fn(), setModMetadata: vi.fn() }));

const { readEmbeddedAddonInfo, carryForwardOriginalIdentity } = vi.hoisted(() => ({
    readEmbeddedAddonInfo: vi.fn<(path: string) => ParsedAddonInfo | null>(),
    carryForwardOriginalIdentity: vi.fn<(embed: unknown, legacy?: unknown) => { sha256: string } | null>(),
}));
vi.mock('./vpkIdentity', () => ({
    readEmbeddedAddonInfo,
    carryForwardOriginalIdentity,
}));

vi.mock('./vpk', () => ({ parseVpkDirectoryCached: vi.fn(), parseVpkEntryStats: vi.fn() }));

const { readEmbeddedModinfo, readLegacyGrimoireMergeMeta, hasLegacyGrimoireMergeMetaEntry } = vi.hoisted(() => ({
    readEmbeddedModinfo: vi.fn<(path: string) => ModinfoRecord | null>(),
    readLegacyGrimoireMergeMeta: vi.fn<(path: string) => { originalSha256?: string } | null>(),
    hasLegacyGrimoireMergeMetaEntry: vi.fn<(path: string) => boolean>(),
}));
vi.mock('./modinfoFormat', () => ({
    computeOriginalIdentity: vi.fn(),
    serializeAddonInfo: vi.fn(),
    serializeModinfo: vi.fn(),
    readEmbeddedModinfo,
    readLegacyGrimoireMergeMeta,
    hasLegacyGrimoireMergeMetaEntry,
    findImprintRepackMismatch: vi.fn(),
    ADDONINFO_ENTRY: 'addoninfo.txt',
    MODINFO_ENTRY: 'modinfo.json',
    MODINFO_FORMAT: 'vpk-modinfo',
    MODINFO_GAME: { name: 'Deadlock', steamAppId: 1422450, gameBananaGameId: 20948 },
    MODINFO_SCHEMA_VERSION: 1,
}));
vi.mock('./modMerger', () => ({ runVpkmerge: vi.fn(), verifyVpkOutput: vi.fn() }));
vi.mock('./gameSessionMods', () => ({
    assertCanMoveLoadedGameMod: vi.fn(),
    isLoadedGameModLocked: vi.fn(),
    syncRunningGameModSnapshotFromMods: vi.fn(),
}));

import { readAdoptionEmbedFields, computeAdoptionPatchAt } from './imprintMods';

const FAKE_PATH = 'C:/fake/pak01_dir.vpk';

function modRecord(overrides: Partial<ModinfoRecord> = {}): ModinfoRecord {
    return {
        format: 'vpk-modinfo',
        schemaVersion: 1,
        kind: 'mod',
        writtenBy: { tool: 'grimoire', version: '0.0.0-test' },
        writtenAt: '2026-01-01T00:00:00.000Z',
        firstImprintedAt: '2025-06-01T00:00:00.000Z',
        game: { name: 'Deadlock', steamAppId: 1422450, gameBananaGameId: 20948 },
        identity: { sha256: 'a'.repeat(64) },
        title: 'Neon Vindicta',
        author: 'someauthor',
        source: { gamebananaId: 4242, gamebananaFileId: 9001, section: 'Mod', categoryId: 77, categoryName: 'Vindicta' },
        packaging: { vpkIndex: 1, variantLabel: 'gold' },
        ...overrides,
    } as ModinfoRecord;
}

beforeEach(() => {
    vi.clearAllMocks();
});

describe('readAdoptionEmbedFields', () => {
    it('projects a current-format kind:"mod" record', () => {
        readEmbeddedModinfo.mockReturnValue(modRecord());
        expect(readAdoptionEmbedFields(FAKE_PATH)).toEqual({
            title: 'Neon Vindicta',
            author: 'someauthor',
            gamebananaId: 4242,
            gamebananaFileId: 9001,
            section: 'Mod',
            categoryId: 77,
            categoryName: 'Vindicta',
            vpkIndex: 1,
            variantLabel: 'gold',
        });
    });

    it('returns null for a current-format kind:"merge" record (never adopt merge fields)', () => {
        readEmbeddedModinfo.mockReturnValue(
            modRecord({ kind: 'merge', title: 'My Merge', author: 'Multiple (merged)', source: undefined, merge: { title: 'My Merge' }, sources: [] })
        );
        expect(readAdoptionEmbedFields(FAKE_PATH)).toBeNull();
        // Never falls through to the legacy reader for a current-format merge.
        expect(readEmbeddedAddonInfo).not.toHaveBeenCalled();
    });

    it('falls back to the legacy addoninfo.txt keys when there is no current-format record', () => {
        readEmbeddedModinfo.mockReturnValue(null);
        readEmbeddedAddonInfo.mockReturnValue({
            title: 'Legacy Vindicta',
            author: 'legacyauthor',
            gamebananaId: '1234',
            gamebananaFileId: '5678',
            raw: {},
        });
        carryForwardOriginalIdentity.mockReturnValue({ sha256: 'b'.repeat(64) });
        hasLegacyGrimoireMergeMetaEntry.mockReturnValue(false);

        expect(readAdoptionEmbedFields(FAKE_PATH)).toEqual({
            title: 'Legacy Vindicta',
            author: 'legacyauthor',
            gamebananaId: 1234,
            gamebananaFileId: 5678,
        });
    });

    it('returns null for a legacy embed that is a MERGE companion (never adopt merge fields)', () => {
        readEmbeddedModinfo.mockReturnValue(null);
        readEmbeddedAddonInfo.mockReturnValue({
            title: 'My Merge',
            author: 'Multiple (merged)',
            raw: {},
        });
        carryForwardOriginalIdentity.mockReturnValue({ sha256: 'b'.repeat(64) });
        hasLegacyGrimoireMergeMetaEntry.mockReturnValue(true);

        expect(readAdoptionEmbedFields(FAKE_PATH)).toBeNull();
    });

    it('returns null for a foreign embed with no recoverable original identity', () => {
        readEmbeddedModinfo.mockReturnValue(null);
        readEmbeddedAddonInfo.mockReturnValue({ title: 'Someone else\'s addon', raw: {} });
        carryForwardOriginalIdentity.mockReturnValue(null);

        expect(readAdoptionEmbedFields(FAKE_PATH)).toBeNull();
    });

    it('returns null when the file carries no embed at all', () => {
        readEmbeddedModinfo.mockReturnValue(null);
        readEmbeddedAddonInfo.mockReturnValue(null);

        expect(readAdoptionEmbedFields(FAKE_PATH)).toBeNull();
    });
});

describe('computeAdoptionPatchAt', () => {
    it('derives the fill-missing patch from a current-format embed against an impoverished sidecar', () => {
        readEmbeddedModinfo.mockReturnValue(modRecord());
        const patch = computeAdoptionPatchAt(FAKE_PATH, { modName: 'User Typed Name' });
        expect(patch).toEqual({
            author: 'someauthor',
            gameBananaId: 4242,
            gameBananaFileId: 9001,
            sourceSection: 'Mod',
            categoryId: 77,
            categoryName: 'Vindicta',
            vpkIndex: 1,
            variantLabel: 'gold',
        });
    });

    it('never overwrites a present sidecar value', () => {
        readEmbeddedModinfo.mockReturnValue(modRecord());
        const fullSidecar = {
            modName: 'User Typed Name',
            author: 'differentauthor',
            gameBananaId: 5555,
            gameBananaFileId: 6666,
            sourceSection: 'Sound',
            categoryId: 88,
            categoryName: 'Lady Geist',
            vpkIndex: 2,
            variantLabel: 'silver',
        };
        expect(computeAdoptionPatchAt(FAKE_PATH, fullSidecar)).toEqual({});
    });

    it('yields an empty patch for a merge embed regardless of sidecar state (merges never adopt through this path)', () => {
        readEmbeddedModinfo.mockReturnValue(
            modRecord({ kind: 'merge', title: 'My Merge', author: 'Multiple (merged)', source: undefined, merge: { title: 'My Merge' }, sources: [] })
        );
        expect(computeAdoptionPatchAt(FAKE_PATH, undefined)).toEqual({});
    });

    it('yields an empty patch when there is no recoverable embed at all', () => {
        readEmbeddedModinfo.mockReturnValue(null);
        readEmbeddedAddonInfo.mockReturnValue(null);
        expect(computeAdoptionPatchAt(FAKE_PATH, undefined)).toEqual({});
    });
});
