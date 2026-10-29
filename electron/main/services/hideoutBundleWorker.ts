import { parentPort } from 'node:worker_threads';
import { prepareHideoutBundle, type HideoutBundleJob } from './hideoutBundle';

parentPort?.once('message', async (job: HideoutBundleJob) => {
    parentPort?.postMessage(await prepareHideoutBundle(job));
});
