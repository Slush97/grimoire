import http, { type Agent, type IncomingMessage } from 'http';
import https from 'https';
import { Readable } from 'stream';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { SocksProxyAgent } from 'socks-proxy-agent';
import { isAllowedGameBananaDownloadHostname } from './security';

export function parseDownloadProxyUrl(value: string): URL {
    let url: URL;
    try {
        if (!value.includes('://')) throw new Error();
        url = new URL(value.trim());
        decodeURIComponent(url.username);
        decodeURIComponent(url.password);
    } catch {
        throw new Error('Enter a valid HTTP, HTTPS, or SOCKS proxy URL.');
    }
    if (!['http:', 'https:', 'socks:', 'socks4:', 'socks4a:', 'socks5:', 'socks5h:'].includes(url.protocol) ||
        !url.hostname || url.port === '0' || (url.pathname !== '' && url.pathname !== '/') || url.search || url.hash) {
        throw new Error('Use an HTTP, HTTPS, or SOCKS proxy URL without a path or query.');
    }
    // Send destination hostnames to SOCKS5 proxies, as HTTP CONNECT already does.
    if (url.protocol === 'socks5:') url.protocol = 'socks5h:';
    return url;
}

export function createDownloadProxyAgent(url: URL): Agent {
    return url.protocol.startsWith('socks')
        ? new SocksProxyAgent(url, { timeout: 30_000 })
        : new HttpsProxyAgent(url, { timeout: 30_000 });
}

export function isGameBananaProxyTarget(url: URL): boolean {
    return url.protocol === 'https:' && isAllowedGameBananaDownloadHostname(url.hostname);
}

function proxyResponse(request: Request, agent: Agent): Promise<IncomingMessage> {
    return new Promise((resolve, reject) => {
        const headers = Object.fromEntries(request.headers);
        const url = new URL(request.url);
        const transport = url.protocol === 'https:' ? https : http;
        const outgoing = transport.request(url, {
            method: request.method,
            headers,
            agent,
            signal: request.signal,
        }, resolve);
        outgoing.on('error', reject);
        outgoing.end();
    });
}

/** The mirror selector only needs GET/HEAD, with explicit redirect handling. */
export async function fetchThroughDownloadProxy(request: Request, agent: Agent): Promise<Response> {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
        throw new Error('The download proxy supports GET and HEAD requests.');
    }
    for (let redirects = 0; ; redirects++) {
        const incoming = await proxyResponse(request, agent);
        const status = incoming.statusCode ?? 502;
        if ([301, 302, 303, 307, 308].includes(status) && request.redirect !== 'manual') {
            incoming.destroy();
            if (request.redirect === 'error' || redirects >= 5 || !incoming.headers.location) {
                throw new Error('Unexpected redirect during download server testing.');
            }
            const target = new URL(incoming.headers.location, request.url);
            if (!isGameBananaProxyTarget(target)) throw new Error('Download proxy redirect was rejected.');
            request = new Request(target, request);
            continue;
        }
        const headers = new Headers();
        for (const [name, value] of Object.entries(incoming.headers)) {
            if (value !== undefined) {
                for (const item of Array.isArray(value) ? value : [value]) headers.append(name, item);
            }
        }
        const noBody = request.method === 'HEAD' || [204, 205, 304].includes(status);
        if (noBody) incoming.resume();
        return new Response(noBody ? null : Readable.toWeb(incoming), { status, headers });
    }
}
