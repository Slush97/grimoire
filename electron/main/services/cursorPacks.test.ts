import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import AdmZip from 'adm-zip';

const harness = vi.hoisted(() => ({ userData: '' }));

vi.mock('../utils/paths', () => ({
    getUserDataPath: () => harness.userData,
    getDevDeadlockPath: () => join(harness.userData, 'dev-deadlock'),
}));

import {
    createCursorPack,
    deleteCursorPack,
    exportCursorZip,
    gameCursorsDir,
    getCursorPacks,
    getCursorPreview,
    installCursorArchive,
    reconcileCursorPack,
    setActiveCursorPack,
} from './cursorPacks';
import { parseCursorRes } from './cursorFiles';

let root: string;
let deadlockPath: string;
let cursors: string;

const read = (name: string) => readFileSync(join(cursors, name), 'utf8');

function cursorZip(name: string, files: Record<string, string>): string {
    const zip = new AdmZip();
    for (const [entry, content] of Object.entries(files)) zip.addFile(entry, Buffer.from(content));
    const path = join(root, name);
    zip.writeZip(path);
    return path;
}

async function install(files: Record<string, string>, fileId = 10) {
    const workDir = mkdtempSync(join(root, 'work-'));
    return installCursorArchive(cursorZip(`m${fileId}.zip`, files), workDir, {
        name: 'Kitty Paw',
        gameBananaId: 1,
        gameBananaFileId: fileId,
    });
}

beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'cursor-packs-'));
    harness.userData = join(root, 'userData');
    deadlockPath = join(root, 'Deadlock');
    cursors = gameCursorsDir(deadlockPath);
    mkdirSync(cursors, { recursive: true });
    writeFileSync(join(cursors, 'cursor.bmp'), 'BM-stock');
    writeFileSync(join(cursors, 'cursor_ping.bmp'), 'BM-stock-ping');
    writeFileSync(join(cursors, 'cursor.res'), 'stock-res');
});

