import type { GameBananaFileServerDiagnostics } from '../../../src/types/electron';

const FILESERVERS_URL = 'https://gamebanana.com/apiv11/Util/Fileservers?_nPage=1';
const DEFAULT_CACHE_TTL_MS = 12 * 60_000;
const DEFAULT_PROBE_TIMEOUT_MS = 4_000;
const DEFAULT_PROBE_BYTES = 256 * 1024;
const PROBE_COUNT = 3;
const FILESERVER_NAME_PATTERN = /^filecache\d+$/;

type FetchLike = typeof globalThis.fetch;

export interface GameBananaFileServerSelector {
    getCandidates(canonicalUrl: string, signal?: AbortSignal): Promise<string[]>;
    getDiagnostics(signal?: AbortSignal): Promise<GameBananaFileServerDiagnostics>;
    refreshCache(signal?: AbortSignal): Promise<GameBananaFileServerDiagnostics>;
}

export interface GameBananaFileServerSelectorDependencies {
    fetchImpl: FetchLike;
    now: () => number;
    cacheTtlMs: number;
    probeTimeoutMs: number;
    probeBytes: number;
    probeCandidate: (url: string, signal?: AbortSignal) => Promise<number | null>;
}

interface DirectoryServer {
    name: string;
    tenMinuteRate: number;
}

interface CachedDirectory {
    fetchedAt: number;
    expiresAt: number;
    servers: DirectoryServer[];
    availableServers: number;
    totalServers: number;
}

interface LocalProbeSnapshot {
    testedAt: number;
    results: Array<{ server: string; bytesPerSecond: number | null }>;
    preferredServer: string | null;
}

export function isCanonicalGameBananaFilesUrl(value: string): boolean {
    try {
        const url = new URL(value);
        return (
            url.protocol === 'https:' &&
            url.hostname === 'files.gamebanana.com' &&
            url.port === '' &&
            url.username === '' &&
            url.password === ''
        );
    } catch {
        return false;
    }
}

function normalizedCanonicalUrl(value: string): URL {
    if (!isCanonicalGameBananaFilesUrl(value)) {
        throw new TypeError('Expected a credential-free HTTPS files.gamebanana.com URL');
    }
    const url = new URL(value);
    url.hash = '';
    return url;
}

function directUrl(serverName: string, source: URL): string {
    const result = new URL(`https://${serverName}.gamebanana.com`);
    result.pathname = source.pathname;
    result.search = source.search;
    return result.toString();
}

function asRecord(value: unknown): Record<string, unknown> | null {
    return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
}

interface ParsedDirectory {
    servers: DirectoryServer[];
    availableServers: number;
    totalServers: number;
}

function parseDirectory(payload: unknown): ParsedDirectory {
    const root = asRecord(payload);
    const records = root?._aRecords;
    if (!Array.isArray(records)) {
        return { servers: [], availableServers: 0, totalServers: 0 };
    }

    const servers: DirectoryServer[] = [];
    let availableServers = 0;
    let totalServers = 0;
    for (const value of records) {
        const record = asRecord(value);
        if (!record || typeof record._sDomain !== 'string') continue;
        if (!FILESERVER_NAME_PATTERN.test(record._sDomain)) continue;
        if (record._sState === 'terminated') continue;
        totalServers += 1;
        if (record._sState !== 'up') continue;
        availableServers += 1;

        const stats = asRecord(record._aStats);
        const tenMinutes = asRecord(stats?._a10min);
        const rate = tenMinutes?._fRate;
        if (typeof rate !== 'number' || !Number.isFinite(rate) || rate < 0) continue;
        servers.push({ name: record._sDomain, tenMinuteRate: rate });
    }

    return {
        servers: servers.sort(
            (left, right) =>
                right.tenMinuteRate - left.tenMinuteRate || left.name.localeCompare(right.name),
        ),
        availableServers,
        totalServers,
    };
}

function throwIfAborted(signal?: AbortSignal): void {
    if (!signal?.aborted) return;
    throw signal.reason ?? new DOMException('The operation was aborted', 'AbortError');
}

function probeRangeBytes(value: string | null, maximum: number): number | null {
    const match = /^bytes\s+0-(\d+)\/(?:\d+|\*)$/i.exec(value ?? '');
    if (!match) return null;
    const end = Number(match[1]);
    const bytes = end + 1;
    return Number.isSafeInteger(bytes) && bytes > 0 && bytes <= maximum ? bytes : null;
}

