import { createHash } from 'crypto';
import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { BrowserWindow } from 'electron';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSettings } from '../../../src/types/mod';

const h = vi.hoisted(() => ({
    userData: '', settings: {} as AppSettings, copying: false, locked: false,
    send: vi.fn(), safety: vi.fn(), identity: vi.fn(), imprint: vi.fn(),
}));
vi.mock('electron', () => ({
    app: { getPath: () => h.userData, getVersion: () => 'test' },
    BrowserWindow: { getAllWindows: () => [] },
}));
vi.mock('./settings', async importOriginal => ({
    ...(await importOriginal<typeof import('./settings')>()),
    loadSettings: () => h.settings,
    getActiveDeadlockPath: (settings = h.settings) => settings.devMode ? settings.devDeadlockPath : settings.deadlockPath,
}));
vi.mock('./devMods', () => ({ isCopyingModsToDev: () => h.copying }));
vi.mock('./modSafety', () => ({
    assertVpkSafety: h.safety, moveSafetySnapshot: vi.fn(), forgetSafetySnapshot: vi.fn(),
}));
vi.mock('./gameSessionMods', () => ({
    beginModMutationRunningScope: async () => {}, endModMutationRunningScope: () => {},
    syncRunningGameModSnapshotFromMods: async () => {},
    assertCanMoveLoadedGameMod: () => {}, assertCanMoveLoadedGameMods: () => {},
}));
vi.mock('./vpkIdentity', async importOriginal => ({
    ...(await importOriginal<typeof import('./vpkIdentity')>()), resolveVpkIdentity: h.identity,
}));
vi.mock('./imprintMods', () => ({ imprintFreshlyInstalled: vi.fn(), imprintOneMod: h.imprint }));
vi.mock('./mods', async importOriginal => {
    const actual = await importOriginal<typeof import('./mods')>();
    return {
        ...actual,
        runExclusiveModMutation: (operation: () => Promise<unknown>) => actual.runExclusiveModMutation(async () => {
            expect(h.locked).toBe(false);
            h.locked = true;
            try { return await operation(); }
            finally { h.locked = false; }
        }),
    };
});

import { installForgeVpk } from './download';
import { generateModId, runExclusiveModMutation } from './mods';
import { saveMetadata } from './metadata';

function deferred() {
    let resolve!: () => void;
    const promise = new Promise<void>(done => { resolve = done; });
    return { promise, resolve };
}

let root: string;
let normal: string;
let developer: string;
let sourcePath: string;
const mainWindow = { webContents: { send: h.send } } as unknown as BrowserWindow;
const forge = () => ({ sourcePath, name: 'Forge fixture', origin: 'https://deadlockforge.net' });
const disabled = (path: string) => join(path, 'game', 'citadel', 'addons', '.disabled');

async function sidecar(devMode: boolean) {
    return JSON.parse(await fs.readFile(join(h.userData, devMode ? 'mod-metadata.dev.json' : 'mod-metadata.json'), 'utf8'));
}

beforeEach(async () => {
    vi.clearAllMocks();
    root = await fs.mkdtemp(join(tmpdir(), 'forge-install-test-'));
    h.userData = join(root, 'user-data');
    normal = join(root, 'normal');
    developer = join(root, 'developer');
    await Promise.all([h.userData, disabled(normal), disabled(developer)].map(path => fs.mkdir(path, { recursive: true })));
    sourcePath = join(root, 'incoming.vpk');
    await fs.writeFile(sourcePath, 'fixture-vpk-bytes');
    h.settings = {
        devMode: false, deadlockPath: normal, devDeadlockPath: developer,
        experimentalVpkImprinting: false, autoEnableDownloads: true,
    } as AppSettings;
    h.copying = false;
    h.locked = false;
    h.safety.mockReset().mockResolvedValue(undefined);
    h.identity.mockReset().mockImplementation(async (path: string) => {
        expect(h.locked).toBe(true);
        return { sha256: createHash('sha256').update(await fs.readFile(path)).digest('hex') };
    });
    h.imprint.mockReset();
    saveMetadata({ 'normal_dir.vpk': { modName: 'Normal identity' } });
    h.settings = { ...h.settings, devMode: true };
    saveMetadata({ 'developer_dir.vpk': { modName: 'Developer identity' } });
    h.settings = { ...h.settings, devMode: false };
});

afterEach(async () => {
    vi.restoreAllMocks();
    await fs.rm(root, { recursive: true, force: true });
});

