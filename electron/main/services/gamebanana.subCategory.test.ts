import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
    BrowserWindow: class BrowserWindow {
        static getAllWindows() { return []; }
    },
}));
vi.mock('./modDatabase', () => ({
    getCachedCategoryTree: vi.fn(),
    saveCachedCategoryTree: vi.fn(),
}));
vi.mock('./modRequirementCache', () => ({ cacheRequirements: vi.fn() }));

import { fetchCollectionItems, fetchModDetails, fetchSubmissions } from './gamebanana';

// Trimmed from the live Mod/Index list response on 2026-10-16. The list
// endpoint gives both categories as name + profile URL and no _idRow, and sends
// _aSubCategory as null for a mod filed directly under its root category.
const payload = {
    _aMetadata: { _nRecordCount: 2, _nPerpage: 50, _bIsComplete: true },
    _aRecords: [
        {
            _idRow: 681048,
            _sName: 'Graves -> Ashley Graves',
            _sProfileUrl: 'https://gamebanana.com/mods/681048',
            _tsDateAdded: 1790000000,
            _tsDateModified: 1790000001,
            _nLikeCount: 3,
            _nViewCount: 40,
            _bHasFiles: true,
            _aRootCategory: { _sName: 'Skins', _sProfileUrl: 'https://gamebanana.com/mods/cats/33295', _sIconUrl: '' },
            _aSubCategory: {
                _sName: 'Graves',
                _sProfileUrl: 'https://gamebanana.com/mods/cats/42674',
                _sIconUrl: 'https://images.gamebanana.com/img/ico/ModCategory/69959cf637664.png',
            },
        },
        {
            _idRow: 700001,
            _sName: 'Silver crosshair',
            _sProfileUrl: 'https://gamebanana.com/mods/700001',
            _tsDateAdded: 1790000010,
            _tsDateModified: 1790000011,
            _nLikeCount: 1,
            _nViewCount: 9,
            _bHasFiles: true,
            _aRootCategory: { _sName: 'HUD', _sProfileUrl: 'https://gamebanana.com/mods/cats/31713', _sIconUrl: '' },
            _aSubCategory: null,
        },
    ],
};

describe('fetchSubmissions sub-category', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('reads the sub-category id from its profile URL and leaves a root-only mod without one', async () => {
        const fetchMock = vi.fn(async () => new Response(JSON.stringify(payload), { status: 200 }));
        vi.stubGlobal('fetch', fetchMock);

        const { records } = await fetchSubmissions('Mod', 1, 50);

        expect(String((fetchMock.mock.calls[0] as unknown[])[0])).toContain('_aSubCategory');
        expect(records[0].rootCategory?.name).toBe('Skins');
        expect(records[0].subCategory).toMatchObject({ id: 42674, name: 'Graves' });
        expect(records[1].subCategory).toBeUndefined();
    });
});

describe('GameBanana image captions', () => {
    afterEach(() => vi.unstubAllGlobals());

    it.each(['details', 'browse', 'collection'] as const)('preserves captions from %s without another request', async source => {
        const record = {
            ...payload._aRecords[0],
            _aPreviewMedia: {
                _aImages: [
                    { _sBaseUrl: 'https://images.gamebanana.com/img/ss/mods', _sFile: 'first.jpg', _sCaption: 'why u bulleh meh' },
                    { _sBaseUrl: 'https://images.gamebanana.com/img/ss/mods', _sFile: 'second.jpg' },
                    { _sBaseUrl: 'https://images.gamebanana.com/img/ss/mods', _sFile: 'third.jpg', _sCaption: '  ' },
                ],
                _aMetadata: { _sAudioUrl: 'https://example.com/preview.mp3' },
            },
        };
        const fetch = vi.fn(async () => Response.json(source === 'details' ? record : { ...payload, _aRecords: [record] }));
        vi.stubGlobal('fetch', fetch);

        const result = source === 'details' ? await fetchModDetails(record._idRow)
            : (source === 'browse' ? await fetchSubmissions('Mod', 1, 50) : await fetchCollectionItems(1)).records[0];

        expect(result.previewMedia?.images).toEqual([
            expect.objectContaining({ file: 'first.jpg', caption: 'why u bulleh meh' }),
            expect.objectContaining({ file: 'second.jpg', caption: undefined }),
            expect.objectContaining({ file: 'third.jpg', caption: undefined }),
        ]);
        expect(result.previewMedia?.metadata?.audioUrl).toBe('https://example.com/preview.mp3');
        expect(fetch).toHaveBeenCalledTimes(1);
    });
});