async function readBoundedBody(response: Response, maximum: number): Promise<number | null> {
    const reader = response.body?.getReader();
    if (!reader) return null;
    let bytes = 0;
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) return bytes;
            bytes += value.byteLength;
            if (bytes > maximum) {
                await reader.cancel();
                return null;
            }
        }
    } finally {
        reader.releaseLock();
    }
}

async function probeWithRange(
    url: string,
    signal: AbortSignal | undefined,
    dependencies: Pick<
        GameBananaFileServerSelectorDependencies,
        'fetchImpl' | 'now' | 'probeTimeoutMs' | 'probeBytes'
    >,
): Promise<number | null> {
    throwIfAborted(signal);
    const controller = new AbortController();
    const onAbort = () => controller.abort(signal?.reason);
    signal?.addEventListener('abort', onAbort, { once: true });
    const timer = setTimeout(() => controller.abort(), dependencies.probeTimeoutMs);
    const startedAt = dependencies.now();

    try {
        const response = await dependencies.fetchImpl(url, {
            method: 'GET',
            headers: { Range: `bytes=0-${dependencies.probeBytes - 1}` },
            credentials: 'omit',
            redirect: 'manual',
            signal: controller.signal,
        });
        if (response.status !== 206) {
            await response.body?.cancel();
            return null;
        }

        const expectedBytes = probeRangeBytes(
            response.headers.get('Content-Range'),
            dependencies.probeBytes,
        );
        const rawContentLength = response.headers.get('Content-Length');
        const contentLength = rawContentLength === null ? null : Number(rawContentLength);
        if (
            expectedBytes === null ||
            (contentLength !== null &&
                (!Number.isSafeInteger(contentLength) || contentLength !== expectedBytes))
        ) {
            await response.body?.cancel();
            return null;
        }

        const bytes = await readBoundedBody(response, dependencies.probeBytes);
        const elapsedMs = dependencies.now() - startedAt;
        if (bytes === null || bytes !== expectedBytes || elapsedMs <= 0) return null;
        return (bytes * 1_000) / elapsedMs;
    } catch {
        throwIfAborted(signal);
        return null;
    } finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
    }
}

