import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const state = vi.hoisted(() => ({ userData: '', bakes: 0, failBakes: false }));
vi.mock('electron', () => ({
    app: {
        getPath: () => state.userData,
        getAppPath: () => process.cwd(),
        getVersion: () => 'test',
        isPackaged: false,
    },
    BrowserWindow: { getAllWindows: () => [] },
}));
vi.mock('./launch', () => ({ isDeadlockRunning: async () => false, readStash: async () => null }));
vi.mock('./system', async (importOriginal) => ({
    ...await importOriginal(),
    getGameinfoStatus: () => ({ configured: true }),
}));
// Stand in for vpkmerge: every bake or merge writes a placeholder VPK.
vi.mock('./modMerger', async (importOriginal) => {
    const { writeFileSync: write } = await import('node:fs');
    return {
        ...await importOriginal(),
        vpkmergeBinaryPath: () => 'vpkmerge',
        verifyVpkOutput: async () => {},
        runVpkmerge: async (args: string[]) => {
            if (state.failBakes) throw new Error('bake failed');
            const encodeAt = args.indexOf('--encode-vpk');
            if (encodeAt !== -1) state.bakes++;
            write(encodeAt === -1 ? args[0] : args[encodeAt + 1], 'vpk');
        },
    };
});

import { applyHeroColor, listAppliedColors, revertHeroColor } from './heroColors';
import { applyTrippySkin, listAppliedTrippySkins } from './trippyEffects';
import { lockerColorsVpkPath, lockerTrippySkinsVpkPath, sameLockerSelections } from './lockerVpk';
import { applyProfile, createProfile, loadProfiles } from './profiles';
import { applyProfileLocker, currentProfileLocker, releaseLockerHold, saveLockerToActiveProfile } from './profileLocker';
import { loadSettings, saveSettings } from './settings';

let root: string;
let deadlockPath: string;

beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'grimoire-profile-locker-'));
    state.userData = join(root, 'userdata');
    state.bakes = 0;
    state.failBakes = false;
    mkdirSync(state.userData);
    deadlockPath = join(root, 'deadlock');
    const citadel = join(deadlockPath, 'game', 'citadel');
    mkdirSync(join(citadel, 'addons'), { recursive: true });
    writeFileSync(join(citadel, 'gameinfo.gi'), 'GameInfo { FileSystem { SearchPaths { Game citadel } } }');
    writeFileSync(join(citadel, 'pak01_dir.vpk'), 'base');
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

function setActiveProfile(id: string | null) {
    saveSettings({ ...loadSettings(), activeProfileId: id });
}

/** Save the current state as a profile, the way the create-profile IPC does. */
const save = (name: string) => createProfile(deadlockPath, name, undefined, undefined, currentProfileLocker());

/** Apply a profile and its Locker effects, the way the apply-profile IPC does. */
async function apply(profileId: string) {
    const { profile } = await applyProfile(deadlockPath, profileId);
    const error = await applyProfileLocker(deadlockPath, profileId, profile.locker);
    setActiveProfile(profileId);
    return error;
}

const hues = () => listAppliedColors().map((c) => `${c.heroName}:${c.hue}`).sort();

