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

export interface VpkParseTask {
    id: string;
    vpkPath: string;
}

export interface VpkParseResult {
    id: string;
    vpkPath: string;
    /** Stat captured BEFORE the read, so a cache entry keyed on it can only be
     *  older-or-equal to the parsed content, never newer. */
    mtimeMs: number;
    size: number;
    /** null = stat succeeded but the file is not a parseable VPK (matches the
     *  sync parseVpkDirectory contract). */
    paths: string[] | null;
    /** Set when stat/read threw (e.g. file deleted mid-scan). */
    error?: string;
}

export interface VpkParseWorkerOptions {
    concurrency?: number;
    signal?: AbortSignal;
    onResult?: (result: VpkParseResult) => void;
}

// Long-lived worker mirroring FINGERPRINT_WORKER_SCRIPT's lifecycle: one VPK
// parse per task message, threads reused across the batch.
//
// The tree parser below is a mechanical copy of parseVpkDirectory in vpk.ts
// (keep in sync with vpk.ts). It cannot be imported because this script is
// eval'd inside the worker; eval is the proven packaged-build path (a bundled
// worker entry file would need asar-aware resolution).
//
// console.warn calls inside the parser still reach the terminal (worker
// stdout/stderr is piped to the parent) but without main-process log context.
const VPK_PARSE_WORKER_SCRIPT = String.raw`
const { parentPort } = require('worker_threads');
const { openSync, readSync, closeSync, statSync } = require('fs');

const VPK_SIGNATURE = 0x55AA1234;

function readNullTerminatedString(buffer, offset) {
  let end = offset;
  while (end < buffer.length && buffer[end] !== 0) {
    end++;
  }
  const str = buffer.slice(offset, end).toString('utf-8');
  return { str, bytesRead: end - offset + 1 };
}

function parseVpkDirectory(vpkPath) {
  try {
    const fd = openSync(vpkPath, 'r');

    const headerBuffer = Buffer.alloc(12);
    readSync(fd, headerBuffer, 0, 12, 0);

    const signature = headerBuffer.readUInt32LE(0);
    if (signature !== VPK_SIGNATURE) {
      closeSync(fd);
      return null;
    }

    const version = headerBuffer.readUInt32LE(4);
    const treeSize = headerBuffer.readUInt32LE(8);
    const headerSize = version === 2 ? 28 : 12;

    const treeBuffer = Buffer.alloc(treeSize);
    readSync(fd, treeBuffer, 0, treeSize, headerSize);
    closeSync(fd);

    const paths = [];
    let offset = 0;
    let properlyTerminated = false;

    while (offset < treeBuffer.length) {
      const extResult = readNullTerminatedString(treeBuffer, offset);
      offset += extResult.bytesRead;

      if (extResult.str === '') {
        properlyTerminated = true;
        break;
      }

      const extension = extResult.str;
      let extensionProperlyTerminated = false;

      while (offset < treeBuffer.length) {
        const pathResult = readNullTerminatedString(treeBuffer, offset);
        offset += pathResult.bytesRead;

        if (pathResult.str === '') {
          extensionProperlyTerminated = true;
          break;
        }

        const dirPath = pathResult.str === ' ' ? '' : pathResult.str;
        let pathProperlyTerminated = false;

        while (offset < treeBuffer.length) {
          const nameResult = readNullTerminatedString(treeBuffer, offset);
          offset += nameResult.bytesRead;

          if (nameResult.str === '') {
            pathProperlyTerminated = true;
            break;
          }

          const filename = nameResult.str;
          const fullPath = dirPath
            ? dirPath + '/' + filename + '.' + extension
            : filename + '.' + extension;
          paths.push(fullPath);

          offset += 18;

          if (offset - 14 >= 0 && offset - 14 < treeBuffer.length - 1) {
            const preloadBytes = treeBuffer.readUInt16LE(offset - 14);
            offset += preloadBytes;
          }
        }

        if (!pathProperlyTerminated) {
          console.warn('[parseVpkDirectory:worker] Warning: Filename section for path "' + dirPath + '" (ext: ' + extension + ') did not terminate properly - buffer exhausted at offset ' + offset + '/' + treeBuffer.length);
        }
      }

      if (!extensionProperlyTerminated) {
        console.warn('[parseVpkDirectory:worker] Warning: Path section for extension "' + extension + '" did not terminate properly - buffer exhausted at offset ' + offset + '/' + treeBuffer.length);
      }
    }

    if (!properlyTerminated) {
      console.warn('[parseVpkDirectory:worker] ' + vpkPath + ': tree did not terminate properly (offset ' + offset + '/' + treeBuffer.length + '). Some files may be missing from conflict detection.');
    }

    if (properlyTerminated && offset < treeBuffer.length) {
      const remainingBytes = treeBuffer.length - offset;
      if (remainingBytes > 16) {
        console.warn('[parseVpkDirectory:worker] ' + vpkPath + ': ' + remainingBytes + ' bytes remaining after tree termination.');
      }
    }

    return paths;
  } catch (error) {
    console.error('[parseVpkDirectory:worker] Error parsing ' + vpkPath + ':', error);
    return null;
  }
}

parentPort.on('message', (task) => {
  try {
    const stats = statSync(task.vpkPath);
    const paths = parseVpkDirectory(task.vpkPath);
    parentPort.postMessage({
      id: task.id,
      vpkPath: task.vpkPath,
      mtimeMs: stats.mtimeMs,
      size: stats.size,
      paths,
    });
  } catch (err) {
    parentPort.postMessage({
      id: task.id,
      vpkPath: task.vpkPath,
      mtimeMs: 0,
      size: 0,
      paths: null,
      error: err instanceof Error ? err.message : String(err),
    });
  }
});
`;

/**
 * Parse a batch of VPK directory trees across a small pool of reused worker
 * threads. Results are returned in task order. Per-file stat/read errors come
 * back on the individual result's `error` field; the returned promise only
 * rejects on abort or a catastrophic worker failure.
 *
 * Deliberately a clone of fingerprintFilesInWorkers rather than a shared
 * generic pool, so the shipped fingerprint path stays untouched.
 */
export function parseVpksInWorkers(
    tasks: VpkParseTask[],
    options: VpkParseWorkerOptions = {}
): Promise<VpkParseResult[]> {
    if (tasks.length === 0) return Promise.resolve([]);

    const concurrency = Math.max(1, Math.min(options.concurrency ?? DEFAULT_WORKER_CONCURRENCY, tasks.length));
    const results = new Array<VpkParseResult>(tasks.length);

    return new Promise<VpkParseResult[]>((resolve, reject) => {
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
        const onAbort = (): void => fail(new Error('VPK parse worker cancelled'));

        if (signal?.aborted) {
            reject(new Error('VPK parse worker cancelled'));
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
            const worker = new Worker(VPK_PARSE_WORKER_SCRIPT, { eval: true });
            workers.push(worker);

            worker.on('message', (result: VpkParseResult) => {
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
                    fail(new Error(`VPK parse worker exited with code ${code}`));
                }
            });

            dispatch(worker);
        }
    });
}