describe('Forge installation isolation', () => {
    it.each([false, true])('keeps bytes and metadata together while a mode switch waits (starts in dev: %s)', async devMode => {
        h.settings = { ...h.settings, devMode };
        const path = devMode ? developer : normal;
        const hashing = deferred();
        const releaseHash = deferred();
        h.identity.mockImplementationOnce(async (filePath: string) => {
            expect(h.locked).toBe(true);
            hashing.resolve();
            await releaseHash.promise;
            return { sha256: createHash('sha256').update(await fs.readFile(filePath)).digest('hex') };
        });
        const installing = installForgeVpk(path, forge(), mainWindow);
        await hashing.promise;
        let switched = false;
        const switching = runExclusiveModMutation(async () => {
            h.settings = { ...h.settings, devMode: !devMode };
            switched = true;
        });
        expect(switched).toBe(false);
        releaseHash.resolve();
        const { installedVpks } = await installing;
        await switching;

        expect(switched).toBe(true);
        expect(await fs.readFile(join(disabled(path), installedVpks[0]), 'utf8')).toBe('fixture-vpk-bytes');
        expect((await sidecar(devMode))[installedVpks[0]]).toMatchObject({ modName: 'Forge fixture', forgeInstall: { origin: forge().origin } });
        expect(await sidecar(!devMode)).toEqual(devMode
            ? { 'normal_dir.vpk': { modName: 'Normal identity' } }
            : { 'developer_dir.vpk': { modName: 'Developer identity' } });
        expect(await fs.readdir(join(path, 'game', 'citadel', 'addons'))).toEqual(['.disabled']);
        expect(h.send).toHaveBeenCalledWith('download-complete', expect.any(Object));
    });

    it.each([false, true])('refuses a mode switch before committing staged files (starts in dev: %s)', async devMode => {
        h.settings = { ...h.settings, devMode };
        const copied = deferred();
        const resume = deferred();
        const copyFile = fs.copyFile.bind(fs);
        vi.spyOn(fs, 'copyFile').mockImplementationOnce(async (...args) => {
            copied.resolve();
            await resume.promise;
            return copyFile(...args);
        });
        const installing = installForgeVpk(devMode ? developer : normal, forge(), mainWindow);
        const rejected = expect(installing).rejects.toThrow('active mod installation changed');
        await copied.promise;
        h.settings = { ...h.settings, devMode: !devMode };
        resume.resolve();
        await rejected;

        expect(await fs.readdir(disabled(normal))).toEqual([]);
        expect(await fs.readdir(disabled(developer))).toEqual([]);
        expect(await sidecar(false)).toEqual({ 'normal_dir.vpk': { modName: 'Normal identity' } });
        expect(await sidecar(true)).toEqual({ 'developer_dir.vpk': { modName: 'Developer identity' } });
        expect(h.identity).not.toHaveBeenCalled();
        expect(h.send).not.toHaveBeenCalled();
    });

    it('refuses an active-path change while the staged file is being reviewed', async () => {
        const reviewing = deferred();
        const resume = deferred();
        h.safety.mockImplementationOnce(async () => {
            expect(h.locked).toBe(false);
            reviewing.resolve();
            await resume.promise;
        });
        const installing = installForgeVpk(normal, forge(), mainWindow);
        const rejected = expect(installing).rejects.toThrow('active mod installation changed');
        await reviewing.promise;
        h.settings = { ...h.settings, deadlockPath: developer };
        resume.resolve();
        await rejected;
        expect(await fs.readdir(disabled(normal))).toEqual([]);
        expect(h.identity).not.toHaveBeenCalled();
    });

    it.each([false, true])('queues optional imprinting outside the installation lock (dev: %s)', async devMode => {
        h.settings = { ...h.settings, devMode, experimentalVpkImprinting: true };
        const path = devMode ? developer : normal;
        h.imprint.mockImplementation(async (_path: string, id: string) => {
            expect(h.locked).toBe(false);
            return runExclusiveModMutation(async () => {
                expect(h.locked).toBe(true);
                expect(Object.values(await sidecar(devMode))).toContainEqual(expect.objectContaining({ modName: 'Forge fixture' }));
                return { id };
            });
        });

        const result = await installForgeVpk(path, forge(), mainWindow);

        expect(h.imprint).toHaveBeenCalledExactlyOnceWith(path, generateModId(result.installedVpks[0]));
        expect(await fs.readdir(disabled(path))).toEqual(result.installedVpks);
    });

    it('prevents queued imprint writes when a mode switch runs after the installation commits', async () => {
        h.settings = { ...h.settings, experimentalVpkImprinting: true };
        const imprintWrite = vi.fn(async () => {});
        h.imprint.mockImplementation(async () => runExclusiveModMutation(imprintWrite));
        const hashing = deferred();
        const resume = deferred();
        h.identity.mockImplementationOnce(async () => {
            hashing.resolve();
            await resume.promise;
            return { sha256: 'a'.repeat(64) };
        });
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        const installing = installForgeVpk(normal, forge(), mainWindow);
        await hashing.promise;
        const switching = runExclusiveModMutation(async () => {
            h.settings = { ...h.settings, devMode: true };
        });
        resume.resolve();
        const result = await installing;
        await switching;

        expect(h.imprint).toHaveBeenCalledOnce();
        expect(imprintWrite).not.toHaveBeenCalled();
        expect((await sidecar(false))[result.installedVpks[0]]).toMatchObject({ modName: 'Forge fixture' });
        expect(await sidecar(true)).toEqual({ 'developer_dir.vpk': { modName: 'Developer identity' } });
    });

    it.each(['before staging', 'before commit'])('refuses installs when developer copying starts %s', async phase => {
        if (phase === 'before staging') h.copying = true;
        else h.safety.mockImplementationOnce(async () => { h.copying = true; });

        await expect(installForgeVpk(normal, forge(), mainWindow)).rejects.toThrow('developer library copy');

        expect(await fs.readdir(disabled(normal))).toEqual([]);
        expect(h.identity).not.toHaveBeenCalled();
        expect(h.send).not.toHaveBeenCalled();
    });

    it('keeps refused files outside the library without holding the mutation lock during review', async () => {
        h.safety.mockImplementationOnce(async () => {
            expect(h.locked).toBe(false);
            throw new Error('Safety review refused');
        });

        await expect(installForgeVpk(normal, forge(), mainWindow)).rejects.toThrow('Safety review refused');

        expect(await fs.readdir(disabled(normal))).toEqual([]);
        expect(h.identity).not.toHaveBeenCalled();
    });
});
