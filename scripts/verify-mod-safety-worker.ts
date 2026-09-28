// Run after pnpm build. Only synthetic VPKs are parsed; no script is executed.
import { promises as fs } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { Worker } from 'node:worker_threads';
import assert from 'node:assert/strict';
import { safetyResource, safetyVpk, safetyLayout } from '../electron/main/services/modSafetyFixtures';
import type { ModSafetyReport } from '../src/types/modSafety';

const root = await fs.mkdtemp(join(tmpdir(), 'grimoire-worker-check-'));
const binaries: Record<string, string> = { 'win32-x64': 'vpkmerge-windows-x86_64.exe',
    'linux-x64': 'vpkmerge-linux-x86_64', 'darwin-arm64': 'vpkmerge-macos-aarch64' };
const binary = resolve('resources/vpkmerge', binaries[`${process.platform}-${process.arch}`]);
try {
    const cases = [
        { name: 'asset', entry: 'textures/test.vtex_c', bytes: Buffer.from('inert fixture'), verdict: 'no-findings' },
        { name: 'script', entry: 'panorama/scripts/test.vjs_c', bytes: safetyResource(Buffer.from('run(1);')), verdict: 'requires-trust' },
        { name: 'blocked', entry: 'panorama/scripts/test.vjs_c', bytes: safetyResource(Buffer.from('run("file:///example.txt");')), verdict: 'blocked' },
        { name: 'compiled-layout', entry: 'panorama/layout/test.vxml_c', bytes: safetyLayout('run(1);'), verdict: 'requires-trust' },
        { name: 'blocked-layout', entry: 'panorama/layout/test.vxml_c', bytes: safetyLayout('run("file:///example.txt");'), verdict: 'blocked' },
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
