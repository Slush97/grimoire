import { Readable } from 'stream';
import { isAllowedGameBananaDownloadHostname } from './security';
import { gamebananaRateLimiter } from './rateLimiter';

export function isGameBananaConnectionFailure(error: unknown): boolean {
    if (!(error instanceof Error)) return false;
    if ('code' in error && typeof error.code === 'string' &&
        /^(ECONNRESET|ECONNREFUSED|EPIPE|EPROTO|ETIMEDOUT|ENETUNREACH|EHOSTUNREACH|UND_ERR_SOCKET|ERR_SSL_.*)$/.test(error.code)) {
        return true;
    }
    return error.cause !== undefined && error.cause !== error && isGameBananaConnectionFailure(error.cause);
}

function abortReason(signal: AbortSignal): Error {
    return signal.reason instanceof Error ? signal.reason : new Error('CANCELLED_BY_USER');
}

async function chromiumResponse(request: Request): Promise<Response> {
    const { net } = await import('electron');
    request.signal.throwIfAborted();
    await gamebananaRateLimiter.acquire();
    request.signal.throwIfAborted();

    return new Promise((resolve, reject) => {
        const outgoing = net.request({
            url: request.url, method: request.method,
            headers: Object.fromEntries(request.headers),
            redirect: 'manual', credentials: 'omit', cache: 'no-store',
        });
        let settled = false;
        let incoming: Readable | undefined;
        const cleanup = () => request.signal.removeEventListener('abort', abort);
        const fail = (error: unknown) => {
            const reason = error instanceof Error ? error : new Error(String(error));
            if (!settled) { settled = true; reject(reason); }
            cleanup();
            incoming?.destroy(reason);
            outgoing.abort();
        };
        const abort = () => fail(abortReason(request.signal));
        const resolveWithoutBody = (response: Response) => {
            settled = true;
            cleanup();
            outgoing.abort();
            resolve(response);
        };
        outgoing.on('redirect', (status, _method, target) => {
            resolveWithoutBody(new Response(null, { status, headers: { Location: target } }));
        });
        outgoing.on('response', response => {
            try {
                // Electron's IncomingMessage is a Readable at runtime, but its public
                // type only declares the event emitter methods.
                if (!(response instanceof Readable)) {
                    throw new Error('Chromium returned an unsupported download stream');
                }
                incoming = response;
                response.on('error', fail);
                response.once('close', () => { cleanup(); outgoing.abort(); });
                const headers = new Headers();
                for (const [name, value] of Object.entries(response.headers)) {
                    for (const item of Array.isArray(value) ? value : [value]) headers.append(name, item);
                }
                if (request.method === 'HEAD' || [204, 205, 304].includes(response.statusCode)) {
                    resolveWithoutBody(new Response(null, { status: response.statusCode, headers }));
                    return;
                }
                const result = new Response(Readable.toWeb(response), { status: response.statusCode, headers });
                settled = true;
                resolve(result);
            } catch (error) { fail(error); }
        });
        outgoing.on('error', fail);
        request.signal.addEventListener('abort', abort, { once: true });
        if (request.signal.aborted) abort();
        else outgoing.end();
    });
}

/** Expose redirects to the transfer and mirror selector before following them. */
export async function fetchChromiumGameBananaDownload(request: Request): Promise<Response> {
    if (!['GET', 'HEAD'].includes(request.method)) throw new Error('Downloads require GET or HEAD');
    for (let redirects = 0; ; redirects++) {
        const url = new URL(request.url);
        if (url.protocol !== 'https:' || !isAllowedGameBananaDownloadHostname(url.hostname)) {
            throw new Error('Chromium download URL was rejected');
        }
        const response = await chromiumResponse(request);
        if (![301, 302, 303, 307, 308].includes(response.status) || request.redirect === 'manual') return response;
        if (request.redirect === 'error' || redirects >= 5) throw new Error('Unexpected redirect during download server testing.');
        const location = response.headers.get('location');
        if (!location) throw new Error('Download redirect did not include a location');
        request = new Request(new URL(location, request.url), request);
    }
}
