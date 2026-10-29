import { join } from 'node:path';
import { Worker } from 'node:worker_threads';
import type { HeroParticleExportJob, HeroParticleWorkerRequest } from './heroParticleExportJob';

// One cold export at a time across heroes. Small video reads do not wait behind cold exports.
let queue: Promise<unknown> = Promise.resolve();

export function exportHeroParticlesInWorker(job: HeroParticleExportJob): Promise<number> {
    return runParticleWorker({ kind: 'export', job }, (message) => {
        if (typeof message === 'object' && message !== null && 'effects' in message
            && typeof message.effects === 'number' && Number.isInteger(message.effects) && message.effects >= 0) return message.effects;
        throw new Error('Invalid hero particle export result.');
    });
}

/** Steam's account selection can query the registry synchronously; it belongs off the main thread too. */
export function readHeroPostBloomInWorker(deadlockPath: string): Promise<boolean> {
    return runParticleWorker({ kind: 'video', deadlockPath }, (message) => {
        if (typeof message === 'object' && message !== null && 'postBloomEnabled' in message && typeof message.postBloomEnabled === 'boolean') return message.postBloomEnabled;
        throw new Error('Invalid hero video settings result.');
    });
}

function runParticleWorker<T extends number | boolean>(request: HeroParticleWorkerRequest, read: (message: unknown) => T): Promise<T> {
    const ready = request.kind === 'export' ? queue : Promise.resolve();
    const task = ready.then(() => new Promise<T>((resolve, reject) => {
        const worker = new Worker(join(__dirname, 'heroParticleWorker.js'), {
            resourceLimits: { maxOldGenerationSizeMb: 512, stackSizeMb: 8 },
        });
        const timer = setTimeout(() => finish(new Error('Hero particle export timed out.')), 300000);
        let done = false;
        function finish(result: T | Error): void {
            if (done) return;
            done = true;
            clearTimeout(timer);
            void worker.terminate();
            if (result instanceof Error) reject(result);
            else resolve(result);
        }
        worker.once('message', (message: unknown) => {
            try { finish(read(message)); }
            catch (error) { finish(error instanceof Error ? error : new Error(String(error))); }
        });
        worker.once('error', (error) => finish(error));
        worker.once('exit', (code) => finish(new Error(`Hero particle worker exited before completing (${code}).`)));
        worker.postMessage(request);
    }));
    if (request.kind === 'export') queue = task.catch(() => undefined);
    return task;
}
