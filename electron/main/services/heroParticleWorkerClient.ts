import { join } from 'node:path';
import { Worker } from 'node:worker_threads';
import type { HeroParticleExportJob } from './heroParticleExportJob';

// One cold export at a time across heroes. Cache hits never enter this queue.
let queue: Promise<unknown> = Promise.resolve();

export function exportHeroParticlesInWorker(job: HeroParticleExportJob): Promise<number> {
    const task = queue.then(() => new Promise<number>((resolve, reject) => {
        const worker = new Worker(join(__dirname, 'heroParticleWorker.js'), {
            resourceLimits: { maxOldGenerationSizeMb: 512, stackSizeMb: 8 },
        });
        const timer = setTimeout(() => finish(new Error('Hero particle export timed out.')), 300000);
        let done = false;
        function finish(result: number | Error): void {
            if (done) return;
            done = true;
            clearTimeout(timer);
            void worker.terminate();
            if (result instanceof Error) reject(result);
            else resolve(result);
        }
        worker.once('message', (message: unknown) => {
            if (typeof message === 'object' && message !== null && 'effects' in message
                && typeof message.effects === 'number' && Number.isInteger(message.effects) && message.effects >= 0) finish(message.effects);
            else finish(new Error('Invalid hero particle export result.'));
        });
        worker.once('error', (error) => finish(error));
        worker.once('exit', (code) => finish(new Error(`Hero particle worker exited before completing (${code}).`)));
        worker.postMessage(job);
    }));
    queue = task.catch(() => undefined);
    return task;
}
