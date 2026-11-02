import { parentPort } from 'node:worker_threads';
import { exportHeroParticleJob, type HeroParticleWorkerRequest } from './heroParticleExportJob';
import { getVideoPath } from './performanceVideo';
import { readHeroPostBloom } from './heroParticleVideo';

parentPort?.once('message', async (request: HeroParticleWorkerRequest) => {
    try {
        if (request.kind === 'video') {
            parentPort?.postMessage({ postBloomEnabled: await readHeroPostBloom(getVideoPath(request.deadlockPath)) });
        } else {
            parentPort?.postMessage({ effects: await exportHeroParticleJob(request.job) });
        }
    } catch (error) {
        // An error event rejects the caller and preserves the worker stack for local diagnostics.
        throw error instanceof Error ? error : new Error(String(error));
    }
});
