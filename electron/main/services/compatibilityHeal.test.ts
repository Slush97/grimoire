import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const h = vi.hoisted(() => ({
    run: vi.fn(), guard: vi.fn(), retarget: vi.fn(), setHash: vi.fn(), safety: vi.fn(),
    userData: '', staged: '', path: '', metaSha: 'old',
    entries: new Map<string, Array<{ path: string; size: number }>>(),
    trees: new Map<string, string[] | null>(),
}));
vi.mock('electron', () => ({ app: { getPath: () => h.userData } }));
vi.mock('./deadlock', () => ({ getCitadelPath: (path: string) => path, metaKeyFor: () => 'pak04_dir.vpk' }));
vi.mock('./gameSessionMods', () => ({ syncRunningGameModSnapshotFromMods: vi.fn(), assertCanMoveLoadedGameMod: h.guard }));
vi.mock('./imprintMods', () => ({ freezeLegacyVpkIndexes: vi.fn() }));
vi.mock('./metadata', () => ({ getModMetadata: () => ({ sha256: h.metaSha }), setModMetadataWithHash: h.setHash }));
vi.mock('./modMerger', () => ({ runVpkmergeStdout: h.run }));
vi.mock('./mods', () => ({
    runExclusiveModMutation: (fn: () => Promise<unknown>) => fn(),
    scanMods: async () => [{ id: 'skin', name: 'Test skin', path: h.path, fileName: 'pak04_dir.vpk', enabled: true }],
}));
vi.mock('./modSafety', () => ({ carryVpkSafety: async () => 'differs', assertVpkSafety: h.safety, moveSafetySnapshot: vi.fn() }));
vi.mock('./modTemps', () => ({ modTempPath: () => h.staged }));
vi.mock('./profiles', () => ({ retargetProfileModSha: h.retarget }));
vi.mock('./vpk', () => ({
    findChunkSiblingNames: () => [],
    parseVpkEntryStats: (path: string) => h.entries.get(path) ?? null,
    parseVpkDirectoriesAsync: async () => h.trees,
}));

import { repairModCompatibility, hasOtherAnimationOverrides } from './compatibilityHeal';

const entry = 'scripts/abilities.vdata_c';
let dir = '';
beforeEach(async () => {
    vi.resetAllMocks();
    dir = await fs.mkdtemp(join(tmpdir(), 'compatibility-heal-'));
    h.userData = join(dir, 'user');
    h.path = join(dir, 'pak04_dir.vpk');
    h.staged = join(dir, '.repair.tmp');
    h.metaSha = 'old';
    h.setHash.mockImplementation(async () => { h.metaSha = await fs.readFile(h.path, 'utf8') === 'repaired' ? 'new' : 'old'; });
    h.trees.clear();
    await fs.writeFile(h.path, 'original');
    await fs.writeFile(join(dir, 'pak01_dir.vpk'), 'game');
    h.entries.clear();
    h.entries.set(h.path, [{ path: entry, size: 10 }, { path: 'keep.bin', size: 4 }]);
    h.entries.set(h.staged, [{ path: entry, size: 20 }, { path: 'keep.bin', size: 4 }]);
    h.run.mockImplementation(async () => {
        await fs.writeFile(h.staged, 'repaired');
        return JSON.stringify([{ entry, kind: 'data', status: 'repairable', changes: 1, detail: '' }]);
    });
});
afterEach(async () => { await fs.rm(dir, { recursive: true, force: true }); });

it('keeps a durable original backup, replaces the archive and updates profile identity', async () => {
    const result = await repairModCompatibility(dir, 'skin');
    expect(result.kind).toBe('repaired');
    if (result.kind !== 'repaired') throw new Error('Expected a repair');
    expect(await fs.readFile(result.backupPath, 'utf8')).toBe('original');
    expect(await fs.readFile(h.path, 'utf8')).toBe('repaired');
    expect(h.setHash).toHaveBeenCalled();
    expect(h.retarget).toHaveBeenCalledWith('old', 'new');
    await expect(fs.stat(h.staged)).rejects.toThrow();
});

