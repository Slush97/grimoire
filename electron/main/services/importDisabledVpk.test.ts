import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { safetyVpk } from './modSafetyFixtures';

const h = vi.hoisted(() => ({ inspect: vi.fn(), move: vi.fn() }));
vi.mock('./deadlock', () => ({ getDisabledPath: (root: string) => join(root, 'addons', '.disabled') }));
vi.mock('./modSafety', async () => {
    const { scanModSafety } = await import('./modSafetyScan');
    return {
        assertVpkSafety: async (path: string, options: { prompt?: boolean; allowUntrusted?: boolean }) => {
            h.inspect(path, options);
            const report = await scanModSafety(path);
            if (report.verdict === 'blocked') throw new Error('MOD_SAFETY_BLOCKED');
            if (report.verdict === 'requires-trust' && !options.allowUntrusted) throw new Error('Consent would be required');
        },
        moveSafetySnapshot: h.move,
    };
});
import { importDisabledVpk } from './importDisabledVpk';

let root: string;
beforeEach(async () => {
    root = await fs.mkdtemp(join(tmpdir(), 'disabled-import-test-'));
    await fs.mkdir(join(root, 'addons'));
    await fs.writeFile(join(root, 'addons', 'pak01_dir.vpk'), 'existing mod');
    vi.clearAllMocks();
});
afterEach(async () => { await fs.rm(root, { recursive: true, force: true }); });

describe('disabled local import', () => {
    it('imports nine scripted VPKs without prompting or touching active slots', async () => {
        for (let index = 0; index < 9; index++) {
            const source = join(root, `source${index}.vpk`);
            const bytes = safetyVpk([{ path: 'hud.js', bytes: Buffer.from(`run(${index});`) }]);
            await fs.writeFile(source, bytes);
            const destination = await importDisabledVpk(root, source);
            expect(dirname(destination)).toBe(join(root, 'addons', '.disabled'));
            expect(await fs.readFile(destination)).toEqual(bytes);
            expect(await fs.readFile(source)).toEqual(bytes);
        }
        expect(await fs.readdir(join(root, 'addons', '.disabled'))).toHaveLength(9);
        expect((await fs.readdir(join(root, 'addons'))).sort()).toEqual(['.disabled', 'pak01_dir.vpk']);
        expect(await fs.readFile(join(root, 'addons', 'pak01_dir.vpk'), 'utf8')).toBe('existing mod');
        expect(h.inspect).toHaveBeenCalledTimes(9);
        for (const [, options] of h.inspect.mock.calls) expect(options).toEqual({ prompt: false, allowUntrusted: true });
        expect(h.move).toHaveBeenCalledTimes(9);
    });
    it('imports passive assets disabled too, preserving repeated source imports', async () => {
        const source = join(root, 'asset.vpk');
        const bytes = safetyVpk([{ path: 'model.vmdl_c', bytes: Buffer.from('inert') }]);
        await fs.writeFile(source, bytes);
        const first = await importDisabledVpk(root, source);
        const second = await importDisabledVpk(root, source);
        expect(first).not.toBe(second);
        expect(await fs.readFile(first)).toEqual(bytes);
        expect(await fs.readFile(second)).toEqual(bytes);
    });
    it('rejects malformed archives without leaving a VPK or temporary copy', async () => {
        const source = join(root, 'broken.vpk');
        await fs.writeFile(source, 'not an archive');
        await expect(importDisabledVpk(root, source)).rejects.toThrow('MOD_SAFETY_BLOCKED');
        expect(await fs.readdir(join(root, 'addons', '.disabled'))).toEqual([]);
        expect(h.move).not.toHaveBeenCalled();
    });
});
