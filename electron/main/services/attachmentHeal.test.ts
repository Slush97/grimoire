import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import { basename, join } from 'node:path';
import { tmpdir } from 'node:os';

const h = vi.hoisted(() => ({
    run: vi.fn(),
    entries: new Map<string, Array<{ path: string; size: number }>>(),
    meta: new Map<string, { sha256?: string }>(),
    setHash: vi.fn(),
    retarget: vi.fn(),
    carry: vi.fn(),
    assertSafety: vi.fn(),
    moveSafety: vi.fn(),
    syncGame: vi.fn(),
    assertMovable: vi.fn(),
    freeze: vi.fn(),
    mods: [] as Array<{ id: string; name: string; path: string; fileName: string; metaKey: string; enabled: boolean }>,
    staged: '',
}));
vi.mock('./gameSessionMods', () => ({
    syncRunningGameModSnapshotFromMods: h.syncGame,
    assertCanMoveLoadedGameMod: h.assertMovable,
}));
vi.mock('./imprintMods', () => ({ freezeLegacyVpkIndexes: h.freeze }));
vi.mock('./deadlock', () => ({
    getCitadelPath: (deadlockPath: string) => deadlockPath,
    metaKeyFor: (path: string) => basename(path),
}));
vi.mock('./metadata', () => ({
    getModMetadata: (key: string) => h.meta.get(key),
    setModMetadataWithHash: h.setHash,
}));
vi.mock('./modMerger', () => ({ runVpkmergeStdout: h.run }));
vi.mock('./mods', () => ({
    runExclusiveModMutation: (fn: () => Promise<unknown>) => fn(),
    scanMods: async () => h.mods,
}));
vi.mock('./modSafety', () => ({
    carryVpkSafety: h.carry,
    assertVpkSafety: h.assertSafety,
    moveSafetySnapshot: h.moveSafety,
}));
vi.mock('./modTemps', () => ({ modTempPath: () => h.staged }));
vi.mock('./profiles', () => ({ retargetProfileModSha: h.retarget }));
vi.mock('./vpk', async (importOriginal) => ({
    findChunkSiblingNames: (await importOriginal<typeof import('./vpk')>()).findChunkSiblingNames,
    parseVpkEntryStats: (path: string) => h.entries.get(path) ?? null,
}));

import { healModAttachments } from './attachmentHeal';

const WEREWOLF = 'models/heroes_wip/werewolf/werewolf.vmdl_c';
const MATERIAL = 'materials/werewolf/skin.vmat_c';

let dir: string;
let modPath: string;

/** vpkmerge writes the repack to `--output` and prints what it healed. */
function vpkmergeHeals(healed: string[], outputEntries: Array<{ path: string; size: number }>) {
    h.run.mockImplementation(async (args: string[]) => {
        if (healed.length > 0) {
            await fs.writeFile(args[args.indexOf('--output') + 1], 'healed');
            h.entries.set(h.staged, outputEntries);
        }
        return JSON.stringify(healed.map((entry) => ({ entry, attachments: ['standing_pivot'], blocks: 2 })));
    });
}

beforeEach(async () => {
    vi.clearAllMocks();
    dir = await fs.mkdtemp(join(tmpdir(), 'attachment-heal-'));
    modPath = join(dir, 'pak04_dir.vpk');
    await fs.writeFile(modPath, 'original');
    h.staged = join(dir, '.heal-test.tmp');
    h.mods = [{ id: 'silver', name: 'Flower Child Silver', path: modPath, fileName: 'pak04_dir.vpk', metaKey: 'pak04_dir.vpk', enabled: true }];
    h.entries.clear();
    h.entries.set(modPath, [{ path: WEREWOLF, size: 100 }, { path: MATERIAL, size: 10 }]);
    h.meta.clear();
    h.meta.set('pak04_dir.vpk', { sha256: 'old' });
    h.setHash.mockImplementation(async (key: string) => h.meta.set(key, { sha256: 'new' }));
    h.carry.mockResolvedValue('trusted');
});

afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
});

async function files(): Promise<string[]> {
    return (await fs.readdir(dir)).sort();
}

