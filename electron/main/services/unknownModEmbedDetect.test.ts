/**
 * Coverage for detectFromEmbed (via detectUnknownModCacheMatches): the embed
 * consult must carry the GameBanana section and file id through (sections are
 * separate id namespaces, so a Sound mod without them resolves against the
 * wrong submission), must probe embeds cheaply (no whole-file hashing), and
 * must route only embed-less inputs into the worker fingerprint pass. Every
 * fs/electron/network dependency is stubbed inert, same pattern as
 * imprintAdoption.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ModinfoRecord } from '../../../src/types/modinfo';
import type { ParsedAddonInfo } from './vpkIdentity';

vi.mock('./archiveCrc', () => ({
    crc32File: vi.fn(),
    fetchGameBananaArchiveVpkCrcEntries: vi.fn(),
}));
vi.mock('./gamebanana', () => ({
    fetchModsFilesMetadata: vi.fn(),
    fetchSubmissions: vi.fn(),
}));
vi.mock('./vpk', () => ({
    parseVpkDirectory: vi.fn(() => []),
    parseVpkDirectoryCached: vi.fn(() => []),
}));

const { readEmbeddedAddonInfo, carryForwardOriginalIdentity } = vi.hoisted(() => ({
    readEmbeddedAddonInfo: vi.fn<(path: string) => ParsedAddonInfo | null>(),
    carryForwardOriginalIdentity: vi.fn<(embed: unknown) => { sha256: string } | null>(),
}));
vi.mock('./vpkIdentity', () => ({
    readEmbeddedAddonInfo,
    carryForwardOriginalIdentity,
}));

const { readEmbeddedModinfo } = vi.hoisted(() => ({
    readEmbeddedModinfo: vi.fn<(path: string) => ModinfoRecord | null>(),
}));
vi.mock('./modinfoFormat', () => ({ readEmbeddedModinfo }));

const { fingerprintFilesInWorkers } = vi.hoisted(() => ({
    fingerprintFilesInWorkers:
        vi.fn<
            (
                files: Array<{ id: string; filePath: string }>,
                opts?: unknown
            ) => Promise<Array<{ id: string; crc32: string; size: number; error?: string }>>
        >(),
}));
vi.mock('./workers', () => ({ fingerprintFilesInWorkers }));

vi.mock('./unknownCrcCache', () => ({
    getUnknownCrcEntryCount: vi.fn(() => 0),
    getUnknownCrcFilesForMods: vi.fn(() => []),
    lookupUnknownCrcMatch: vi.fn(() => null),
    lookupUnknownCrcMatches: vi.fn(() => new Map()),
    replaceUnknownCrcEntries: vi.fn(),
    updateUnknownCrcFileStatus: vi.fn(),
    upsertUnknownCrcFiles: vi.fn(),
    UNKNOWN_CRC_PARSER_VERSION: 1,
}));

import { detectUnknownModCacheMatches } from './unknownModDetection';

const IMPRINTED = 'C:/addons/pak01_dir.vpk';
const PLAIN = 'C:/addons/pak02_dir.vpk';

function addonInfo(overrides: Partial<ParsedAddonInfo> = {}): ParsedAddonInfo {
    return {
        originalSha256: 'a'.repeat(64),
        gamebananaId: '4242',
        title: 'Neon Vindicta',
        raw: {},
        ...overrides,
    };
}

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
        title: 'Boom Melee',
        author: 'someauthor',
        source: {
            gamebananaId: 4242,
            gamebananaFileId: 9001,
            section: 'Sound',
            categoryId: 77,
            categoryName: 'Hero Sounds',
        },
        packaging: { vpkIndex: 1 },
        ...overrides,
    } as ModinfoRecord;
}

beforeEach(() => {
    vi.clearAllMocks();
    fingerprintFilesInWorkers.mockResolvedValue([]);
});

describe('detectUnknownModCacheMatches embed consult', () => {
    it('carries section and file id from a kind:"mod" modinfo record (Sound namespace)', async () => {
        readEmbeddedAddonInfo.mockReturnValue(addonInfo());
        carryForwardOriginalIdentity.mockReturnValue({ sha256: 'a'.repeat(64) });
        readEmbeddedModinfo.mockReturnValue(modRecord());

        const [result] = await detectUnknownModCacheMatches([
            { modId: 'm1', fileName: 'pak01_dir.vpk', vpkPath: IMPRINTED },
        ]);

        expect(result.crcMatch).toMatchObject({
            status: 'found',
            provenance: 'embedded-metadata',
            modId: 4242,
            modName: 'Boom Melee',
            fileId: 9001,
            section: 'Sound',
            categoryName: 'Hero Sounds',
        });
    });

    it('derives the Sound section and file id from legacy addoninfo keys', async () => {
        readEmbeddedAddonInfo.mockReturnValue(
            addonInfo({
                gamebananaId: '1234',
                gamebananaFileId: '5678',
                sourceUrl: 'https://gamebanana.com/sounds/1234',
                title: 'Legacy Sound',
            })
        );
        carryForwardOriginalIdentity.mockReturnValue({ sha256: 'a'.repeat(64) });
        readEmbeddedModinfo.mockReturnValue(null);

        const [result] = await detectUnknownModCacheMatches([
            { modId: 'm1', fileName: 'pak01_dir.vpk', vpkPath: IMPRINTED },
        ]);

        expect(result.crcMatch).toMatchObject({
            status: 'found',
            provenance: 'embedded-metadata',
            modId: 1234,
            fileId: 5678,
            section: 'Sound',
        });
    });

    it('leaves the section undefined when a legacy embed cannot say', async () => {
        readEmbeddedAddonInfo.mockReturnValue(
            addonInfo({ gamebananaId: '1234', sourceUrl: undefined })
        );
        carryForwardOriginalIdentity.mockReturnValue({ sha256: 'a'.repeat(64) });
        readEmbeddedModinfo.mockReturnValue(null);

        const [result] = await detectUnknownModCacheMatches([
            { modId: 'm1', fileName: 'pak01_dir.vpk', vpkPath: IMPRINTED },
        ]);

        expect(result.crcMatch.status).toBe('found');
        expect(result.crcMatch.section).toBeUndefined();
        expect(result.crcMatch.fileId).toBeUndefined();
    });

    it('still reconstructs merge sources from a kind:"merge" record', async () => {
        readEmbeddedAddonInfo.mockReturnValue(addonInfo({ gamebananaId: undefined }));
        carryForwardOriginalIdentity.mockReturnValue({ sha256: 'a'.repeat(64) });
        readEmbeddedModinfo.mockReturnValue(
            modRecord({
                kind: 'merge',
                title: 'My Merge',
                source: undefined,
                merge: { title: 'My Merge' },
                sources: [
                    {
                        title: 'Mod A',
                        gamebananaId: 11,
                        gamebananaFileId: 22,
                        section: 'Mod',
                        fileNameAtMergeTime: 'a_dir.vpk',
                    },
                ],
            } as Partial<ModinfoRecord>)
        );

        const [result] = await detectUnknownModCacheMatches([
            { modId: 'm1', fileName: 'pak01_dir.vpk', vpkPath: IMPRINTED },
        ]);

        expect(result.crcMatch).toMatchObject({
            status: 'found',
            provenance: 'embedded-merge',
            modName: 'My Merge',
        });
        expect(result.crcMatch.mergeSources).toEqual([
            {
                modName: 'Mod A',
                gameBananaId: 11,
                gameBananaFileId: 22,
                section: 'Mod',
                fileName: 'a_dir.vpk',
            },
        ]);
    });

    it('never hashes an embed-carrying input and fingerprints only the rest', async () => {
        readEmbeddedAddonInfo.mockImplementation((path) =>
            path === IMPRINTED ? addonInfo() : null
        );
        carryForwardOriginalIdentity.mockReturnValue({ sha256: 'a'.repeat(64) });
        readEmbeddedModinfo.mockImplementation((path) =>
            path === IMPRINTED ? modRecord() : null
        );
        fingerprintFilesInWorkers.mockResolvedValue([{ id: 'm2', crc32: 'deadbeef', size: 100 }]);

        const results = await detectUnknownModCacheMatches([
            { modId: 'm1', fileName: 'pak01_dir.vpk', vpkPath: IMPRINTED },
            { modId: 'm2', fileName: 'pak02_dir.vpk', vpkPath: PLAIN },
        ]);

        expect(results).toHaveLength(2);
        // Only the embed-less input reaches the worker fingerprint pass; the
        // imprinted one was answered by the cheap directory-parse probe.
        expect(fingerprintFilesInWorkers).toHaveBeenCalledTimes(1);
        expect(fingerprintFilesInWorkers.mock.calls[0][0]).toEqual([
            { id: 'm2', filePath: PLAIN },
        ]);
    });

    it('falls through to fingerprinting when the embed lacks an identity anchor', async () => {
        readEmbeddedAddonInfo.mockReturnValue(addonInfo());
        carryForwardOriginalIdentity.mockReturnValue(null);
        readEmbeddedModinfo.mockReturnValue(modRecord());

        await detectUnknownModCacheMatches([
            { modId: 'm1', fileName: 'pak01_dir.vpk', vpkPath: IMPRINTED },
        ]);

        expect(fingerprintFilesInWorkers).toHaveBeenCalledTimes(1);
        expect(fingerprintFilesInWorkers.mock.calls[0][0]).toEqual([
            { id: 'm1', filePath: IMPRINTED },
        ]);
    });
});
