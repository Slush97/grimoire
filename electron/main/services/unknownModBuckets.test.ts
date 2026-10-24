/**
 * Coverage for which GameBanana categories the unknown-mod search probes and
 * what category it records for a match. Buckets must carry real category names
 * and ids (including Animations and Quality of Life/Fixes), the runner-up
 * bucket must only spend page budget the best bucket left over, and a match
 * must record the mod's own category rather than the bucket it was found in.
 * Every fs/electron/network dependency is stubbed inert, same pattern as
 * unknownModEmbedDetect.test.ts.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { GameBananaCategory, GameBananaMod } from '../../../src/types/gamebanana';
import type { UnknownCrcFile, UnknownCrcFileInput } from './unknownCrcCache';

vi.mock('./archiveCrc', () => ({
    crc32File: vi.fn(async () => 'deadbeef'),
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
vi.mock('./vpkIdentity', () => ({
    readEmbeddedAddonInfo: vi.fn(() => null),
    carryForwardOriginalIdentity: vi.fn(() => null),
}));
vi.mock('./modinfoFormat', () => ({ readEmbeddedModinfo: vi.fn(() => null) }));
vi.mock('./workers', () => ({ fingerprintFilesInWorkers: vi.fn(async () => []) }));
vi.mock('./unknownCrcCache', () => ({
    getUnknownCrcEntryCount: vi.fn(() => 0),
    getUnknownCrcFilesForMods: vi.fn(() => new Map()),
    lookupUnknownCrcMatch: vi.fn(() => null),
    lookupUnknownCrcMatches: vi.fn(() => new Map()),
    replaceUnknownCrcEntries: vi.fn(),
    updateUnknownCrcFileStatus: vi.fn(),
    upsertUnknownCrcFiles: vi.fn(),
    UNKNOWN_CRC_PARSER_VERSION: 1,
}));

import { fetchGameBananaArchiveVpkCrcEntries } from './archiveCrc';
import { fetchModsFilesMetadata, fetchSubmissions } from './gamebanana';
import { parseVpkDirectory } from './vpk';
import { upsertUnknownCrcFiles } from './unknownCrcCache';
import { detectUnknownModFilters } from './unknownModDetection';

const VINDICTA_MODEL = ['models/heroes_wip/hornet/hornet.vmdl_c'];

let workDir: string;
let vpkPath: string;

beforeAll(() => {
    workDir = mkdtempSync(join(tmpdir(), 'unknown-buckets-'));
    vpkPath = join(workDir, 'pak01_dir.vpk');
    writeFileSync(vpkPath, 'abc');
});

afterAll(() => {
    rmSync(workDir, { recursive: true, force: true });
});

function category(name: string, id?: number): GameBananaCategory {
    return { id, name, profileUrl: id ? `https://gamebanana.com/mods/cats/${id}` : undefined };
}

function candidate(id: number, rootCategory: GameBananaCategory, subCategory?: GameBananaCategory): GameBananaMod {
    return {
        id,
        name: `Candidate ${id}`,
        profileUrl: `https://gamebanana.com/mods/${id}`,
        dateAdded: 1,
        dateModified: 1,
        likeCount: 0,
        viewCount: 0,
        hasFiles: true,
        nsfw: false,
        rootCategory,
        subCategory,
    };
}

beforeEach(() => {
    vi.mocked(fetchSubmissions).mockReset();
    vi.mocked(fetchModsFilesMetadata).mockReset();
    vi.mocked(fetchGameBananaArchiveVpkCrcEntries).mockReset();
    vi.mocked(upsertUnknownCrcFiles).mockReset();

    vi.mocked(fetchModsFilesMetadata).mockImplementation(async (requests) =>
        requests.map(({ id, section }) => ({
            modId: id,
            section,
            files: [{
                id: id * 10,
                fileName: 'candidate.zip',
                fileSize: 10,
                downloadUrl: `https://files.example/${id}`,
                downloadCount: 0,
                isArchived: false,
            }],
        }))
    );
    vi.mocked(upsertUnknownCrcFiles).mockImplementation((files: UnknownCrcFileInput[]) =>
        files.map((file): UnknownCrcFile => ({
            ...file,
            archiveType: null,
            status: 'pending',
            error: null,
            bytesFetched: 0,
            checkedAt: null,
            parserVersion: 0,
        }))
    );
    vi.mocked(fetchGameBananaArchiveVpkCrcEntries).mockResolvedValue({
        archiveType: 'zip',
        entries: [],
        bytesFetched: 0,
    });
});

function searchedCategoryIds(): Array<number | undefined> {
    return vi.mocked(fetchSubmissions).mock.calls.map((call) => call[4]);
}

describe('unknown mod search buckets', () => {
    it('probes Animations for clip-only mods', async () => {
        vi.mocked(parseVpkDirectory).mockReturnValue([
            'models/heroes_wip/hornet/clips/idle.vnmclip_c',
            'models/heroes_wip/hornet/clips/run.vnmclip_c',
        ]);
        vi.mocked(fetchSubmissions).mockResolvedValue({ records: [], totalCount: 0, isComplete: true, perPage: 50 });

        const guess = await detectUnknownModFilters('m1', 'pak01_dir.vpk', vpkPath);

        expect(guess.categoryName).toBe('Animations');
        expect(searchedCategoryIds()[0]).toBe(47611);
    });

    it('names Gameplay Modifications and falls through to Quality of Life/Fixes', async () => {
        vi.mocked(parseVpkDirectory).mockReturnValue(['scripts/abilities.vdata_c']);
        vi.mocked(fetchSubmissions).mockResolvedValue({ records: [], totalCount: 0, isComplete: true, perPage: 50 });

        const guess = await detectUnknownModFilters('m2', 'pak01_dir.vpk', vpkPath);

        expect(guess.categoryName).toBe('Gameplay Modifications');
        expect(searchedCategoryIds()).toEqual([33331, 46154]);
    });

    it('does not invent a category name for Sound', async () => {
        vi.mocked(parseVpkDirectory).mockReturnValue(['sounds/vo/line.vsnd_c']);
        vi.mocked(fetchSubmissions).mockResolvedValue({ records: [], totalCount: 0, isComplete: true, perPage: 50 });

        const guess = await detectUnknownModFilters('m3', 'pak01_dir.vpk', vpkPath);

        expect(guess.section).toBe('Sound');
        expect(guess.categoryName).toBeUndefined();
        expect(guess.contentHints[0]).toMatch(/^Sound \(/);
    });

    it('records the matched mod\'s own category, found through the runner-up bucket', async () => {
        vi.mocked(parseVpkDirectory).mockReturnValue(VINDICTA_MODEL);
        // The list endpoint omits the root category id; it only rides in the URL.
        vi.mocked(fetchSubmissions).mockImplementation(async (_section, _page, _perPage, _search, categoryId) => ({
            records: categoryId === 33324
                ? [candidate(1, category('Skins'), category('Faithful/Vanilla+', 50572))]
                : [candidate(2, { name: 'Model Replacement', profileUrl: 'https://gamebanana.com/mods/cats/33154' })],
            totalCount: 1,
            isComplete: true,
            perPage: 50,
        }));
        vi.mocked(fetchGameBananaArchiveVpkCrcEntries).mockImplementation(async (file) => ({
            archiveType: 'zip',
            bytesFetched: 0,
            entries: file.downloadUrl.endsWith('/2')
                ? [{ name: 'pak01_dir.vpk', crc32: 'DEADBEEF', compressedSize: 3, uncompressedSize: 3 }]
                : [],
        }));

        const guess = await detectUnknownModFilters('m4', 'pak01_dir.vpk', vpkPath);

        expect(searchedCategoryIds()).toEqual([33324, 33154]);
        expect(guess.crcMatch).toMatchObject({
            status: 'found',
            modId: 2,
            categoryId: 33154,
            categoryName: 'Model Replacement',
        });
        const stored = vi.mocked(upsertUnknownCrcFiles).mock.calls.flatMap(([files]) => files);
        expect(stored.map(({ modId, categoryId, categoryName }) => ({ modId, categoryId, categoryName }))).toEqual([
            { modId: 1, categoryId: 50572, categoryName: 'Faithful/Vanilla+' },
            { modId: 2, categoryId: 33154, categoryName: 'Model Replacement' },
        ]);
    });

    it('never fetches more pages than the single-bucket search did', async () => {
        vi.mocked(parseVpkDirectory).mockReturnValue(VINDICTA_MODEL);
        vi.mocked(fetchSubmissions).mockImplementation(async (_section, page, _perPage, _search, categoryId) => ({
            records: [candidate((categoryId ?? 0) * 100 + page, category('Skins'))],
            totalCount: 1000,
            isComplete: false,
            perPage: 50,
        }));

        const guess = await detectUnknownModFilters('m5', 'pak01_dir.vpk', vpkPath);

        expect(guess.crcMatch.status).toBe('not-found');
        expect(vi.mocked(fetchSubmissions)).toHaveBeenCalledTimes(8);
        expect(new Set(searchedCategoryIds())).toEqual(new Set([33324]));
    });

    it('spends only the leftover pages on the runner-up', async () => {
        vi.mocked(parseVpkDirectory).mockReturnValue(VINDICTA_MODEL);
        vi.mocked(fetchSubmissions).mockImplementation(async (_section, page, _perPage, _search, categoryId) => ({
            records: [candidate((categoryId ?? 0) * 100 + page, category('Skins'))],
            totalCount: categoryId === 33324 ? 150 : 1000,
            isComplete: false,
            perPage: 50,
        }));

        await detectUnknownModFilters('m6', 'pak01_dir.vpk', vpkPath);

        expect(searchedCategoryIds()).toEqual([33324, 33324, 33324, 33154, 33154, 33154, 33154, 33154]);
    });
});
