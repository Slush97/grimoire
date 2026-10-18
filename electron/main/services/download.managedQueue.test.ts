import { createServer, type Server, type ServerResponse } from 'http';
import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { BrowserWindow } from 'electron';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DownloadModArgs } from '../../../src/types/electron';

const harness = vi.hoisted(() => ({
    userData: '',
    disabledPath: '',
    baseUrl: '',
    send: vi.fn(),
    fetchModDetails: vi.fn(),
    setModMetadataWithHash: vi.fn(),
    enableMod: vi.fn(),
    scanMods: vi.fn(),
    extractArchive: vi.fn(),
    assertVpkSafety: vi.fn(),
    settings: { autoEnableDownloads: true, autoDisableSiblingVariants: true },
}));

vi.mock('electron', () => ({
    app: { getPath: () => harness.userData, getVersion: () => 'test' },
    BrowserWindow: class BrowserWindow {
        static getAllWindows() { return [{ webContents: { send: harness.send } }]; }
    },
}));
vi.mock('@grimoire/social-types/heroes', () => ({ inferHeroFromTitle: () => null }));
vi.mock('./gamebanana', () => ({ fetchModDetails: harness.fetchModDetails }));
vi.mock('./deadlock', async (importOriginal) => ({
    ...(await importOriginal<typeof import('./deadlock')>()),
    getDisabledPath: () => harness.disabledPath,
}));
vi.mock('./settings', async (importOriginal) => ({
    ...(await importOriginal<typeof import('./settings')>()),
    loadSettings: () => harness.settings,
}));
vi.mock('./metadata', async (importOriginal) => ({
    ...(await importOriginal<typeof import('./metadata')>()),
    getModMetadata: () => undefined,
    setModMetadataWithHash: harness.setModMetadataWithHash,
}));
vi.mock('./mods', async (importOriginal) => ({
    ...(await importOriginal<typeof import('./mods')>()),
    scanMods: harness.scanMods,
    enableMod: harness.enableMod,
    disableMod: vi.fn(),
}));
vi.mock('./modSafety', () => ({ assertVpkSafety: harness.assertVpkSafety }));
vi.mock('./security', () => ({ validateDownloadUrl: vi.fn(), validateFileSize: vi.fn() }));
vi.mock('./extract', async (importOriginal) => ({
    ...(await importOriginal<typeof import('./extract')>()),
    extractArchive: harness.extractArchive,
}));
vi.mock('./vpk', async (importOriginal) => ({
    ...(await importOriginal<typeof import('./vpk')>()),
    getVpkLabels: () => ({}),
}));

import {
    cancelActiveDownload,
    cancelDownloadTarget,
    downloadMod,
    downloadModFromUrl,
    enqueueManagedDownload,
    getCurrentDownload,
    getDownloadQueue,
    isDownloadCancelled,
    isDownloadTargetQueued,
    moveQueuedDownload,
    prioritizeQueuedDownload,
    resolveMultiVpkPick,
} from './download';

function deferred<T = void>() {
    let resolve!: (value: T | PromiseLike<T>) => void;
    const promise = new Promise<T>((done) => { resolve = done; });
    return { promise, resolve };
}

function args(modId: number, fileId = modId): DownloadModArgs {
    return { modId, fileId, fileName: `fixture-${modId}.vpk`, modName: `Fixture ${modId}` };
}

const mainWindow = { webContents: { send: harness.send } } as unknown as BrowserWindow;
const emptyInstall = () => Promise.resolve({ installedVpks: [] });

function completions(): number[] {
    return harness.send.mock.calls
        .filter(([channel]) => channel === 'download-complete')
        .map(([, data]) => data.modId);
}

type TransferRequest = { range?: string; ifRange?: string; response: ServerResponse; offset: number };
type ControlledTransfer = { body: Buffer; requests: TransferRequest[]; released: boolean };

function queuedJobId(modId: number): string {
    const item = getDownloadQueue().find((queued) => queued.modId === modId);
    if (!item?.jobId) throw new Error(`Queued fixture ${modId} has no job ID`);
    return item.jobId;
}

