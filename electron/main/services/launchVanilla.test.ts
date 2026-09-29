import { beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const harness = vi.hoisted(() => ({ userData: '', untrusted: new Set<string>(), incomplete: new Set<string>() }));
const lock = vi.hoisted(() => vi.fn((fn: () => Promise<unknown>) => fn()));
vi.mock('electron', () => ({
    app: { getPath: () => harness.userData },
    shell: { openExternal: vi.fn() },
}));
vi.mock('./mods', () => ({ runExclusiveModMutation: lock }));
// launchModded must never read or rewrite the developer's real Steam config.
vi.mock('./launchOptions', () => ({ isSteamRunning: async () => true, readLaunchOptions: vi.fn(), writeLaunchOptions: vi.fn() }));

import { shell } from 'electron';
import { launchModded, readStash, restoreFromStash, stashEnabledMods } from './launch';
import { getModMetadata, setModMetadata } from './metadata';

function gameDirs() {
    const root = mkdtempSync(join(tmpdir(), 'vanilla-game-'));
    const citadel = join(root, 'game', 'citadel');
    const grimoire = join(citadel, 'grimoire');
    const addons = join(citadel, 'addons');
    const disabled = join(addons, '.disabled');
    mkdirSync(grimoire, { recursive: true });
    mkdirSync(disabled, { recursive: true });
    return { root, grimoire, addons, disabled };
}

const parkedFiles = (disabled: string) => readdirSync(disabled).filter((name) => name.endsWith('.vpk')).sort();

describe('Vanilla user-mod stash', () => {
    beforeEach(() => {
        harness.userData = mkdtempSync(join(tmpdir(), 'vanilla-userdata-'));
        harness.untrusted = new Set();
        harness.incomplete = new Set();
        lock.mockClear();
        vi.mocked(shell.openExternal).mockClear();
    });

    it('stashes and restores Global user VPKs while preserving reserved Locker artifacts', async () => {
        const root = mkdtempSync(join(tmpdir(), 'vanilla-game-'));
        const citadel = join(root, 'game', 'citadel');
        const grimoire = join(citadel, 'grimoire');
        const addons = join(citadel, 'addons');
        const disabled = join(addons, '.disabled');
        mkdirSync(grimoire, { recursive: true });
        mkdirSync(disabled, { recursive: true });

        const managedDir = join(grimoire, 'pak01_dir.vpk');
        const managedChunk = join(grimoire, 'pak01_000.vpk');
        const globalDir = join(grimoire, 'pak05_dir.vpk');
        const globalChunk = join(grimoire, 'pak05_000.vpk');
        const addonDir = join(addons, 'pak02_dir.vpk');
        for (const path of [managedDir, managedChunk, globalDir, globalChunk, addonDir]) {
            writeFileSync(path, path);
        }

        const stash = await stashEnabledMods(root);

        expect(stash.status).toBe('active');
        expect(stash.mods.map(({ fileName, folder }) => `${folder}/${fileName}`).sort()).toEqual([
            'addons/pak02_dir.vpk',
            'grimoire/pak05_000.vpk',
            'grimoire/pak05_dir.vpk',
        ]);
        expect(existsSync(managedDir)).toBe(true);
        expect(existsSync(managedChunk)).toBe(true);
        expect(existsSync(globalDir)).toBe(false);
        expect(existsSync(globalChunk)).toBe(false);
        expect(existsSync(addonDir)).toBe(false);
        expect(existsSync(join(disabled, 'grimoire', 'pak05_dir.vpk'))).toBe(true);
        expect(existsSync(join(disabled, 'grimoire', 'pak05_000.vpk'))).toBe(true);
        expect(existsSync(join(disabled, 'pak02_dir.vpk'))).toBe(true);

        const restored = await restoreFromStash(root, stash);

        expect(restored).toEqual({ restored: 3, skipped: 0, failed: [] });
        expect(existsSync(globalDir)).toBe(true);
        expect(existsSync(globalChunk)).toBe(true);
        expect(existsSync(addonDir)).toBe(true);
        expect(existsSync(join(harness.userData, 'vanilla-stash.json'))).toBe(false);
    });

    it('moves unapproved stashed archives into the disabled library, chunks and metadata included', async () => {
        const { root, grimoire, addons, disabled } = gameDirs();
        for (const path of [
            join(grimoire, 'pak05_dir.vpk'),
            join(grimoire, 'pak05_000.vpk'),
            join(addons, 'pak02_dir.vpk'),
            join(addons, 'pak03_dir.vpk'),
        ]) {
            writeFileSync(path, path);
        }
        setModMetadata('grimoire/pak05_dir.vpk', { modName: 'Script HUD', priorityMod: true });
        setModMetadata('pak03_dir.vpk', { modName: 'Unreadable pack' });
        const stash = await stashEnabledMods(root);
        harness.untrusted = new Set(['pak05_dir.vpk', 'pak03_dir.vpk']);

        const result = await restoreFromStash(root, stash);

        expect(result).toEqual({ restored: 1, skipped: 3, failed: [] });
        expect(await readStash()).toBeNull();
        expect(existsSync(join(addons, 'pak02_dir.vpk'))).toBe(true);
        expect(readdirSync(grimoire)).toEqual([]);
        expect(existsSync(join(addons, 'pak03_dir.vpk'))).toBe(false);
        expect(readdirSync(join(disabled, 'grimoire'))).toEqual([]);

        const parked = parkedFiles(disabled);
        expect(parked).toHaveLength(3);
        const hud = parked.find((name) => name.endsWith('_pak05_dir.vpk'))!;
        const pack = parked.find((name) => name.endsWith('_pak03_dir.vpk'))!;
        expect(parked).toContain(hud.replace(/_dir\.vpk$/, '_000.vpk'));
        expect(getModMetadata(hud)).toEqual({ modName: 'Script HUD', priorityMod: true });
        expect(getModMetadata(pack)).toEqual({ modName: 'Unreadable pack' });
        expect(getModMetadata('grimoire/pak05_dir.vpk')).toBeUndefined();
        expect(getModMetadata('pak03_dir.vpk')).toBeUndefined();
        expect(lock).toHaveBeenCalledTimes(2);
    });

    it('launches modded after restoring a stash whose mod predates its approval', async () => {
        const { root, addons, disabled } = gameDirs();
        writeFileSync(join(addons, 'pak02_dir.vpk'), 'script hud');
        await stashEnabledMods(root);
        harness.untrusted = new Set(['pak02_dir.vpk']);

        await expect(launchModded({ deadlockPath: root })).resolves.toBeUndefined();

        expect(await readStash()).toBeNull();
        expect(existsSync(join(addons, 'pak02_dir.vpk'))).toBe(false);
        expect(parkedFiles(disabled)).toEqual([expect.stringMatching(/^safety_.+_pak02_dir\.vpk$/)]);
        expect(shell.openExternal).toHaveBeenCalledOnce();
    });

    it('keeps the manifest only while an I/O failure leaves a stashed file unaccounted for', async () => {
        const { root, addons } = gameDirs();
        writeFileSync(join(addons, 'pak02_dir.vpk'), 'script hud');
        const stash = await stashEnabledMods(root);
        harness.untrusted = new Set(['pak02_dir.vpk']);
        lock.mockRejectedValueOnce(Object.assign(new Error('busy'), { code: 'EBUSY' }));

        expect(await restoreFromStash(root, stash)).toEqual({ restored: 0, skipped: 0, failed: ['pak02_dir.vpk'] });
        expect(await readStash()).not.toBeNull();

        expect(await restoreFromStash(root, stash)).toEqual({ restored: 0, skipped: 1, failed: [] });
        expect(await readStash()).toBeNull();
    });

    it('restores an archive whose check could not complete instead of parking it', async () => {
        const { root, addons, disabled } = gameDirs();
        writeFileSync(join(addons, 'pak02_dir.vpk'), 'skin');
        const stash = await stashEnabledMods(root);
        harness.incomplete = new Set(['pak02_dir.vpk']);

        expect(await restoreFromStash(root, stash)).toEqual({ restored: 1, skipped: 0, failed: [] });
        expect(existsSync(join(addons, 'pak02_dir.vpk'))).toBe(true);
        expect(parkedFiles(disabled)).toEqual([]);
        expect(lock).not.toHaveBeenCalled();
        expect(await readStash()).toBeNull();
    });
});
// These tests use inert file placeholders; scanner behavior has its own fixtures.
vi.mock('./modSafety', () => {
    const named = (set: Set<string>, path: string) => set.has(path.split(/[\\/]/).pop()!);
    return {
        assertVpkSafety: vi.fn(async (path: string) => {
            if (named(harness.untrusted, path)) throw new Error('MOD_SAFETY_TRUST_REQUIRED');
        }),
        inspectVpkSafety: vi.fn(async (path: string) => ({
            verdict: named(harness.incomplete, path) ? 'incomplete' : named(harness.untrusted, path) ? 'requires-trust' : 'no-findings',
        })),
        isModSafetyTrusted: vi.fn(async (report: { verdict: string }) => report.verdict === 'no-findings'),
        moveSafetySnapshot: vi.fn(),
    };
});
