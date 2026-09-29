import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { safetyChunkedVpk } from './modSafetyFixtures';
import type { ModSafetyReport } from '../../../src/types/modSafety';

// Real mods.ts moves and the real scanner. Only consent is faked.
const h = vi.hoisted(() => ({ userData: '', trusted: new Set<string>() }));
vi.mock('electron', () => ({ app: { getPath: () => h.userData } }));
vi.mock('./launch', () => ({ isDeadlockRunning: async () => false, readStash: async () => null }));
vi.mock('./modSafety', async () => {
    const { scanModSafety } = await import('./modSafetyScan');
    const trusted = async (report: ModSafetyReport) => report.verdict === 'no-findings' || h.trusted.has(report.fingerprint);
    return {
        inspectVpkSafety: (path: string) => scanModSafety(path),
        isModSafetyTrusted: trusted,
        assertVpkSafety: async (path: string) => {
            if (!await trusted(await scanModSafety(path))) throw new Error('MOD_SAFETY_TRUST_REQUIRED');
        },
        announceUnsafeMod: vi.fn(), moveSafetySnapshot: vi.fn(), notifyModSafetyChanged: vi.fn(),
    };
});
import { auditInstalledSafety } from './modSafetyAudit';
import { enableMod } from './mods';
import { scanModSafety } from './modSafetyScan';

let root: string;
let addons: string;
let disabled: string;
beforeEach(async () => {
    root = await fs.mkdtemp(join(tmpdir(), 'safety-chunks-test-'));
    addons = join(root, 'game', 'citadel', 'addons');
    disabled = join(addons, '.disabled');
    h.userData = join(root, 'userdata');
    for (const dir of [disabled, join(root, 'game', 'citadel', 'grimoire'), h.userData]) await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(join(root, 'game', 'citadel', 'gameinfo.gi'), 'GameInfo {}\n');
    h.trusted.clear();
});
afterEach(async () => { await fs.rm(root, { recursive: true, force: true }); });
const vpks = async (folder: string) => (await fs.readdir(folder)).filter(n => n.endsWith('.vpk')).sort();

describe('multi-chunk mods', () => {
    it('keep their chunks through a safety disable and a later enable', async () => {
        const { dir, chunk } = safetyChunkedVpk([{ path: 'panorama/scripts/hud.js', bytes: Buffer.from('run("file:///x")') }]);
        await fs.writeFile(join(addons, 'pak07_dir.vpk'), dir);
        await fs.writeFile(join(addons, 'pak07_000.vpk'), chunk);
        const original = await scanModSafety(join(addons, 'pak07_dir.vpk'));
        expect(original.verdict).toBe('requires-trust');

        const [row] = await auditInstalledSafety(root);
        expect(row).toMatchObject({ enabled: false, trusted: false, report: { fingerprint: original.fingerprint } });
        expect(await vpks(addons)).toEqual([]);
        const parked = await vpks(disabled);
        expect(parked).toEqual([parked[1].replace(/_dir\.vpk$/, '_000.vpk'), parked[1]]);
        expect(parked[1]).toMatch(/_dir\.vpk$/);
        expect((await scanModSafety(join(disabled, parked[1]))).fingerprint).toBe(original.fingerprint);

        expect(await auditInstalledSafety(root)).toHaveLength(1);
        expect(await vpks(disabled)).toEqual(parked);

        h.trusted.add(original.fingerprint);
        const enabled = await enableMod(root, row.modId);
        expect(await vpks(addons)).toEqual(['pak07_000.vpk', 'pak07_dir.vpk']);
        expect(await vpks(disabled)).toEqual([]);
        expect(await scanModSafety(enabled.path)).toEqual(original);
    });
});
