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

import { fetchSubmissions } from './gamebanana';

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