describe('profile Locker effects', () => {
    it('saves the applied colors and trippy skins with a new profile', async () => {
        await applyHeroColor(deadlockPath, 'Paige', 120, 1, 1);
        await applyTrippySkin(deadlockPath, 'Abrams', {});

        const profile = await save('Mine');

        expect(profile.locker?.colors.map((c) => c.heroName)).toEqual(['Paige']);
        expect(profile.locker?.trippySkins.map((s) => s.heroName)).toEqual(['Abrams']);
    });

    it('restores each profile\'s own effects on apply', async () => {
        await applyHeroColor(deadlockPath, 'Paige', 120, 1, 1);
        const mine = await save('Mine');

        await applyHeroColor(deadlockPath, 'Paige', 300, 1, 1);
        await applyHeroColor(deadlockPath, 'Abrams', 40, 1, 1);
        await applyTrippySkin(deadlockPath, 'Abrams', {});
        const theirs = await save('Theirs');

        expect(await apply(mine.id)).toBeUndefined();
        expect(hues()).toEqual(['Paige:120']);
        expect(listAppliedTrippySkins()).toEqual([]);
        expect(existsSync(lockerTrippySkinsVpkPath(deadlockPath))).toBe(false);

        await apply(theirs.id);
        expect(hues()).toEqual(['Abrams:40', 'Paige:300']);
        expect(listAppliedTrippySkins().map((s) => s.heroName)).toEqual(['Abrams']);
        expect(existsSync(lockerColorsVpkPath(deadlockPath))).toBe(true);
    });

    it('clears the Locker for a profile saved with no effects', async () => {
        const empty = await save('Empty');
        await applyHeroColor(deadlockPath, 'Paige', 120, 1, 1);

        await apply(empty.id);

        expect(listAppliedColors()).toEqual([]);
        expect(existsSync(lockerColorsVpkPath(deadlockPath))).toBe(false);
    });

    it('leaves the Locker alone for a profile saved without a Locker set', async () => {
        const legacy = await save('Legacy');
        const stored = loadProfiles();
        delete stored[0].locker;
        writeFileSync(join(state.userData, 'profiles.json'), JSON.stringify(stored));
        await applyHeroColor(deadlockPath, 'Paige', 120, 1, 1);

        await apply(legacy.id);

        expect(hues()).toEqual(['Paige:120']);
    });

    it('does not rebuild when the Locker already matches the profile', async () => {
        await applyHeroColor(deadlockPath, 'Paige', 120, 1, 1);
        const mine = await save('Mine');
        rmSync(join(state.userData, 'ability-colors'), { recursive: true });
        state.bakes = 0;

        await apply(mine.id);

        expect(state.bakes).toBe(0);
    });

    it('reports a failed rebuild instead of throwing', async () => {
        await applyHeroColor(deadlockPath, 'Paige', 120, 1, 1);
        const mine = await save('Mine');
        await revertHeroColor(deadlockPath, 'Paige');
        rmSync(join(state.userData, 'ability-colors'), { recursive: true });
        state.failBakes = true;

        expect(await apply(mine.id)).toBe('bake failed');
    });

    it('reports a pack it cannot remove and keeps its colors listed', async () => {
        const empty = await save('Empty');
        await applyHeroColor(deadlockPath, 'Paige', 120, 1, 1);
        // Stands in for a pack the running game holds open: removing it fails with something other than ENOENT
        const pack = lockerColorsVpkPath(deadlockPath);
        rmSync(pack);
        mkdirSync(join(pack, 'held'), { recursive: true });

        expect(await apply(empty.id)).toBeTruthy();
        expect(hues()).toEqual(['Paige:120']);
    });

    it('keeps a profile\'s saved effects while its rebuild has failed', async () => {
        await applyHeroColor(deadlockPath, 'Paige', 120, 1, 1);
        const mine = await save('Mine');
        await revertHeroColor(deadlockPath, 'Paige');
        rmSync(join(state.userData, 'ability-colors'), { recursive: true });
        state.failBakes = true;
        expect(await apply(mine.id)).toBe('bake failed');
        state.failBakes = false;
        const stored = () => loadProfiles().find((p) => p.id === mine.id)?.locker?.colors.map((c) => `${c.heroName}:${c.hue}`);

        await applyHeroColor(deadlockPath, 'Abrams', 40, 1, 1);
        saveLockerToActiveProfile();
        expect(stored()).toEqual(['Paige:120']);

        expect(await apply(mine.id)).toBeUndefined();
        expect(hues()).toEqual(['Paige:120']);
        await applyHeroColor(deadlockPath, 'Paige', 200, 1, 1);
        saveLockerToActiveProfile();
        expect(stored()).toEqual(['Paige:200']);
    });

    it('lets an Update end a failed apply\'s hold', async () => {
        await applyHeroColor(deadlockPath, 'Paige', 120, 1, 1);
        const mine = await save('Mine');
        rmSync(join(state.userData, 'ability-colors'), { recursive: true });
        await revertHeroColor(deadlockPath, 'Paige');
        state.failBakes = true;
        await apply(mine.id);
        state.failBakes = false;

        releaseLockerHold('profile_other');
        expect(loadSettings().lockerUnappliedProfileId).toBe(mine.id);
        releaseLockerHold(mine.id);
        expect(loadSettings().lockerUnappliedProfileId).toBeNull();
    });

    it('stores a Locker edit in the active profile only', async () => {
        const mine = await save('Mine');
        const theirs = await save('Theirs');
        setActiveProfile(theirs.id);

        await applyHeroColor(deadlockPath, 'Paige', 200, 1, 1);
        saveLockerToActiveProfile();

        const saved = loadProfiles();
        expect(saved.find((p) => p.id === theirs.id)?.locker?.colors.map((c) => c.hue)).toEqual([200]);
        expect(saved.find((p) => p.id === mine.id)?.locker?.colors).toEqual([]);
    });

    it('stores nothing when no saved profile is active', async () => {
        const mine = await save('Mine');
        await applyHeroColor(deadlockPath, 'Paige', 200, 1, 1);

        setActiveProfile(null);
        saveLockerToActiveProfile();
        setActiveProfile('profile_deleted');
        saveLockerToActiveProfile();

        expect(loadProfiles().find((p) => p.id === mine.id)?.locker?.colors).toEqual([]);
    });
});

describe('sameLockerSelections', () => {
    const pick = (heroCodename: string, hue: number, addedAt = 'then') => ({ heroCodename, hue, addedAt });

    it('ignores order, key order and when a pick was added', () => {
        expect(sameLockerSelections(
            [pick('bookworm', 120), pick('abrams', 40)],
            [{ addedAt: 'now', hue: 40, heroCodename: 'abrams' }, pick('bookworm', 120, 'now')],
        )).toBe(true);
    });

    it('tells apart a changed, added or removed pick', () => {
        expect(sameLockerSelections([pick('bookworm', 120)], [pick('bookworm', 121)])).toBe(false);
        expect(sameLockerSelections([pick('bookworm', 120)], [])).toBe(false);
        expect(sameLockerSelections([], [pick('bookworm', 120)])).toBe(false);
        expect(sameLockerSelections([], [])).toBe(true);
    });
});
