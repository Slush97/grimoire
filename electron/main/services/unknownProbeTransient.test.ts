/**
 * Coverage for isTransientProbeError, the predicate that decides whether a
 * failed archive probe is stamped `failed` in the CRC cache (skipped for the
 * next FAILED_RETRY_SECONDS) or left `pending` for the next run.
 *
 * The bug this guards: undici reports a dropped connection as a bare
 * `TypeError: fetch failed` with the real errno on `.cause`, which the original
 * rate-limit-only predicate read as "this archive is unusable". A user whose
 * network went away mid-run banked ~100 `failed` rows, so their retry checked
 * nothing for six hours. Over-classifying is the opposite hazard: a genuinely
 * unparseable archive must still be stamped, or every run re-downloads it.
 *
 * Every fs/electron/network dependency is stubbed inert, same pattern as
 * unknownModEmbedDetect.test.ts.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('./archiveCrc', () => ({
    crc32File: vi.fn(),
    fetchGameBananaArchiveVpkCrcEntries: vi.fn(),
}));
vi.mock('./gamebanana', () => ({
    fetchModsFilesMetadata: vi.fn(),
    fetchSubmissions: vi.fn(),
}));
vi.mock('./vpk', () => ({
    parseVpkDirectory: vi.fn(() => []),
    parseVpkDirectoryCached: vi.fn(() => []),
}));
vi.mock('./vpkIdentity', () => ({
    readEmbeddedAddonInfo: vi.fn(() => null),
    carryForwardOriginalIdentity: vi.fn(() => null),
}));
vi.mock('./modinfoFormat', () => ({ readEmbeddedModinfo: vi.fn(() => null) }));
vi.mock('./workers', () => ({ fingerprintFilesInWorkers: vi.fn(async () => []) }));
vi.mock('./unknownCrcCache', () => ({
    getUnknownCrcEntryCount: vi.fn(() => 0),
    getUnknownCrcFilesForMods: vi.fn(() => []),
    lookupUnknownCrcMatch: vi.fn(() => null),
    lookupUnknownCrcMatches: vi.fn(() => new Map()),
    replaceUnknownCrcEntries: vi.fn(),
    updateUnknownCrcFileStatus: vi.fn(),
    upsertUnknownCrcFiles: vi.fn(),
    UNKNOWN_CRC_PARSER_VERSION: 1,
}));

import { isTransientProbeError } from './unknownModDetection';

/** What undici actually throws when the connection fails: the message is
 *  useless, the errno is one level down on `.cause`. */
function fetchFailed(cause?: unknown): TypeError {
    const err = new TypeError('fetch failed');
    if (cause !== undefined) (err as TypeError & { cause?: unknown }).cause = cause;
    return err;
}

function errno(code: string): NodeJS.ErrnoException {
    const err = new Error(code) as NodeJS.ErrnoException;
    err.code = code;
    return err;
}

describe('isTransientProbeError', () => {
    it('treats a bare undici "fetch failed" as transient', () => {
        // The exact shape from the 2026-08-14 report: ~100 of these in a row,
        // every one of them stamped failed.
        expect(isTransientProbeError(fetchFailed())).toBe(true);
    });

    it('follows the cause chain to the errno', () => {
        expect(isTransientProbeError(fetchFailed(errno('ENOTFOUND')))).toBe(true);
        expect(isTransientProbeError(fetchFailed(errno('ECONNRESET')))).toBe(true);
        expect(isTransientProbeError(fetchFailed(errno('UND_ERR_CONNECT_TIMEOUT')))).toBe(true);
    });

    it('recognises an errno thrown directly, with no wrapper', () => {
        expect(isTransientProbeError(errno('ETIMEDOUT'))).toBe(true);
    });

    it('keeps treating rate limits and server errors as transient', () => {
        expect(isTransientProbeError(new Error('Archive range request failed: 429'))).toBe(true);
        expect(isTransientProbeError(new Error('Archive range request failed: 503'))).toBe(true);
        expect(isTransientProbeError(new Error('Archive range request failed: 408'))).toBe(true);
    });

    it('stamps a genuinely unusable archive, so it is not re-probed forever', () => {
        expect(isTransientProbeError(new Error('Archive range request failed: 404'))).toBe(false);
        expect(isTransientProbeError(new Error('Unsupported archive: solid RAR5 block'))).toBe(false);
        expect(isTransientProbeError(new Error('Central directory not found'))).toBe(false);
        expect(isTransientProbeError('not an error at all')).toBe(false);
    });

    it('survives a self-referential cause chain', () => {
        const err = new Error('boom') as Error & { cause?: unknown };
        err.cause = err;
        expect(isTransientProbeError(err)).toBe(false);
    });
});
