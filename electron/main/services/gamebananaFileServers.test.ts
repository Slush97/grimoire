import { describe, expect, it, vi } from 'vitest';

import {
    createGameBananaFileServerSelector,
    isCanonicalGameBananaFilesUrl,
} from './gamebananaFileServers';

const canonicalUrl = 'https://files.gamebanana.com/mods/uhd_08_07_2.zip?token=public#ignored';

function directoryResponse(records: unknown[]): Response {
    return Response.json({ _aRecords: records });
}

function server(domain: string, rate: number, state = 'up') {
    return {
        _sDomain: domain,
        _sState: state,
        _aStats: { _a10min: { _fRate: rate } },
    };
}

describe('gameBananaFileServerSelector', () => {
    it('probes only the top three directory servers and keeps every fallback', async () => {
        const fetchImpl = vi.fn(async () =>
            directoryResponse([
                server('filecache41', 100),
                server('filecache45', 500),
                server('filecache44', 400),
                server('filecache43', 300),
                server('filecache99.evil.test', 10_000),
                server('filecache42', 9_000, 'down'),
            ]),
        );
        const probeCandidate = vi.fn(async (url: string) => {
            if (url.includes('filecache44')) return 900;
            if (url.includes('filecache45')) return 100;
            return null;
        });
        const selector = createGameBananaFileServerSelector({ fetchImpl, probeCandidate });

        await expect(selector.getCandidates(canonicalUrl)).resolves.toEqual([
            'https://filecache44.gamebanana.com/mods/uhd_08_07_2.zip?token=public',
            'https://filecache45.gamebanana.com/mods/uhd_08_07_2.zip?token=public',
            'https://filecache41.gamebanana.com/mods/uhd_08_07_2.zip?token=public',
            'https://filecache43.gamebanana.com/mods/uhd_08_07_2.zip?token=public',
            'https://files.gamebanana.com/mods/uhd_08_07_2.zip?token=public',
        ]);
        expect(probeCandidate).toHaveBeenCalledTimes(3);
        expect(probeCandidate.mock.calls.map(([url]) => new URL(url).hostname)).toEqual([
            'filecache45.gamebanana.com',
            'filecache44.gamebanana.com',
            'filecache43.gamebanana.com',
        ]);
    });

    it('caches the fileserver directory for twelve minutes', async () => {
        let now = 0;
        const fetchImpl = vi.fn(async () => directoryResponse([server('filecache45', 500)]));
        const selector = createGameBananaFileServerSelector({
            fetchImpl,
            now: () => now,
            probeCandidate: async () => 1,
        });

        await selector.getCandidates(canonicalUrl);
        now = 12 * 60_000 - 1;
        await selector.getCandidates(canonicalUrl);
        expect(fetchImpl).toHaveBeenCalledTimes(1);

        now = 12 * 60_000;
        await selector.getCandidates(canonicalUrl);
        expect(fetchImpl).toHaveBeenCalledTimes(2);
    });

    it('reuses the locally measured order for different files until the directory refreshes', async () => {
        let now = 0;
        const fetchImpl = vi.fn(async () =>
            directoryResponse([
                server('filecache45', 500),
                server('filecache44', 400),
                server('filecache43', 300),
                server('filecache42', 200),
            ]),
        );
        const probeCandidate = vi.fn(async (url: string) =>
            url.includes('filecache44') ? 900 : 100,
        );
        const selector = createGameBananaFileServerSelector({
            fetchImpl,
            now: () => now,
            probeCandidate,
        });

        await selector.getCandidates('https://files.gamebanana.com/mods/first.zip');
        const second = await selector.getCandidates(
            'https://files.gamebanana.com/sounds/second.zip?download=1',
        );

        expect(probeCandidate).toHaveBeenCalledTimes(3);
        expect(second[0]).toBe(
            'https://filecache44.gamebanana.com/sounds/second.zip?download=1',
        );
        expect(second.at(-1)).toBe(
            'https://files.gamebanana.com/sounds/second.zip?download=1',
        );

        now = 12 * 60_000;
        await selector.getCandidates('https://files.gamebanana.com/mods/third.zip');
        expect(fetchImpl).toHaveBeenCalledTimes(2);
        expect(probeCandidate).toHaveBeenCalledTimes(6);
    });

    it('falls back to the canonical URL when the directory is unavailable', async () => {
        const selector = createGameBananaFileServerSelector({
            fetchImpl: async () => {
                throw new Error('offline');
            },
        });

        await expect(selector.getCandidates(canonicalUrl)).resolves.toEqual([
            'https://files.gamebanana.com/mods/uhd_08_07_2.zip?token=public',
        ]);
    });

    it('uses bounded credential-free range requests for production probes', async () => {
        const requests: Array<{ url: string; init?: RequestInit }> = [];
        let clock = 0;
        const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
            const url = input.toString();
            requests.push({ url, init });
            if (url.includes('/apiv11/')) {
                return directoryResponse([
                    server('filecache45', 500),
                    server('filecache44', 400),
                    server('filecache43', 300),
                    server('filecache42', 200),
                ]);
            }
            return new Response(new Uint8Array(16), {
                status: 206,
                headers: { 'Content-Range': 'bytes 0-15/1000', 'Content-Length': '16' },
            });
        });
        const selector = createGameBananaFileServerSelector({
            fetchImpl,
            now: () => (clock += 10),
        });

        await selector.getCandidates(canonicalUrl);

        const probes = requests.filter(({ url }) => url.includes('filecache'));
        expect(probes).toHaveLength(3);
        for (const { init } of probes) {
            expect(new Headers(init?.headers).get('Range')).toBe('bytes=0-262143');
            expect(init?.credentials).toBe('omit');
            expect(init?.redirect).toBe('manual');
            expect(init?.signal).toBeInstanceOf(AbortSignal);
        }
    });

    it('rejects oversized or dishonest probe bodies without buffering past the cap', async () => {
        let clock = 0;
        const fetchImpl = vi.fn(async (input: string | URL | Request) => {
            const url = input.toString();
            clock += 10;
            if (url.includes('/apiv11/')) {
                return directoryResponse([
                    server('filecache45', 500),
                    server('filecache44', 400),
                    server('filecache43', 300),
                ]);
            }
            if (url.includes('filecache45')) {
                return new Response(new Uint8Array(16), {
                    status: 206,
                    headers: { 'Content-Range': 'bytes 0-999999/2000000' },
                });
            }
            if (url.includes('filecache44')) {
                return new Response(new Uint8Array(300_000), {
                    status: 206,
                    headers: { 'Content-Range': 'bytes 0-15/1000' },
                });
            }
            return new Response(new Uint8Array(16), {
                status: 206,
                headers: { 'Content-Range': 'bytes 0-15/1000', 'Content-Length': '16' },
            });
        });
        const selector = createGameBananaFileServerSelector({
            fetchImpl,
            now: () => clock,
        });

        const candidates = await selector.getCandidates(canonicalUrl);

        expect(candidates[0]).toContain('filecache43.gamebanana.com');
        expect(candidates.slice(1, 3).map((url) => new URL(url).hostname)).toEqual([
            'filecache45.gamebanana.com',
            'filecache44.gamebanana.com',
        ]);
    });
});

describe('isCanonicalGameBananaFilesUrl', () => {
    it.each([
        'http://files.gamebanana.com/mods/file.zip',
        'https://files.gamebanana.com.evil.test/mods/file.zip',
        'https://user:pass@files.gamebanana.com/mods/file.zip',
        'https://files.gamebanana.com:444/mods/file.zip',
        'not a URL',
    ])('rejects %s', (url) => {
        expect(isCanonicalGameBananaFilesUrl(url)).toBe(false);
    });

    it('accepts the exact credential-free HTTPS host', () => {
        expect(isCanonicalGameBananaFilesUrl('https://files.gamebanana.com/mods/file.zip')).toBe(true);
    });
});
