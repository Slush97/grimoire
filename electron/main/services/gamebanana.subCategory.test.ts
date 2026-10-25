import { afterEach, describe, expect, it, vi } from 'vitest';

const categoryCache = vi.hoisted(() => ({ get: vi.fn(), save: vi.fn() }));

vi.mock('electron', () => ({
    BrowserWindow: class BrowserWindow {
        static getAllWindows() { return []; }
    },
}));
vi.mock('./modDatabase', () => ({
    getCachedCategoryTree: categoryCache.get,
    saveCachedCategoryTree: categoryCache.save,
}));
vi.mock('./modRequirementCache', () => ({ cacheRequirements: vi.fn() }));
vi.mock('./rateLimiter', () => ({ gamebananaRateLimiter: { acquire: async () => {} } }));

import { fetchCategoryTreeCached, fetchCollectionItems, fetchModDetails, fetchSubmissions } from './gamebanana';

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
        expect(records[0].rootCategory).toMatchObject({ id: 33295, name: 'Skins' });
        expect(records[0].subCategory).toMatchObject({ id: 42674, name: 'Graves' });
        expect(records[1].subCategory).toBeUndefined();
    });

    it('normalizes detail categories without a numeric ID and retains collection leaf categories', async () => {
        const record = {
            ...payload._aRecords[0],
            _aCategory: payload._aRecords[0]._aSubCategory,
        };
        vi.stubGlobal('fetch', vi.fn(async (url: string) => Response.json(
            url.includes('/Collection/') ? { ...payload, _aRecords: [record] } : record,
        )));

        expect((await fetchModDetails(record._idRow)).category).toMatchObject({ id: 42674, name: 'Graves' });
        const collection = (await fetchCollectionItems(1)).records[0];
        expect(collection.rootCategory).toMatchObject({ id: 33295, name: 'Skins' });
        expect(collection.subCategory).toMatchObject({ id: 42674, name: 'Graves' });
    });
});

describe('cached GameBanana category trees', () => {
    afterEach(() => {
        categoryCache.get.mockReset();
        categoryCache.save.mockReset();
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it('shares an initial request and retains parent IDs from the live tree shape', async () => {
        const fetch = vi.fn(async () => Response.json([{
            _idRow: 33295,
            _sName: 'Skins',
            _nItemCount: 10,
            _aChildren: [{ _idRow: 49629, _sName: 'Rat King', _nItemCount: 2, _idParentRow: 33295 }],
        }]));
        vi.stubGlobal('fetch', fetch);

        const [first, second] = await Promise.all([
            fetchCategoryTreeCached('ModCategory'),
            fetchCategoryTreeCached('ModCategory'),
        ]);

        expect(fetch).toHaveBeenCalledTimes(1);
        expect(first).toBe(second);
        expect(first[0].children?.[0]).toMatchObject({ id: 49629, parentId: 33295 });
        expect(categoryCache.save).toHaveBeenCalledTimes(1);
    });

    it('serves fresh stored trees without another request', async () => {
        const nodes = [{ id: 33295, name: 'Skins', itemCount: 10 }];
        categoryCache.get.mockReturnValue({ fetchedAt: Date.now(), payload: JSON.stringify(nodes) });
        const fetch = vi.fn();
        vi.stubGlobal('fetch', fetch);

        expect(await fetchCategoryTreeCached('ModCategory')).toEqual(nodes);
        expect(fetch).not.toHaveBeenCalled();
    });

    it('preserves network failures on cold loads but falls back when revalidating a stored tree', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        const failure = new Error('offline');
        vi.stubGlobal('fetch', vi.fn().mockRejectedValue(failure));
        await expect(fetchCategoryTreeCached('ModCategory')).rejects.toBe(failure);

        const nodes = [{ id: 33295, name: 'Skins', itemCount: 10 }];
        categoryCache.get.mockReturnValue({ fetchedAt: 0, payload: JSON.stringify(nodes) });
        expect(await fetchCategoryTreeCached('ModCategory', true)).toEqual(nodes);
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
