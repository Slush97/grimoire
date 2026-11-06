import { beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, promises as fs } from 'fs';
import { tmpdir } from 'os';
import { basename, dirname, join } from 'path';

const h = vi.hoisted(() => ({ userData: '', assertVpkSafety: vi.fn(), running: vi.fn(async () => false) }));
vi.mock('electron', () => ({ app: { getPath: () => h.userData } }));
vi.mock('./launch', () => ({
    isDeadlockRunning: h.running,
    readStash: async () => null,
}));
vi.mock('./modSafety', () => ({ assertVpkSafety: h.assertVpkSafety, moveSafetySnapshot: vi.fn() }));

import { scanMods, setModsEnabledBatch, swapEnabledMods } from './mods';
import { getModMetadata, saveMetadata, setModMetadata } from './metadata';
import { captureLoadedGameMods, clearLoadedGameMods } from './gameSessionMods';

function writeVpk(path: string): void {
    const header = Buffer.alloc(64);
    header.writeUInt32LE(0x55aa1234, 0);
    header.writeUInt32LE(2, 4);
    header.write(basename(path), 32, 'utf8');
    writeFileSync(path, header);
}

/** One enabled skin and two disabled candidates, the second of them blocked. */
async function shuffleLibrary() {
    const root = mkdtempSync(join(tmpdir(), 'batch-safety-'));
    const addons = join(root, 'game', 'citadel', 'addons');
    mkdirSync(join(addons, '.disabled'), { recursive: true });
    mkdirSync(join(root, 'game', 'citadel', 'grimoire'), { recursive: true });
    const currentPath = join(addons, 'pak01_dir.vpk');
    const passingPath = join(addons, '.disabled', 'Passing_dir.vpk');
    const blockedPath = join(addons, '.disabled', 'Blocked_dir.vpk');
    for (const path of [currentPath, passingPath, blockedPath]) writeVpk(path);
    const mods = await scanMods(root);
    const byPath = (path: string) => mods.find((mod) => mod.path === path)!;
    return { root, addons, current: byPath(currentPath), passing: byPath(passingPath), blocked: byPath(blockedPath) };
}

describe('setModsEnabledBatch safety gate', () => {
    beforeEach(() => {
        h.userData = mkdtempSync(join(tmpdir(), 'batch-safety-userdata-'));
        saveMetadata({});
        h.assertVpkSafety.mockReset();
    });

    it('counts a refused mod as a failure and still applies the rest of the batch', async () => {
        const { root, current, passing, blocked } = await shuffleLibrary();
        h.assertVpkSafety.mockImplementation(async (path: string) => {
            if (path === blocked.path) throw new Error('MOD_SAFETY_BLOCKED: The archive could not be read or installed safely.');
        });

        const result = await setModsEnabledBatch(root, { enable: [passing.id, blocked.id], disable: [current.id] });

        expect(result.enabled).toBe(1);
        expect(result.disabled).toBe(1);
        expect(result.failures).toHaveLength(1);
        expect(result.failures[0]).toContain(`enable ${blocked.id}`);
        expect(result.failures[0]).toContain('MOD_SAFETY_BLOCKED');
        const after = await scanMods(root);
        expect(after.filter((mod) => mod.enabled).map((mod) => mod.fileName)).toHaveLength(1);
        expect(existsSync(blocked.path)).toBe(true);
        expect(existsSync(passing.path)).toBe(false);
    });

    it('asks about a refused mod once, before any file moves', async () => {
        const { root, current, blocked } = await shuffleLibrary();
        h.assertVpkSafety.mockImplementation(async (path: string) => {
            expect(existsSync(current.path)).toBe(true);
            if (path === blocked.path) throw new Error('MOD_SAFETY_TRUST_REQUIRED: This version must be trusted before activation.');
        });

        const result = await setModsEnabledBatch(root, { enable: [blocked.id], disable: [current.id] });

        expect(h.assertVpkSafety.mock.calls.filter(([path]) => path === blocked.path)).toHaveLength(1);
        expect(result).toMatchObject({ enabled: 0, disabled: 1 });
    });
});

