import { parentPort } from 'node:worker_threads';
import { exportHeroParticleJob, type HeroParticleExportJob } from './heroParticleExportJob';

parentPort?.once('message', async (job: HeroParticleExportJob) => {
    try {
        parentPort?.postMessage({ effects: await exportHeroParticleJob(job) });
    } catch (error) {
        // An error event rejects the caller and preserves the worker stack for local diagnostics.
        throw error instanceof Error ? error : new Error(String(error));
    }
});
