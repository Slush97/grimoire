import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, rm, utimes, rename } from 'fs/promises';
import { join, dirname } from 'path';
import { tmpdir } from 'os';
import type { Mod } from './mods';

const h = vi.hoisted(() => ({ userData: '', gamePath: '', steamRoot: '', mods: [] as Mod[], send: vi.fn() }));
vi.mock('electron', () => ({ BrowserWindow: { getAllWindows: () => [{ isDestroyed: () => false, webContents: { send: h.send } }] } }));
vi.mock('../utils/paths', () => ({ getUserDataPath: () => h.userData }));
vi.mock('./settings', () => ({ getActiveDeadlockPath: () => h.gamePath }));
vi.mock('./steamRoots', () => ({ getSteamRoots: () => [h.steamRoot] }));
vi.mock('./mods', () => ({ scanModsReadOnly: async () => h.mods.map(mod => ({ ...mod })) }));
vi.mock('./metadata', () => ({ getModMetadata: () => ({ modName: 'Crash test mod', sha256: 'a'.repeat(64) }) }));
vi.mock('./vpk', async importOriginal => {
    const original = await importOriginal<typeof import('./vpk')>();
    return { ...original, parseVpkDirectoriesAsync: async (paths: string[]) => new Map(paths.map(path => [path, original.parseVpkDirectory(path)])) };
});

const entry = 'panorama/layout/hud.vxml_c';
const fatal = "FATAL ERROR: Unable to load layout file 'file://{resources}/layout/hud.xml'.";
const configured = 'GameInfo { FileSystem { SearchPaths { Game citadel/addons Game citadel Game core } } }';
let root: string;
let clock: number;

async function put(path: string, bytes: string | Buffer): Promise<void> {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, bytes);
}

function vpk(bytes: string): Buffer {
    const data = Buffer.from(bytes);
    const metadata = Buffer.alloc(18);
    metadata.writeUInt16LE(0x7fff, 6);
    metadata.writeUInt32LE(data.length, 12);
    metadata.writeUInt16LE(0xffff, 16);
    const tree = Buffer.concat([Buffer.from('vxml_c\0panorama/layout\0hud\0'), metadata, Buffer.from([0, 0, 0])]);
    const header = Buffer.alloc(12);
    header.writeUInt32LE(0x55aa1234, 0);
    header.writeUInt32LE(1, 4);
    header.writeUInt32LE(tree.length, 8);
    return Buffer.concat([header, tree, data]);
}

function dump(time: number, message = fatal): Buffer {
    const comment = Buffer.from(message);
    const bytes = Buffer.alloc(68 + comment.length);
    bytes.write('MDMP');
    bytes.writeUInt32LE(2, 8);
    bytes.writeUInt32LE(32, 12);
    bytes.writeUInt32LE(Math.floor(time / 1000), 20);
    bytes.writeUInt32LE(15, 32); bytes.writeUInt32LE(12, 36); bytes.writeUInt32LE(56, 40);
    bytes.writeUInt32LE(10, 44); bytes.writeUInt32LE(comment.length, 48); bytes.writeUInt32LE(68, 52);
    bytes.writeUInt32LE(12, 56); bytes.writeUInt32LE(1, 60); bytes.writeUInt32LE(123, 64);
    comment.copy(bytes, 68);
    return bytes;
}

const stamp = (time: number): string => {
    const date = new Date(time);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
};

async function crash(message = fatal): Promise<void> {
    const started = clock + 10000;
    const crashed = started + 5000;
    clock = crashed + 10000;
    vi.setSystemTime(clock);
    await put(join(h.steamRoot, 'logs/gameprocess_log.txt'), `[${stamp(started)}] AppID 1422450 adding PID 123 as a tracked process "C:\\Steam\\deadlock.exe" -steam\n[${stamp(crashed + 1000)}] AppID 1422450 no longer tracking PID 123, exit code 1`);
    const path = join(h.steamRoot, 'dumps/crash_deadlock.exe_test.dmp');
    await put(path, dump(crashed, message));
    await utimes(path, new Date(crashed), new Date(crashed));
}

beforeEach(async () => {
    vi.resetModules();
    vi.useFakeTimers({ toFake: ['Date'] });
    clock = new Date('2026-10-10T12:00:00Z').getTime();
    vi.setSystemTime(clock);
    root = await mkdtemp(join(tmpdir(), 'crash-advisories-'));
    h.userData = join(root, 'userdata');
    h.steamRoot = join(root, 'Steam');
    h.gamePath = join(h.steamRoot, 'steamapps/common/Deadlock');
    const path = join(h.gamePath, 'game/citadel/addons/pak01_dir.vpk');
    await put(path, vpk('deliberately incompatible HUD'));
    await put(join(h.gamePath, 'game/citadel/pak01_dir.vpk'), vpk('native HUD'));
    await put(join(h.gamePath, 'game/citadel/gameinfo.gi'), configured);
    await put(join(h.steamRoot, 'steamapps/appmanifest_1422450.acf'), '"buildid" "100"');
    await put(join(h.steamRoot, 'logs/content_log.txt'), `[${stamp(clock - 1000)}] AppID 1422450 finished update, 3 mounted depots (BuildID 100)`);
    h.mods = [{ id: 'mod-1', name: 'Test', metaKey: 'pak01_dir.vpk', fileName: 'pak01_dir.vpk', path, enabled: true, priority: 1, size: 70, installedAt: '' }];
    h.send.mockClear();
});