describe('healModAttachments', () => {
    it('swaps in the healed repack and moves profiles onto the new hash', async () => {
        vpkmergeHeals([WEREWOLF], [{ path: WEREWOLF, size: 140 }, { path: MATERIAL, size: 10 }]);

        await expect(healModAttachments(dir, 'silver')).resolves.toBe(1);
        expect(h.run.mock.calls[0][0]).toEqual([
            'attachments', 'heal', '--base', join(dir, 'pak01_dir.vpk'), '--output', h.staged, '--json', modPath,
        ]);
        expect(await fs.readFile(modPath, 'utf8')).toBe('healed');
        expect(await files()).toEqual(['pak04_dir.vpk']);
        expect(h.moveSafety).toHaveBeenCalledWith(h.staged, modPath);
        expect(h.setHash).toHaveBeenCalledWith('pak04_dir.vpk', {}, modPath);
        expect(h.retarget).toHaveBeenCalledWith('old', 'new');
    });

    it('leaves a current mod untouched', async () => {
        vpkmergeHeals([], []);
        await expect(healModAttachments(dir, 'silver')).resolves.toBe(0);
        expect(await fs.readFile(modPath, 'utf8')).toBe('original');
        expect(h.setHash).not.toHaveBeenCalled();
        expect(h.retarget).not.toHaveBeenCalled();
    });

    it('refuses a repack that lost an entry', async () => {
        vpkmergeHeals([WEREWOLF], [{ path: WEREWOLF, size: 140 }]);
        await expect(healModAttachments(dir, 'silver')).rejects.toThrow(/2 entries became 1/);
        expect(await fs.readFile(modPath, 'utf8')).toBe('original');
        expect(await files()).toEqual(['pak04_dir.vpk']);
        expect(h.retarget).not.toHaveBeenCalled();
    });

    it('accepts a repack that folded a path the mod listed twice', async () => {
        h.entries.set(modPath, [{ path: WEREWOLF, size: 100 }, { path: 'README.txt', size: 0 }, { path: 'README.txt', size: 0 }]);
        vpkmergeHeals([WEREWOLF], [{ path: WEREWOLF, size: 140 }, { path: 'README.txt', size: 0 }]);
        await expect(healModAttachments(dir, 'silver')).resolves.toBe(1);
        expect(await fs.readFile(modPath, 'utf8')).toBe('healed');
    });

    it('refuses a repack that resized an entry it did not heal', async () => {
        vpkmergeHeals([WEREWOLF], [{ path: WEREWOLF, size: 140 }, { path: MATERIAL.toUpperCase(), size: 11 }]);
        await expect(healModAttachments(dir, 'silver')).rejects.toThrow(/skin\.vmat_c changed size/);
        expect(await fs.readFile(modPath, 'utf8')).toBe('original');
    });

    it('reviews the repack when it carries a finding the mod did not', async () => {
        vpkmergeHeals([WEREWOLF], [{ path: WEREWOLF, size: 140 }, { path: MATERIAL, size: 10 }]);
        h.carry.mockResolvedValue('differs');
        h.assertSafety.mockRejectedValue(new Error('MOD_SAFETY_BLOCKED'));
        await expect(healModAttachments(dir, 'silver')).rejects.toThrow('MOD_SAFETY_BLOCKED');
        expect(h.assertSafety).toHaveBeenCalledWith(h.staged, { name: 'Flower Child Silver' });
        expect(await fs.readFile(modPath, 'utf8')).toBe('original');
        expect(await files()).toEqual(['pak04_dir.vpk']);
    });

    it('does not stamp a hash on a mod that had none', async () => {
        h.meta.clear();
        vpkmergeHeals([WEREWOLF], [{ path: WEREWOLF, size: 140 }, { path: MATERIAL, size: 10 }]);
        await expect(healModAttachments(dir, 'silver')).resolves.toBe(1);
        expect(h.setHash).not.toHaveBeenCalled();
        expect(h.retarget).not.toHaveBeenCalled();
    });

    it('rejects an unknown mod id without spawning vpkmerge', async () => {
        await expect(healModAttachments(dir, 'gone')).rejects.toThrow('Mod not found: gone');
        expect(h.run).not.toHaveBeenCalled();
    });

    it('pins legacy sibling order before the heal changes the size', async () => {
        vpkmergeHeals([WEREWOLF], [{ path: WEREWOLF, size: 140 }, { path: MATERIAL, size: 10 }]);
        await healModAttachments(dir, 'silver');
        expect(h.freeze).toHaveBeenCalledWith(h.mods);
        expect(h.freeze.mock.invocationCallOrder[0]).toBeLessThan(h.run.mock.invocationCallOrder[0]);
    });

    it('refuses a mod the running game has loaded', async () => {
        h.assertMovable.mockImplementationOnce(() => { throw new Error('Game is running'); });
        await expect(healModAttachments(dir, 'silver')).rejects.toThrow('Game is running');
        expect(h.syncGame).toHaveBeenCalledWith(h.mods);
        expect(h.assertMovable).toHaveBeenCalledWith(h.mods[0]);
        expect(h.run).not.toHaveBeenCalled();
        expect(await fs.readFile(modPath, 'utf8')).toBe('original');
    });

    it('refuses a VPK split into chunk files', async () => {
        await fs.writeFile(join(dir, 'pak04_000.vpk'), 'chunk');
        await expect(healModAttachments(dir, 'silver')).rejects.toThrow(/chunk files/);
        expect(h.run).not.toHaveBeenCalled();
        expect(await files()).toEqual(['pak04_000.vpk', 'pak04_dir.vpk']);
    });
});
