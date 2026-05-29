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

const FINGERPRINT_WORKER_SCRIPT = String.raw`
const { parentPort, workerData } = require('worker_threads');
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

(async () => {
  try {
    const stats = await fs.stat(workerData.filePath);
    const crc32 = await crc32File(workerData.filePath);
    parentPort.postMessage({
      id: workerData.id,
      filePath: workerData.filePath,
      size: stats.size,
      mtimeMs: stats.mtimeMs,
      crc32,
    });
  } catch (err) {
    parentPort.postMessage({
      id: workerData.id,
      filePath: workerData.filePath,
      size: 0,
      mtimeMs: 0,
      crc32: '',
      error: err instanceof Error ? err.message : String(err),
    });
  }
})();
`;

export async function fingerprintFilesInWorkers(
    tasks: FileFingerprintTask[],
    options: FileFingerprintWorkerOptions = {}
): Promise<FileFingerprintResult[]> {
    if (tasks.length === 0) return [];

    const concurrency = Math.max(1, Math.min(options.concurrency ?? DEFAULT_WORKER_CONCURRENCY, tasks.length));
    const results = new Array<FileFingerprintResult>(tasks.length);
    let nextIndex = 0;

    const workers = Array.from({ length: concurrency }, async () => {
        while (nextIndex < tasks.length) {
            throwIfAborted(options.signal);
            const index = nextIndex++;
            const result = await fingerprintFileInWorker(tasks[index], options.signal);
            results[index] = result;
            options.onResult?.(result);
        }
    });

    await Promise.all(workers);
    return results;
}

export function fingerprintFileInWorker(
    task: FileFingerprintTask,
    signal?: AbortSignal
): Promise<FileFingerprintResult> {
    throwIfAborted(signal);

    return new Promise((resolve, reject) => {
        const worker = new Worker(FINGERPRINT_WORKER_SCRIPT, {
            eval: true,
            workerData: task,
        });
        let settled = false;

        const finish = (callback: () => void) => {
            if (settled) return;
            settled = true;
            signal?.removeEventListener('abort', abort);
            callback();
        };

        const abort = () => {
            void worker.terminate();
            finish(() => reject(new Error('File fingerprint worker cancelled')));
        };

        signal?.addEventListener('abort', abort, { once: true });
        worker.once('message', (result: FileFingerprintResult) => {
            finish(() => resolve(result));
        });
        worker.once('error', (err) => {
            finish(() => reject(err));
        });
        worker.once('exit', (code) => {
            if (code !== 0) {
                finish(() => reject(new Error(`File fingerprint worker exited with code ${code}`)));
            }
        });
    });
}

function throwIfAborted(signal?: AbortSignal): void {
    if (signal?.aborted) {
        throw new Error('File fingerprint worker cancelled');
    }
}
