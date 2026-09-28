import { parentPort } from 'node:worker_threads';
import { scanModSafety } from './modSafetyScan';

parentPort?.on('message', async ({ path, binary, cacheDir }: { path: string; binary: string; cacheDir: string }) => {
    parentPort?.postMessage(await scanModSafety(path, binary, cacheDir));
});
