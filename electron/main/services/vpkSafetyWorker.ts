import { parentPort } from 'node:worker_threads';
import { scanModSafety } from './modSafetyScan';

parentPort?.on('message', async ({ path, binary }: { path: string; binary: string }) => {
    parentPort?.postMessage(await scanModSafety(path, binary));
});
