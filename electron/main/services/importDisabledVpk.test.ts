import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { safetyVpk } from './modSafetyFixtures';
import AdmZip from 'adm-zip';

const h = vi.hoisted(() => ({ inspect: vi.fn(), move: vi.fn(), skipSafety: false }));
vi.mock('./deadlock', () => ({ getDisabledPath: (root: string) => join(root, 'addons', '.disabled') }));
vi.mock('./modSafety', async () => {
    const { scanModSafety } = await import('./modSafetyScan');
    return {
        assertVpkSafety: async (path: string, options: { prompt?: boolean; allowUntrusted?: boolean }) => {
            h.inspect(path, options);
            if (h.skipSafety) return;
            const report = await scanModSafety(path);
            if (report.verdict === 'blocked') throw new Error('MOD_SAFETY_BLOCKED');
            if (report.verdict === 'requires-trust' && !options.allowUntrusted) throw new Error('Consent would be required');
        },
        moveSafetySnapshot: h.move,
    };
});
import { importDisabledVpk, prepareLocalImport, getPreparedLocalImport, withPreparedLocalImport, releaseLocalImport } from './importDisabledVpk';
import { validateImportVpk } from './vpk';

let root: string;
beforeEach(async () => {
    root = await fs.mkdtemp(join(tmpdir(), 'disabled-import-test-'));
    await fs.mkdir(join(root, 'addons'));
    await fs.writeFile(join(root, 'addons', 'pak01_dir.vpk'), 'existing mod');
    vi.clearAllMocks();
});
afterEach(async () => { await releaseLocalImport(7); await fs.rm(root, { recursive: true, force: true }); });

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

describe('local import preparation', () => {
    const valid = () => safetyVpk([{ path: 'models/heroes/haze/body.vmdl_c', bytes: Buffer.from('model') }]);
    it('retains leased archive contents until the copy finishes after renderer release', async () => {
        const path = join(root, 'leased.zip'); const archive = new AdmZip();
        archive.addFile('skin.vpk', valid()); archive.writeZip(path);
        const prepared = await prepareLocalImport(path, 7, 'leased');
        await withPreparedLocalImport(prepared.id, 7, path, async preparation => {
            await releaseLocalImport(7, 'leased');
            expect(await fs.readFile(preparation.sources[0].path)).toEqual(valid());
            await expect(getPreparedLocalImport(prepared.id, 7, path)).rejects.toThrow('expired');
        });
        await expect(fs.stat(prepared.tempDir!)).rejects.toThrow();
    });

    it('validates the copied bytes even with Mod Safety disabled', async () => {
        const path = join(root, 'corrupt.vpk'); await fs.writeFile(path, 'not a VPK');
        h.skipSafety = true;
        try { await expect(importDisabledVpk(root, path)).rejects.toThrow('VPK header'); }
        finally { h.skipSafety = false; }
        expect(await fs.readdir(join(root, 'addons', '.disabled'))).toEqual([]);
    });

    it('rejects incomplete directory endings and payloads outside a v2 data section', async () => {
        const bytes = valid(); const treeSize = bytes.readUInt32LE(8);
        const path = join(root, 'bad-tree.vpk');
        const incomplete = Buffer.concat([bytes.subarray(0, 12 + treeSize - 1), bytes.subarray(12 + treeSize)]);
        incomplete.writeUInt32LE(treeSize - 1, 8); await fs.writeFile(path, incomplete);
        expect(() => validateImportVpk(path)).toThrow('directory');
        const header = Buffer.alloc(28); bytes.copy(header, 0, 0, 12); header.writeUInt32LE(2, 4);
        const version2 = Buffer.concat([header, bytes.subarray(12)]);
        const v2Path = join(root, 'bad-v2.vpk'); await fs.writeFile(v2Path, version2);
        expect(() => validateImportVpk(v2Path)).toThrow('payload is truncated');
    });
    it('inspects a bare VPK without changing it or installing anything', async () => {
        const path = join(root, 'haze.vpk');
        await fs.writeFile(path, valid());
        const prepared = await prepareLocalImport(path, 7, 'first');
        expect(prepared.sources).toEqual([{ path, fileName: 'haze.vpk' }]);
        expect(prepared.size).toBe(valid().length);
        expect(await fs.readdir(join(root, 'addons'))).toEqual(['pak01_dir.vpk']);
        expect(await fs.readFile(path)).toEqual(valid());
        expect(await getPreparedLocalImport(prepared.id, 7, path)).toBe(prepared);
        await expect(getPreparedLocalImport(prepared.id, 8, path)).rejects.toThrow('expired');
    });
    it('retains extracted archive members until release and rejects a mixed-validity archive', async () => {
        const path = join(root, 'variants.zip');
        const archive = new AdmZip();
        archive.addFile('Blue/skin.vpk', valid()); archive.addFile('Gold/skin.vpk', valid());
        archive.writeZip(path);
        const prepared = await prepareLocalImport(path, 7, 'archive');
        expect(prepared.sources).toHaveLength(2);
        expect(prepared.sources.map(source => source.archiveFolder)).toEqual(['Blue', 'Gold']);
        expect((await getPreparedLocalImport(prepared.id, 7, path)).sources).toBe(prepared.sources);
        await releaseLocalImport(7, 'archive');
        await expect(fs.stat(prepared.tempDir!)).rejects.toThrow();
        await expect(getPreparedLocalImport(prepared.id, 7, path)).rejects.toThrow('expired');
        archive.addFile('broken.vpk', Buffer.from('broken'));
        archive.writeZip(path);
        await expect(prepareLocalImport(path, 7, 'mixed')).rejects.toThrow('broken.vpk');
    });
    it('rejects empty archives, corrupt files, truncated payloads, and changed sources', async () => {
        const archive = join(root, 'empty.zip'); new AdmZip().writeZip(archive);
        await expect(prepareLocalImport(archive, 7, 'empty')).rejects.toThrow('No .vpk');
        const path = join(root, 'invalid.vpk'); await fs.writeFile(path, 'broken');
        await expect(prepareLocalImport(path, 7, 'broken')).rejects.toThrow('Cannot read');
        await fs.writeFile(path, valid().subarray(0, -2));
        await expect(prepareLocalImport(path, 7, 'truncated')).rejects.toThrow('truncated');
        await fs.writeFile(path, valid());
        const prepared = await prepareLocalImport(path, 7, 'changed');
        await fs.appendFile(path, 'changed');
        await expect(getPreparedLocalImport(prepared.id, 7, path)).rejects.toThrow('changed after inspection');
    });
    it('cancels queued work and allows the same path to be added again', async () => {
        const path = join(root, 'skin.vpk'); await fs.writeFile(path, valid());
        const request = prepareLocalImport(path, 7, 'cancelled');
        await releaseLocalImport(7, 'cancelled');
        await expect(request).rejects.toThrow('cancelled');
        const next = await prepareLocalImport(path, 7, 'replacement');
        expect(next.ready).toBe(true);
    });
});
