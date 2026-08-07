import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'http';
import { mkdtempSync } from 'fs';
import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterAll, describe, expect, it } from 'vitest';

import { downloadTransfer } from './downloadTransfer';

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
});
