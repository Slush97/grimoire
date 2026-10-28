import { promises as fsPromises } from 'fs';
import { createServer, request as httpRequest, type Server } from 'http';
import https from 'https';
import { mkdtemp, readFile, rm, stat, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const harness = vi.hoisted(() => ({ root: '', request: vi.fn() }));
vi.mock('electron', () => ({
    app: { getPath: () => harness.root },
    net: { request: harness.request },
}));

import { downloadTransfer, DownloadSuspendedError, type DownloadTransferCheckpoint } from './downloadTransfer';
import { fetchGameBananaDownload, saveGameBananaDownloadProxyConfig } from './gamebananaDownloadProxy';

let server: Server;
let fixtureUrl: string;
const payload = Buffer.from('archive bytes recovered through Chromium');
const route = 'https://gamebanana.com/dl/123';
const mirror = 'https://filecache20.gamebanana.com/mods/fixture.zip';
let requests: Array<{ url: string; headers: Record<string, string | string[]> }>;
let redirectTarget: string | undefined;
let responseStatus: number;
let hold: 'headers' | 'body' | undefined;
let archiveStarted: Promise<void>;
let markArchiveStarted: () => void;
let earlyClose: boolean;

beforeEach(async () => {
    harness.root = await mkdtemp(join(tmpdir(), 'download-recovery-'));
    requests = [];
    redirectTarget = undefined;
    responseStatus = 200;
    hold = undefined;
    earlyClose = false;
    archiveStarted = new Promise(resolve => { markArchiveStarted = resolve; });
    server = createServer((request, response) => {
        if (request.url === '/reset') {
            request.socket.destroy();
            return;
        }
        if (redirectTarget && request.url === '/route') {
            response.writeHead(302, { Location: redirectTarget });
            response.end();
            return;
        }
        const offset = Number(request.headers.range?.match(/^bytes=(\d+)-$/)?.[1] ?? 0);
        markArchiveStarted();
        if (hold === 'headers') return;
        response.writeHead(offset ? 206 : responseStatus, {
            'Content-Length': payload.length - offset,
            ...(offset ? { 'Content-Range': `bytes ${offset}-${payload.length - 1}/${payload.length}` } : {}),
            ETag: '"recovery-v1"',
        });
        if (hold === 'body') response.write(payload.subarray(offset, offset + 8));
        else response.end(payload.subarray(offset));
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Expected a TCP server');
    fixtureUrl = `http://127.0.0.1:${address.port}`;
    vi.spyOn(https, 'get').mockImplementation(() => httpRequest(`${fixtureUrl}/reset`).end());
    harness.request.mockReset().mockImplementation((options: Electron.ClientRequestConstructorOptions) => {
        const url = String(options.url);
        const headers = options.headers ?? {};
        requests.push({ url, headers });
        const request = httpRequest(`${fixtureUrl}${url === route ? '/route' : '/archive'}`, {
            method: options.method, headers,
        }, response => {
            if (response.statusCode === 302) {
                request.emit('redirect', 302, options.method, response.headers.location, response.headers);
            } else request.emit('response', response);
        });
        if (earlyClose) request.once('finish', () => request.emit('close'));
        return request;
    });
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    await rm(harness.root, { recursive: true, force: true });
});

describe('GameBanana download connection recovery', () => {
    it('recovers a reset before the redirect, then hands the assigned mirror to the selector', async () => {
        redirectTarget = mirror;
        const destinationPath = join(harness.root, 'recovered.zip');
        const resolveRedirectCandidates = vi.fn(async () => [mirror]);
        const signal = new AbortController().signal;
        await downloadTransfer({ candidateUrls: [route], destinationPath, signal, onProgress: () => {}, resolveRedirectCandidates });
        expect(await readFile(destinationPath)).toEqual(payload);
        expect(resolveRedirectCandidates).toHaveBeenCalledWith(mirror, signal);
        expect(requests.map(request => request.url)).toEqual([route, mirror]);
        expect(harness.request).toHaveBeenCalledWith(expect.objectContaining({
            redirect: 'manual', credentials: 'omit', cache: 'no-store',
        }));
    });

    it('preserves the validator and range when a suspended transfer needs Chromium', async () => {
        const destinationPath = join(harness.root, 'resumed.zip');
        const offset = 8;
        await writeFile(destinationPath, payload.subarray(0, offset));
        const checkpoint: DownloadTransferCheckpoint = {
            destinationPath, total: payload.length, validator: { header: 'ETag', value: '"recovery-v1"' },
        };
        await downloadTransfer({ candidateUrls: [mirror], destinationPath, checkpoint, onProgress: () => {} });
        expect(await readFile(destinationPath)).toEqual(payload);
        expect(requests[0].headers).toMatchObject({ range: `bytes=${offset}-`, 'if-range': '"recovery-v1"' });
    });

    it('still rejects a Chromium redirect to an untrusted host', async () => {
        redirectTarget = 'https://example.com/archive.zip';
        const destinationPath = join(harness.root, 'untrusted.zip');
        await expect(downloadTransfer({ candidateUrls: [route], destinationPath, onProgress: () => {} }))
            .rejects.toThrow('Download redirect was rejected');
        expect(requests).toHaveLength(1);
        await expect(stat(destinationPath)).rejects.toMatchObject({ code: 'ENOENT' });
    });

    it('recovers server-test discovery and exposes HEAD redirects without following them', async () => {
        redirectTarget = mirror;
        vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed', {
            cause: Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' }),
        })));
        const response = await fetchGameBananaDownload(route, { method: 'HEAD', redirect: 'manual' });
        expect(response.status).toBe(302);
        expect(response.headers.get('location')).toBe(mirror);
        expect(requests).toHaveLength(1);
    });

    it('does not bypass an explicit proxy after its connection fails', async () => {
        await saveGameBananaDownloadProxyConfig({ enabled: true, url: 'http://127.0.0.1:1' });
        await expect(fetchGameBananaDownload(route)).rejects.toThrow();
        expect(harness.request).not.toHaveBeenCalled();
    });

    it.each(['ECONNRESET', 'EPROTO', 'ERR_SSL_SSLV3_ALERT_HANDSHAKE_FAILURE'])(
        'recovers a server probe after %s', async code => {
            vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed', {
                cause: Object.assign(new Error(code), { code }),
            })));
            const response = await fetchGameBananaDownload(mirror);
            expect(Buffer.from(await response.arrayBuffer())).toEqual(payload);
        },
    );

    it('does not retry an HTTP rejection or a certificate verification failure', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 403 })));
        expect((await fetchGameBananaDownload(route)).status).toBe(403);
        const failure = new TypeError('fetch failed', {
            cause: Object.assign(new Error('certificate expired'), { code: 'CERT_HAS_EXPIRED' }),
        });
        vi.stubGlobal('fetch', vi.fn().mockRejectedValue(failure));
        await expect(fetchGameBananaDownload(route)).rejects.toBe(failure);
        expect(harness.request).not.toHaveBeenCalled();
    });

    it('honors a server probe that forbids redirects', async () => {
        redirectTarget = mirror;
        vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed', {
            cause: Object.assign(new Error('reset'), { code: 'ECONNRESET' }),
        })));
        await expect(fetchGameBananaDownload(route, { redirect: 'error' })).rejects.toThrow('Unexpected redirect');
        expect(requests).toHaveLength(1);
    });

    it('does not bypass a supplied transfer proxy agent', async () => {
        const { Agent } = await import('https');
        const agent = new Agent();
        try {
            await expect(downloadTransfer({
                candidateUrls: [route], destinationPath: join(harness.root, 'proxy.zip'), agent, onProgress: () => {},
            })).rejects.toThrow('socket hang up');
            expect(harness.request).not.toHaveBeenCalled();
        } finally { agent.destroy(); }
    });

    it('cancels Chromium while waiting for response headers', async () => {
        hold = 'headers';
        const cancel = new AbortController();
        const destinationPath = join(harness.root, 'cancelled.zip');
        const transfer = downloadTransfer({ candidateUrls: [route], destinationPath, signal: cancel.signal, onProgress: () => {} });
        const rejected = expect(transfer).rejects.toThrow('CANCELLED_BY_USER');
        await archiveStarted;
        cancel.abort();
        await rejected;
        await expect(stat(destinationPath)).rejects.toMatchObject({ code: 'ENOENT' });
    });

    it('cancels Chromium while the destination file is opening', async () => {
        const cancel = new AbortController();
        const open = fsPromises.open;
        vi.spyOn(fsPromises, 'open').mockImplementationOnce(async (...args: Parameters<typeof open>) => {
            cancel.abort();
            await new Promise(resolve => setTimeout(resolve, 50));
            return open(...args);
        });
        await expect(downloadTransfer({
            candidateUrls: [mirror], destinationPath: join(harness.root, 'opening.zip'), signal: cancel.signal, onProgress: () => {},
        })).rejects.toThrow('CANCELLED_BY_USER');
    });

    it('suspends a Chromium body and resumes its partial file', async () => {
        hold = 'body';
        const pause = new AbortController();
        const checkpoint: DownloadTransferCheckpoint = {};
        const destinationPath = join(harness.root, 'paused.zip');
        await expect(downloadTransfer({
            candidateUrls: [mirror], destinationPath, checkpoint, pauseSignal: pause.signal,
            onProgress: () => pause.abort(),
        })).rejects.toBeInstanceOf(DownloadSuspendedError);
        expect(await readFile(destinationPath)).toEqual(payload.subarray(0, 8));
        hold = undefined;
        await downloadTransfer({ candidateUrls: [mirror], destinationPath, checkpoint, onProgress: () => {} });
        expect(await readFile(destinationPath)).toEqual(payload);
        expect(requests.at(-1)?.headers).toMatchObject({ range: 'bytes=8-', 'if-range': '"recovery-v1"' });
    });

    it('bounds the Chromium header wait by the connection timeout', async () => {
        hold = 'headers';
        await expect(downloadTransfer({
            candidateUrls: [mirror], destinationPath: join(harness.root, 'timeout.zip'),
            connectionTimeoutMs: 150, onProgress: () => {},
        })).rejects.toThrow('Download connection timed out');
        expect(requests).toHaveLength(1);
    });

    it('keeps reading after Electron closes the writable side before response headers', async () => {
        earlyClose = true;
        const destinationPath = join(harness.root, 'early-close.zip');
        await downloadTransfer({ candidateUrls: [mirror], destinationPath, onProgress: () => {} });
        expect(await readFile(destinationPath)).toEqual(payload);
    });

    it('reports an unsupported Chromium response status without throwing from the event handler', async () => {
        responseStatus = 999;
        await expect(downloadTransfer({
            candidateUrls: [mirror], destinationPath: join(harness.root, 'invalid-status.zip'), onProgress: () => {},
        })).rejects.toThrow('status');
    });
});
