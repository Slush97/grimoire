// Run after pnpm build. Only synthetic VPKs are parsed; no script is executed.
import { promises as fs } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { Worker } from 'node:worker_threads';
import assert from 'node:assert/strict';
import { safetyResource, safetyVpk, safetyLayout } from '../electron/main/services/modSafetyFixtures';
import { VPKMERGE_BINARY_BY_PLATFORM, type SupportedPlatform } from '../electron/main/services/vpkmergeBinary';
import type { ModSafetyReport } from '../src/types/modSafety';

const root = await fs.mkdtemp(join(tmpdir(), 'grimoire-worker-check-'));
const binary = resolve('resources/vpkmerge', VPKMERGE_BINARY_BY_PLATFORM[`${process.platform}-${process.arch}` as SupportedPlatform]);
try {
    const cases = [
        { name: 'asset', entry: 'textures/test.vtex_c', bytes: Buffer.from('inert fixture'), verdict: 'no-findings' },
        { name: 'animation', entry: 'models/hero.vnmskel_c', bytes: Buffer.from('inert fixture'), verdict: 'no-findings' },
        { name: 'unknown-resource', entry: 'scripts/heroes.vdata_c', bytes: Buffer.from('opaque fixture'), verdict: 'no-findings' },
        { name: 'passive-svg', entry: 'panorama/images/name.vsvg_c', bytes: safetyResource(Buffer.concat([Buffer.alloc(6), Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0L1 1"/></svg>')])), verdict: 'no-findings' },
        { name: 'nested-asset', entry: 'maps/portrait.vpk', bytes: safetyVpk([{ path: 'hero.vmdl_c', bytes: Buffer.from('inert') }]), verdict: 'no-findings' },
        { name: 'nested-risk', entry: 'maps/portrait.vpk', bytes: safetyVpk([{ path: 'test.js', bytes: Buffer.from('run("file:///example.txt")') }]), verdict: 'requires-trust' },
        { name: 'script', entry: 'panorama/scripts/test.vjs_c', bytes: safetyResource(Buffer.from('run(1);')), verdict: 'no-findings' },
        { name: 'file-access', entry: 'panorama/scripts/test.vjs_c', bytes: safetyResource(Buffer.from('run("file:///example.txt");')), verdict: 'requires-trust' },
        { name: 'compiled-layout', entry: 'panorama/layout/test.vxml_c', bytes: safetyLayout('run(1);'), verdict: 'no-findings' },
        { name: 'file-access-layout', entry: 'panorama/layout/test.vxml_c', bytes: safetyLayout('run("file:///example.txt");'), verdict: 'requires-trust' },
    ];
    for (const fixture of cases) {
        const path = join(root, fixture.name + '_dir.vpk');
        await fs.writeFile(path, safetyVpk([{ path: fixture.entry, bytes: fixture.bytes }]));
        const worker = new Worker(resolve('dist/main/vpkSafetyWorker.js'));
        try {
            const report = await new Promise<ModSafetyReport>((accept, reject) => {
                const timer = setTimeout(() => reject(new Error('Worker did not respond')), 15000);
                worker.once('message', result => { clearTimeout(timer); accept(result); });
                worker.once('error', error => { clearTimeout(timer); reject(error); });
                worker.postMessage({ path, binary });
            });
            assert.equal(report.verdict, fixture.verdict);
            assert.match(report.fingerprint, /^[a-f0-9]{64}$/);
            console.log(`${fixture.name}: ${report.verdict}`);
        } finally { await worker.terminate(); }
    }
} finally { await fs.rm(root, { recursive: true, force: true }); }
