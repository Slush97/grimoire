import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { safetyVpk } from './modSafetyFixtures';

// Real trust store, real scanner run in-process and real mods.ts moves.
const h = vi.hoisted(() => ({ userData: '', running: false }));
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
vi.mock('./launch', async (importOriginal) => ({ ...await importOriginal<typeof import('./launch')>(), isDeadlockRunning: async () => h.running }));

import { approveVpkSafety, inspectVpkSafety, isModSafetyTrusted, modSafetySnapshot } from './modSafety';
import { disallowInstalledMod } from './modSafetyAudit';
import { clearLoadedGameMods } from './gameSessionMods';
import { scanMods } from './mods';
import { saveMetadata } from './metadata';

const hud = safetyVpk([{ path: 'panorama/scripts/hud.js', bytes: Buffer.from('run("file:///x")') }]);

let root: string;
let addons: string;
beforeEach(async () => {
    root = await fs.mkdtemp(join(tmpdir(), 'safety-disallow-test-'));
    addons = join(root, 'game', 'citadel', 'addons');
    h.userData = join(root, 'userdata');
    h.running = false;
    clearLoadedGameMods();
    for (const dir of [join(addons, '.disabled'), join(root, 'game', 'citadel', 'grimoire'), h.userData]) await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(join(h.userData, 'settings.json'), JSON.stringify({ experimentalModSafety: true }));
    saveMetadata({});
});
afterEach(async () => { await fs.rm(root, { recursive: true, force: true }); });
const idAt = async (path: string) => (await scanMods(root)).find((m) => m.path === path)!.id;
const approved = async () => JSON.parse(await fs.readFile(join(h.userData, 'mod-safety-trust.json'), 'utf8')) as string[];
async function allowed(path: string) {
    await fs.writeFile(path, hud);
    const report = await inspectVpkSafety(path);
    await approveVpkSafety(path, report.fingerprint);
    return report;
}

describe('disallowing an allowed mod', () => {
    it('disables an enabled mod and returns it to review', async () => {
        const pak01 = join(addons, 'pak01_dir.vpk');
        const report = await allowed(pak01);
        expect(await approved()).toEqual([report.fingerprint]);

        const mod = await disallowInstalledMod(root, await idAt(pak01));

        expect(mod.enabled).toBe(false);
        await expect(fs.stat(pak01)).rejects.toThrow();
        expect(await fs.readFile(mod.path)).toEqual(hud);
        expect(await approved()).toEqual([]);
        expect(modSafetySnapshot(mod.path)).toEqual({ report, trusted: false });
        expect(await isModSafetyTrusted(await inspectVpkSafety(mod.path))).toBe(false);
    });

    it('takes back the approval of a mod that is already disabled, and of every copy of those bytes', async () => {
        const parked = join(addons, '.disabled', 'hud_dir.vpk');
        const copy = join(addons, '.disabled', 'hud copy_dir.vpk');
        await allowed(parked);
        await fs.writeFile(copy, hud);
        await inspectVpkSafety(copy);
        expect(modSafetySnapshot(copy)?.trusted).toBe(true);

        const mod = await disallowInstalledMod(root, await idAt(parked));

        expect(mod.path).toBe(parked);
        expect(await approved()).toEqual([]);
        expect(modSafetySnapshot(parked)?.trusted).toBe(false);
        expect(modSafetySnapshot(copy)?.trusted).toBe(false);
    });

    it('keeps the approval of a mod the running game holds, since it cannot be disabled', async () => {
        const pak01 = join(addons, 'pak01_dir.vpk');
        const report = await allowed(pak01);
        h.running = true;

        await expect(disallowInstalledMod(root, await idAt(pak01))).rejects.toThrow('Game is running');

        expect((await fs.stat(pak01)).isFile()).toBe(true);
        expect(await approved()).toEqual([report.fingerprint]);
        expect(modSafetySnapshot(pak01)?.trusted).toBe(true);
    });

    it('leaves a mod that was never allowed in review without writing anything', async () => {
        const parked = join(addons, '.disabled', 'hud_dir.vpk');
        await fs.writeFile(parked, hud);

        await disallowInstalledMod(root, await idAt(parked));

        await expect(fs.stat(join(h.userData, 'mod-safety-trust.json'))).rejects.toThrow();
        expect(modSafetySnapshot(parked)?.trusted).toBe(false);
    });
});
