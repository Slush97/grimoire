import { createServer, type Server } from 'http';
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
    enqueueManagedDownload,
    getCurrentDownload,
    getDownloadQueue,
    isDownloadCancelled,
    isDownloadTargetQueued,
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

describe('managed download FIFO', () => {
    let root: string;
    let server: Server;

    beforeAll(async () => {
        root = await fs.mkdtemp(join(tmpdir(), 'grimoire-managed-download-'));
        harness.userData = join(root, 'user-data');
        harness.disabledPath = join(root, 'disabled');
        server = createServer((_request, response) => {
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
        await fs.rm(harness.disabledPath, { recursive: true, force: true });
        await fs.mkdir(harness.disabledPath, { recursive: true });
        harness.send.mockReset();
        harness.fetchModDetails.mockReset().mockImplementation(async (modId: number) => ({
            name: `Fixture ${modId}`,
            files: [{ id: modId, fileName: `fixture-${modId}.vpk`, downloadUrl: `${harness.baseUrl}/${modId}`, fileSize: 11 }],
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
});
