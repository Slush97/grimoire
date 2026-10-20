import { net } from 'electron';
import { inspect } from 'node:util';
import { gamebananaRateLimiter } from './rateLimiter';

export async function fetchGameBananaApi(
    url: string,
    init: { headers: Record<string, string>; signal: AbortSignal },
): Promise<Response> {
    try {
        return await fetch(url, init);
    } catch (nodeError) {
        if (!(nodeError instanceof TypeError) || nodeError.message !== 'fetch failed') throw nodeError;
        init.signal.throwIfAborted();

        console.warn('[GameBanana] Node transport failed; retrying with Chromium:', inspect(nodeError, { depth: 4 }));
        await gamebananaRateLimiter.acquire();
        init.signal.throwIfAborted();

        try {
            return await net.fetch(url, { ...init, credentials: 'omit', cache: 'no-store' });
        } catch (chromiumError) {
            init.signal.throwIfAborted();
            console.warn('[GameBanana] Chromium transport also failed:', inspect(chromiumError, { depth: 4 }));
            throw nodeError;
        }
    }
}
