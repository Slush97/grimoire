import { Agent, createServer, type IncomingMessage, type Server, type ServerResponse } from 'http';
import { mkdtempSync } from 'fs';
import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterAll, describe, expect, it, vi } from 'vitest';

import {
    downloadTransfer,
    DownloadSuspendedError,
    isDownloadSuspended,
    type DownloadTransferCheckpoint,
} from './downloadTransfer';

const roots: string[] = [];
const servers: Server[] = [];

async function listen(handler: (request: IncomingMessage, response: ServerResponse) => void): Promise<string> {
    const server = createServer(handler);
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Expected TCP test server');
    return `http://127.0.0.1:${address.port}/fixture.zip`;
}

function destination(name: string): string {
    const root = mkdtempSync(join(tmpdir(), 'download-transfer-test-'));
    roots.push(root);
    return join(root, name);
}

afterAll(async () => {
    await Promise.all(servers.map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
    await Promise.all(roots.map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe('downloadTransfer', () => {
    it('downloads from the selected server and reports aggregate progress', async () => {
        const body = Buffer.from('complete archive payload');
        const url = await listen((_request, response) => {
            response.writeHead(200, {
                'Content-Length': body.length,
                'Content-Disposition': `attachment; filename*=UTF-8''fixture%20archive.zip`,
                ETag: '"fixture-v1"',
            });
            response.end(body);
        });
        const path = destination('selected.zip');
        const progress: Array<[number, number]> = [];
        const statuses: Array<{ phase: string; server: string }> = [];
        let responseFilename: string | undefined;

        await downloadTransfer({
            candidateUrls: [url],
            destinationPath: path,
            onProgress: (downloaded, total) => progress.push([downloaded, total]),
            onResponseFilename: (filename) => { responseFilename = filename; },
            onServerStatus: (status) => statuses.push(status),
        });

        expect(await fs.readFile(path)).toEqual(body);
        expect(progress.at(-1)).toEqual([body.length, body.length]);
        expect(responseFilename).toBe('fixture archive.zip');
        expect(statuses).toEqual([{ phase: 'selected', server: '127.0.0.1' }]);
    });

    it('sends every request, including redirect hops, through the supplied agent', async () => {
        const body = Buffer.from('proxied payload');
        const url = await listen((request, response) => {
            if (request.url === '/fixture.zip') {
                response.writeHead(302, { Location: '/final.zip' });
                response.end();
                return;
            }
            response.writeHead(200, { 'Content-Length': body.length });
            response.end(body);
        });
        const agent = new Agent();
        const createConnection = vi.spyOn(agent, 'createConnection');
        const path = destination('proxied.zip');

        await downloadTransfer({ candidateUrls: [url], destinationPath: path, onProgress: () => {}, agent });
        agent.destroy();

        expect(await fs.readFile(path)).toEqual(body);
        expect(createConnection).toHaveBeenCalledTimes(2);
    });

    it('resumes from the next server after the first server drops mid-body', async () => {
        const body = Buffer.from('abcdefghijklmnopqrstuvwxyz');
        const split = 10;
        const first = await listen((_request, response) => {
            response.writeHead(200, {
                'Content-Length': body.length,
                ETag: '"fixture-v1"',
            });
            response.write(body.subarray(0, split));
            setTimeout(() => response.destroy(), 5);
        });
        let receivedRange: string | undefined;
        let receivedIfRange: string | undefined;
        const second = await listen((request, response) => {
            receivedRange = request.headers.range;
            const ifRange = request.headers['if-range'];
            receivedIfRange = Array.isArray(ifRange) ? ifRange[0] : ifRange;
            const remainder = body.subarray(split);
            response.writeHead(206, {
                'Content-Length': remainder.length,
                'Content-Range': `bytes ${split}-${body.length - 1}/${body.length}`,
                ETag: '"fixture-v1"',
            });
            response.end(remainder);
        });
        const path = destination('resumed.zip');
        const progress: Array<[number, number]> = [];
        const statuses: Array<{ phase: string; server: string }> = [];

        await downloadTransfer({
            candidateUrls: [first, second],
            destinationPath: path,
            onProgress: (downloaded, total) => progress.push([downloaded, total]),
            onServerStatus: (status) => statuses.push(status),
        });

        expect(await fs.readFile(path)).toEqual(body);
        expect(receivedRange).toBe(`bytes=${split}-`);
        expect(receivedIfRange).toBe('"fixture-v1"');
        expect(progress.at(-1)).toEqual([body.length, body.length]);
        expect(statuses).toEqual([
            { phase: 'selected', server: '127.0.0.1' },
            { phase: 'switching', server: '127.0.0.1', previousServer: '127.0.0.1' },
            { phase: 'selected', server: '127.0.0.1' },
        ]);
    });

    it('resumes on the next server when a connected response stalls', async () => {
        const body = Buffer.from('a stalled response should resume safely');
        const split = 9;
        const first = await listen((_request, response) => {
            response.writeHead(200, {
                'Content-Length': body.length,
                ETag: '"stall-v1"',
            });
            response.write(body.subarray(0, split));
        });
        let receivedRange: string | undefined;
        let receivedIfRange: string | undefined;
        const second = await listen((request, response) => {
            receivedRange = request.headers.range;
            const ifRange = request.headers['if-range'];
            receivedIfRange = Array.isArray(ifRange) ? ifRange[0] : ifRange;
            const remainder = body.subarray(split);
            response.writeHead(206, {
                'Content-Length': remainder.length,
                'Content-Range': `bytes ${split}-${body.length - 1}/${body.length}`,
                ETag: '"stall-v1"',
            });
            response.end(remainder);
        });
        const path = destination('stalled.zip');

        await downloadTransfer({
            candidateUrls: [first, second],
            destinationPath: path,
            onProgress: () => undefined,
            stallTimeoutMs: 30,
        });

        expect(receivedRange).toBe(`bytes=${split}-`);
        expect(receivedIfRange).toBe('"stall-v1"');
        expect(await fs.readFile(path)).toEqual(body);
    });

    it('safely restarts when a server ignores the resume range', async () => {
        const body = Buffer.from('a full response must replace partial bytes');
        const split = 8;
        const first = await listen((_request, response) => {
            response.writeHead(200, {
                'Content-Length': body.length,
                ETag: '"fixture-v1"',
            });
            response.write(body.subarray(0, split));
            setTimeout(() => response.destroy(), 5);
        });
        let requestedRange: string | undefined;
        const second = await listen((request, response) => {
            requestedRange = request.headers.range;
            response.writeHead(200, {
                'Content-Length': body.length,
                ETag: '"fixture-v2"',
            });
            response.end(body);
        });
        const path = destination('restarted.zip');

        await downloadTransfer({
            candidateUrls: [first, second],
            destinationPath: path,
            onProgress: () => undefined,
        });

        expect(requestedRange).toBe(`bytes=${split}-`);
        expect(await fs.readFile(path)).toEqual(body);
    });

    it('cancels during the body, removes the partial, and does not try another server', async () => {
        const first = await listen((_request, response) => {
            response.writeHead(200, {
                'Content-Length': 100,
                ETag: '"fixture-v1"',
            });
            response.write(Buffer.alloc(10, 1));
        });
        let fallbackRequests = 0;
        const second = await listen((_request, response) => {
            fallbackRequests += 1;
            response.end('should not be requested');
        });
        const path = destination('cancelled.zip');
        const controller = new AbortController();

        await expect(downloadTransfer({
            candidateUrls: [first, second],
            destinationPath: path,
            onProgress: () => controller.abort(),
            signal: controller.signal,
        })).rejects.toThrow('CANCELLED_BY_USER');

        expect(fallbackRequests).toBe(0);
        await expect(fs.stat(path)).rejects.toMatchObject({ code: 'ENOENT' });
    });

    it('discards a partial before continuing after an incompatible range response', async () => {
        const body = Buffer.from('the mirror contents must never be spliced');
        const split = 9;
        const first = await listen((_request, response) => {
            response.writeHead(200, {
                'Content-Length': body.length,
                ETag: '"fixture-v1"',
            });
            response.write(body.subarray(0, split));
            setTimeout(() => response.destroy(), 5);
        });
        const incompatible = await listen((_request, response) => {
            const remainder = body.subarray(split);
            response.writeHead(206, {
                'Content-Length': remainder.length,
                'Content-Range': `bytes ${split}-${body.length - 1}/${body.length}`,
                ETag: '"different-file"',
            });
            response.end(remainder);
        });
        let finalRange: string | undefined;
        const fallback = await listen((request, response) => {
            finalRange = request.headers.range;
            response.writeHead(200, {
                'Content-Length': body.length,
                ETag: '"fixture-v1"',
            });
            response.end(body);
        });
        const path = destination('validator-mismatch.zip');

        await downloadTransfer({
            candidateUrls: [first, incompatible, fallback],
            destinationPath: path,
            onProgress: () => undefined,
        });

        expect(finalRange).toBeUndefined();
        expect(await fs.readFile(path)).toEqual(body);
    });

    it('rejects a short final response and removes its partial file', async () => {
        const url = await listen((_request, response) => {
            response.writeHead(200, {
                'Content-Length': 50,
                ETag: '"fixture-v1"',
            });
            response.write(Buffer.alloc(12, 1));
            setTimeout(() => response.destroy(), 5);
        });
        const path = destination('short.zip');

        await expect(downloadTransfer({
            candidateUrls: [url],
            destinationPath: path,
            onProgress: () => undefined,
        })).rejects.toThrow();
        await expect(fs.stat(path)).rejects.toMatchObject({ code: 'ENOENT' });
    });

    it('does not retry another server after a fatal destination write error', async () => {
        const first = await listen((_request, response) => response.end('payload'));
        let fallbackRequests = 0;
        const second = await listen((_request, response) => {
            fallbackRequests += 1;
            response.end('fallback');
        });
        const root = mkdtempSync(join(tmpdir(), 'download-transfer-test-'));
        roots.push(root);
        const path = join(root, 'missing-parent', 'fatal.zip');

        await expect(downloadTransfer({
            candidateUrls: [first, second],
            destinationPath: path,
            onProgress: () => undefined,
        })).rejects.toMatchObject({ code: 'ENOENT' });
        expect(fallbackRequests).toBe(0);
    });

    it('restarts the same fallback server from zero when the partial has no validator', async () => {
        const body = Buffer.from('validator-free payload');
        const first = await listen((_request, response) => {
            response.writeHead(200, { 'Content-Length': body.length });
            response.write(body.subarray(0, 5));
            setTimeout(() => response.destroy(), 5);
        });
        const fallbackRanges: Array<string | undefined> = [];
        const second = await listen((request, response) => {
            fallbackRanges.push(request.headers.range);
            response.writeHead(200, { 'Content-Length': body.length });
            response.end(body);
        });
        const path = destination('no-validator.zip');

        await downloadTransfer({
            candidateUrls: [first, second],
            destinationPath: path,
            onProgress: () => undefined,
        });

        expect(fallbackRanges).toEqual([undefined]);
        expect(await fs.readFile(path)).toEqual(body);
    });

    it('moves past a mirror that answers 404 for the file', async () => {
        const body = Buffer.from('only the second mirror has this file');
        const missing = await listen((_request, response) => {
            response.writeHead(404);
            response.end('Not Found');
        });
        const present = await listen((_request, response) => {
            response.writeHead(200, { 'Content-Length': body.length });
            response.end(body);
        });
        const path = destination('missing-mirror.zip');
        const statuses: Array<{ phase: string }> = [];

        await downloadTransfer({
            candidateUrls: [missing, present],
            destinationPath: path,
            onProgress: () => undefined,
            onServerStatus: (status) => statuses.push(status),
        });

        expect(await fs.readFile(path)).toEqual(body);
        expect(statuses.map(({ phase }) => phase)).toEqual(['selected', 'switching', 'selected']);
    });

    it('gives up on a silent mirror after the mirror timeout instead of the full budget', async () => {
        const body = Buffer.from('served after the silent mirror is skipped');
        const silent = await listen(() => undefined);
        const working = await listen((_request, response) => {
            response.writeHead(200, { 'Content-Length': body.length });
            response.end(body);
        });
        const path = destination('silent-mirror.zip');

        await downloadTransfer({
            candidateUrls: [silent, working],
            destinationPath: path,
            onProgress: () => undefined,
            connectionTimeoutMs: 30_000,
            mirrorConnectionTimeoutMs: 100,
        });

        expect(await fs.readFile(path)).toEqual(body);
    });

    it('gives the last candidate the full connection budget and reports why it failed', async () => {
        const silentMirror = await listen(() => undefined);
        const silentLast = await listen(() => undefined);
        const path = destination('all-silent.zip');

        await expect(downloadTransfer({
            candidateUrls: [silentMirror, silentLast],
            destinationPath: path,
            onProgress: () => undefined,
            connectionTimeoutMs: 400,
            mirrorConnectionTimeoutMs: 50,
        })).rejects.toThrow('Download connection timed out after 0.4 seconds');
        await expect(fs.stat(path)).rejects.toMatchObject({ code: 'ENOENT' });
    });

    it('never surfaces a blank error when the connect fails on every address', async () => {
        const closed = createServer();
        await new Promise<void>((resolve) => closed.listen(0, '127.0.0.1', resolve));
        const address = closed.address();
        if (!address || typeof address === 'string') throw new Error('Expected TCP test server');
        await new Promise<void>((resolve) => closed.close(() => resolve()));
        const path = destination('refused.zip');

        const error = await downloadTransfer({
            candidateUrls: [`http://localhost:${address.port}/fixture.zip`],
            destinationPath: path,
            onProgress: () => undefined,
        }).catch((reason: unknown) => reason);

        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toMatch(/ECONNREFUSED/);
    });

    it('rejects a redirect that leaves the trusted download hosts', async () => {
        const url = await listen((_request, response) => {
            response.writeHead(302, { Location: 'http://example.com/untrusted.zip' });
            response.end();
        });
        const path = destination('redirect.zip');

        await expect(downloadTransfer({
            candidateUrls: [url],
            destinationPath: path,
            onProgress: () => undefined,
        })).rejects.toThrow('Download redirect was rejected');
        await expect(fs.stat(path)).rejects.toMatchObject({ code: 'ENOENT' });
    });

    it('resumes repeated suspensions from closed partial files with the original validator', async () => {
        const body = Buffer.from('abcdefghijklmnopqrstuvwxyz');
        const ranges: Array<string | undefined> = [];
        const ifRanges: Array<string | string[] | undefined> = [];
        const openResponses = new Set<ServerResponse>();
        const url = await listen((request, response) => {
            ranges.push(request.headers.range);
            ifRanges.push(request.headers['if-range']);
            const offset = Number(/^bytes=(\d+)-$/.exec(request.headers.range ?? '')?.[1] ?? 0);
            openResponses.add(response);
            response.on('close', () => openResponses.delete(response));
            response.writeHead(offset ? 206 : 200, {
                'Content-Length': body.length - offset,
                ...(offset ? { 'Content-Range': `bytes ${offset}-${body.length - 1}/${body.length}` } : {}),
                ETag: '"pause-v1"',
            });
            if (offset < 16) response.write(body.subarray(offset, offset + 8));
            else response.end(body.subarray(offset));
        });
        const path = destination('repeated-pause.zip');
        const checkpoint: DownloadTransferCheckpoint = {};

        for (const expectedSize of [8, 16]) {
            const pause = new AbortController();
            const error = await downloadTransfer({
                candidateUrls: [url], destinationPath: path, checkpoint,
                pauseSignal: pause.signal,
                onProgress: () => pause.abort(),
            }).catch((reason: unknown) => reason);
            expect(error).toBeInstanceOf(DownloadSuspendedError);
            expect(isDownloadSuspended(error)).toBe(true);
            expect(await fs.readFile(path)).toEqual(body.subarray(0, expectedSize));
            expect(checkpoint.total).toBe(body.length);
            await vi.waitFor(() => expect(openResponses.size).toBe(0));
            // On Windows this also verifies no open destination handle survives.
            await fs.rename(path, `${path}.closed`);
            await fs.rename(`${path}.closed`, path);
        }

        await downloadTransfer({
            candidateUrls: [url], destinationPath: path, checkpoint,
            onProgress: () => undefined,
        });
        expect(ranges).toEqual([undefined, 'bytes=8-', 'bytes=16-']);
        expect(ifRanges).toEqual([undefined, '"pause-v1"', '"pause-v1"']);
        expect(await fs.readFile(path)).toEqual(body);
        expect(isDownloadSuspended(new Error('CANCELLED_BY_USER'))).toBe(false);
    });

    it('suspends a request waiting for headers without retaining a live connection', async () => {
        let requested!: () => void;
        const requestSeen = new Promise<void>((resolve) => { requested = resolve; });
        let closed = false;
        const url = await listen((_request, response) => {
            response.on('close', () => { closed = true; });
            requested();
        });
        const path = destination('pause-before-headers.zip');
        const pause = new AbortController();
        const transfer = downloadTransfer({
            candidateUrls: [url], destinationPath: path, checkpoint: {},
            pauseSignal: pause.signal, onProgress: () => undefined,
        });
        const rejection = expect(transfer).rejects.toBeInstanceOf(DownloadSuspendedError);
        await requestSeen;
        pause.abort();
        await rejection;
        await vi.waitFor(() => expect(closed).toBe(true));
        await expect(fs.stat(path)).rejects.toMatchObject({ code: 'ENOENT' });
    });

    it('validates a complete partial when suspension races the final transfer sample', async () => {
        const body = Buffer.from('a completed suspended archive');
        const ranges: Array<string | undefined> = [];
        const url = await listen((request, response) => {
            ranges.push(request.headers.range);
            if (request.headers.range) {
                response.writeHead(416, {
                    'Content-Range': `bytes */${body.length}`,
                    ETag: '"complete"',
                });
                response.end();
            } else {
                response.writeHead(200, { 'Content-Length': body.length, ETag: '"complete"' });
                response.end(body);
            }
        });
        const path = destination('complete-suspended.zip');
        const checkpoint: DownloadTransferCheckpoint = {};
        const pause = new AbortController();
        await expect(downloadTransfer({
            candidateUrls: [url], destinationPath: path, checkpoint,
            pauseSignal: pause.signal, onProgress: () => pause.abort(),
        })).rejects.toBeInstanceOf(DownloadSuspendedError);
        await downloadTransfer({
            candidateUrls: [url], destinationPath: path, checkpoint, onProgress: () => undefined,
        });
        expect(ranges).toEqual([undefined, `bytes=${body.length}-`]);
        expect(await fs.readFile(path)).toEqual(body);
    });

    it('cancels an already suspended checkpoint and gives cancellation precedence over suspension', async () => {
        let requests = 0;
        const url = await listen((_request, response) => {
            requests += 1;
            response.writeHead(200, { 'Content-Length': 20, ETag: '"cancel-paused"' });
            response.write(Buffer.alloc(5, 1));
        });
        const path = destination('cancel-paused.zip');
        const checkpoint: DownloadTransferCheckpoint = {};
        const pause = new AbortController();
        await expect(downloadTransfer({
            candidateUrls: [url], destinationPath: path, checkpoint,
            pauseSignal: pause.signal, onProgress: () => pause.abort(),
        })).rejects.toBeInstanceOf(DownloadSuspendedError);

        const cancel = new AbortController();
        cancel.abort();
        await expect(downloadTransfer({
            candidateUrls: [url], destinationPath: path, checkpoint,
            signal: cancel.signal, pauseSignal: pause.signal, onProgress: () => undefined,
        })).rejects.toThrow('CANCELLED_BY_USER');
        expect(requests).toBe(1);
        expect(checkpoint.validator).toBeUndefined();
        await expect(fs.stat(path)).rejects.toMatchObject({ code: 'ENOENT' });
    });

    it.each(['ignored range', 'changed validator', 'missing validator'])(
        'resets displayed progress before safely restarting a paused transfer with %s', async (scenario) => {
            const oldBody = Buffer.from('old archive contents');
            const newBody = Buffer.from('different replacement archive contents');
            const requests: Array<string | undefined> = [];
            const url = await listen((request, response) => {
                requests.push(request.headers.range);
                if (requests.length === 1) {
                    response.writeHead(200, {
                        'Content-Length': oldBody.length,
                        ...(scenario === 'missing validator' ? {} : { ETag: '"old"' }),
                    });
                    response.write(oldBody.subarray(0, 5));
                } else if (scenario === 'changed validator' && request.headers.range) {
                    response.writeHead(206, {
                        'Content-Length': newBody.length - 5,
                        'Content-Range': `bytes 5-${newBody.length - 1}/${newBody.length}`,
                        ETag: '"new"',
                    });
                    response.end(newBody.subarray(5));
                } else {
                    response.writeHead(200, { 'Content-Length': newBody.length, ETag: '"new"' });
                    response.end(newBody);
                }
            });
            const path = destination('restart-paused.zip');
            const checkpoint: DownloadTransferCheckpoint = {};
            const pause = new AbortController();
            await expect(downloadTransfer({
                candidateUrls: [url], destinationPath: path, checkpoint,
                pauseSignal: pause.signal, onProgress: () => pause.abort(),
            })).rejects.toBeInstanceOf(DownloadSuspendedError);
            const progress: Array<[number, number]> = [];
            await downloadTransfer({
                candidateUrls: [url], destinationPath: path, checkpoint,
                onProgress: (downloaded, total) => progress.push([downloaded, total]),
            });
            expect(progress[0][0]).toBe(0);
            expect(progress.at(-1)).toEqual([newBody.length, newBody.length]);
            expect(requests).toEqual(scenario === 'missing validator'
                ? [undefined, undefined]
                : scenario === 'changed validator'
                    ? [undefined, 'bytes=5-', undefined]
                    : [undefined, 'bytes=5-']);
            expect(await fs.readFile(path)).toEqual(newBody);
        },
    );

    it('discards a previous invocation partial when no checkpoint is retained', async () => {
        const body = Buffer.from('fresh invocation payload');
        const ranges: Array<string | undefined> = [];
        const url = await listen((request, response) => {
            ranges.push(request.headers.range);
            response.writeHead(200, { 'Content-Length': body.length, ETag: '"fresh"' });
            if (ranges.length === 1) response.write(body.subarray(0, 5));
            else response.end(body);
        });
        const path = destination('fresh-invocation.zip');
        const pause = new AbortController();
        await expect(downloadTransfer({
            candidateUrls: [url], destinationPath: path, pauseSignal: pause.signal,
            onProgress: () => pause.abort(),
        })).rejects.toBeInstanceOf(DownloadSuspendedError);
        await downloadTransfer({
            candidateUrls: [url], destinationPath: path, onProgress: () => undefined,
        });
        expect(ranges).toEqual([undefined, undefined]);
        expect(await fs.readFile(path)).toEqual(body);
    });

    it('retains the selected redirect route across suspension without resolving mirrors again', async () => {
        const body = Buffer.from('resolved mirror archive contents');
        const ranges: Array<string | undefined> = [];
        const mirror = await listen((request, response) => {
            ranges.push(request.headers.range);
            const offset = request.headers.range ? 7 : 0;
            response.writeHead(offset ? 206 : 200, {
                'Content-Length': body.length - offset,
                ...(offset ? { 'Content-Range': `bytes ${offset}-${body.length - 1}/${body.length}` } : {}),
                ...(!offset ? { 'Content-Disposition': 'attachment; filename="resolved.zip"' } : {}),
                ETag: '"resolved"',
            });
            if (offset) response.end(body.subarray(offset));
            else response.write(body.subarray(0, 7));
        });
        let redirects = 0;
        const router = await listen((_request, response) => {
            redirects += 1;
            response.writeHead(302, { Location: mirror });
            response.end();
        });
        const resolver = vi.fn(async () => [mirror]);
        const path = destination('resolved-pause.zip');
        const checkpoint: DownloadTransferCheckpoint = {};
        const pause = new AbortController();
        let filename: string | undefined;
        await expect(downloadTransfer({
            candidateUrls: [router], destinationPath: path, checkpoint,
            pauseSignal: pause.signal, resolveRedirectCandidates: resolver,
            onResponseFilename: (value) => { filename = value; },
            onProgress: () => pause.abort(),
        })).rejects.toBeInstanceOf(DownloadSuspendedError);
        await downloadTransfer({
            candidateUrls: [router], destinationPath: path, checkpoint,
            resolveRedirectCandidates: resolver,
            onResponseFilename: (value) => { filename = value; },
            onProgress: () => undefined,
        });
        expect(resolver).toHaveBeenCalledTimes(1);
        expect(redirects).toBe(1);
        expect(ranges).toEqual([undefined, 'bytes=7-']);
        expect(filename).toBe('resolved.zip');
        expect(await fs.readFile(path)).toEqual(body);
    });

    it('rejects untrusted redirect candidates before making a request', async () => {
        const url = await listen((_request, response) => {
            response.writeHead(302, { Location: '/trusted.zip' });
            response.end();
        });
        const path = destination('untrusted-route.zip');
        await expect(downloadTransfer({
            candidateUrls: [url], destinationPath: path, onProgress: () => undefined,
            resolveRedirectCandidates: async () => ['http://example.com/untrusted.zip'],
        })).rejects.toThrow('Download route returned an untrusted server');
        await expect(fs.stat(path)).rejects.toMatchObject({ code: 'ENOENT' });
    });
});
