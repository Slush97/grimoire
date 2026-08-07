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
    it('loads lightweight directory diagnostics without probing download servers', async () => {
        let now = 1_000;
        const fetchImpl = vi.fn(async () =>
            directoryResponse([
                server('filecache45', 500),
                server('filecache44', 400),
                server('filecache42', 9_000, 'down'),
            ]),
        );
        const probeCandidate = vi.fn(async () => 1_000);
        const selector = createGameBananaFileServerSelector({
            fetchImpl,
            now: () => now,
            cacheTtlMs: 12 * 60_000,
            probeCandidate,
        });

        await expect(selector.getDiagnostics()).resolves.toEqual({
            status: 'degraded',
            availableServers: 2,
            totalServers: 3,
            directoryCheckedAt: 1_000,
            directoryExpiresAt: 721_000,
            needsProbe: true,
            testedServers: [],
        });
        expect(fetchImpl).toHaveBeenCalledTimes(1);
        expect(probeCandidate).not.toHaveBeenCalled();

        now += 60_000;
        await selector.getDiagnostics();
        expect(fetchImpl).toHaveBeenCalledTimes(1);
        expect(probeCandidate).not.toHaveBeenCalled();
    });

    it('reports the last top-three local measurements and preferred server', async () => {
        let now = 2_000;
        const selector = createGameBananaFileServerSelector({
            fetchImpl: async () =>
                directoryResponse([
                    server('filecache45', 500),
                    server('filecache44', 400),
                    server('filecache43', 300),
                    server('filecache42', 200),
                ]),
            now: () => now,
            probeCandidate: async (url) => {
                if (url.includes('filecache44')) return 900;
                if (url.includes('filecache45')) return 100;
                return null;
            },
        });

        await selector.getCandidates(canonicalUrl);
        now = 5_000;

        await expect(selector.getDiagnostics()).resolves.toEqual({
            status: 'healthy',
            availableServers: 4,
            totalServers: 4,
            directoryCheckedAt: 2_000,
            directoryExpiresAt: 722_000,
            preferredServer: 'filecache44',
            needsProbe: false,
            localProbeCheckedAt: 2_000,
            testedServers: [
                { server: 'filecache45', bytesPerSecond: 100, available: true },
                { server: 'filecache44', bytesPerSecond: 900, available: true },
                { server: 'filecache43', available: false },
            ],
        });
    });

    it('tests the top three servers on demand using the current Grimoire download', async () => {
        const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
            const url = String(input);
            if (url.includes('/Util/Fileservers')) {
                return directoryResponse([
                    server('filecache45', 500),
                    server('filecache44', 400),
                    server('filecache43', 300),
                ]);
            }
            if (url.includes('/Tool/22583')) {
                return Response.json({
                    _aFiles: [
                        {
                            _sDownloadUrl: 'https://gamebanana.com/dl/100',
                            _tsDateAdded: 10,
                            _bIsArchived: true,
                        },
                        {
                            _sDownloadUrl: 'https://gamebanana.com/dl/200',
                            _tsDateAdded: 20,
                            _bIsArchived: false,
                        },
                    ],
                });
            }
            expect(url).toBe('https://gamebanana.com/dl/200');
            expect(init?.method).toBe('HEAD');
            expect(init?.redirect).toBe('manual');
            return new Response(null, {
                status: 302,
                headers: { Location: 'https://files.gamebanana.com/tools/grimoire.exe' },
            });
        });
        const probeCandidate = vi.fn(async (url: string) => {
            if (url.includes('filecache44')) return 4_000;
            if (url.includes('filecache45')) return 2_000;
            return null;
        });
        const selector = createGameBananaFileServerSelector({ fetchImpl, probeCandidate });

        await expect(selector.testServers()).resolves.toMatchObject({
            preferredServer: 'filecache44',
            needsProbe: false,
            testedServers: [
                { server: 'filecache45', bytesPerSecond: 2_000, available: true },
                { server: 'filecache44', bytesPerSecond: 4_000, available: true },
                { server: 'filecache43', available: false },
            ],
        });
        expect(probeCandidate.mock.calls.map(([url]) => url)).toEqual([
            'https://filecache45.gamebanana.com/tools/grimoire.exe',
            'https://filecache44.gamebanana.com/tools/grimoire.exe',
            'https://filecache43.gamebanana.com/tools/grimoire.exe',
        ]);
    });

    it('retests servers on every explicit request instead of reusing the cached ranking', async () => {
        const fetchImpl = vi.fn(async (input: string | URL | Request) => {
            const url = String(input);
            if (url.includes('/Util/Fileservers')) {
                return directoryResponse([
                    server('filecache45', 500),
                    server('filecache44', 400),
                    server('filecache43', 300),
                ]);
            }
            if (url.includes('/Tool/22583')) {
                return Response.json({
                    _aFiles: [{
                        _sDownloadUrl: 'https://gamebanana.com/dl/200',
                        _tsDateAdded: 20,
                        _bIsArchived: false,
                    }],
                });
            }
            return new Response(null, {
                status: 302,
                headers: { Location: 'https://files.gamebanana.com/tools/grimoire.exe' },
            });
        });
        const probeCandidate = vi.fn(async () => 2_000);
        const selector = createGameBananaFileServerSelector({ fetchImpl, probeCandidate });

        await selector.testServers();
        await selector.testServers();

        expect(probeCandidate).toHaveBeenCalledTimes(6);
    });

    it('keeps the previous ranking when an explicit test cannot get a test file', async () => {
        const fetchImpl = vi
            .fn()
            .mockResolvedValueOnce(directoryResponse([
                server('filecache45', 500),
                server('filecache44', 400),
                server('filecache43', 300),
            ]))
            .mockResolvedValueOnce(new Response(null, { status: 503 }));
        const selector = createGameBananaFileServerSelector({
            fetchImpl,
            probeCandidate: async (url) => url.includes('filecache44') ? 4_000 : 2_000,
        });
        await selector.getCandidates(canonicalUrl);

        await expect(selector.testServers()).rejects.toThrow('Grimoire file list returned HTTP 503');
        await expect(selector.getDiagnostics()).resolves.toMatchObject({
            preferredServer: 'filecache44',
            needsProbe: false,
        });
    });

    it('reports an explicit test failure when no download servers can be measured', async () => {
        const fetchImpl = vi.fn(async (input: string | URL | Request) => {
            const url = String(input);
            if (url.includes('/Tool/22583')) {
                return Response.json({
                    _aFiles: [{
                        _sDownloadUrl: 'https://gamebanana.com/dl/200',
                        _tsDateAdded: 20,
                        _bIsArchived: false,
                    }],
                });
            }
            if (url.includes('/dl/200')) {
                return new Response(null, {
                    status: 302,
                    headers: { Location: 'https://files.gamebanana.com/tools/grimoire.exe' },
                });
            }
            return directoryResponse([]);
        });
        const selector = createGameBananaFileServerSelector({ fetchImpl });

        await expect(selector.testServers()).rejects.toThrow('No download servers available to test');
    });

    it('restores the previous ranking when every explicit speed probe fails', async () => {
        const fetchImpl = vi.fn(async (input: string | URL | Request) => {
            const url = String(input);
            if (url.includes('/Util/Fileservers')) {
                return directoryResponse([
                    server('filecache45', 500),
                    server('filecache44', 400),
                    server('filecache43', 300),
                ]);
            }
            if (url.includes('/Tool/22583')) {
                return Response.json({
                    _aFiles: [{
                        _sDownloadUrl: 'https://gamebanana.com/dl/200',
                        _tsDateAdded: 20,
                        _bIsArchived: false,
                    }],
                });
            }
            return new Response(null, {
                status: 302,
                headers: { Location: 'https://files.gamebanana.com/tools/grimoire.exe' },
            });
        });
        let explicitTest = false;
        const probeCandidate = vi.fn(async (url: string) => {
            if (explicitTest) return null;
            return url.includes('filecache44') ? 4_000 : 2_000;
        });
        const selector = createGameBananaFileServerSelector({ fetchImpl, probeCandidate });
        await selector.getCandidates(canonicalUrl);
        explicitTest = true;

        await expect(selector.testServers()).rejects.toThrow('No download servers passed the speed test');
        await expect(selector.getDiagnostics()).resolves.toMatchObject({
            preferredServer: 'filecache44',
            needsProbe: false,
            testedServers: [
                { server: 'filecache45', bytesPerSecond: 2_000, available: true },
                { server: 'filecache44', bytesPerSecond: 4_000, available: true },
                { server: 'filecache43', bytesPerSecond: 2_000, available: true },
            ],
        });
    });

    it('forces a directory refresh while retaining historical local measurements', async () => {
        let now = 10_000;
        const fetchImpl = vi
            .fn()
            .mockResolvedValueOnce(
                directoryResponse([
                    server('filecache45', 500),
                    server('filecache44', 400),
                    server('filecache43', 300),
                ]),
            )
            .mockResolvedValueOnce(
                directoryResponse([
                    server('filecache46', 800),
                    server('filecache45', 500),
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

        await selector.getCandidates(canonicalUrl);
        now = 20_000;
        const refreshed = await selector.refreshCache();

        expect(fetchImpl).toHaveBeenCalledTimes(2);
        expect(probeCandidate).toHaveBeenCalledTimes(3);
        expect(refreshed).toMatchObject({
            status: 'healthy',
            availableServers: 2,
            totalServers: 2,
            directoryCheckedAt: 20_000,
            preferredServer: 'filecache44',
            needsProbe: true,
            localProbeCheckedAt: 10_000,
            testedServers: [
                { server: 'filecache45', bytesPerSecond: 100, available: true },
                { server: 'filecache44', bytesPerSecond: 900, available: true },
                { server: 'filecache43', bytesPerSecond: 100, available: true },
            ],
        });

        await selector.getCandidates(canonicalUrl);
        expect(probeCandidate).toHaveBeenCalledTimes(5);
    });

    it('coalesces concurrent cache refresh requests', async () => {
        let release!: (response: Response) => void;
        const fetchImpl = vi.fn(() => new Promise<Response>((resolve) => {
            release = resolve;
        }));
        const selector = createGameBananaFileServerSelector({ fetchImpl });

        const first = selector.refreshCache();
        const second = selector.refreshCache();
        expect(fetchImpl).toHaveBeenCalledTimes(1);

        release(directoryResponse([server('filecache45', 500)]));
        await expect(Promise.all([first, second])).resolves.toEqual([
            expect.objectContaining({ status: 'healthy', availableServers: 1 }),
            expect.objectContaining({ status: 'healthy', availableServers: 1 }),
        ]);
        expect(fetchImpl).toHaveBeenCalledTimes(1);
    });

    it('lets a download cancel while a shared directory refresh is still pending', async () => {
        let releaseRefresh!: (response: Response) => void;
        const fetchImpl = vi.fn(() => new Promise<Response>((resolve) => {
            releaseRefresh = resolve;
        }));
        const selector = createGameBananaFileServerSelector({ fetchImpl });
        const refresh = selector.refreshCache();
        const controller = new AbortController();
        const candidates = selector.getCandidates(canonicalUrl, controller.signal);

        controller.abort(new DOMException('cancelled', 'AbortError'));
        try {
            const outcome = candidates.then(() => 'resolved', () => 'rejected');
            const timeout = new Promise<string>((resolve) => {
                setTimeout(() => resolve('pending'), 50);
            });
            await expect(Promise.race([outcome, timeout])).resolves.toBe('rejected');
        } finally {
            releaseRefresh(directoryResponse([server('filecache45', 500)]));
            await refresh;
            await candidates.catch(() => undefined);
        }
    });

    it('bounds lightweight directory requests with an explicit timeout', async () => {
        vi.useFakeTimers();
        try {
            const fetchImpl = vi.fn((_input: string | URL | Request, init?: RequestInit) =>
                new Promise<Response>((_resolve, reject) => {
                    init?.signal?.addEventListener('abort', () => {
                        reject(new DOMException('timed out', 'AbortError'));
                    }, { once: true });
                }),
            );
            const selector = createGameBananaFileServerSelector({
                fetchImpl,
                requestTimeoutMs: 100,
            });
            const diagnostics = selector.getDiagnostics();

            await vi.advanceTimersByTimeAsync(100);

            await expect(diagnostics).resolves.toMatchObject({
                status: 'unavailable',
                needsProbe: true,
            });
        } finally {
            vi.useRealTimers();
        }
    });

    it('keeps the directory timeout active while the JSON body is still streaming', async () => {
        vi.useFakeTimers();
        try {
            const fetchImpl = vi.fn((_input: string | URL | Request, init?: RequestInit) => {
                const body = new ReadableStream<Uint8Array>({
                    start(controller) {
                        init?.signal?.addEventListener('abort', () => {
                            controller.error(new DOMException('timed out', 'AbortError'));
                        }, { once: true });
                    },
                });
                return Promise.resolve(new Response(body, { status: 200 }));
            });
            const selector = createGameBananaFileServerSelector({
                fetchImpl,
                requestTimeoutMs: 100,
            });
            const diagnostics = selector.getDiagnostics();

            await vi.advanceTimersByTimeAsync(100);

            await expect(diagnostics).resolves.toMatchObject({
                status: 'unavailable',
                needsProbe: true,
            });
        } finally {
            vi.useRealTimers();
        }
    });

    it('does not let an old in-flight probe replace a freshly invalidated ranking', async () => {
        let releaseOldProbe!: (bytesPerSecond: number) => void;
        const fetchImpl = vi
            .fn()
            .mockResolvedValueOnce(directoryResponse([server('filecache45', 500)]))
            .mockResolvedValueOnce(directoryResponse([server('filecache46', 800)]));
        const probeCandidate = vi.fn((url: string) => {
            if (url.includes('filecache45')) {
                return new Promise<number>((resolve) => {
                    releaseOldProbe = resolve;
                });
            }
            return Promise.resolve(1_000);
        });
        const selector = createGameBananaFileServerSelector({ fetchImpl, probeCandidate });

        await selector.getDiagnostics();
        const oldDownload = selector.getCandidates(canonicalUrl);
        await vi.waitFor(() => expect(probeCandidate).toHaveBeenCalledTimes(1));

        await selector.refreshCache();
        releaseOldProbe(500);
        await oldDownload;

        await expect(selector.getDiagnostics()).resolves.toMatchObject({
            needsProbe: true,
            testedServers: [],
        });
        await expect(selector.getCandidates(canonicalUrl)).resolves.toEqual([
            'https://filecache46.gamebanana.com/mods/uhd_08_07_2.zip?token=public',
            'https://files.gamebanana.com/mods/uhd_08_07_2.zip?token=public',
        ]);
        expect(probeCandidate).toHaveBeenCalledTimes(2);
    });

    it('reports unavailable directory diagnostics without throwing or probing', async () => {
        const probeCandidate = vi.fn(async () => 1);
        const selector = createGameBananaFileServerSelector({
            fetchImpl: async () => {
                throw new Error('offline');
            },
            probeCandidate,
        });

        await expect(selector.getDiagnostics()).resolves.toEqual({
            status: 'unavailable',
            availableServers: 0,
            totalServers: 0,
            needsProbe: true,
            testedServers: [],
            error: 'offline',
        });
        expect(probeCandidate).not.toHaveBeenCalled();
    });

    it('marks retained directory data degraded when a forced refresh fails', async () => {
        let now = 1_000;
        const fetchImpl = vi
            .fn()
            .mockResolvedValueOnce(
                directoryResponse([
                    server('filecache45', 500),
                    server('filecache44', 400),
                    server('filecache25', 0, 'terminated'),
                ]),
            )
            .mockRejectedValueOnce(new Error('refresh failed'));
        const selector = createGameBananaFileServerSelector({
            fetchImpl,
            now: () => now,
            probeCandidate: async () => 100,
        });

        await selector.getCandidates(canonicalUrl);
        now = 5_000;
        const diagnostics = await selector.refreshCache();

        expect(diagnostics).toMatchObject({
            status: 'degraded',
            availableServers: 2,
            totalServers: 2,
            directoryCheckedAt: 1_000,
            preferredServer: 'filecache45',
            needsProbe: true,
            localProbeCheckedAt: 1_000,
            error: 'refresh failed',
        });
    });

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
