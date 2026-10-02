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

import { fetchModFileList } from './gamebanana';

// Trimmed from the live `?_csvProperties=_idRow,_aFiles` response for mod
// 627024 on 2026-10-02. GameBanana omits _sDescription when the author left
// it blank, and archived rows come back in the same array.
const payload = {
    _idRow: 627024,
    _aFiles: [
        {
            _idRow: 1834531,
            _sFile: 'heliosmagicianandassistant_b1537.zip',
            _nFilesize: 1,
            _tsDateAdded: 1790954488,
            _nDownloadCount: 10,
            _sDownloadUrl: 'https://gamebanana.com/dl/1834531',
            _sMd5Checksum: 'cfa76cd167a039365e1d6e6195485fd5',
            _sDescription: 'Model + Assistant',
            _bIsArchived: false,
        },
        {
            _idRow: 1748195,
            _sFile: 'heliosmagician_75405.zip',
            _nFilesize: 1,
            _tsDateAdded: 1783451132,
            _nDownloadCount: 10,
            _sDownloadUrl: 'https://gamebanana.com/dl/1748195',
            _sMd5Checksum: 'b5efc33c1193252d199a89c217a8968e',
            _sDescription: 'Model + Assistant + VO',
            _bIsArchived: true,
        },
        {
            _idRow: 1627686,
            _sFile: 'optional_addon_neutral_icons.zip',
            _nFilesize: 1,
            _tsDateAdded: 1771311454,
            _nDownloadCount: 10,
            _sDownloadUrl: 'https://gamebanana.com/dl/1627686',
            _sMd5Checksum: '708cd96ddbb6c66ca8725c21930d033c',
            _bIsArchived: true,
        },
    ],
};

describe('fetchModFileList', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('maps the identity fields the update classifier needs from the slim file list', async () => {
        const fetchMock = vi.fn(async () => new Response(JSON.stringify(payload), { status: 200 }));
        vi.stubGlobal('fetch', fetchMock);

        const list = await fetchModFileList(627024);

        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(String((fetchMock.mock.calls[0] as unknown[])[0])).toContain('/Mod/627024?_csvProperties=_idRow,_aFiles');
        expect(list).toEqual({
            id: 627024,
            files: [
                {
                    id: 1834531,
                    fileName: 'heliosmagicianandassistant_b1537.zip',
                    isArchived: false,
                    description: 'Model + Assistant',
                    dateAdded: 1790954488,
                },
                {
                    id: 1748195,
                    fileName: 'heliosmagician_75405.zip',
                    isArchived: true,
                    description: 'Model + Assistant + VO',
                    dateAdded: 1783451132,
                },
                {
                    id: 1627686,
                    fileName: 'optional_addon_neutral_icons.zip',
                    isArchived: true,
                    description: undefined,
                    dateAdded: 1771311454,
                },
            ],
        });
    });
});
