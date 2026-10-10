import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, rm, stat, utimes } from 'fs/promises';
import { join, dirname } from 'path';
import { tmpdir } from 'os';
import { CrashHistory } from './crashHistory';

const time = 1700000000000;
const fatal = "FATAL ERROR: Unable to load layout file 'file://{resources}/layout/hud.xml'.";
let root: string, game: string, steam: string;

function dump(message = '', createdAt = time, pid = 123, exception = 0xc0000005): Buffer {
    const misc = Buffer.alloc(12); misc.writeUInt32LE(12); misc.writeUInt32LE(1, 4); misc.writeUInt32LE(pid, 8);
    const code = Buffer.alloc(12); code.writeUInt32LE(exception, 8);
    const streams = [{ kind: 15, bytes: misc }, { kind: 6, bytes: code }, { kind: 10, bytes: Buffer.from(message) }];
    let offset = 32 + streams.length * 12;
    const bytes = Buffer.alloc(offset + streams.reduce((sum, stream) => sum + stream.bytes.length, 0));
    bytes.write('MDMP'); bytes.writeUInt32LE(streams.length, 8); bytes.writeUInt32LE(32, 12); bytes.writeUInt32LE(createdAt / 1000, 20);
    streams.forEach((stream, index) => {
        const slot = 32 + index * 12;
        bytes.writeUInt32LE(stream.kind, slot); bytes.writeUInt32LE(stream.bytes.length, slot + 4); bytes.writeUInt32LE(offset, slot + 8);
        stream.bytes.copy(bytes, offset); offset += stream.bytes.length;
    });
    return bytes;
}
async function put(path: string, bytes: Buffer, modified = time): Promise<void> {
    await mkdir(dirname(path), { recursive: true }); await writeFile(path, bytes);
    await utimes(path, new Date(modified), new Date(modified));
}
const gameDump = (name = 'test'): string => join(game, `game/bin/win64/deadlock_${name}_error.mdmp`);
const steamDump = (): string => join(steam, 'dumps/crash_deadlock.exe_test.dmp');
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'crash-history-')); game = join(root, 'Deadlock'); steam = join(root, 'Steam'); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

describe('on-demand Deadlock crash history', () => {
    it('lists older and generic crashes without a mod accusation, and ignores other applications', async () => {
        await put(gameDump(), dump('Warning loading panorama/layout/hud.xml'));
        await put(join(steam, 'dumps/crash_other.exe_test.dmp'), dump(fatal));
        const context = vi.fn(async () => ({ suspectedMod: 'Wrong mod' }));
        const history = new CrashHistory(game, [steam], context);
        const result = await history.list();
        expect(result.total).toBe(1);
        expect(result.reports[0]).toMatchObject({ crashedAt: time, kind: 'access-violation', exceptionCode: '0xc0000005' });
        expect(result.reports[0].suspectedMod).toBeUndefined();
        expect(context).not.toHaveBeenCalled();
    });

    it('groups matching Steam/game copies but keeps different processes and exceptions separate', async () => {
        await put(gameDump(), dump(fatal)); await put(steamDump(), dump(fatal));
        await put(gameDump('other-pid'), dump(fatal, time, 456));
        await put(gameDump('other-exception'), dump('', time, 123, 0xc000001d));
        const history = new CrashHistory(game, [steam, steam]);
        const result = await history.list();
        expect(result.total).toBe(3);
        const duplicate = result.reports.find(report => report.copies === 2)!;
        expect((await history.detail(duplicate.id)).files).toHaveLength(2);
    });

    it('keeps recorded suspect context independent of current mod warnings', async () => {
        await put(gameDump(), dump(fatal));
        const context = vi.fn(async () => ({ suspectedMod: 'Old HUD', gameBuild: '100', attribution: 'last-known' as const }));
        const history = new CrashHistory(game, [steam], context);
        const result = await history.list();
        expect(context).toHaveBeenCalledWith(time, 'panorama/layout/hud.vxml_c');
        expect(result.reports[0]).toMatchObject({ suspectedMod: 'Old HUD', gameBuild: '100', attribution: 'last-known' });
        expect((await history.detail(result.reports[0].id)).suspectedMod).toBe('Old HUD');
    });

    it('paginates the entire available history instead of applying advisory retention', async () => {
        for (let index = 0; index < 55; index++) await put(gameDump(String(index)), dump('', time + index * 1000, index));
        const history = new CrashHistory(game, [steam]);
        expect((await history.list()).reports).toHaveLength(50);
        const next = await history.list(50);
        expect(next.total).toBe(55); expect(next.reports).toHaveLength(5);
        expect(next.reports.at(-1)?.crashedAt).toBe(time);
    });

    it('shows unreadable dumps and retries them after a refresh', async () => {
        await put(gameDump(), Buffer.from('not a dump'));
        const history = new CrashHistory(game, [steam]);
        expect((await history.list()).reports[0].kind).toBe('unreadable');
        await put(gameDump(), dump(fatal));
        expect((await history.list()).reports[0].kind).toBe('resource-error');
    });

    it('redacts diagnostic text and selected support reports while leaving original bytes intact', async () => {
        const bytes = dump(`${fatal}\nC:\\Users\\Alice\\secret 76561191234567890\nBearer abcdefghijklmnop\nalice@example.com`);
        await put(gameDump(), bytes);
        const history = new CrashHistory(game, [steam]);
        const id = (await history.list()).reports[0].id;
        const detail = await history.detail(id);
        const text = await history.reportText([id, id]);
        for (const value of ['Alice', '76561191234567890', 'abcdefghijklmnop', 'alice@example.com']) {
            expect(detail.diagnostics).not.toContain(value); expect(text).not.toContain(value);
        }
        expect(text.match(/Crash:/g)).toHaveLength(1);
        expect(await readFile(gameDump())).toEqual(bytes);
    });

    it('saves an exact copy only on request and never overwrites an original report', async () => {
        await put(gameDump(), dump(fatal));
        const history = new CrashHistory(game, [steam]);
        const id = (await history.list()).reports[0].id;
        await expect(history.saveDump(id, gameDump())).rejects.toThrow('different location');
        const target = join(root, 'selected.mdmp');
        await history.saveDump(id, target);
        expect(await readFile(target)).toEqual(await readFile(gameDump()));
        await expect(history.sourcePath(join(root, 'unrelated-secret'))).rejects.toThrow('Refresh');
    });

    it('uses another surviving copy and handles removal during support export', async () => {
        await put(gameDump(), dump(fatal)); await put(steamDump(), dump(fatal));
        const history = new CrashHistory(game, [steam]);
        const id = (await history.list()).reports[0].id;
        await rm(gameDump());
        expect(await history.sourcePath(id)).toBe(steamDump());
        await rm(steamDump());
        expect(await history.reportText([id])).toContain('no longer available');
    });

    it('does not create missing report folders', async () => {
        const history = new CrashHistory(game, [steam]);
        expect(await history.list()).toEqual({ reports: [], total: 0 });
        await expect(stat(game)).rejects.toMatchObject({ code: 'ENOENT' });
        await expect(stat(steam)).rejects.toMatchObject({ code: 'ENOENT' });
    });
});
