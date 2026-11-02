// Node-only export job. The app runs this in a worker so VPK indexing, resource reads, JSON parsing,
// snapshot/model decoding and bundle serialization never occupy Electron's main event loop.
import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { discoverAmbientEffects } from './heroAmbientDiscovery';
import { exportParticleBundle } from './heroParticleBundle';
import { PackageStack, type VpkmergeRunner } from './heroParticleSources';

export interface HeroParticleExportJob {
    packages: string[];
    binary: string;
    hero: string;
    outDir: string;
    modelEntry?: string;
    clips: string[];
}

export type HeroParticleWorkerRequest =
    | { kind: 'export'; job: HeroParticleExportJob }
    | { kind: 'video'; deadlockPath: string };

export async function exportHeroParticleJob(job: HeroParticleExportJob): Promise<number> {
    await fs.mkdir(job.outDir, { recursive: true });
    const scratch = await fs.mkdtemp(join(job.outDir, '.scratch-'));
    const runner: VpkmergeRunner = {
        stdout: (args) => new Promise((resolve, reject) => {
            execFile(job.binary, args, { windowsHide: true, timeout: 120000, maxBuffer: 128 * 1024 * 1024 }, (error, stdout, stderr) => {
                if (error) reject(new Error(`vpkmerge ${args[0]} failed: ${stderr || error.message}`));
                else resolve(stdout);
            });
        }),
    };
    try {
        const stack = new PackageStack(job.packages, runner, scratch);
        const discovery = await discoverAmbientEffects(stack, job.hero, { modelEntry: job.modelEntry, clips: job.clips });
        if (discovery.effects.length === 0) return 0;
        const bundle = await exportParticleBundle(stack, discovery, { hero: job.hero, outDir: job.outDir, vpkmerge: runner });
        return bundle.effects.length;
    } finally {
        await fs.rm(scratch, { recursive: true, force: true });
    }
}