describe('managed download FIFO', () => {
    let root: string;
    let server: Server;
    const transfers = new Map<number, ControlledTransfer>();

    function controlledTransfer(modId: number): ControlledTransfer {
        const fixture = { body: Buffer.alloc(128 * 1024, modId), requests: [] as TransferRequest[], released: false };
        transfers.set(modId, fixture);
        return fixture;
    }

    function finishTransfer(fixture: ControlledTransfer): void {
        fixture.released = true;
        for (const request of fixture.requests) {
            if (!request.response.destroyed && !request.response.writableEnded) {
                request.response.end(fixture.body.subarray(request.offset + 64 * 1024));
            }
        }
    }

    beforeAll(async () => {
        root = await fs.mkdtemp(join(tmpdir(), 'grimoire-managed-download-'));
        harness.userData = join(root, 'user-data');
        harness.disabledPath = join(root, 'disabled');
        server = createServer((request, response) => {
            const fixture = transfers.get(Number.parseInt(request.url?.slice(1) ?? '', 10));
            if (fixture) {
                const offset = Number(/^bytes=(\d+)-$/.exec(request.headers.range ?? '')?.[1] ?? 0);
                fixture.requests.push({
                    range: request.headers.range,
                    ifRange: request.headers['if-range'] as string | undefined,
                    response,
                    offset,
                });
                if (offset === fixture.body.length) {
                    response.writeHead(416, { 'Content-Range': `bytes */${fixture.body.length}`, ETag: '"fixture-v1"' });
                    response.end();
                    return;
                }
                response.writeHead(offset ? 206 : 200, {
                    'Content-Length': fixture.body.length - offset,
                    ETag: '"fixture-v1"',
                    ...(offset ? { 'Content-Range': `bytes ${offset}-${fixture.body.length - 1}/${fixture.body.length}` } : {}),
                });
                response.write(fixture.body.subarray(offset, offset + 64 * 1024));
                // Initial transfers wait for a priority/cancellation command.
                // Resumed responses finish without another test-side release.
                if (offset || fixture.released) response.end(fixture.body.subarray(offset + 64 * 1024));
                return;
            }
            response.writeHead(200, { 'Content-Length': '11' });
            response.end('fixture-vpk');
        });
        await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
        const address = server.address();
        if (!address || typeof address === 'string') throw new Error('Test server did not bind');
        harness.baseUrl = `http://127.0.0.1:${address.port}`;
    });

    beforeEach(async () => {
        expect(getDownloadQueue()).toEqual([]);
        expect(getCurrentDownload()).toBeNull();
        transfers.clear();
        await fs.rm(harness.disabledPath, { recursive: true, force: true });
        await fs.mkdir(harness.disabledPath, { recursive: true });
        harness.send.mockReset();
        harness.fetchModDetails.mockReset().mockImplementation(async (modId: number) => ({
            name: `Fixture ${modId}`,
            files: [{ id: modId, fileName: `fixture-${modId}.vpk`, downloadUrl: `${harness.baseUrl}/${modId}`, fileSize: transfers.get(modId)?.body.length ?? 11 }],
        }));
        harness.scanMods.mockReset().mockResolvedValue([]);
        harness.enableMod.mockReset();
        harness.setModMetadataWithHash.mockReset();
        harness.extractArchive.mockReset();
        harness.assertVpkSafety.mockReset().mockResolvedValue(undefined);
    });

    afterAll(async () => {
        await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
        await fs.rm(root, { recursive: true, force: true });
    });

    it('enqueues every job immediately and finishes replacement before the next update or Browse install', async () => {
        const executed = deferred();
        const finalize = deferred();
        const finalizing = deferred();
        const order: string[] = [];
        const first = enqueueManagedDownload('/game', args(1), mainWindow, {
            execute: async () => { order.push('first install'); await executed.promise; return { installedVpks: ['first.vpk'] }; },
            afterInstall: async () => { order.push('first finalizing'); finalizing.resolve(); await finalize.promise; order.push('first finished'); },
        });
        const second = enqueueManagedDownload('/game', args(2), mainWindow, {
            execute: async () => { order.push('second install'); return { installedVpks: ['second.vpk'] }; },
            afterInstall: async () => { order.push('second finished'); },
        });
        const browse = downloadMod('/game', args(3), mainWindow);

        expect(getDownloadQueue().map((item) => item.modId)).toEqual([2, 3]);
        expect(isDownloadTargetQueued(1, 1)).toBe(true);
        expect(isDownloadTargetQueued(2, 2)).toBe(true);
        executed.resolve();
        await finalizing.promise;
        expect(order).toEqual(['first install', 'first finalizing']);
        expect(harness.fetchModDetails).not.toHaveBeenCalled();
        expect(completions()).toEqual([]);

        finalize.resolve();
        await Promise.all([first, second, browse]);
        expect(order).toEqual(['first install', 'first finalizing', 'first finished', 'second install', 'second finished']);
        expect(completions()).toEqual([1, 2, 3]);
        expect(harness.fetchModDetails).toHaveBeenCalledTimes(1);
        expect(harness.fetchModDetails).toHaveBeenCalledWith(3, 'Mod', { includeSubmitter: true });
    });

    it('keeps managed installs disabled even when downloads auto-enable and delays completion until finalized', async () => {
        harness.scanMods.mockResolvedValue([{ id: 'fresh', fileName: 'fixture_4_dir.vpk', enabled: false }]);
        const finalize = deferred();
        const finalizing = deferred();
        const copy = enqueueManagedDownload('/game', args(4), mainWindow, {
            afterInstall: async ({ installedVpks }) => {
                expect(installedVpks).toEqual(['fixture_4_dir.vpk']);
                expect(await fs.readFile(join(harness.disabledPath, installedVpks[0]), 'utf8')).toBe('fixture-vpk');
                finalizing.resolve();
                await finalize.promise;
            },
        });
        await finalizing.promise;
        expect(harness.enableMod).not.toHaveBeenCalled();
        expect(completions()).toEqual([]);
        finalize.resolve();
        await copy;
        expect(completions()).toEqual([4]);

        harness.scanMods.mockResolvedValue([{ id: 'legacy', fileName: 'fixture_5_dir.vpk', enabled: false }]);
        await downloadMod('/game', { ...args(5), isReplacement: true }, mainWindow);
        expect(harness.enableMod).toHaveBeenCalledWith('/game', 'legacy');
    });

    it('continues the FIFO after a finalizer fails without reporting that job as complete', async () => {
        const failed = enqueueManagedDownload('/game', args(6), mainWindow, {
            execute: emptyInstall,
            afterInstall: async () => { throw new Error('Backup failed'); },
        }).catch((error: unknown) => error);
        const nextFinalize = vi.fn(async () => {});
        const next = enqueueManagedDownload('/game', args(7), mainWindow, { execute: emptyInstall, afterInstall: nextFinalize });
        expect(await failed).toEqual(new Error('Backup failed'));
        await next;
        expect(nextFinalize).toHaveBeenCalledTimes(1);
        expect(completions()).toEqual([7]);
    });

    it('validates a queued job before execution and continues after validation fails', async () => {
        const execute = vi.fn(emptyInstall);
        const afterInstall = vi.fn(async () => {});
        const failed = enqueueManagedDownload('/game', args(8), mainWindow, {
            beforeStart: async () => { throw new Error('Active mod path changed'); },
            execute,
            afterInstall,
        }).catch((error: unknown) => error);
        const next = enqueueManagedDownload('/game', args(9), mainWindow, { execute: emptyInstall, afterInstall: async () => {} });
        expect(await failed).toEqual(new Error('Active mod path changed'));
        await next;
        expect(execute).not.toHaveBeenCalled();
        expect(afterInstall).not.toHaveBeenCalled();
        expect(completions()).toEqual([9]);
    });

    it('does not finalize a failed download and continues with the next queued update', async () => {
        harness.fetchModDetails.mockRejectedValueOnce(new Error('Details unavailable'));
        const afterInstall = vi.fn(async () => {});
        const failed = enqueueManagedDownload('/game', args(18), mainWindow, { afterInstall })
            .catch((error: unknown) => error);
        const next = enqueueManagedDownload('/game', args(19), mainWindow, { execute: emptyInstall, afterInstall: async () => {} });
        expect(await failed).toEqual(new Error('Details unavailable'));
        await next;
        expect(afterInstall).not.toHaveBeenCalled();
        expect(completions()).toEqual([19]);
        expect(isDownloadTargetQueued(18, 18)).toBe(false);
    });

    it('rejects managed duplicate active and queued targets without empty successes', async () => {
        const release = deferred();
        const first = enqueueManagedDownload('/game', args(10), mainWindow, {
            execute: async () => { await release.promise; return { installedVpks: [] }; },
            afterInstall: async () => {},
        });
        const second = enqueueManagedDownload('/game', args(11), mainWindow, { execute: emptyInstall, afterInstall: async () => {} });
        await expect(enqueueManagedDownload('/game', args(10), mainWindow, { execute: emptyInstall, afterInstall: async () => {} })).rejects.toThrow('already queued');
        await expect(enqueueManagedDownload('/game', args(11), mainWindow, { execute: emptyInstall, afterInstall: async () => {} })).rejects.toThrow('already queued');
        expect(getDownloadQueue().map((item) => item.modId)).toEqual([11]);
        release.resolve();
        await Promise.all([first, second]);
    });

    it('removes a queued replacement without starting or finalizing it', async () => {
        const release = deferred();
        const first = enqueueManagedDownload('/game', args(12), mainWindow, {
            execute: async () => { await release.promise; return { installedVpks: [] }; },
            afterInstall: async () => {},
        });
        const beforeStart = vi.fn(async () => {});
        const afterInstall = vi.fn(async () => {});
        const removed = enqueueManagedDownload('/game', args(13), mainWindow, {
            beforeStart, execute: emptyInstall, afterInstall,
        }).catch((error: unknown) => error);
        expect(cancelDownloadTarget(13, 13)).toBe(true);
        expect(isDownloadCancelled(await removed)).toBe(true);
        expect(isDownloadTargetQueued(13, 13)).toBe(false);
        release.resolve();
        await first;
        expect(beforeStart).not.toHaveBeenCalled();
        expect(afterInstall).not.toHaveBeenCalled();
    });

    it('defers cancellation during installation and preserves the predecessor by skipping finalization', async () => {
        const release = deferred();
        const started = deferred();
        const afterInstall = vi.fn(async () => {});
        const cancelled = enqueueManagedDownload('/game', args(14), mainWindow, {
            execute: async () => { started.resolve(); await release.promise; return { installedVpks: ['fresh.vpk'] }; },
            afterInstall,
        }).catch((error: unknown) => error);
        await started.promise;
        expect(cancelActiveDownload()).toBe(true);
        expect(cancelActiveDownload()).toBe(false);
        release.resolve();
        expect(isDownloadCancelled(await cancelled)).toBe(true);
        expect(afterInstall).not.toHaveBeenCalled();
        expect(completions()).toEqual([]);
        expect(harness.send).toHaveBeenCalledWith('download-error', expect.objectContaining({ modId: 14, errorCode: 'CANCELLED_BY_USER' }));
    });

    it('cancels while validation is waiting without starting the install', async () => {
        const release = deferred();
        const execute = vi.fn(emptyInstall);
        const afterInstall = vi.fn(async () => {});
        const cancelled = enqueueManagedDownload('/game', args(15), mainWindow, {
            beforeStart: () => release.promise,
            execute,
            afterInstall,
        }).catch((error: unknown) => error);
        expect(cancelDownloadTarget(15, 15)).toBe(true);
        release.resolve();
        expect(isDownloadCancelled(await cancelled)).toBe(true);
        expect(execute).not.toHaveBeenCalled();
        expect(afterInstall).not.toHaveBeenCalled();
    });

    it('does not permit cancellation once replacement finalization starts', async () => {
        const release = deferred();
        const finalizing = deferred();
        const job = enqueueManagedDownload('/game', args(16), mainWindow, {
            execute: emptyInstall,
            afterInstall: async () => { finalizing.resolve(); await release.promise; },
        });
        await finalizing.promise;
        expect(cancelDownloadTarget(16, 16)).toBe(false);
        release.resolve();
        await job;
        expect(completions()).toEqual([16]);
    });

    it.each(['ordinary', 'update', 'promotion'] as const)('cancels a %s safety review and advances FIFO without finalizing the predecessor', async (kind) => {
        const reviewing = deferred();
        const afterInstall = vi.fn(async () => {});
        harness.assertVpkSafety.mockImplementation(async (_path: string, options: { allowUntrusted?: boolean; signal?: AbortSignal }) => {
            if (options.allowUntrusted) return;
            if (!options.signal) throw new Error('Review cancellation signal is missing');
            reviewing.resolve();
            await new Promise<void>((_resolve, reject) => {
                options.signal!.addEventListener('abort', () => reject(options.signal!.reason), { once: true });
            });
        });
        const first = kind === 'ordinary'
            ? downloadMod('/game', args(30), mainWindow)
            : enqueueManagedDownload('/game', args(30), mainWindow, {
                ...(kind === 'promotion' ? {
                    execute: async (signal: AbortSignal) => {
                        await harness.assertVpkSafety('/installed/candidate.vpk', { signal });
                        return { installedVpks: ['candidate.vpk'] };
                    },
                } : {}),
                afterInstall,
            });
        const cancelled = first.catch((error: unknown) => error);
        const next = enqueueManagedDownload('/game', args(31), mainWindow, { execute: emptyInstall, afterInstall: async () => {} });
        await reviewing.promise;
        expect(cancelDownloadTarget(30, 30)).toBe(true);
        expect(isDownloadCancelled(await cancelled)).toBe(true);
        await next;
        expect(afterInstall).not.toHaveBeenCalled();
        expect(harness.enableMod).not.toHaveBeenCalled();
        expect(completions()).toEqual([31]);
        expect(getCurrentDownload()).toBeNull();
    });

    it('does not open a later picker when cancelled while archive extraction is finishing', async () => {
        const extracting = deferred();
        const release = deferred();
        harness.extractArchive.mockImplementation(async () => {
            extracting.resolve();
            await release.promise;
            return [{ path: '/staged/one.vpk', fileName: 'one.vpk' }, { path: '/staged/two.vpk', fileName: 'two.vpk' }];
        });
        const afterInstall = vi.fn(async () => {});
        const cancelled = enqueueManagedDownload('/game', { ...args(20), fileName: 'fixture.zip' }, mainWindow, { afterInstall })
            .catch((error: unknown) => error);
        await extracting.promise;
        expect(cancelActiveDownload()).toBe(true);
        release.resolve();
        expect(isDownloadCancelled(await cancelled)).toBe(true);
        expect(afterInstall).not.toHaveBeenCalled();
        expect(harness.send.mock.calls.some(([channel]) => channel === 'multi-vpk-pick')).toBe(false);
        expect(await fs.readdir(harness.disabledPath)).toEqual([]);
    });

    it.each(['dismiss', 'cancel'] as const)('treats multi-VPK picker %s as cancellation and never finalizes', async (action) => {
        harness.extractArchive.mockImplementation(async (_archive: string, workDir: string) => {
            const files = ['one.vpk', 'two.vpk'];
            await Promise.all(files.map((fileName) => fs.writeFile(join(workDir, fileName), 'fixture-vpk')));
            return files.map((fileName) => ({ path: join(workDir, fileName), fileName }));
        });
        harness.send.mockImplementation((channel: string, data: { requestId: string }) => {
            if (channel === 'multi-vpk-pick') queueMicrotask(() => {
                if (action === 'cancel') cancelActiveDownload();
                else resolveMultiVpkPick(data.requestId, null);
            });
        });
        const afterInstall = vi.fn(async () => {});
        const error = await enqueueManagedDownload('/game', { ...args(17), fileName: 'fixture.zip' }, mainWindow, { afterInstall })
            .catch((error: unknown) => error);
        expect(isDownloadCancelled(error)).toBe(true);
        expect(afterInstall).not.toHaveBeenCalled();
        expect(await fs.readdir(harness.disabledPath)).toEqual([]);
        expect(completions()).toEqual([]);
        expect(harness.send.mock.calls.filter(([channel]) => channel === 'download-error')).toHaveLength(1);
    });

    it('moves one waiting job without replacing newer enqueues and rejects stale or active targets', async () => {
        const release = deferred();
        const first = enqueueManagedDownload('/game', args(40), mainWindow, {
            execute: async () => { await release.promise; return { installedVpks: [] }; },
            afterInstall: async () => {},
        });
        const second = enqueueManagedDownload('/game', args(41), mainWindow, { execute: emptyInstall, afterInstall: async () => {} });
        const third = enqueueManagedDownload('/game', args(42), mainWindow, { execute: emptyInstall, afterInstall: async () => {} });
        const fourth = enqueueManagedDownload('/game', args(43), mainWindow, { execute: emptyInstall, afterInstall: async () => {} });
        try {
            const secondId = queuedJobId(41);
            const thirdId = queuedJobId(42);
            const activeId = getCurrentDownload()!.jobId!;
            expect(moveQueuedDownload(thirdId, secondId)).toBe(true);
            expect(getDownloadQueue().map((item) => item.modId)).toEqual([42, 41, 43]);

            const browse = downloadMod('/game', args(44), mainWindow);
            expect(moveQueuedDownload(secondId, null)).toBe(true);
            expect(getDownloadQueue().map((item) => item.modId)).toEqual([42, 43, 44, 41]);
            expect(moveQueuedDownload('removed-job', thirdId)).toBe(false);
            expect(moveQueuedDownload(thirdId, 'removed-job')).toBe(false);
            expect(moveQueuedDownload(activeId, thirdId)).toBe(false);
            expect(moveQueuedDownload(thirdId, activeId)).toBe(false);
            expect(prioritizeQueuedDownload(activeId)).toBe(false);
            expect(prioritizeQueuedDownload('removed-job')).toBe(false);
            expect(getDownloadQueue().map((item) => item.modId)).toEqual([42, 43, 44, 41]);
            release.resolve();
            await Promise.all([first, second, third, fourth, browse]);
            expect(completions()).toEqual([40, 42, 43, 44, 41]);
        } finally {
            release.resolve();
            await Promise.allSettled([first, second, third, fourth]);
        }
    });

    it.each(['installing', 'finalizing'] as const)('prioritizes the next job without interrupting %s', async (phase) => {
        const release = deferred();
        const entered = deferred();
        const order: string[] = [];
        const first = enqueueManagedDownload('/game', args(45), mainWindow, {
            execute: async () => {
                order.push('install');
                if (phase === 'installing') { entered.resolve(); await release.promise; }
                return { installedVpks: [] };
            },
            afterInstall: async () => {
                order.push('finalize');
                if (phase === 'finalizing') { entered.resolve(); await release.promise; }
                order.push('finished');
            },
        });
        const second = enqueueManagedDownload('/game', args(46), mainWindow, { execute: emptyInstall, afterInstall: async () => {} });
        const third = enqueueManagedDownload('/game', args(47), mainWindow, { execute: emptyInstall, afterInstall: async () => {} });
        try {
            await entered.promise;
            expect(getCurrentDownload()?.phase).toBe(phase);
            expect(prioritizeQueuedDownload(queuedJobId(47))).toBe(true);
            expect(getCurrentDownload()?.modId).toBe(45);
            expect(getDownloadQueue().map((item) => item.modId)).toEqual([47, 46]);
            expect(completions()).toEqual([]);
            expect(order).toEqual(phase === 'installing' ? ['install'] : ['install', 'finalize']);
            release.resolve();
            await Promise.all([first, second, third]);
            expect(order).toEqual(['install', 'finalize', 'finished']);
            expect(completions()).toEqual([45, 47, 46]);
        } finally {
            release.resolve();
            await Promise.allSettled([first, second, third]);
        }
    });

    it('retains two interrupted transfers and resumes each once before finalizing their replacements', async () => {
        const firstTransfer = controlledTransfer(50);
        const chosenTransfer = controlledTransfer(52);
        const secondChoiceTransfer = controlledTransfer(51);
        const firstBefore = vi.fn(async () => {});
        const firstAfter = vi.fn(async () => {});
        const chosenBefore = vi.fn(async () => {});
        const chosenAfter = vi.fn(async () => {});
        const first = enqueueManagedDownload('/game', args(50), mainWindow, { beforeStart: firstBefore, afterInstall: firstAfter });
        const second = enqueueManagedDownload('/game', args(51), mainWindow, { afterInstall: async () => {} });
        const chosen = enqueueManagedDownload('/game', args(52), mainWindow, { beforeStart: chosenBefore, afterInstall: chosenAfter });
        const browse = downloadMod('/game', args(53), mainWindow);
        let firstSettled = false;
        void first.then(() => { firstSettled = true; }, () => { firstSettled = true; });
        try {
            await vi.waitFor(() => expect(getCurrentDownload()?.progress?.downloaded).toBe(64 * 1024));
            const firstId = getCurrentDownload()!.jobId;
            expect(prioritizeQueuedDownload(queuedJobId(52))).toBe(true);
            await vi.waitFor(() => {
                expect(getCurrentDownload()?.modId).toBe(52);
                expect(getCurrentDownload()?.progress?.downloaded).toBe(64 * 1024);
            });
            expect(getDownloadQueue().map((item) => item.modId)).toEqual([50, 51, 53]);
            expect(getDownloadQueue()[0]).toMatchObject({
                jobId: firstId,
                phase: 'paused',
                progress: { downloaded: 64 * 1024, total: firstTransfer.body.length },
            });
            expect(firstSettled).toBe(false);
            expect(firstAfter).not.toHaveBeenCalled();
            expect(firstTransfer.requests[0].response.destroyed).toBe(true);
            expect(completions()).toEqual([]);
            expect(harness.send.mock.calls.filter(([channel]) => channel === 'download-error')).toEqual([]);

            expect(prioritizeQueuedDownload(queuedJobId(51))).toBe(true);
            await vi.waitFor(() => {
                expect(getCurrentDownload()?.modId).toBe(51);
                expect(getCurrentDownload()?.progress?.downloaded).toBe(64 * 1024);
            });
            expect(getDownloadQueue().map((item) => item.modId)).toEqual([52, 50, 53]);
            expect(getDownloadQueue().slice(0, 2).map((item) => item.phase)).toEqual(['paused', 'paused']);
            finishTransfer(secondChoiceTransfer);
            await Promise.all([first, second, chosen, browse]);

            expect(completions()).toEqual([51, 52, 50, 53]);
            for (const transfer of [firstTransfer, chosenTransfer]) {
                expect(transfer.requests).toHaveLength(2);
                expect(transfer.requests[1]).toMatchObject({ range: `bytes=${64 * 1024}-`, ifRange: '"fixture-v1"' });
                expect(transfer.requests[0].response.destroyed).toBe(true);
            }
            expect(firstBefore).toHaveBeenCalledTimes(1);
            expect(chosenBefore).toHaveBeenCalledTimes(1);
            expect(firstAfter).toHaveBeenCalledTimes(1);
            expect(chosenAfter).toHaveBeenCalledTimes(1);
            expect(await fs.readFile(join(harness.disabledPath, 'fixture_50_dir.vpk'))).toEqual(firstTransfer.body);
            expect(await fs.readFile(join(harness.disabledPath, 'fixture_52_dir.vpk'))).toEqual(chosenTransfer.body);
            expect(harness.send.mock.calls.filter(([channel]) => channel === 'download-error')).toEqual([]);
        } finally {
            for (const transfer of [firstTransfer, chosenTransfer, secondChoiceTransfer]) finishTransfer(transfer);
            await Promise.allSettled([first, second, chosen, browse]);
        }
    });

    it('removes a paused transfer, discards its staging directory, and never finalizes it', async () => {
        const firstTransfer = controlledTransfer(54);
        const chosenTransfer = controlledTransfer(55);
        const createDirectory = vi.spyOn(fs, 'mkdtemp');
        const afterInstall = vi.fn(async () => {});
        const first = enqueueManagedDownload('/game', args(54), mainWindow, { afterInstall })
            .catch((error: unknown) => error);
        const chosen = enqueueManagedDownload('/game', args(55), mainWindow, { afterInstall: async () => {} });
        try {
            await vi.waitFor(() => expect(getCurrentDownload()?.progress?.downloaded).toBe(64 * 1024));
            const workDir = await createDirectory.mock.results[0].value as string;
            expect(prioritizeQueuedDownload(queuedJobId(55))).toBe(true);
            await vi.waitFor(() => expect(getCurrentDownload()?.modId).toBe(55));
            expect(getDownloadQueue()[0]).toMatchObject({ modId: 54, phase: 'paused' });
            expect(cancelDownloadTarget(54, 54)).toBe(true);
            expect(isDownloadCancelled(await first)).toBe(true);
            await vi.waitFor(async () => expect(fs.stat(workDir)).rejects.toMatchObject({ code: 'ENOENT' }));
            expect(afterInstall).not.toHaveBeenCalled();
            expect(getDownloadQueue()).toEqual([]);
            expect(firstTransfer.requests).toHaveLength(1);
            finishTransfer(chosenTransfer);
            await chosen;
            expect(completions()).toEqual([55]);
        } finally {
            finishTransfer(firstTransfer);
            finishTransfer(chosenTransfer);
            await Promise.allSettled([first, chosen]);
            createDirectory.mockRestore();
        }
    });

    it.each(['ordinary', 'one-click'] as const)('resumes an interrupted %s download through the same FIFO', async (kind) => {
        const transfer = controlledTransfer(56);
        const release = deferred();
        const selectedStarted = deferred();
        const first = kind === 'ordinary'
            ? downloadMod('/game', args(56), mainWindow)
            : downloadModFromUrl('/game', { archiveUrl: `${harness.baseUrl}/56.vpk`, modId: 56 }, mainWindow);
        const selected = enqueueManagedDownload('/game', args(57), mainWindow, {
            execute: async () => {
                selectedStarted.resolve();
                await release.promise;
                return { installedVpks: [] };
            },
            afterInstall: async () => {},
        });
        try {
            await vi.waitFor(() => expect(getCurrentDownload()?.progress?.downloaded).toBe(64 * 1024));
            expect(prioritizeQueuedDownload(queuedJobId(57))).toBe(true);
            await selectedStarted.promise;
            expect(getDownloadQueue()[0]).toMatchObject({
                modId: 56,
                phase: 'paused',
                progress: { downloaded: 64 * 1024, total: transfer.body.length },
            });
            expect(completions()).toEqual([]);
            release.resolve();
            await Promise.all([first, selected]);
            expect(completions()).toEqual([57, 56]);
            expect(transfer.requests).toHaveLength(2);
            expect(transfer.requests[1]).toMatchObject({ range: `bytes=${64 * 1024}-`, ifRange: '"fixture-v1"' });
            const installedFiles = await fs.readdir(harness.disabledPath);
            expect(installedFiles).toHaveLength(1);
            expect(await fs.readFile(join(harness.disabledPath, installedFiles[0]))).toEqual(transfer.body);
        } finally {
            release.resolve();
            finishTransfer(transfer);
            await Promise.allSettled([first, selected]);
        }
    });

    it('returns the interrupted transfer to the front when its selected priority job is removed mid-switch', async () => {
        const transfer = controlledTransfer(58);
        const first = enqueueManagedDownload('/game', args(58), mainWindow, { afterInstall: async () => {} });
        const second = enqueueManagedDownload('/game', args(59), mainWindow, { execute: emptyInstall, afterInstall: async () => {} });
        const chosenBefore = vi.fn(async () => {});
        const chosen = enqueueManagedDownload('/game', args(60), mainWindow, {
            beforeStart: chosenBefore, execute: emptyInstall, afterInstall: async () => {},
        }).catch((error: unknown) => error);
        try {
            await vi.waitFor(() => expect(getCurrentDownload()?.progress?.downloaded).toBe(64 * 1024));
            expect(prioritizeQueuedDownload(queuedJobId(60))).toBe(true);
            expect(cancelDownloadTarget(60, 60)).toBe(true);
            expect(isDownloadCancelled(await chosen)).toBe(true);
            await Promise.all([first, second]);
            expect(completions()).toEqual([58, 59]);
            expect(chosenBefore).not.toHaveBeenCalled();
            expect(transfer.requests).toHaveLength(2);
            expect(transfer.requests[1].range).toBe(`bytes=${64 * 1024}-`);
        } finally {
            finishTransfer(transfer);
            await Promise.allSettled([first, second, chosen]);
        }
    });

    it('resumes an interrupted transfer after the priority job fails without running its finalizer', async () => {
        const transfer = controlledTransfer(61);
        const beforeStart = vi.fn(async () => {});
        const afterInstall = vi.fn(async () => {});
        const first = enqueueManagedDownload('/game', args(61), mainWindow, { beforeStart, afterInstall });
        const second = enqueueManagedDownload('/game', args(62), mainWindow, { execute: emptyInstall, afterInstall: async () => {} });
        const failedAfter = vi.fn(async () => {});
        const failed = enqueueManagedDownload('/game', args(63), mainWindow, {
            execute: async () => { throw new Error('Priority install failed'); },
            afterInstall: failedAfter,
        }).catch((error: unknown) => error);
        try {
            await vi.waitFor(() => expect(getCurrentDownload()?.progress?.downloaded).toBe(64 * 1024));
            expect(prioritizeQueuedDownload(queuedJobId(63))).toBe(true);
            expect(await failed).toEqual(new Error('Priority install failed'));
            await Promise.all([first, second]);
            expect(completions()).toEqual([61, 62]);
            expect(beforeStart).toHaveBeenCalledTimes(1);
            expect(afterInstall).toHaveBeenCalledTimes(1);
            expect(failedAfter).not.toHaveBeenCalled();
            expect(transfer.requests[1].range).toBe(`bytes=${64 * 1024}-`);
            expect(await fs.readFile(join(harness.disabledPath, 'fixture_61_dir.vpk'))).toEqual(transfer.body);
        } finally {
            finishTransfer(transfer);
            await Promise.allSettled([first, second, failed]);
        }
    });

    it('handles a priority switch on the final transfer byte without duplicating installation or finalization', async () => {
        const transfer = controlledTransfer(64);
        const beforeStart = vi.fn(async () => {});
        const afterInstall = vi.fn(async () => {});
        const first = enqueueManagedDownload('/game', args(64), mainWindow, { beforeStart, afterInstall });
        const second = enqueueManagedDownload('/game', args(65), mainWindow, { execute: emptyInstall, afterInstall: async () => {} });
        const chosen = enqueueManagedDownload('/game', args(66), mainWindow, { execute: emptyInstall, afterInstall: async () => {} });
        const chosenId = queuedJobId(66);
        const prioritize = vi.fn(() => prioritizeQueuedDownload(chosenId));
        harness.send.mockImplementation((channel: string, data: { modId: number; downloaded?: number; total?: number }) => {
            if (channel === 'download-progress' && data.modId === 64 && data.downloaded === transfer.body.length) prioritize();
        });
        try {
            await vi.waitFor(() => expect(getCurrentDownload()?.progress?.downloaded).toBe(64 * 1024));
            finishTransfer(transfer);
            await Promise.all([first, second, chosen]);
            expect(prioritize).toHaveBeenCalledTimes(1);
            expect(prioritize).toHaveReturnedWith(true);
            expect(completions()).toEqual([66, 64, 65]);
            expect(beforeStart).toHaveBeenCalledTimes(1);
            expect(afterInstall).toHaveBeenCalledTimes(1);
            expect(harness.setModMetadataWithHash).toHaveBeenCalledTimes(1);
            expect(await fs.readFile(join(harness.disabledPath, 'fixture_64_dir.vpk'))).toEqual(transfer.body);
            expect(transfer.requests.length).toBeLessThanOrEqual(2);
            expect(harness.send.mock.calls.filter(([channel]) => channel === 'download-error')).toEqual([]);
        } finally {
            finishTransfer(transfer);
            await Promise.allSettled([first, second, chosen]);
        }
    });

    it('cancels only the identified one-click job after reordering and ignores a stale active-job identity', async () => {
        const transfer = controlledTransfer(70);
        const first = downloadModFromUrl('/game', { archiveUrl: `${harness.baseUrl}/70-first.vpk`, modId: 70 }, mainWindow);
        const removed = downloadModFromUrl('/game', { archiveUrl: `${harness.baseUrl}/70-second.vpk`, modId: 70 }, mainWindow)
            .catch((error: unknown) => error);
        const third = downloadModFromUrl('/game', { archiveUrl: `${harness.baseUrl}/70-third.vpk`, modId: 70 }, mainWindow)
            .catch((error: unknown) => error);
        const [secondItem, thirdItem] = getDownloadQueue();
        try {
            await vi.waitFor(() => expect(getCurrentDownload()?.progress?.downloaded).toBe(64 * 1024));
            const firstId = getCurrentDownload()!.jobId!;
            expect(secondItem).toMatchObject({ modId: 70, fileId: -1, fileName: '70-second.vpk' });
            expect(thirdItem).toMatchObject({ modId: 70, fileId: -1, fileName: '70-third.vpk' });
            expect(moveQueuedDownload(thirdItem.jobId!, secondItem.jobId!)).toBe(true);
            expect(cancelDownloadTarget(70, -1, secondItem.jobId)).toBe(true);
            expect(isDownloadCancelled(await removed)).toBe(true);
            expect(getCurrentDownload()?.jobId).toBe(firstId);
            expect(getDownloadQueue().map((item) => item.jobId)).toEqual([thirdItem.jobId]);

            // Finish only this response so the next same-target job remains
            // active long enough to test an old cancel button's identity.
            transfer.requests[0].response.end(transfer.body.subarray(64 * 1024));
            await first;
            await vi.waitFor(() => {
                expect(getCurrentDownload()?.jobId).toBe(thirdItem.jobId);
                expect(getCurrentDownload()?.progress?.downloaded).toBe(64 * 1024);
            });
            expect(cancelDownloadTarget(70, -1, firstId)).toBe(false);
            expect(getCurrentDownload()?.jobId).toBe(thirdItem.jobId);
            expect(cancelDownloadTarget(70, -1, thirdItem.jobId)).toBe(true);
            expect(isDownloadCancelled(await third)).toBe(true);
            expect(completions()).toEqual([70]);
            expect(transfer.requests).toHaveLength(2);
            expect(await fs.readdir(harness.disabledPath)).toHaveLength(1);
        } finally {
            finishTransfer(transfer);
            await Promise.allSettled([first, removed, third]);
        }
    });
});
