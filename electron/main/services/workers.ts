import { availableParallelism } from 'os';
import { Worker } from 'worker_threads';

export interface FileFingerprintTask {
    id: string;
    filePath: string;
}

export interface FileFingerprintResult {
    id: string;
    filePath: string;
    size: number;
    mtimeMs: number;
    crc32: string;
    error?: string;
}

export interface FileFingerprintWorkerOptions {
    concurrency?: number;
    signal?: AbortSignal;
    onResult?: (result: FileFingerprintResult) => void;
}

const DEFAULT_WORKER_CONCURRENCY = Math.max(1, Math.min(8, availableParallelism() - 1));

// Long-lived worker: waits for task messages and fingerprints one file per
// message, so the pool reuses threads across a batch instead of paying worker
// startup for every file.
const FINGERPRINT_WORKER_SCRIPT = String.raw`
const { parentPort } = require('worker_threads');
const { createReadStream, promises: fs } = require('fs');

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < table.length; i++) {
    let value = i;
    for (let bit = 0; bit < 8; bit++) {
      value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
    }
    table[i] = value >>> 0;
  }
  return table;
})();

async function crc32File(filePath) {
  let crc = 0xffffffff;
  const stream = createReadStream(filePath, { highWaterMark: 1024 * 1024 });
  for await (const chunk of stream) {
    const buffer = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
    for (let index = 0; index < buffer.length; index++) {
      crc = (crc >>> 8) ^ CRC32_TABLE[(crc ^ buffer[index]) & 0xff];
    }
  }
  return ((crc ^ 0xffffffff) >>> 0).toString(16).padStart(8, '0');
}

parentPort.on('message', async (task) => {
  try {
    const stats = await fs.stat(task.filePath);
    const crc32 = await crc32File(task.filePath);
    parentPort.postMessage({
      id: task.id,
      filePath: task.filePath,
      size: stats.size,
      mtimeMs: stats.mtimeMs,
      crc32,
    });
  } catch (err) {
    parentPort.postMessage({
      id: task.id,
      filePath: task.filePath,
      size: 0,
      mtimeMs: 0,
      crc32: '',
      error: err instanceof Error ? err.message : String(err),
    });
  }
});
`;

/**
 * Fingerprint a batch of files (size + CRC-32) across a small pool of reused
 * worker threads. Results are returned in task order. Per-file read/stat errors
 * come back on the individual result's `error` field; the returned promise only
 * rejects on abort or a catastrophic worker failure.
 */
export function fingerprintFilesInWorkers(
    tasks: FileFingerprintTask[],
    options: FileFingerprintWorkerOptions = {}
): Promise<FileFingerprintResult[]> {
    if (tasks.length === 0) return Promise.resolve([]);

    const concurrency = Math.max(1, Math.min(options.concurrency ?? DEFAULT_WORKER_CONCURRENCY, tasks.length));
    const results = new Array<FileFingerprintResult>(tasks.length);

    return new Promise<FileFingerprintResult[]>((resolve, reject) => {
        const { signal } = options;
        const workers: Worker[] = [];
        const inFlight = new Map<Worker, number>();
        let nextIndex = 0;
        let completed = 0;
        let settled = false;

        const cleanup = (): void => {
            signal?.removeEventListener('abort', onAbort);
            for (const worker of workers) void worker.terminate();
        };
        const fail = (err: Error): void => {
            if (settled) return;
            settled = true;
            cleanup();
            reject(err);
        };
        const succeed = (): void => {
            if (settled) return;
            settled = true;
            cleanup();
            resolve(results);
        };
        const onAbort = (): void => fail(new Error('File fingerprint worker cancelled'));

        if (signal?.aborted) {
            reject(new Error('File fingerprint worker cancelled'));
            return;
        }
        signal?.addEventListener('abort', onAbort, { once: true });

        const dispatch = (worker: Worker): void => {
            if (settled || nextIndex >= tasks.length) return;
            const index = nextIndex++;
            inFlight.set(worker, index);
            worker.postMessage(tasks[index]);
        };

        for (let i = 0; i < concurrency; i++) {
            const worker = new Worker(FINGERPRINT_WORKER_SCRIPT, { eval: true });
            workers.push(worker);

            worker.on('message', (result: FileFingerprintResult) => {
                const index = inFlight.get(worker);
                inFlight.delete(worker);
                if (typeof index === 'number') {
                    results[index] = result;
                    options.onResult?.(result);
                    completed++;
                }
                if (completed >= tasks.length) {
                    succeed();
                    return;
                }
                dispatch(worker);
            });
            worker.on('error', (err) => fail(err));
            worker.on('exit', (code) => {
                if (!settled && code !== 0) {
                    fail(new Error(`File fingerprint worker exited with code ${code}`));
                }
            });

            dispatch(worker);
        }
    });
}

/** Fingerprint a single file via a one-worker pool. */
export async function fingerprintFileInWorker(
    task: FileFingerprintTask,
    signal?: AbortSignal
): Promise<FileFingerprintResult> {
    const [result] = await fingerprintFilesInWorkers([task], { concurrency: 1, signal });
    return result;
}