it('refuses loaded mods before running the engine', async () => {
    h.guard.mockImplementation(() => { throw new Error('loaded'); });
    await expect(repairModCompatibility(dir, 'skin')).rejects.toThrow('loaded');
    expect(h.run).not.toHaveBeenCalled();
    expect(await fs.readFile(h.path, 'utf8')).toBe('original');
});

it('counts a model repaired for both sounds and skeletons as one file', async () => {
    h.run.mockImplementationOnce(async () => {
        await fs.writeFile(h.staged, 'repaired');
        return JSON.stringify(['sounds', 'skeleton'].map((kind) => ({ entry, kind, status: 'repairable', changes: 1, detail: '' })));
    });
    const result = await repairModCompatibility(dir, 'skin');
    expect(result).toMatchObject({ kind: 'repaired', count: 1 });
});

it('does not replace a mod after a failed safety or preservation check', async () => {
    h.safety.mockRejectedValueOnce(new Error('unsafe'));
    await expect(repairModCompatibility(dir, 'skin')).rejects.toThrow('unsafe');
    expect(await fs.readFile(h.path, 'utf8')).toBe('original');
    h.entries.set(h.staged, [{ path: entry, size: 20 }]);
    await expect(repairModCompatibility(dir, 'skin')).rejects.toThrow('unrelated');
    expect(await fs.readFile(h.path, 'utf8')).toBe('original');
    expect(h.retarget).not.toHaveBeenCalled();
});

it('rejects invalid CLI output and source edits made during the repair', async () => {
    h.run.mockResolvedValueOnce('[{"entry":"unvalidated"}]');
    await expect(repairModCompatibility(dir, 'skin')).rejects.toThrow();
    h.run.mockImplementationOnce(async () => {
        await fs.writeFile(h.path, 'external edit');
        await fs.writeFile(h.staged, 'repaired');
        return JSON.stringify([{ entry, kind: 'data', status: 'repairable', changes: 1, detail: '' }]);
    });
    await expect(repairModCompatibility(dir, 'skin')).rejects.toThrow('changed during repair');
    expect(await fs.readFile(h.path, 'utf8')).toBe('external edit');
});

it('treats an unreadable competing mod as an unknown animation provider', async () => {
    h.trees.set('other.vpk', null);
    await expect(hasOtherAnimationOverrides(['other.vpk'], h.path)).resolves.toBe(true);
});

it('refuses a game update that lands while the engine is running', async () => {
    h.run.mockImplementationOnce(async () => {
        await fs.writeFile(join(dir, 'pak01_dir.vpk'), 'updated game');
        return JSON.stringify([{ entry, kind: 'data', status: 'repairable', changes: 1, detail: '' }]);
    });
    await expect(repairModCompatibility(dir, 'skin')).rejects.toThrow('Deadlock updated');
    expect(await fs.readFile(h.path, 'utf8')).toBe('original');
});

it('restores the original archive when saving its identity fails after replacement', async () => {
    h.setHash.mockRejectedValueOnce(new Error('disk error'));
    await expect(repairModCompatibility(dir, 'skin')).rejects.toThrow('original mod was restored');
    expect(await fs.readFile(h.path, 'utf8')).toBe('original');
    expect(h.retarget).not.toHaveBeenCalled();
});

it('rolls profile identities back if their persistence fails after the archive swap', async () => {
    h.retarget.mockImplementationOnce(() => { throw new Error('profile save failed'); });
    await expect(repairModCompatibility(dir, 'skin')).rejects.toThrow('original mod was restored');
    expect(await fs.readFile(h.path, 'utf8')).toBe('original');
    expect(h.metaSha).toBe('old');
    expect(h.retarget).toHaveBeenLastCalledWith('new', 'old');
});
