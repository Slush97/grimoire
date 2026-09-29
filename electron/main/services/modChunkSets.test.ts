import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Real mods.ts file moves on real folders. Only the content check is faked.
const h = vi.hoisted(() => ({ userData: '', assertVpkSafety: vi.fn() }));
vi.mock('electron', () => ({ app: { getPath: () => h.userData } }));
vi.mock('./launch', () => ({ isDeadlockRunning: async () => false, readStash: async () => null }));
vi.mock('./modSafety', () => ({ assertVpkSafety: h.assertVpkSafety, moveSafetySnapshot: vi.fn(), forgetSafetySnapshot: vi.fn() }));

import { deleteMod, enableMod, installEnabledVpk, reorderMods, scanMods, setModPriority, swapModPriority } from './mods';
import { saveMetadata } from './metadata';

let root: string;
let addons: string;
let disabled: string;
beforeEach(async () => {
    root = await fs.mkdtemp(join(tmpdir(), 'chunk-sets-test-'));
    addons = join(root, 'game', 'citadel', 'addons');
    disabled = join(addons, '.disabled');
    h.userData = join(root, 'userdata');
    for (const dir of [disabled, join(root, 'game', 'citadel', 'grimoire'), h.userData]) await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(join(root, 'game', 'citadel', 'gameinfo.gi'), 'GameInfo {}\n');
    saveMetadata({});
    h.assertVpkSafety.mockReset();
    h.assertVpkSafety.mockResolvedValue(undefined);
});
afterEach(async () => { await fs.rm(root, { recursive: true, force: true }); });

const put = (folder: string, files: Record<string, string>) =>
    Promise.all(Object.entries(files).map(([name, bytes]) => fs.writeFile(join(folder, name), bytes)));
const contents = async (folder: string) => {
    const out: Record<string, string> = {};
    for (const name of (await fs.readdir(folder)).sort()) {
        if (name !== '.disabled') out[name] = await fs.readFile(join(folder, name), 'utf8');
    }
    return out;
};
const idAt = async (path: string) => (await scanMods(root)).find((m) => m.path === path)!.id;

describe('chunked mods move and delete as one set', () => {
    it('reorder swaps a chunked mod with a single-file one', async () => {
        await put(addons, { 'pak01_dir.vpk': 'a', 'pak02_dir.vpk': 'b', 'pak02_000.vpk': 'b0', 'pak02_001.vpk': 'b1' });
        const a = await idAt(join(addons, 'pak01_dir.vpk'));
        const b = await idAt(join(addons, 'pak02_dir.vpk'));

        await reorderMods(root, [b, a]);

        expect(await contents(addons)).toEqual({
            'pak01_000.vpk': 'b0', 'pak01_001.vpk': 'b1', 'pak01_dir.vpk': 'b', 'pak02_dir.vpk': 'a',
        });
    });

    it('reorder treats a slot holding only chunk files as taken', async () => {
        await put(addons, { 'pak01_000.vpk': 'orphan', 'pak03_dir.vpk': 'c', 'pak03_000.vpk': 'c0' });

        await reorderMods(root, [await idAt(join(addons, 'pak03_dir.vpk'))]);

        expect(await contents(addons)).toEqual({ 'pak01_000.vpk': 'orphan', 'pak02_000.vpk': 'c0', 'pak02_dir.vpk': 'c' });
    });

    it('swap with a disabled legacy slot carries the chunks', async () => {
        await put(addons, { 'pak02_dir.vpk': 'a', 'pak02_000.vpk': 'a0' });
        await put(disabled, { 'pak07_dir.vpk': 'b' });

        await swapModPriority(root, await idAt(join(addons, 'pak02_dir.vpk')), await idAt(join(disabled, 'pak07_dir.vpk')));

        expect(await contents(addons)).toEqual({ 'pak07_000.vpk': 'a0', 'pak07_dir.vpk': 'a' });
        expect(await contents(disabled)).toEqual({ 'pak02_dir.vpk': 'b' });
    });

    it('setModPriority carries the chunks and refuses a chunk-only slot', async () => {
        await put(addons, { 'pak02_dir.vpk': 'b', 'pak02_000.vpk': 'b0', 'pak05_000.vpk': 'orphan' });
        const b = await idAt(join(addons, 'pak02_dir.vpk'));

        await expect(setModPriority(root, b, 5)).rejects.toThrow('Priority 5 is already in use');
        await setModPriority(root, b, 7);

        expect(await contents(addons)).toEqual({ 'pak05_000.vpk': 'orphan', 'pak07_000.vpk': 'b0', 'pak07_dir.vpk': 'b' });
    });

    it('delete removes the chunks with the directory file', async () => {
        await put(addons, { 'pak04_dir.vpk': 'd', 'pak04_000.vpk': 'd0', 'pak04_001.vpk': 'd1' });

        await deleteMod(root, await idAt(join(addons, 'pak04_dir.vpk')));

        expect(await contents(addons)).toEqual({});
    });

    it('the enabled/disabled collision heal renames or drops a disabled twin with its chunks', async () => {
        await put(addons, { 'pak05_dir.vpk': 'enabled', 'pak06_dir.vpk': 'same', 'pak06_000.vpk': 'same0' });
        await put(disabled, { 'pak05_dir.vpk': 'other', 'pak05_000.vpk': 'other0', 'pak06_dir.vpk': 'same', 'pak06_000.vpk': 'same0' });

        await scanMods(root);

        const parked = await contents(disabled);
        const [dir] = Object.keys(parked).filter((name) => name.endsWith('_dir.vpk'));
        expect(parked).toEqual({ [dir.replace(/_dir\.vpk$/, '_000.vpk')]: 'other0', [dir]: 'other' });
        expect(dir).not.toMatch(/^pak/);
    });
});

describe('installEnabledVpk', () => {
    it('allocates after the check, so installs and enables finishing first cannot take its slot', async () => {
        const src = join(root, 'src');
        await fs.mkdir(src);
        await put(src, { 'slow.vpk': 'slow', 'fast.vpk': 'fast' });
        await put(disabled, { 'skin_dir.vpk': 'skin' });
        let release!: () => void;
        h.assertVpkSafety.mockImplementationOnce(() => new Promise<void>((resolve) => { release = resolve; }));

        const slow = installEnabledVpk(root, join(src, 'slow.vpk'));
        await vi.waitFor(() => expect(h.assertVpkSafety).toHaveBeenCalledTimes(1));
        const fast = await installEnabledVpk(root, join(src, 'fast.vpk'));
        const skin = await enableMod(root, await idAt(join(disabled, 'skin_dir.vpk')));
        release();

        expect([fast, skin.path, await slow]).toEqual(['pak01_dir.vpk', 'pak02_dir.vpk', 'pak03_dir.vpk'].map((n) => join(addons, n)));
        expect(await contents(addons)).toEqual({ 'pak01_dir.vpk': 'fast', 'pak02_dir.vpk': 'skin', 'pak03_dir.vpk': 'slow' });
    });
});