export function createGameBananaFileServerSelector(
    overrides: Partial<GameBananaFileServerSelectorDependencies> = {},
): GameBananaFileServerSelector {
    const baseDependencies = {
        fetchImpl: overrides.fetchImpl ?? globalThis.fetch.bind(globalThis),
        now: overrides.now ?? Date.now,
        cacheTtlMs: overrides.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS,
        probeTimeoutMs: overrides.probeTimeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS,
        probeBytes: overrides.probeBytes ?? DEFAULT_PROBE_BYTES,
    };
    const probeCandidate =
        overrides.probeCandidate ??
        ((url: string, signal?: AbortSignal) => probeWithRange(url, signal, baseDependencies));
    let cachedDirectory: CachedDirectory | null = null;
    let cachedOrder: string[] | null = null;
    let directoryStatus: GameBananaFileServerDiagnostics['status'] = 'unavailable';
    let directoryError: string | undefined;
    let lastLocalProbe: LocalProbeSnapshot | null = null;
    let refreshInFlight: Promise<GameBananaFileServerDiagnostics> | null = null;
    let routingGeneration = 0;

    async function getDirectory(signal?: AbortSignal, force = false): Promise<DirectoryServer[]> {
        if (!force && cachedDirectory && baseDependencies.now() < cachedDirectory.expiresAt) {
            return cachedDirectory.servers;
        }

        throwIfAborted(signal);
        try {
            const response = await baseDependencies.fetchImpl(FILESERVERS_URL, {
                method: 'GET',
                headers: { Accept: 'application/json' },
                credentials: 'omit',
                redirect: 'error',
                signal,
            });
            if (!response.ok) throw new Error(`Fileserver directory returned HTTP ${response.status}`);
            const directory = parseDirectory(await response.json());
            const fetchedAt = baseDependencies.now();
            cachedDirectory = {
                fetchedAt,
                expiresAt: fetchedAt + baseDependencies.cacheTtlMs,
                ...directory,
            };
            cachedOrder = null;
            routingGeneration += 1;
            directoryStatus =
                directory.availableServers > 0 &&
                directory.availableServers === directory.totalServers &&
                directory.servers.length === directory.availableServers
                    ? 'healthy'
                    : 'degraded';
            directoryError = undefined;
            return directory.servers;
        } catch (error) {
            throwIfAborted(signal);
            directoryError = error instanceof Error ? error.message : 'Directory refresh failed';
            if (cachedDirectory) {
                directoryStatus = 'degraded';
                return cachedDirectory.servers;
            }
            directoryStatus = 'unavailable';
            throw error;
        }
    }

    function diagnosticsSnapshot(): GameBananaFileServerDiagnostics {
        return {
            status: directoryStatus,
            availableServers: cachedDirectory?.availableServers ?? 0,
            totalServers: cachedDirectory?.totalServers ?? 0,
            ...(cachedDirectory
                ? {
                      directoryCheckedAt: cachedDirectory.fetchedAt,
                      directoryExpiresAt: cachedDirectory.expiresAt,
                  }
                : {}),
            ...(lastLocalProbe?.preferredServer
                ? { preferredServer: lastLocalProbe.preferredServer }
                : {}),
            needsProbe: cachedOrder === null,
            ...(lastLocalProbe ? { localProbeCheckedAt: lastLocalProbe.testedAt } : {}),
            testedServers:
                lastLocalProbe?.results.map((result) => ({
                    server: result.server,
                    ...(result.bytesPerSecond === null
                        ? {}
                        : { bytesPerSecond: result.bytesPerSecond }),
                    available: result.bytesPerSecond !== null,
                })) ?? [],
            ...(directoryError ? { error: directoryError } : {}),
        };
    }

    return {
        async getCandidates(canonicalUrl: string, signal?: AbortSignal): Promise<string[]> {
            const source = normalizedCanonicalUrl(canonicalUrl);
            const fallback = source.toString();
            if (refreshInFlight) {
                await refreshInFlight;
                throwIfAborted(signal);
            }
            let servers: DirectoryServer[];
            try {
                servers = await getDirectory(signal);
            } catch {
                throwIfAborted(signal);
                return [fallback];
            }
            if (servers.length === 0) return [fallback];
            if (cachedOrder) {
                return [...cachedOrder.map((name) => directUrl(name, source)), fallback];
            }
            const probeGeneration = routingGeneration;

            const topServers = servers.slice(0, PROBE_COUNT);
            const probes = await Promise.all(
                topServers.map(async (server) => {
                    try {
                        const bytesPerSecond = await probeCandidate(directUrl(server.name, source), signal);
                        return { server, bytesPerSecond };
                    } catch {
                        return { server, bytesPerSecond: null };
                    }
                }),
            );
            throwIfAborted(signal);

            const measured = probes
                .filter(
                    (probe): probe is { server: DirectoryServer; bytesPerSecond: number } =>
                        typeof probe.bytesPerSecond === 'number' &&
                        Number.isFinite(probe.bytesPerSecond) &&
                        probe.bytesPerSecond > 0,
                )
                .sort(
                    (left, right) =>
                        right.bytesPerSecond - left.bytesPerSecond ||
                        right.server.tenMinuteRate - left.server.tenMinuteRate,
                )
                .map(({ server }) => server);
            const measuredNames = new Set(measured.map(({ name }) => name));
            const unprobed = servers.slice(PROBE_COUNT);
            const failed = topServers.filter(({ name }) => !measuredNames.has(name));
            const ordered = [...measured, ...unprobed, ...failed];
            if (routingGeneration === probeGeneration) {
                cachedOrder = ordered.map(({ name }) => name);
                lastLocalProbe = {
                    testedAt: baseDependencies.now(),
                    results: probes.map(({ server, bytesPerSecond }) => ({
                        server: server.name,
                        bytesPerSecond,
                    })),
                    preferredServer: ordered[0]?.name ?? null,
                };
            }

            return [...ordered.map((server) => directUrl(server.name, source)), fallback];
        },
        async getDiagnostics(signal?: AbortSignal): Promise<GameBananaFileServerDiagnostics> {
            try {
                await getDirectory(signal);
            } catch {
                throwIfAborted(signal);
            }
            return diagnosticsSnapshot();
        },
        refreshCache(signal?: AbortSignal): Promise<GameBananaFileServerDiagnostics> {
            if (refreshInFlight) return refreshInFlight;
            cachedOrder = null;
            routingGeneration += 1;
            refreshInFlight = (async () => {
                try {
                    await getDirectory(signal, true);
                } catch {
                    throwIfAborted(signal);
                }
                return diagnosticsSnapshot();
            })().finally(() => {
                refreshInFlight = null;
            });
            return refreshInFlight;
        },
    };
}

export const gameBananaFileServerSelector = createGameBananaFileServerSelector();
