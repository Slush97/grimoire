import { describe, expect, it } from 'vitest';
import { bmpWithExplicitAlpha, groupCursorFiles, isCursorFileName, isUsableCursorFile } from './cursorFiles';

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

function rgbBmp(pixels: number[]): Buffer {
    const bmp = Buffer.alloc(54 + pixels.length);
    bmp.write('BM', 0, 'latin1');
    bmp.writeUInt32LE(bmp.length, 2);
    bmp.writeUInt32LE(54, 10);
    bmp.writeUInt32LE(40, 14);
    bmp.writeInt32LE(2, 18);
    bmp.writeInt32LE(1, 22);
    bmp.writeUInt16LE(1, 26);
    bmp.writeUInt16LE(32, 28);
    Buffer.from(pixels).copy(bmp, 54);
    return bmp;
}

describe('bmpWithExplicitAlpha', () => {
    it('re-headers a 32-bit BI_RGB image with alpha as BITMAPV5 with an alpha mask', () => {
        const pixels = [0xff, 0xff, 0xff, 0x00, 0x10, 0x20, 0x30, 0xff];
        const out = bmpWithExplicitAlpha(rgbBmp(pixels));
        expect(out.readUInt32LE(2)).toBe(out.length);
        expect(out.readUInt32LE(10)).toBe(138);
        expect(out.readUInt32LE(14)).toBe(124);
        expect(out.readInt32LE(18)).toBe(2);
        expect(out.readInt32LE(22)).toBe(1);
        expect(out.readUInt32LE(30)).toBe(3);
        expect(out.readUInt32LE(66)).toBe(0xff000000);
        expect([...out.subarray(138)]).toEqual(pixels);
    });

    it('leaves an all-zero alpha channel alone, since SDL loads it opaque', () => {
        const bmp = rgbBmp([1, 2, 3, 0, 4, 5, 6, 0]);
        expect(bmpWithExplicitAlpha(bmp)).toBe(bmp);
    });

    it('passes through images that already carry masks, and junk', () => {
        const v5 = rgbBmp([1, 2, 3, 0x80, 4, 5, 6, 0]);
        v5.writeUInt32LE(3, 30);
        expect(bmpWithExplicitAlpha(v5)).toBe(v5);
        const junk = Buffer.from('BM-stock');
        expect(bmpWithExplicitAlpha(junk)).toBe(junk);
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