describe('hero mod swap transaction', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
        h.userData = mkdtempSync(join(tmpdir(), 'swap-userdata-'));
        saveMetadata({});
        clearLoadedGameMods();
        h.running.mockResolvedValue(false);
        h.assertVpkSafety.mockReset();
    });

    it('enables the replacement before disabling the outgoing file, then inherits its slot', async () => {
        const { root, current, passing } = await shuffleLibrary();
        const replacementBytes = readFileSync(passing.path);
        const sourceBytes = readFileSync(current.path);
        setModMetadata(current.metaKey, { modName: 'Outgoing' });
        setModMetadata(passing.metaKey, { modName: 'Replacement' });
        h.assertVpkSafety.mockImplementation(async path => {
            if (path === passing.path) expect(readFileSync(current.path)).toEqual(sourceBytes);
        });
        await swapEnabledMods(root, [passing.id], [current.id]);
        expect(existsSync(passing.path)).toBe(false);
        expect(readFileSync(current.path)).toEqual(replacementBytes);
        const after = await scanMods(root);
        expect(after.filter(mod => mod.enabled).map(mod => mod.path)).toEqual([current.path]);
        expect(getModMetadata(current.metaKey)?.modName).toBe('Replacement');
        const disabled = after.find(mod => !mod.enabled && getModMetadata(mod.metaKey)?.modName === 'Outgoing')!;
        expect(readFileSync(disabled.path)).toEqual(sourceBytes);
    });

    it.each(['addons1', 'grimoire'])('inherits the exact %s folder without moving unrelated loaded files', async folder => {
        const { root, addons, current, passing } = await shuffleLibrary();
        const targetPath = join(dirname(addons), folder, 'pak05_dir.vpk');
        mkdirSync(dirname(targetPath), { recursive: true });
        writeVpk(targetPath);
        const target = (await scanMods(root)).find(mod => mod.path === targetPath)!;
        const replacementBytes = readFileSync(passing.path);
        const unrelatedBytes = readFileSync(current.path);
        captureLoadedGameMods([current]);
        h.running.mockResolvedValue(true);
        await swapEnabledMods(root, [passing.id], [target.id]);
        const after = await scanMods(root);
        expect(after.filter(mod => mod.enabled).map(mod => mod.path).sort()).toEqual([current.path, target.path].sort());
        expect(readFileSync(target.path)).toEqual(replacementBytes);
        expect(readFileSync(current.path)).toEqual(unrelatedBytes);
        expect(getModMetadata(target.metaKey)?.priorityMod).toBe(folder === 'grimoire' ? true : undefined);
    });

    it('demotes a disabled Global replacement when it takes a regular mod slot', async () => {
        const { root, current, passing } = await shuffleLibrary();
        setModMetadata(passing.metaKey, { priorityMod: true });
        await swapEnabledMods(root, [passing.id], [current.id]);
        expect(getModMetadata(current.metaKey)?.priorityMod).toBeUndefined();
        expect((await scanMods(root)).filter(mod => mod.enabled).map(mod => mod.path)).toEqual([current.path]);
    });

    it('places only the selected replacement in the target slot when requirements also change', async () => {
        const { root, addons, current, passing, blocked } = await shuffleLibrary();
        const targetPath = join(addons, 'pak09_dir.vpk');
        writeVpk(targetPath);
        const target = (await scanMods(root)).find(mod => mod.path === targetPath)!;
        const replacementBytes = readFileSync(passing.path);
        const dependencyBytes = readFileSync(blocked.path);
        await swapEnabledMods(root, [blocked.id, passing.id], [current.id, target.id], {
            incomingId: passing.id, outgoingId: target.id,
        });
        expect(readFileSync(target.path)).toEqual(replacementBytes);
        const other = (await scanMods(root)).find(mod => mod.enabled && mod.path !== target.path)!;
        expect(readFileSync(other.path)).toEqual(dependencyBytes);
        expect(existsSync(current.path)).toBe(false);
    });

    it('restores both files and the Global flag if final placement fails', async () => {
        const { root, current, passing } = await shuffleLibrary();
        setModMetadata(passing.metaKey, { priorityMod: true });
        const sourceBytes = readFileSync(current.path);
        const replacementBytes = readFileSync(passing.path);
        const rename = fs.rename.bind(fs);
        vi.spyOn(fs, 'rename').mockImplementation(async (from, to) => {
            if (to === current.path && String(from).includes('grimoire')) throw new Error('placement failed');
            await rename(from, to);
        });
        await expect(swapEnabledMods(root, [passing.id], [current.id])).rejects.toThrow('placement failed');
        expect(readFileSync(current.path)).toEqual(sourceBytes);
        expect(readFileSync(passing.path)).toEqual(replacementBytes);
        expect(getModMetadata(passing.metaKey)?.priorityMod).toBe(true);
        expect((await scanMods(root)).filter(mod => mod.enabled).map(mod => mod.path)).toEqual([current.path]);
    });

    it('leaves every file untouched when safety review refuses a replacement', async () => {
        const { root, current, blocked } = await shuffleLibrary();
        h.assertVpkSafety.mockRejectedValue(new Error('MOD_SAFETY_TRUST_REQUIRED'));
        await expect(swapEnabledMods(root, [blocked.id], [current.id])).rejects.toThrow('MOD_SAFETY_TRUST_REQUIRED');
        expect(existsSync(current.path)).toBe(true);
        expect(existsSync(blocked.path)).toBe(true);
    });

    it('blocks game-loaded outgoing files before reviewing or enabling a replacement', async () => {
        const { root, current, passing } = await shuffleLibrary();
        captureLoadedGameMods(await scanMods(root));
        h.running.mockResolvedValue(true);
        await expect(swapEnabledMods(root, [passing.id], [current.id])).rejects.toThrow('Game is running');
        expect(h.assertVpkSafety).not.toHaveBeenCalled();
        expect(existsSync(current.path)).toBe(true);
        expect(existsSync(passing.path)).toBe(true);
        clearLoadedGameMods();
    });

    it('rolls back an earlier replacement when a later enable fails', async () => {
        const { root, current, passing, blocked } = await shuffleLibrary();
        let reviews = 0;
        h.assertVpkSafety.mockImplementation(async path => {
            if (path === blocked.path && ++reviews === 2) throw new Error('enable failed');
        });
        await expect(swapEnabledMods(root, [passing.id, blocked.id], [current.id])).rejects.toThrow('enable failed');
        for (const mod of [current, passing, blocked]) expect(existsSync(mod.path)).toBe(true);
        expect((await scanMods(root)).filter(mod => mod.enabled).map(mod => mod.id)).toEqual([current.id]);
    });

    it('rechecks the game session if the game starts during safety review', async () => {
        const { root, current, passing } = await shuffleLibrary();
        h.assertVpkSafety.mockImplementation(async () => { h.running.mockResolvedValue(true); });
        await expect(swapEnabledMods(root, [passing.id], [current.id])).rejects.toThrow('Game is running');
        expect(existsSync(current.path)).toBe(true);
        expect(existsSync(passing.path)).toBe(true);
        clearLoadedGameMods();
    });

    it('restores outgoing files and replacements when a later disable fails', async () => {
        const { root, addons, current, passing } = await shuffleLibrary();
        const secondPath = join(addons, 'pak02_dir.vpk');
        writeVpk(secondPath);
        const second = (await scanMods(root)).find(mod => mod.path === secondPath)!;
        const rename = fs.rename.bind(fs);
        vi.spyOn(fs, 'rename').mockImplementation(async (from, to) => {
            if (from === secondPath) throw new Error('disable failed');
            await rename(from, to);
        });
        await expect(swapEnabledMods(root, [passing.id], [current.id, second.id])).rejects.toThrow('disable failed');
        for (const mod of [current, second, passing]) expect(existsSync(mod.path)).toBe(true);
        expect((await scanMods(root)).filter(mod => mod.enabled)).toHaveLength(2);
    });

    it('rejects overlapping or missing selections without moving files', async () => {
        const { root, current, passing } = await shuffleLibrary();
        await expect(swapEnabledMods(root, [current.id], [current.id])).rejects.toThrow('MOD_SWAP_STALE');
        await expect(swapEnabledMods(root, [passing.id], ['missing'])).rejects.toThrow('MOD_SWAP_STALE');
        await expect(swapEnabledMods(root, [passing.id], [current.id], {
            incomingId: current.id, outgoingId: current.id,
        })).rejects.toThrow('MOD_SWAP_STALE');
        expect(existsSync(current.path)).toBe(true);
        expect(existsSync(passing.path)).toBe(true);
    });
});