describe('cursor packs', () => {
    it('installs only valid cursor images from a no-VPK archive', async () => {
        const packs = await install({
            'cursor.bmp': 'BM-kitty',
            'Cursor_Ping.bmp': 'BM-kitty-ping',
            'cursor_shop.bmp': 'not a bitmap',
            'readme.txt': 'hi',
        });
        expect(packs).toHaveLength(1);
        expect(packs[0].files).toEqual(['cursor.bmp', 'cursor_ping.bmp']);
        expect((await getCursorPacks()).packs.map((p) => p.name)).toEqual(['Kitty Paw']);
    });

    it('installs nothing from an archive without cursor images', async () => {
        expect(await install({ 'readme.txt': 'hi', 'preview.png': 'x' })).toEqual([]);
    });

    it('applies a pack over the stock files and restores them', async () => {
        const [pack] = await install({ 'cursor.bmp': 'BM-kitty', 'cursor_vsz64.bmp': 'BM-kitty-64' });

        await setActiveCursorPack(deadlockPath, pack.id);
        expect(read('cursor.bmp')).toBe('BM-kitty');
        expect(read('cursor_vsz64.bmp')).toBe('BM-kitty-64');
        expect(read('cursor_ping.bmp')).toBe('BM-stock-ping');

        const state = await setActiveCursorPack(deadlockPath, null);
        expect(state.activeId).toBeNull();
        expect(read('cursor.bmp')).toBe('BM-stock');
        expect(existsSync(join(cursors, 'cursor_vsz64.bmp'))).toBe(false);
    });

    it('switching packs never leaves the previous pack behind', async () => {
        const [a] = await install({ 'cursor.bmp': 'BM-a', 'cursor_ping.bmp': 'BM-a-ping' }, 10);
        const [b] = await install({ 'cursor.bmp': 'BM-b' }, 11);

        await setActiveCursorPack(deadlockPath, a.id);
        await setActiveCursorPack(deadlockPath, b.id);
        expect(read('cursor.bmp')).toBe('BM-b');
        expect(read('cursor_ping.bmp')).toBe('BM-stock-ping');
    });

    it('reapplies after a game update and adopts the new stock files', async () => {
        const [pack] = await install({ 'cursor.bmp': 'BM-kitty' });
        await setActiveCursorPack(deadlockPath, pack.id);

        writeFileSync(join(cursors, 'cursor.bmp'), 'BM-stock-v2');
        await reconcileCursorPack(deadlockPath);
        expect(read('cursor.bmp')).toBe('BM-kitty');

        await setActiveCursorPack(deadlockPath, null);
        expect(read('cursor.bmp')).toBe('BM-stock-v2');
    });

    it('reinstalling the same GameBanana file replaces its pack in place', async () => {
        const [first] = await install({ 'cursor.bmp': 'BM-v1' });
        await setActiveCursorPack(deadlockPath, first.id);
        const [second] = await install({ 'cursor.bmp': 'BM-v2' });

        expect(second.id).toBe(first.id);
        expect((await getCursorPacks()).packs).toHaveLength(1);
        await setActiveCursorPack(deadlockPath, second.id);
        expect(read('cursor.bmp')).toBe('BM-v2');
    });

    it('deleting the active pack puts the stock cursors back', async () => {
        const [pack] = await install({ 'cursor.bmp': 'BM-kitty' });
        await setActiveCursorPack(deadlockPath, pack.id);

        const state = await deleteCursorPack(deadlockPath, pack.id);
        expect(state).toEqual({ packs: [], activeId: null });
        expect(read('cursor.bmp')).toBe('BM-stock');
    });

    it('previews the stock set from the backup while a pack is applied', async () => {
        const [pack] = await install({ 'cursor.bmp': 'BM-kitty' });
        await setActiveCursorPack(deadlockPath, pack.id);

        const stock = await getCursorPreview(deadlockPath, null);
        expect(Object.keys(stock)).toEqual(['cursor.bmp', 'cursor_ping.bmp']);
        expect(Buffer.from(stock['cursor.bmp'].split(',')[1], 'base64').toString()).toBe('BM-stock');
    });

    it('a switch that fails partway leaves the stock backup intact', async () => {
        const [a] = await install({ 'cursor.bmp': 'BM-a' }, 10);
        const [b] = await install({ 'cursor.bmp': 'BM-b', 'cursor_ping.bmp': 'BM-b-ping' }, 11);
        await setActiveCursorPack(deadlockPath, a.id);
        rmSync(join(harness.userData, 'cursor-packs', 'packs', b.id, 'cursor_ping.bmp'));

        await expect(setActiveCursorPack(deadlockPath, b.id)).rejects.toThrow();
        expect(read('cursor.bmp')).toBe('BM-a');
        await setActiveCursorPack(deadlockPath, null);
        expect(read('cursor.bmp')).toBe('BM-stock');
    });

    it('refuses to touch the game folder when its state file is unreadable', async () => {
        const [pack] = await install({ 'cursor.bmp': 'BM-kitty' });
        await setActiveCursorPack(deadlockPath, pack.id);
        writeFileSync(join(harness.userData, 'cursor-packs', 'state.json'), '{ not json');

        await expect(setActiveCursorPack(deadlockPath, null)).rejects.toThrow();
        expect(readFileSync(join(harness.userData, 'cursor-packs', 'stock', 'cursor.bmp'), 'utf8')).toBe('BM-stock');
    });

    it('deletes the active pack even when the game folder is gone', async () => {
        const [pack] = await install({ 'cursor.bmp': 'BM-kitty' });
        await setActiveCursorPack(deadlockPath, pack.id);
        rmSync(cursors, { recursive: true });

        expect(await deleteCursorPack(deadlockPath, pack.id)).toEqual({ packs: [], activeId: null });
    });

    const built = (fileName: string, content: string, hotspot = { x: 0, y: 0 }) => ({
        fileName,
        bytes: new Uint8Array(Buffer.from(content)),
        hotspot,
    });

    it('creates a pack from built images, keeping only valid cursor files', async () => {
        const [pack] = await createCursorPack(deadlockPath, 'Mine', [
            built('Cursor.bmp', 'BM-mine'),
            built('cursor_ping.bmp', 'not a bitmap'),
            built('../cursor_shop.bmp', 'BM-escape'),
            built('cursor.res', '"evil" {}'),
        ]);
        expect(pack.name).toBe('Mine');
        expect(pack.files).toEqual(['cursor.bmp', 'cursor.res']);

        await setActiveCursorPack(deadlockPath, pack.id);
        expect(read('cursor.bmp')).toBe('BM-mine');
        expect(read('cursor_ping.bmp')).toBe('BM-stock-ping');
    });

    it('writes the built hotspots into the stock cursor.res', async () => {
        writeFileSync(
            join(cursors, 'cursor.res'),
            '"resource/cursor/cursor.res"\n{\n\tcursor_commend\n\t{\n\t\t"hotx" "22"\n\t\t"hoty" "2"\n\t}\n}\n'
        );
        const [pack] = await createCursorPack(deadlockPath, 'Mine', [built('cursor.bmp', 'BM-mine', { x: 9, y: 4 })]);
        await setActiveCursorPack(deadlockPath, pack.id);

        expect(parseCursorRes(read('cursor.res'))).toEqual(
            new Map([
                ['cursor_commend', { x: 22, y: 2 }],
                ['cursor', { x: 9, y: 4 }],
            ])
        );
        await setActiveCursorPack(deadlockPath, null);
        expect(parseCursorRes(read('cursor.res')).has('cursor')).toBe(false);
    });

    it('exports built images as a zip that imports back as the same pack', async () => {
        const dest = join(root, 'Mine.zip');
        await exportCursorZip(deadlockPath, dest, [built('cursor.bmp', 'BM-mine'), built('notes.txt', 'BM-nope')]);
        expect(new AdmZip(dest).getEntries().map((e) => e.entryName)).toEqual(['cursor.bmp', 'cursor.res']);

        const [pack] = await installCursorArchive(dest, mkdtempSync(join(root, 'work-')), { name: 'Mine' });
        expect(pack.files).toEqual(['cursor.bmp', 'cursor.res']);
    });

    it('creates nothing when no image is usable', async () => {
        expect(await createCursorPack(deadlockPath, 'Mine', [built('cursor.bmp', '')])).toEqual([]);
        expect((await getCursorPacks()).packs).toEqual([]);
    });

    it('installs sibling folders as separate variants', async () => {
        const packs = await install({ 'Large/cursor.bmp': 'BM-l', 'Small/cursor.bmp': 'BM-s' });
        expect(packs.map((p) => p.name)).toEqual(['Kitty Paw (Large)', 'Kitty Paw (Small)']);
    });
});
