import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { scanModSafety } from './modSafetyScan';
import { safetyChunkedVpk, safetyLayout, safetyResource, safetyVpk } from './modSafetyFixtures';
import { VPKMERGE_BINARY_BY_PLATFORM, type SupportedPlatform } from './vpkmergeBinary';
import * as policy from './modSafetyPolicy';

const pinnedDecoder = join(__dirname, '../../../resources/vpkmerge',
    VPKMERGE_BINARY_BY_PLATFORM[`${process.platform}-${process.arch}` as SupportedPlatform] ?? 'unsupported');

let root: string;
beforeEach(async () => { root = await fs.mkdtemp(join(tmpdir(), 'safety-scanner-test-')); });
afterEach(async () => { vi.restoreAllMocks(); await fs.rm(root, { recursive: true, force: true }); });
async function scan(bytes: Buffer) {
    const path = join(root, 'test_dir.vpk');
    await fs.writeFile(path, bytes);
    return scanModSafety(path);
}

describe('VPK safety inspection', () => {
    it('reuses a persisted report after a rename without analyzing unchanged scripts again', async () => {
        const inspect = vi.spyOn(policy, 'inspectModSource');
        const path = join(root, 'test_dir.vpk');
        const cache = join(root, 'reports');
        await fs.writeFile(path, safetyVpk([{ path: 'test.js', bytes: Buffer.from('run(1);') }]));
        const first = await scanModSafety(path, undefined, cache);
        expect(inspect).toHaveBeenCalledTimes(1);
        const renamed = join(root, 'enabled_dir.vpk');
        await fs.rename(path, renamed);
        expect(await scanModSafety(renamed, undefined, cache)).toEqual(first);
        expect(inspect).toHaveBeenCalledTimes(1);
    });
    it('hashes current contents even when file size and modification time are unchanged', async () => {
        const inspect = vi.spyOn(policy, 'inspectModSource');
        const path = join(root, 'test_dir.vpk');
        const cache = join(root, 'reports');
        await fs.writeFile(path, safetyVpk([{ path: 'test.js', bytes: Buffer.from('run(1);') }]));
        const before = await fs.stat(path);
        const first = await scanModSafety(path, undefined, cache);
        await fs.writeFile(path, safetyVpk([{ path: 'test.js', bytes: Buffer.from('eval(x)') }]));
        await fs.utimes(path, before.atime, before.mtime);
        expect((await fs.stat(path)).size).toBe(before.size);
        const changed = await scanModSafety(path, undefined, cache);
        expect(changed.fingerprint).not.toBe(first.fingerprint);
        expect(changed.findings).toContainEqual({ entry: 'test.js', reason: 'dynamic-code' });
        expect(inspect).toHaveBeenCalledTimes(2);
    });
    it.each(['old-scanner', 'old-policy', 'wrong-hash', 'invalid-report', 'broken-json'])(
        'reanalyzes when the persisted cache has %s', async kind => {
            const inspect = vi.spyOn(policy, 'inspectModSource');
            const path = join(root, 'test_dir.vpk');
            const cache = join(root, 'reports');
            await fs.writeFile(path, safetyVpk([{ path: 'test.js', bytes: Buffer.from('run(1);') }]));
            const report = await scanModSafety(path, undefined, cache);
            const file = join(cache, `${report.fingerprint}.json`);
            const stored = JSON.parse(await fs.readFile(file, 'utf8'));
            if (kind === 'old-scanner') stored.scannerVersion = -1;
            if (kind === 'old-policy') stored.report.policyVersion = -1;
            if (kind === 'wrong-hash') stored.report.fingerprint = 'f'.repeat(64);
            if (kind === 'invalid-report') stored.report.findings = null;
            await fs.writeFile(file, kind === 'broken-json' ? '{' : JSON.stringify(stored));
            expect(await scanModSafety(path, undefined, cache)).toEqual(report);
            expect(inspect).toHaveBeenCalledTimes(2);
        });
    it('does not let a cache write failure block valid inspection', async () => {
        const path = join(root, 'test_dir.vpk');
        const cache = join(root, 'not-a-directory');
        await fs.writeFile(cache, 'inert');
        await fs.writeFile(path, safetyVpk([{ path: 'test.js', bytes: Buffer.from('eval(x);') }]));
        expect((await scanModSafety(path, undefined, cache)).verdict).toBe('requires-trust');
    });
    it('never reuses a successful report for a missing file', async () => {
        const path = join(root, 'test_dir.vpk');
        const cache = join(root, 'reports');
        await fs.writeFile(path, safetyVpk([{ path: 'test.js', bytes: Buffer.from('run(1);') }]));
        await scanModSafety(path, undefined, cache);
        await fs.unlink(path);
        expect((await scanModSafety(path, undefined, cache)).verdict).toBe('blocked');
    });
    it.each([1, 2])('reads VPK v%s with preload and returns asset-only no-findings', async version => {
        const result = await scan(safetyVpk([{ path: 'textures/test.vtex_c', bytes: Buffer.from('inert'), preload: 2 }], version));
        expect(result.verdict).toBe('no-findings');
        expect(result.fingerprint).toMatch(/^[a-f0-9]{64}$/);
    });
    it('reads compiled JS DATA rather than searching only archive names', async () => {
        const result = await scan(safetyVpk([{ path: 'panorama/scripts/ordinary.vjs_c',
            bytes: safetyResource(Buffer.from('use("file:///example.txt");')), preload: 19 }]));
        expect(result.verdict).toBe('requires-trust');
        expect(result.findings).toContainEqual({ entry: 'panorama/scripts/ordinary.vjs_c', reason: 'local-file' });
    });
    it('requires consent for scripts without recognizable dangerous tokens', async () => {
        const result = await scan(safetyVpk([{ path: 'panorama/scripts/compact.vjs_c', bytes: safetyResource(Buffer.from('!function(a){a(1)}(run);')) }]));
        expect(result.verdict).toBe('requires-trust');
        expect(result.findings).toEqual([{ entry: 'panorama/scripts/compact.vjs_c', reason: 'executable' }]);
    });
    it('does not require review for stylesheets without executable behavior', async () => {
        const result = await scan(safetyVpk([{ path: 'panorama/styles/test.css', bytes: Buffer.from('.x { background-image: url("\\66 ile:///example"); }') }]));
        expect(result.verdict).toBe('no-findings');
    });
    it('does not inherit a fingerprint after a one-byte change and ignores outer filename', async () => {
        const a = safetyVpk([{ path: 'test.js', bytes: Buffer.from('run(1);') }]);
        const b = safetyVpk([{ path: 'test.js', bytes: Buffer.from('run(2);') }]);
        const first = await scan(a);
        await fs.rename(join(root, 'test_dir.vpk'), join(root, 'renamed.vpk'));
        expect((await scanModSafety(join(root, 'renamed.vpk'))).fingerprint).toBe(first.fingerprint);
        expect((await scan(b)).fingerprint).not.toBe(first.fingerprint);
    });
    it('reports a missing layout decoder as an incomplete check and never caches it', async () => {
        const path = join(root, 'test_dir.vpk');
        const cache = join(root, 'reports');
        await fs.writeFile(path, safetyVpk([{ path: 'panorama/layout/test.vxml_c', bytes: safetyResource(Buffer.from('inert'), 'LaCo') }]));
        for (const binary of [undefined, join(root, 'missing-decoder')]) {
            const report = await scanModSafety(path, binary, cache);
            expect(report.verdict).toBe('incomplete');
            expect(report.findings).toContainEqual({ entry: 'test_dir.vpk', reason: 'inspection-failed' });
        }
        expect(await fs.readdir(cache).catch(() => [])).toEqual([]);
    });
    // The pinned decoder reports every archive entry, filtered ones included,
    // which overflowed the old 2 MiB stdout buffer at roughly 9,000 entries.
    it.skipIf(!existsSync(pinnedDecoder))('decodes layouts in archives with many entries', async () => {
        const path = join(root, 'test_dir.vpk');
        await fs.writeFile(path, safetyVpk([{ path: 'panorama/layout/hud.vxml_c', bytes: safetyLayout('run("file:///example.txt");') },
            ...Array.from({ length: 12000 }, (_, i) => ({ path: `models/heroes/hero_${i}.vmdl_c`, bytes: Buffer.from('inert') }))]));
        const report = await scanModSafety(path, pinnedDecoder);
        expect(report.verdict).toBe('requires-trust');
        expect(report.findings).toContainEqual({ entry: 'panorama/layout/hud.vxml_c', reason: 'local-file' });
    });
    it.skipIf(!existsSync(pinnedDecoder)).each([0, 120])('inspects every layout across batches with %s extra path characters', async extra => {
        const path = join(root, 'test_dir.vpk');
        await fs.writeFile(path, safetyVpk(Array.from({ length: 129 }, (_, i) => ({
            path: `panorama/layout/${'x'.repeat(extra)}hud_${i}.vxml_c`,
            bytes: safetyLayout(i === 128 ? 'run("file:///example.txt");' : 'run(1);'),
        }))));
        const report = await scanModSafety(path, pinnedDecoder);
        expect(report.verdict).toBe('requires-trust');
        expect(report.findings).toContainEqual({ entry: `panorama/layout/${'x'.repeat(extra)}hud_128.vxml_c`, reason: 'local-file' });
        expect(report.findings.some((finding) => finding.reason === 'unreadable-archive')).toBe(false);
    });
    it('still blocks layouts the decoder runs on but rejects', async () => {
        const path = join(root, 'test_dir.vpk');
        await fs.writeFile(path, safetyVpk([{ path: 'panorama/layout/test.vxml_c', bytes: safetyResource(Buffer.from('inert'), 'LaCo') }]));
        expect((await scanModSafety(path, process.execPath)).verdict).toBe('blocked');
    });
    it('inspects scripts stored in chunk archives and fingerprints the chunk bytes', async () => {
        const { dir, chunk } = safetyChunkedVpk([{ path: 'panorama/scripts/hud.js', bytes: Buffer.from('run("file:///a")') }]);
        const path = join(root, 'test_dir.vpk');
        await fs.writeFile(path, dir);
        await fs.writeFile(join(root, 'test_000.vpk'), chunk);
        const report = await scanModSafety(path);
        expect(report.verdict).toBe('requires-trust');
        expect(report.findings).toContainEqual({ entry: 'panorama/scripts/hud.js', reason: 'local-file' });
        await fs.writeFile(join(root, 'test_000.vpk'), Buffer.from(chunk.toString().replace('/a', '/b')));
        expect((await scanModSafety(path)).fingerprint).not.toBe(report.fingerprint);
    });
    it('accepts passive multi-chunk archives but blocks one with a missing chunk', async () => {
        const { dir, chunk } = safetyChunkedVpk([{ path: 'models/hero.vmdl_c', bytes: Buffer.from('inert') }]);
        const path = join(root, 'test_dir.vpk');
        await fs.writeFile(path, dir);
        await fs.writeFile(join(root, 'test_000.vpk'), chunk);
        expect((await scanModSafety(path)).verdict).toBe('no-findings');
        await fs.unlink(join(root, 'test_000.vpk'));
        expect((await scanModSafety(path)).verdict).toBe('blocked');
    });
    it('does not mistake static stylesheet image references for scripts', async () => {
        const header = Buffer.alloc(6); header.writeUInt16LE(1, 4);
        const css = Buffer.concat([header, Buffer.from('file:///example.png\0'), Buffer.alloc(8), Buffer.from('.test { width: 1px; }')]);
        const result = await scan(safetyVpk([{ path: 'panorama/styles/test.vcss_c', bytes: safetyResource(css) }]));
        expect(result.verdict).toBe('no-findings');
    });
    it.each(['../escape.js', '/root.js', 'C:/outside.js', 'CON.js', 'folder/../x.js'])('rejects unsafe entry paths: %s', async path => {
        expect((await scan(safetyVpk([{ path, bytes: Buffer.from('run()') }]))).verdict).toBe('blocked');
    });
    it('reads extensionless entries, which the VPK format stores with a blank extension', async () => {
        const report = await scan(safetyVpk([{ path: 'README', bytes: Buffer.from('notes') },
            { path: 'docs/LICENSE', bytes: Buffer.from('terms') }, { path: 'models/hero.vmdl_c', bytes: Buffer.from('inert') }]));
        expect(report.verdict).toBe('no-findings');
        expect(report.fingerprint).toMatch(/^[a-f0-9]{64}$/);
    });
    it.each(['../README', 'folder/../LICENSE', 'CON', 'notes/README '])('rejects unsafe extensionless paths: %s', async path => {
        expect((await scan(safetyVpk([{ path, bytes: Buffer.from('inert') }]))).verdict).toBe('blocked');
    });
    it('rejects duplicate case-insensitive paths', async () => {
        expect((await scan(safetyVpk([{ path: 'a.js', bytes: Buffer.from('run()') }, { path: 'A.js', bytes: Buffer.from('run()') }]))).verdict).toBe('blocked');
    });
    it.each([Buffer.alloc(0), Buffer.from('not a vpk'), Buffer.from([0x34, 0x12, 0xaa, 0x55])])('rejects truncated headers', async bytes => {
        expect((await scan(bytes)).verdict).toBe('blocked');
    });
    it('allows review of bundled programs but rejects malformed nested archives', async () => {
        for (const extension of ['dll', 'exe']) {
            expect((await scan(safetyVpk([{ path: `test.${extension}`, bytes: Buffer.from('inert') }]))).verdict).toBe('requires-trust');
        }
        expect((await scan(safetyVpk([{ path: 'test.vpk', bytes: Buffer.from('inert') }]))).verdict).toBe('blocked');
    });
    it.each(['vnmskel_c', 'vnmclip_c', 'vnmgraph_c', 'vanmgrph_c', 'vnmgraph.+hero_c'])('recognizes animation asset %s', async extension => {
        expect((await scan(safetyVpk([{ path: `models/hero.${extension}`, bytes: Buffer.from('inert') }]))).verdict).toBe('no-findings');
    });
    it('does not flag unknown asset formats without executable content', async () => {
        const result = await scan(safetyVpk([{ path: 'scripts/heroes.vdata_c', bytes: Buffer.from('opaque') }]));
        expect(result.verdict).toBe('no-findings');
        expect(result.fingerprint).toMatch(/^[a-f0-9]{64}$/);
        expect(result.findings).toEqual([]);
    });
    it('clears passive compiled SVG but still checks active SVG', async () => {
        const header = Buffer.alloc(6);
        const plain = Buffer.concat([header, Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0L1 1"/></svg>')]);
        expect((await scan(safetyVpk([{ path: 'name.vsvg_c', bytes: safetyResource(plain) }]))).verdict).toBe('no-findings');
        const active = Buffer.concat([header, Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="eval(code)"/>')]);
        expect((await scan(safetyVpk([{ path: 'name.vsvg_c', bytes: safetyResource(active) }]))).verdict).toBe('requires-trust');
    });
    it.each([
        ['panorama/layout/static.xml', '<root><styles><include src="s2r://panorama/styles/x.vcss_c"/></styles><Panel><Image src="file://{images}/icon.png"/></Panel></root>'],
        ['resource/localization/english.txt', '"description" "A file: label, not a script"'],
        ['panorama/images/name.svg', '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0L1 1"/></svg>'],
    ])('does not prompt for passive content: %s', async (path, source) => {
        expect((await scan(safetyVpk([{ path, bytes: Buffer.from(source) }]))).verdict).toBe('no-findings');
    });
    it.each([
        ['panorama/layout/hud.xml', '<root><scripts><include src="s2r://panorama/scripts/hud.vjs_c"/></scripts><Panel/></root>'],
        ['panorama/layout/hud.xml', '<Panel onload="run(1)"/>'],
        ['scripts/main.nut', 'run(1);'],
        ['panorama/scripts/hud.js', '$.Schedule(0.1, () => $("#timer").text = String(Game.GetGameTime()));'],
    ])('keeps executable content behind review: %s', async (path, source) => {
        const report = await scan(safetyVpk([{ path, bytes: Buffer.from(source) }]));
        expect(report.verdict).toBe('requires-trust');
        expect(report.findings).toContainEqual({ entry: path, reason: 'executable' });
    });
    it('recursively inspects nested VPKs including preload bytes', async () => {
        const asset = safetyVpk([{ path: 'model.vmdl_c', bytes: Buffer.from('inert') }]);
        expect((await scan(safetyVpk([{ path: 'maps/portrait.vpk', bytes: asset, preload: 12 }]))).verdict).toBe('no-findings');
        const bad = safetyVpk([{ path: 'probe.js', bytes: Buffer.from('run("file:///example")') }]);
        const report = await scan(safetyVpk([{ path: 'maps/portrait.vpk', bytes: bad }]));
        expect(report.verdict).toBe('requires-trust');
        expect(report.findings).toContainEqual({ entry: 'maps/portrait.vpk > probe.js', reason: 'local-file' });
    });
    it('bounds nested archive depth', async () => {
        let bytes = safetyVpk([{ path: 'model.vmdl_c', bytes: Buffer.from('inert') }]);
        for (let i = 0; i < 6; i++) bytes = safetyVpk([{ path: 'nested.vpk', bytes }]);
        expect((await scan(bytes)).verdict).toBe('blocked');
    });
    it('preserves risk findings when followed by unknown assets', async () => {
        const files = [{ path: 'probe.js', bytes: Buffer.from('run("file:///x")') },
            ...Array.from({ length: 205 }, (_, i) => ({ path: `file${i}.unknown`, bytes: Buffer.from('inert') }))];
        const result = await scan(safetyVpk(files));
        expect(result.verdict).toBe('requires-trust');
        expect(result.findings).toContainEqual({ entry: 'probe.js', reason: 'local-file' });
    });
    it('cannot hide a specific risk behind the UI finding limit', async () => {
        const files = Array.from({ length: 201 }, (_, i) => ({ path: `script${i}.js`, bytes: Buffer.from('run(1);') }));
        files.push({ path: 'last.js', bytes: Buffer.from('run("file:///example")') });
        const result = await scan(safetyVpk(files));
        expect(result.findings.length).toBe(200);
        expect(result.verdict).toBe('requires-trust');
        expect(result.findings).toContainEqual({ entry: 'last.js', reason: 'local-file' });
    });
    it.each([
        ['local-file', 'run("file:///example.txt")'],
        ['browser', '$.CreatePanel("CitadelHTMLPanel", parent, "")'],
        ['remote-code', 'fetch("https://example.invalid")'],
        ['dynamic-code', 'eval(code)'],
        ['dynamic-code', 'panel[String.fromCharCode(83, 101, 116, 85, 82, 76)](target)'],
        ['uninspectable', 'function {'],
    ])('offers review for %s without executing the script', async (reason, source) => {
        const report = await scan(safetyVpk([{ path: 'script.js', bytes: Buffer.from(source) }]));
        expect(report.verdict).toBe('requires-trust');
        expect(report.findings).toContainEqual({ entry: 'script.js', reason });
    });
});
