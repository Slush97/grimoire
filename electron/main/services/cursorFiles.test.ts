import { describe, expect, it } from 'vitest';
import { groupCursorFiles, isCursorFileName, isUsableCursorFile } from './cursorFiles';

describe('isCursorFileName', () => {
    it('accepts the stock cursor set, size variants and cursor.res', () => {
        for (const name of ['cursor.bmp', 'cursor_ping.bmp', 'Cursor_Shop.BMP', 'cursor_commend.bmp', 'cursor_vsz64.bmp', 'cursor_ping_vsz32.bmp', 'cursor.res']) {
            expect(isCursorFileName(name), name).toBe(true);
        }
    });

    it('rejects anything else an archive might carry', () => {
        for (const name of ['readme.txt', 'preview.png', 'cursor.png', 'my cursor.bmp', 'pak01_dir.vpk', 'other.res', 'cursor_ping.res']) {
            expect(isCursorFileName(name), name).toBe(false);
        }
    });
});

describe('isUsableCursorFile', () => {
    it('requires the BMP signature on images', () => {
        expect(isUsableCursorFile('cursor.bmp', Buffer.from('BM....'))).toBe(true);
        expect(isUsableCursorFile('cursor.bmp', Buffer.from('\x89PNG'))).toBe(false);
        expect(isUsableCursorFile('cursor.res', Buffer.from('"resource/cursor/cursor.res" {}'))).toBe(true);
        expect(isUsableCursorFile('cursor.bmp', Buffer.alloc(0))).toBe(false);
    });
});

describe('groupCursorFiles', () => {
    it('treats one folder of cursors as a single set', () => {
        const groups = groupCursorFiles([
            { path: '/x/a', fileName: 'cursor.bmp', archiveFolder: 'cursors' },
            { path: '/x/b', fileName: 'Cursor_Ping.bmp', archiveFolder: 'cursors' },
            { path: '/x/c', fileName: 'readme.txt', archiveFolder: 'cursors' },
        ]);
        expect(groups).toHaveLength(1);
        expect(groups[0].variant).toBeUndefined();
        expect([...groups[0].files.keys()]).toEqual(['cursor.bmp', 'cursor_ping.bmp']);
    });

    it('splits sibling folders into variants', () => {
        const groups = groupCursorFiles([
            { path: '/l/a', fileName: 'cursor.bmp', archiveFolder: 'Large' },
            { path: '/s/a', fileName: 'cursor.bmp', archiveFolder: 'Small' },
        ]);
        expect(groups.map((g) => [g.variant, g.files.get('cursor.bmp')])).toEqual([
            ['Large', '/l/a'],
            ['Small', '/s/a'],
        ]);
    });

    it('drops a set with no image', () => {
        expect(groupCursorFiles([{ path: '/r', fileName: 'cursor.res' }])).toEqual([]);
    });
});
