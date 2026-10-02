import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { safetyVpk } from './modSafetyFixtures';

// Real snapshot store, real scanner run in-process, real mods.ts and stash moves.
const h = vi.hoisted(() => ({ userData: '' }));
vi.mock('electron', () => ({
    app: { getPath: () => h.userData, getAppPath: () => h.userData, isPackaged: false },
    BrowserWindow: { getAllWindows: () => [] },
    shell: { openExternal: vi.fn() },
}));
vi.mock('node:worker_threads', async () => {
    const { EventEmitter } = await import('node:events');
    const { scanModSafety } = await import('./modSafetyScan');
    return { Worker: class extends EventEmitter {
        postMessage({ path }: { path: string }) { void scanModSafety(path).then((report) => this.emit('message', report)); }
        terminate() { return Promise.resolve(0); }
    } };
});
vi.mock('./launch', async (importOriginal) => ({ ...await importOriginal<typeof import('./launch')>(), isDeadlockRunning: async () => false }));

import { approveVpkSafety, inspectVpkSafety, modSafetySnapshot } from './modSafety';
import { deleteMod, installEnabledVpk, scanMods, swapModPriority } from './mods';
import { restoreFromStash, stashEnabledMods } from './launch';
import { saveMetadata } from './metadata';

const hud = safetyVpk([{ path: 'panorama/scripts/hud.js', bytes: Buffer.from('run("file:///x")') }]);
const skin = safetyVpk([{ path: 'models/heroes/skin.vmdl_c', bytes: Buffer.from('mesh') }]);
const other = safetyVpk([{ path: 'sounds/other.vsnd_c', bytes: Buffer.from('audio') }]);

let root: string;
let addons: string;
beforeEach(async () => {
    root = await fs.mkdtemp(join(tmpdir(), 'safety-snapshots-test-'));
    addons = join(root, 'game', 'citadel', 'addons');
    h.userData = join(root, 'userdata');
    for (const dir of [join(addons, '.disabled'), join(root, 'game', 'citadel', 'grimoire'), h.userData]) await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(join(h.userData, 'settings.json'), JSON.stringify({ experimentalModSafety: true }));
    saveMetadata({});
});
afterEach(async () => { await fs.rm(root, { recursive: true, force: true }); });
const idAt = async (path: string) => (await scanMods(root)).find((m) => m.path === path)!.id;

describe('safety snapshots follow the bytes', () => {
    it('swap exchanges the badges, so allowing the moved mod sends its own fingerprint', async () => {
        const [pak01, pak02] = [join(addons, 'pak01_dir.vpk'), join(addons, 'pak02_dir.vpk')];
        await fs.writeFile(pak01, hud);
        await fs.writeFile(pak02, skin);
        const flagged = await inspectVpkSafety(pak01);
        const clean = await inspectVpkSafety(pak02);
        expect(flagged.verdict).toBe('requires-trust');

        await swapModPriority(root, await idAt(pak01), await idAt(pak02));

        expect(modSafetySnapshot(pak02)).toEqual({ report: flagged, trusted: false });
        expect(modSafetySnapshot(pak01)).toEqual({ report: clean, trusted: true });
        await approveVpkSafety(pak02, flagged.fingerprint);
        expect(modSafetySnapshot(pak02)?.trusted).toBe(true);
    });

    it('delete clears the badge, and bytes a writer puts at the same path are not labelled with it', async () => {
        const pak03 = join(addons, 'pak03_dir.vpk');
        const pak05 = join(addons, 'pak05_dir.vpk');
        await fs.writeFile(pak03, hud);
        await fs.writeFile(pak05, hud);
        await inspectVpkSafety(pak03);
        await inspectVpkSafety(pak05);

        await deleteMod(root, await idAt(pak03));
        await fs.writeFile(pak03, other);
        await fs.writeFile(pak05, other);

        expect(modSafetySnapshot(pak03)).toBeUndefined();
        expect(modSafetySnapshot(pak05)).toBeUndefined();
    });

    it('bytes committed over a live path replace its badge with their own', async () => {
        const pak01 = join(addons, 'pak01_dir.vpk');
        const built = join(root, 'built.vpk');
        await fs.writeFile(pak01, hud);
        await fs.writeFile(built, skin);
        await inspectVpkSafety(pak01);

        expect(await installEnabledVpk(root, built, pak01)).toBe(pak01);

        expect(modSafetySnapshot(pak01)).toEqual({ report: await inspectVpkSafety(built), trusted: true });
    });

    it('a stash restore keeps the verdict its restore check produced', async () => {
        const pak02 = join(addons, 'pak02_dir.vpk');
        await fs.writeFile(pak02, skin);

        await restoreFromStash(root, await stashEnabledMods(root));

        expect(modSafetySnapshot(pak02)).toEqual({ report: await inspectVpkSafety(pak02), trusted: true });
    });
});
