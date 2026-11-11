/**
 * Some packers write a root-level file's directory as an empty string instead
 * of the usual single space. A community Ivy skin packed its
 * tools_thumbnail_cache.sqlite3 that way. Read as the end of the extension's
 * directory list, the file name became the next extension and the rest of the
 * tree was misread, so the walk never reached the tree terminator.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { parseVpkDirectory, parseVpkEntryStats, readVpkEntryBytes, vpkHasEntry } from './vpk';
import { parseVpksInWorkers } from './workers';

type File = [extension: string, directory: string, name: string, bytes: string];

/** A single-file v2 VPK. `directory` is written verbatim, so '' reproduces the odd root. */
function vpk(files: File[]): Buffer {
    const tree: Buffer[] = [];
    const data: Buffer[] = [];
    let dataLength = 0;
    const text = (value: string) => tree.push(Buffer.from(`${value}\0`, 'utf8'));
    for (const extension of [...new Set(files.map(file => file[0]))]) {
        text(extension);
        const inExtension = files.filter(file => file[0] === extension);
        for (const directory of [...new Set(inExtension.map(file => file[1]))]) {
            text(directory);
            for (const [, , name, bytes] of inExtension.filter(file => file[1] === directory)) {
                text(name);
                const payload = Buffer.from(bytes, 'utf8');
                const entry = Buffer.alloc(18);
                entry.writeUInt16LE(0x7fff, 6);
                entry.writeUInt32LE(dataLength, 8);
                entry.writeUInt32LE(payload.length, 12);
                entry.writeUInt16LE(0xffff, 16);
                tree.push(entry);
                data.push(payload);
                dataLength += payload.length;
            }
            tree.push(Buffer.from([0]));
        }
        tree.push(Buffer.from([0]));
    }
    tree.push(Buffer.from([0]));
    const treeBytes = Buffer.concat(tree);
    const header = Buffer.alloc(28);
    header.writeUInt32LE(0x55aa1234, 0);
    header.writeUInt32LE(2, 4);
    header.writeUInt32LE(treeBytes.length, 8);
    header.writeUInt32LE(dataLength, 12);
    return Buffer.concat([header, treeBytes, ...data]);
}

const dir = mkdtempSync(join(tmpdir(), 'grimoire-vpk-root-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function fixture(name: string, files: File[]): string {
    const path = join(dir, name);
    writeFileSync(path, vpk(files));
    return path;
}

// The layout of the skin that hit this: the root file comes last.
const SKIN: File[] = [
    ['vmdl_c', 'models/heroes_wip/ivy', 'ivy', 'model'],
    ['sqlite3', '', 'tools_thumbnail_cache', 'cache'],
];
const SKIN_PATHS = ['models/heroes_wip/ivy/ivy.vmdl_c', 'tools_thumbnail_cache.sqlite3'];

describe('a root directory written as an empty string', () => {
    it('lists every entry and reaches the tree terminator', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        try {
            expect(parseVpkDirectory(fixture('skin_dir.vpk', SKIN))).toEqual(SKIN_PATHS);
            expect(warn).not.toHaveBeenCalled();
        } finally {
            warn.mockRestore();
        }
    });

    it('keeps the entries that follow it', () => {
        const path = fixture('mixed_dir.vpk', [
            ['txt', '', 'readme', 'root'],
            ['txt', 'notes', 'todo', 'nested'],
            ['vmat_c', 'materials', 'skin', 'material'],
        ]);
        expect(parseVpkDirectory(path)).toEqual(['readme.txt', 'notes/todo.txt', 'materials/skin.vmat_c']);
    });

    it('reads sizes and bytes of the root entry', () => {
        const path = fixture('stats_dir.vpk', SKIN);
        expect(parseVpkEntryStats(path)?.map(entry => entry.path)).toEqual(SKIN_PATHS);
        expect(vpkHasEntry(path, 'tools_thumbnail_cache.sqlite3')).toBe(true);
        expect(readVpkEntryBytes(path, 'tools_thumbnail_cache.sqlite3')?.toString()).toBe('cache');
        expect(readVpkEntryBytes(path, 'models/heroes_wip/ivy/ivy.vmdl_c')?.toString()).toBe('model');
    });

    it('parses the same way in the worker copy', async () => {
        const path = fixture('worker_dir.vpk', SKIN);
        const [result] = await parseVpksInWorkers([{ id: 'skin', vpkPath: path }]);
        expect(result.paths).toEqual(SKIN_PATHS);
    });

    it('still reads the usual single-space root', () => {
        const path = fixture('space_dir.vpk', [['txt', ' ', 'readme', 'root'], ['txt', 'notes', 'todo', 'nested']]);
        expect(parseVpkDirectory(path)).toEqual(['readme.txt', 'notes/todo.txt']);
    });
});
