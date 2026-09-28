import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { safetyVpk } from './modSafetyFixtures';

const h = vi.hoisted(() => ({ running: false, trusted: false, scans: vi.fn(), announce: vi.fn(), guard: vi.fn() }));
vi.mock('./deadlock', () => ({
    getDisabledPath: (root: string) => join(root, '.disabled'),
    getModScanRootPaths: (root: string) => [join(root, 'addons'), join(root, 'grimoire')],
}));
vi.mock('./mods', () => ({
    scanMods: async () => [],
    runExclusiveModMutation: async (fn: () => unknown) => fn(),
    disableModUnlocked: vi.fn(),
}));
vi.mock('./launch', () => ({ isDeadlockRunning: async () => h.running }));
vi.mock('./metadata', () => ({ getModMetadata: () => undefined }));
vi.mock('./modSafety', async () => {
    const { scanModSafety } = await import('./modSafetyScan');
    return {
        inspectVpkSafety: async (path: string) => { h.scans(path); return scanModSafety(path); },
        isModSafetyTrusted: async (report: { verdict: string }) => report.verdict === 'no-findings' || (h.trusted && report.verdict === 'requires-trust'),
        announceUnsafeMod: h.announce, assertVpkSafety: h.guard,
        moveSafetySnapshot: vi.fn(), notifyModSafetyChanged: vi.fn(),
    };
});
import { auditInstalledSafety, assertActiveModsSafety } from './modSafetyAudit';

let root: string;
beforeEach(async () => {
    root = await fs.mkdtemp(join(tmpdir(), 'safety-audit-test-'));
    for (const dir of ['addons', 'grimoire', '.disabled']) await fs.mkdir(join(root, dir));
    h.running = false; h.trusted = false; vi.clearAllMocks();
});
afterEach(async () => { await fs.rm(root, { recursive: true, force: true }); });
async function put(folder: string, name: string, source = 'run(1);') {
    const path = join(root, folder, name);
    await fs.writeFile(path, safetyVpk([{ path: 'script.js', bytes: Buffer.from(source) }]));
    return path;
}

describe('installed mod inspection', () => {
    it('moves an unregistered reserved artifact out of game paths without deleting its bytes or scanning it twice', async () => {
        const path = await put('grimoire', 'pak01_dir.vpk', 'run("file:///example.txt");');
        const original = await fs.readFile(path);
        const results = await auditInstalledSafety(root);
        expect(results).toHaveLength(1);
        expect(results[0]).toMatchObject({ enabled: false, trusted: false, report: { verdict: 'requires-trust' } });
        await expect(fs.stat(path)).rejects.toThrow();
        const disabled = await fs.readdir(join(root, '.disabled'));
        expect(disabled).toHaveLength(1);
        expect(await fs.readFile(join(root, '.disabled', disabled[0]))).toEqual(original);
        expect(h.scans).toHaveBeenCalledTimes(1);
    });
    it('leaves mounted files in place and announces the limitation while the game runs', async () => {
        h.running = true;
        const path = await put('addons', 'pak05_dir.vpk');
        const results = await auditInstalledSafety(root);
        expect(results[0].enabled).toBe(true);
        expect((await fs.stat(path)).isFile()).toBe(true);
        expect(h.announce).toHaveBeenCalledWith('pak05_dir.vpk', expect.anything(), true);
    });
    it('does not disable already trusted script versions', async () => {
        h.trusted = true;
        const path = await put('addons', 'pak05_dir.vpk');
        const results = await auditInstalledSafety(root);
        expect(results[0]).toMatchObject({ enabled: true, trusted: true });
        expect((await fs.stat(path)).isFile()).toBe(true);
        expect(h.announce).not.toHaveBeenCalled();
    });
    it('prelaunch includes reserved slots and rejects before proceeding', async () => {
        const path = await put('grimoire', 'pak01_dir.vpk');
        h.guard.mockRejectedValueOnce(new Error('MOD_SAFETY_BLOCKED'));
        await expect(assertActiveModsSafety(root)).rejects.toThrow('MOD_SAFETY_BLOCKED');
        expect(h.guard).toHaveBeenCalledWith(path);
    });
});
