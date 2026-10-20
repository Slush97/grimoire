import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ chromiumFetch: vi.fn<typeof fetch>(), acquire: vi.fn(async () => {}) }));
vi.mock('electron', () => ({
    net: { fetch: h.chromiumFetch },
    BrowserWindow: { getAllWindows: () => [] },
}));
vi.mock('./modDatabase', () => ({ getCachedCategoryTree: vi.fn(), saveCachedCategoryTree: vi.fn() }));
vi.mock('./rateLimiter', () => ({ gamebananaRateLimiter: { acquire: h.acquire } }));

import { fetchCategoryTree, fetchSubmissions } from './gamebanana';

const payload = {
    _aMetadata: { _nRecordCount: 1, _nPerpage: 1, _bIsComplete: true },
    _aRecords: [{ _idRow: 123, _sName: 'Cached connection test', _bHasFiles: true }],
};
function resetError() {
    return new TypeError('fetch failed', {
        cause: Object.assign(new Error('Client network socket disconnected before secure TLS connection was established'), { code: 'ECONNRESET' }),
    });
}

describe('GameBanana Chromium transport fallback', () => {
    beforeEach(() => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        vi.spyOn(console, 'error').mockImplementation(() => {});
        h.chromiumFetch.mockReset();
        h.acquire.mockReset().mockResolvedValue(undefined);
    });
    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
        vi.useRealTimers();
    });

    it('loads Browse through Chromium after the reported TLS reset', async () => {
        const nodeFetch = vi.fn<typeof fetch>().mockRejectedValue(resetError());
        vi.stubGlobal('fetch', nodeFetch);
        h.chromiumFetch.mockResolvedValue(Response.json(payload));

        const result = await fetchSubmissions('Mod', 1, 1);

        expect(result.records[0]).toMatchObject({ id: 123, name: 'Cached connection test' });
        expect(nodeFetch).toHaveBeenCalledTimes(1);
        expect(h.chromiumFetch).toHaveBeenCalledTimes(1);
        expect(h.acquire).toHaveBeenCalledTimes(2);
        const [url, init] = nodeFetch.mock.calls[0];
        expect(h.chromiumFetch).toHaveBeenCalledWith(url, { ...init, credentials: 'omit', cache: 'no-store' });
        expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('Chromium'), expect.stringContaining('ECONNRESET'));
    });

    it('keeps successful requests on Node', async () => {
        vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(Response.json(payload)));
        expect((await fetchSubmissions('Mod', 1, 1)).records[0].id).toBe(123);
        expect(h.chromiumFetch).not.toHaveBeenCalled();
        expect(h.acquire).toHaveBeenCalledTimes(1);
    });

    it.each([403, 429, 503])('does not retry HTTP %i through Chromium', async status => {
        vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(new Response('', { status })));
        await expect(fetchSubmissions('Mod', 1, 1)).rejects.toThrow(`GameBanana API error: ${status}`);
        expect(h.chromiumFetch).not.toHaveBeenCalled();
        expect(h.acquire).toHaveBeenCalledTimes(1);
    });

    it.each(['', '<html>challenge</html>'])('does not retry an unusable response body: %s', async body => {
        vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(new Response(body)));
        await expect(fetchSubmissions('Mod', 1, 1)).rejects.toThrow('GameBanana API returned');
        expect(h.chromiumFetch).not.toHaveBeenCalled();
    });

    it('keeps a Chromium HTTP rejection visible', async () => {
        vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockRejectedValue(resetError()));
        h.chromiumFetch.mockResolvedValue(new Response('', { status: 403, statusText: 'Forbidden' }));
        await expect(fetchSubmissions('Mod', 1, 1)).rejects.toThrow('GameBanana API error: 403 Forbidden');
        expect(h.chromiumFetch).toHaveBeenCalledTimes(1);
    });

    it('preserves the original transport error if Chromium also fails', async () => {
        const original = resetError();
        vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockRejectedValue(original));
        h.chromiumFetch.mockRejectedValue(new Error('net::ERR_CONNECTION_RESET'));
        await expect(fetchSubmissions('Mod', 1, 1)).rejects.toBe(original);
        expect(h.chromiumFetch).toHaveBeenCalledTimes(1);
        expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('also failed'), expect.stringContaining('ERR_CONNECTION_RESET'));
    });

    it('does not retry programming errors', async () => {
        const error = new TypeError('Invalid request options');
        vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockRejectedValue(error));
        await expect(fetchSubmissions('Mod', 1, 1)).rejects.toBe(error);
        expect(h.chromiumFetch).not.toHaveBeenCalled();
    });

    it('does not retry a cancelled Node request', async () => {
        const controller = new AbortController();
        vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockImplementation(async () => {
            controller.abort();
            throw controller.signal.reason;
        }));
        await expect(fetchCategoryTree('ModCategory', { signal: controller.signal })).rejects.toThrow('GameBanana request cancelled');
        expect(h.chromiumFetch).not.toHaveBeenCalled();
    });

    it('honors cancellation while waiting for the fallback rate limiter', async () => {
        const controller = new AbortController();
        h.acquire.mockResolvedValueOnce(undefined).mockImplementationOnce(async () => { controller.abort(); });
        vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockRejectedValue(resetError()));
        await expect(fetchCategoryTree('ModCategory', { signal: controller.signal })).rejects.toThrow('GameBanana request cancelled');
        expect(h.chromiumFetch).not.toHaveBeenCalled();
    });

    it('honors cancellation during the Chromium request', async () => {
        const controller = new AbortController();
        vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockRejectedValue(resetError()));
        h.chromiumFetch.mockImplementation(async () => {
            controller.abort();
            throw new Error('net::ERR_ABORTED');
        });
        await expect(fetchCategoryTree('ModCategory', { signal: controller.signal })).rejects.toThrow('GameBanana request cancelled');
        expect(h.chromiumFetch).toHaveBeenCalledTimes(1);
    });

    it('uses the remaining timeout rather than starting a fresh one for Chromium', async () => {
        vi.useFakeTimers();
        vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockImplementation(() => new Promise((_resolve, reject) => {
            setTimeout(() => reject(resetError()), 20_000);
        })));
        h.chromiumFetch.mockImplementation((_url, init) => {
            const signal = init?.signal;
            if (!signal) throw new Error('Expected the shared request signal');
            return new Promise((_resolve, reject) => {
                signal.addEventListener('abort', () => reject(new Error('net::ERR_ABORTED')), { once: true });
            });
        });
        const result = fetchCategoryTree('ModCategory').catch((error: unknown) => error);
        await vi.advanceTimersByTimeAsync(20_000);
        expect(h.chromiumFetch).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(10_000);
        expect(await result).toMatchObject({ message: 'GameBanana API request timed out after 30 seconds' });
    });

    it('keeps the existing Retry-After handling when Chromium returns 429', async () => {
        vi.useFakeTimers();
        const nodeFetch = vi.fn<typeof fetch>().mockRejectedValueOnce(resetError()).mockResolvedValueOnce(Response.json(payload));
        vi.stubGlobal('fetch', nodeFetch);
        h.chromiumFetch.mockResolvedValue(new Response('', { status: 429, headers: { 'Retry-After': '1' } }));
        const result = fetchSubmissions('Mod', 1, 1);
        await vi.advanceTimersByTimeAsync(1_000);
        expect((await result).records[0].id).toBe(123);
        expect(nodeFetch).toHaveBeenCalledTimes(2);
        expect(h.chromiumFetch).toHaveBeenCalledTimes(1);
        expect(h.acquire).toHaveBeenCalledTimes(3);
    });
});
