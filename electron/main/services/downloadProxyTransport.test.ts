import http, { type Server } from 'http';
import net, { type Socket } from 'net';
import { mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDownloadProxyAgent, fetchThroughDownloadProxy, parseDownloadProxyUrl } from './downloadProxyTransport';
import { downloadTransfer } from './downloadTransfer';

const body = Buffer.from('shared movement effects '.repeat(1024));
let origin: Server;
let originPort: number;
let proxy: Server | net.Server;
let sockets: Set<Socket>;
let root: string;
let connects: string[];
let auth: string | undefined;
let originHits: number;

async function listen(server: Server | net.Server): Promise<number> {
    server.on('connection', (socket: Socket) => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)); });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Server did not bind');
    return address.port;
}

async function connectProxy(): Promise<string> {
    proxy = http.createServer();
    proxy.on('connect', (request, client, head) => {
        connects.push(request.url ?? '');
        auth = request.headers['proxy-authorization'];
        const target = net.connect(originPort, '127.0.0.1', () => {
            client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
            if (head.length) target.write(head);
            client.pipe(target).pipe(client);
        });
        sockets.add(target);
        target.on('error', () => client.destroy());
        client.on('error', () => target.destroy());
        client.on('close', () => target.destroy());
    });
    return `http://user:pass@127.0.0.1:${await listen(proxy)}`;
}

describe('download proxy transport', () => {
    beforeEach(async () => {
        sockets = new Set(); connects = []; auth = undefined; originHits = 0;
        root = mkdtempSync(join(tmpdir(), 'proxy-transfer-'));
        origin = http.createServer((request, response) => {
            originHits++;
            expect(request.headers['proxy-authorization']).toBeUndefined();
            if (request.url === '/redirect') { response.writeHead(302, { Location: '/file' }).end(); return; }
            if (request.url === '/hang') { response.writeHead(200); response.write('partial'); return; }
            const start = Number(request.headers.range?.match(/bytes=(\d+)-/)?.[1] ?? 0);
            response.writeHead(start ? 206 : 200, {
                'Content-Length': body.length - start,
                ETag: '"same-file"',
                ...(start ? { 'Content-Range': `bytes ${start}-${body.length - 1}/${body.length}` } : {}),
            });
            if (request.url === '/partial') response.end(body.subarray(0, 64));
            else response.end(body.subarray(start));
        });
        originPort = await listen(origin);
    });
    afterEach(async () => {
        for (const socket of sockets) socket.destroy();
        await Promise.all([origin, proxy].filter(Boolean).map(server => new Promise<void>(resolve => server.close(() => resolve()))));
        rmSync(root, { recursive: true, force: true });
    });

    it('uses HTTP CONNECT with proxy auth and safely resumes across mirrors', async () => {
        const agent = createDownloadProxyAgent(parseDownloadProxyUrl(await connectProxy()));
        const destination = join(root, 'mod.zip');
        await downloadTransfer({
            agent,
            candidateUrls: [`http://127.0.0.1:${originPort}/partial`, `http://127.0.0.1:${originPort}/file`],
            destinationPath: destination,
            onProgress: () => undefined,
        });
        expect(readFileSync(destination)).toEqual(body);
        expect(connects).toHaveLength(2);
        expect(auth).toBe(`Basic ${Buffer.from('user:pass').toString('base64')}`);
        agent.destroy();
    });

    it('routes bounded fetches through the same proxy and preserves manual redirects', async () => {
        const agent = createDownloadProxyAgent(parseDownloadProxyUrl(await connectProxy()));
        const response = await fetchThroughDownloadProxy(new Request(`http://127.0.0.1:${originPort}/file`), agent);
        expect(Buffer.from(await response.arrayBuffer())).toEqual(body);
        const redirect = await fetchThroughDownloadProxy(new Request(`http://127.0.0.1:${originPort}/redirect`, { redirect: 'manual' }), agent);
        expect(redirect.status).toBe(302);
        expect(redirect.headers.get('location')).toBe('/file');
        await redirect.body?.cancel();
        expect(connects).toHaveLength(2);
        agent.destroy();
    });

    it('cancels a response body that has started arriving through a proxy', async () => {
        const agent = createDownloadProxyAgent(parseDownloadProxyUrl(await connectProxy()));
        const controller = new AbortController();
        const response = await fetchThroughDownloadProxy(new Request(`http://127.0.0.1:${originPort}/hang`, { signal: controller.signal }), agent);
        const result = response.text();
        controller.abort();
        await expect(result).rejects.toThrow();
        agent.destroy();
    });

    it('sends destination hostnames to a SOCKS5 proxy without local DNS lookup', async () => {
        proxy = net.createServer(client => {
            let buffer = Buffer.alloc(0);
            let greeted = false;
            const receive = (chunk: Buffer) => {
                buffer = Buffer.concat([buffer, chunk]);
                if (!greeted) {
                    if (buffer.length < 2 || buffer.length < 2 + buffer[1]) return;
                    buffer = buffer.subarray(2 + buffer[1]);
                    greeted = true;
                    client.write(Buffer.from([5, 0]));
                }
                if (buffer.length < 5) return;
                expect(buffer[3]).toBe(3);
                const length = buffer[4];
                if (buffer.length < 7 + length) return;
                connects.push(buffer.subarray(5, 5 + length).toString());
                client.removeListener('data', receive);
                const target = net.connect(originPort, '127.0.0.1', () => {
                    client.write(Buffer.from([5, 0, 0, 1, 127, 0, 0, 1, 0, 0]));
                    client.pipe(target).pipe(client);
                });
                sockets.add(target);
                target.on('error', () => client.destroy());
                client.on('close', () => target.destroy());
            };
            client.on('data', receive);
        });
        const port = await listen(proxy);
        const agent = createDownloadProxyAgent(parseDownloadProxyUrl(`socks5://127.0.0.1:${port}`));
        const response = await fetchThroughDownloadProxy(new Request(`http://download.invalid:${originPort}/file`), agent);
        expect(Buffer.from(await response.arrayBuffer())).toEqual(body);
        expect(connects).toEqual(['download.invalid']);
        agent.destroy();
    });

    it('rejects malformed endpoints without including credentials in the error', () => {
        for (const url of ['localhost:1080', 'ftp://user:secret@localhost', 'http://localhost/path', 'http://localhost/?token=secret', 'http://localhost:0', 'http://user:%broken@localhost']) {
            expect(() => parseDownloadProxyUrl(url)).toThrow(/proxy URL/);
            try { parseDownloadProxyUrl(url); } catch (error) { expect(String(error)).not.toContain('secret'); }
        }
    });

    it('fails on a proxy refusal instead of sending the file request directly', async () => {
        proxy = http.createServer();
        proxy.on('connect', (_request, client) => client.end('HTTP/1.1 407 Proxy Authentication Required\r\n\r\n'));
        const agent = createDownloadProxyAgent(parseDownloadProxyUrl(`http://127.0.0.1:${await listen(proxy)}`));
        await expect(downloadTransfer({
            agent,
            candidateUrls: [`http://127.0.0.1:${originPort}/file`],
            destinationPath: join(root, 'refused.zip'),
            onProgress: () => undefined,
        })).rejects.toThrow();
        expect(originHits).toBe(0);
        agent.destroy();
    });
});