afterEach(async () => { vi.useRealTimers(); await rm(root, { recursive: true, force: true }); });

describe('advisory crash lifecycle', () => {
    it('retains the suspect if Steam temporarily removes gameinfo during verification', async () => {
        const service = await import('./crashAdvisories');
        await service.refreshCrashAdvisories();
        await crash();
        await rm(join(h.gamePath, 'game/citadel/gameinfo.gi'));
        await service.refreshCrashAdvisories();
        expect(service.getCrashAdvisories()).toMatchObject([{ modId: 'mod-1', enabled: true }]);
    });
    it('checks periodically while open without requiring a focus event', async () => {
        let poll: () => void = () => {};
        const unref = vi.fn();
        const timer = vi.spyOn(globalThis, 'setInterval').mockImplementation(callback => {
            poll = callback as () => void;
            return { unref } as unknown as ReturnType<typeof setInterval>;
        });
        try {
            const service = await import('./crashAdvisories');
            service.startCrashAdvisories();
            await service.refreshCrashAdvisories();
            expect(timer).toHaveBeenCalledWith(expect.any(Function), 15000);
            expect(unref).toHaveBeenCalled();
            await crash();
            poll();
            await service.refreshCrashAdvisories();
            expect(service.getCrashAdvisories()).toHaveLength(1);
        } finally { timer.mockRestore(); }
    });
    it('detects a Steam-launched crash on next startup despite Steam resetting mounts', async () => {
        let service = await import('./crashAdvisories');
        await service.refreshCrashAdvisories();
        await crash();
        await put(join(h.gamePath, 'game/citadel/gameinfo.gi'), 'GameInfo { FileSystem { SearchPaths { Game citadel Game core } } }');
        vi.resetModules();
        service = await import('./crashAdvisories');
        await service.refreshCrashAdvisories();
        expect(service.getCrashAdvisories()).toMatchObject([{ modId: 'mod-1', entry, attribution: 'last-known', enabled: true }]);
        expect(await readFile(join(h.gamePath, 'game/citadel/gameinfo.gi'), 'utf8')).not.toContain('addons');
        expect(h.mods[0].enabled).toBe(true);
        const state = JSON.parse(await readFile(join(h.userData, 'crash-advisories.json'), 'utf8'));
        expect(state.incidents).toHaveLength(1);
    });

    it('publishes a new crash while open and deduplicates Steam and game reports', async () => {
        const service = await import('./crashAdvisories');
        await service.refreshCrashAdvisories();
        await crash();
        const duplicate = join(h.gamePath, 'game/bin/win64/deadlock_test_error.mdmp');
        await put(duplicate, await readFile(join(h.steamRoot, 'dumps/crash_deadlock.exe_test.dmp')));
        await utimes(duplicate, new Date(clock - 10000), new Date(clock - 10000));
        await service.refreshCrashAdvisories();
        expect(service.getCrashAdvisories()).toHaveLength(1);
        expect(h.send).toHaveBeenCalledWith('crash-advisories-changed', expect.arrayContaining([expect.objectContaining({ modId: 'mod-1' })]));
    });

    it('persists dismissal across app restarts and does not alter mod contents', async () => {
        let service = await import('./crashAdvisories');
        await service.refreshCrashAdvisories();
        const before = await readFile(h.mods[0].path);
        await crash();
        await service.refreshCrashAdvisories();
        await service.dismissCrashAdvisory(service.getCrashAdvisories()[0].id);
        vi.resetModules();
        service = await import('./crashAdvisories');
        await service.refreshCrashAdvisories();
        expect(service.getCrashAdvisories()).toEqual([]);
        expect(await readFile(h.mods[0].path)).toEqual(before);
    });

    it('keeps the mod hint but removes its launch warning when disabled', async () => {
        const service = await import('./crashAdvisories');
        await service.refreshCrashAdvisories();
        await crash();
        await service.refreshCrashAdvisories();
        const path = join(dirname(h.mods[0].path), '.disabled/pak01_dir.vpk');
        await mkdir(dirname(path), { recursive: true });
        await rename(h.mods[0].path, path);
        h.mods[0] = { ...h.mods[0], enabled: false, path };
        await service.refreshCrashAdvisories();
        expect(service.getCrashAdvisories()).toMatchObject([{ enabled: false }]);
    });

    it('retires a finding when the affected mod contents change even if metadata identity does not', async () => {
        const service = await import('./crashAdvisories');
        await service.refreshCrashAdvisories();
        await crash();
        await service.refreshCrashAdvisories();
        expect(service.getCrashAdvisories()).toHaveLength(1);
        await put(h.mods[0].path, vpk('updated compatible HUD with changed content'));
        await service.refreshCrashAdvisories();
        expect(service.getCrashAdvisories()).toEqual([]);
        expect(await service.getCrashReportContext(h.gamePath, clock - 10000, entry))
            .toMatchObject({ suspectedMod: 'Crash test mod', gameBuild: '100' });
    });

    it('retains a finding when an update or reorder changes identity but leaves relevant bytes unchanged', async () => {
        const service = await import('./crashAdvisories');
        await service.refreshCrashAdvisories();
        await crash();
        await service.refreshCrashAdvisories();
        const path = join(dirname(h.mods[0].path), 'pak05_dir.vpk');
        await rename(h.mods[0].path, path);
        h.mods[0] = { ...h.mods[0], id: 'renamed-mod', name: 'Updated version label', path,
            fileName: 'pak05_dir.vpk', metaKey: 'pak05_dir.vpk', priority: 5 };
        await service.refreshCrashAdvisories();
        expect(service.getCrashAdvisories()).toMatchObject([{ modId: 'renamed-mod', entry }]);
    });

    it('blames only the recorded winning provider and does not transfer blame after it is disabled', async () => {
        const path = join(dirname(h.mods[0].path), 'pak02_dir.vpk');
        await put(path, vpk('a different HUD overriding the same path'));
        h.mods.push({ ...h.mods[0], id: 'mod-2', path, fileName: 'pak02_dir.vpk',
            metaKey: 'pak02_dir.vpk', priority: 2 });
        const service = await import('./crashAdvisories');
        await service.refreshCrashAdvisories();
        await crash();
        await service.refreshCrashAdvisories();
        expect(service.getCrashAdvisories()).toMatchObject([{ modId: 'mod-1', enabled: true }]);
        expect(service.getCrashAdvisories()).toHaveLength(1);
        const disabled = join(dirname(h.mods[0].path), '.disabled/pak01_dir.vpk');
        await mkdir(dirname(disabled), { recursive: true });
        await rename(h.mods[0].path, disabled);
        h.mods[0] = { ...h.mods[0], path: disabled, enabled: false };
        await service.refreshCrashAdvisories();
        expect(service.getCrashAdvisories()).toMatchObject([{ modId: 'mod-1', enabled: false }]);
        expect(service.getCrashAdvisories()).toHaveLength(1);
    });

    it('uses the new game build for a crash after an update while Grimoire was closed', async () => {
        const service = await import('./crashAdvisories');
        await service.refreshCrashAdvisories();
        const updateTime = clock + 5000;
        await put(join(h.steamRoot, 'logs/content_log.txt'), `[${stamp(updateTime)}] AppID 1422450 finished update, 3 mounted depots (BuildID 101)`);
        await put(join(h.steamRoot, 'steamapps/appmanifest_1422450.acf'), '"buildid" "101"');
        await crash();
        await service.refreshCrashAdvisories();
        expect(service.getCrashAdvisories()).toMatchObject([{ gameBuild: '101' }]);
        await put(join(h.steamRoot, 'steamapps/appmanifest_1422450.acf'), '"buildid" "102"');
        await service.refreshCrashAdvisories();
        expect(service.getCrashAdvisories()).toEqual([]);
    });

    it('establishes a baseline without surfacing a backlog of older crashes', async () => {
        await crash();
        vi.setSystemTime(clock + 10000);
        const service = await import('./crashAdvisories');
        await service.refreshCrashAdvisories();
        expect(service.getCrashAdvisories()).toEqual([]);
    });

    it.each(['Access violation in client.dll', 'Warning loading panorama/layout/hud.xml'])('does not create a suspect for %s', async message => {
        const service = await import('./crashAdvisories');
        await service.refreshCrashAdvisories();
        await crash(message);
        await service.refreshCrashAdvisories();
        expect(service.getCrashAdvisories()).toEqual([]);
    });

    it('skips corrupted diagnostic history and unreadable mods without throwing', async () => {
        await put(join(h.userData, 'crash-advisories.json'), '{not json');
        await put(h.mods[0].path, 'invalid VPK');
        const service = await import('./crashAdvisories');
        await expect(service.refreshCrashAdvisories()).resolves.toBeUndefined();
        expect(service.getCrashAdvisories()).toEqual([]);
        expect(h.mods[0].enabled).toBe(true);
    });
});
