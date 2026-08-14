/**
 * Coverage for the discriminator the orphan-prune guard rests on (see the
 * get-mods handler in ipc/mods.ts).
 *
 * The prune may only run against a Deadlock folder that is really there. The
 * hard part is that Grimoire's own path helpers mkdir their roots on demand, so
 * a path that has stopped resolving does not fail: it comes back as a clean,
 * empty, entirely fabricated addons tree, and the scan honestly reports zero
 * mods. gameinfo.gi is what separates the two, so these tests pin that the
 * helpers cannot fabricate one, that the looser check would NOT have done the
 * job, and that the dev sandbox does pass it (which is why the devMode check in
 * get-mods is load-bearing rather than redundant).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const harness = vi.hoisted(() => ({ devRoot: '' }));

vi.mock('../utils/paths', () => ({
    getDevDeadlockPath: () => harness.devRoot,
}));
vi.mock('./steamRoots', () => ({
    getSteamRoots: () => [],
    findBottleForPath: () => null,
    readBottleDriveMap: () => new Map(),
    resolveBottleWindowsPath: () => null,
}));

import {
    getAddonsPath,
    getDisabledPath,
    getGrimoirePath,
    isValidDeadlockPath,
    looksLikeDeadlockPath,
} from './deadlock';
import { ensureDevDeadlockPath } from './dev';

const created: string[] = [];

function tempRoot(prefix: string): string {
    const dir = mkdtempSync(join(tmpdir(), prefix));
    created.push(dir);
    return dir;
}

afterEach(() => {
    for (const dir of created.splice(0)) {
        rmSync(dir, { recursive: true, force: true });
    }
});

describe('isValidDeadlockPath as the prune guard', () => {
    it('rejects the empty tree our own path helpers fabricate', () => {
        // Exactly what scanMods does to a path that no longer resolves: every
        // root is created on demand, then scanned, then reported as zero mods.
        const root = tempRoot('deadlock-fabricated-');
        getAddonsPath(root);
        getDisabledPath(root);
        getGrimoirePath(root);

        expect(existsSync(join(root, 'game', 'citadel', 'addons', '.disabled'))).toBe(true);
        expect(existsSync(join(root, 'game', 'citadel', 'grimoire'))).toBe(true);
        // The whole tree exists and still does not read as an install.
        expect(isValidDeadlockPath(root)).toBe(false);
    });

    it('accepts a real install', () => {
        const root = tempRoot('deadlock-real-');
        getAddonsPath(root);
        writeFileSync(join(root, 'game', 'citadel', 'gameinfo.gi'), '"GameInfo" {}');

        expect(isValidDeadlockPath(root)).toBe(true);
    });

    it('rejects a path with nothing in it at all', () => {
        expect(isValidDeadlockPath(tempRoot('deadlock-bare-'))).toBe(false);
    });

    it('shows why the looser check could not be used here', () => {
        // looksLikeDeadlockPath exists for the manual path picker, so a user
        // whose gameinfo.gi was removed can still reach the recovery UI. It
        // only tests game/citadel, which getAddonsPath creates on the way to
        // citadel/addons, so it says yes to the fabricated tree above.
        const root = tempRoot('deadlock-loose-');
        getAddonsPath(root);

        expect(looksLikeDeadlockPath(root)).toBe(true);
        expect(isValidDeadlockPath(root)).toBe(false);
    });

    it('says yes to the dev sandbox, which is why devMode is still checked separately', () => {
        // ensureDevDeadlockPath writes an empty gameinfo.gi, so the sandbox
        // passes this guard. get-mods must keep its own !settings.devMode
        // check, or a dev session would prune every real install's metadata
        // against a tree that has never held a mod.
        harness.devRoot = tempRoot('deadlock-devmode-');

        expect(isValidDeadlockPath(ensureDevDeadlockPath())).toBe(true);
    });
});
