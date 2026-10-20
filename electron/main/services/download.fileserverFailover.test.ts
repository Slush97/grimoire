import { Agent } from 'http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const selectorMocks = vi.hoisted(() => ({ getCandidates: vi.fn() }));
const transferMocks = vi.hoisted(() => ({ downloadTransfer: vi.fn() }));
const proxyMocks = vi.hoisted(() => ({ getGameBananaDownloadProxyAgent: vi.fn() }));

vi.mock('electron', () => ({
    app: { getPath: () => '', getVersion: () => 'test' },
    BrowserWindow: class BrowserWindow {
        static getAllWindows() { return []; }
    },
}));
vi.mock('@grimoire/social-types/heroes', () => ({ inferHeroFromTitle: () => null }));
vi.mock('./gamebananaFileServers', () => ({
    gameBananaFileServerSelector: { getCandidates: selectorMocks.getCandidates },
}));
vi.mock('./gamebananaDownloadProxy', () => ({
    getGameBananaDownloadProxyAgent: proxyMocks.getGameBananaDownloadProxyAgent,
}));
vi.mock('./downloadTransfer', async (importOriginal) => ({
    ...(await importOriginal<typeof import('./downloadTransfer')>()),
    downloadTransfer: transferMocks.downloadTransfer,
}));

import { downloadFile } from './download';
import type { DownloadTransferOptions } from './downloadTransfer';

const route = 'https://gamebanana.com/dl/123';
const chosen = 'https://filecache20.gamebanana.com/mods/uhd.zip?token=fixture';
const fastest = 'https://filecache45.gamebanana.com/mods/uhd.zip?token=fixture';
const canonical = 'https://files.gamebanana.com/mods/uhd.zip?token=fixture';

function options(): DownloadTransferOptions {
    return transferMocks.downloadTransfer.mock.calls[0][0];
}

describe('downloadFile GameBanana fileserver handoff', () => {
    beforeEach(() => {
        selectorMocks.getCandidates.mockReset();
        transferMocks.downloadTransfer.mockReset().mockResolvedValue(undefined);
        proxyMocks.getGameBananaDownloadProxyAgent.mockReset().mockResolvedValue(undefined);
    });
    afterEach(() => vi.restoreAllMocks());

    it('routes all transfers through the resumable helper and ranks GameBanana mirrors', async () => {
        const second = 'https://filecache12.gamebanana.com/mods/uhd.zip?token=fixture';
        selectorMocks.getCandidates.mockResolvedValue([fastest, second, canonical]);
        const checkpoint = {};
        const pause = new AbortController();
        const progress = vi.fn();
        const filename = vi.fn();
        const status = vi.fn();
        await downloadFile(route, 'uhd.zip', progress, undefined, undefined, filename,
            undefined, status, checkpoint, pause.signal);
        expect(options()).toMatchObject({
            candidateUrls: [route], destinationPath: 'uhd.zip',
            connectionTimeoutMs: 30_000, stallTimeoutMs: 60_000,
            onProgress: progress, onResponseFilename: filename, onServerStatus: status,
            checkpoint, pauseSignal: pause.signal,
        });
        await expect(options().resolveRedirectCandidates!(chosen, options().signal)).resolves.toEqual([fastest, second, chosen]);
        expect(selectorMocks.getCandidates).toHaveBeenCalledExactlyOnceWith(canonical, expect.any(AbortSignal), 'filecache20.gamebanana.com');
        await expect(options().resolveRedirectCandidates!(route, options().signal)).resolves.toBeUndefined();
    });

    it('hands the GameBanana proxy agent to the transfer', async () => {
        const agent = new Agent();
        proxyMocks.getGameBananaDownloadProxyAgent.mockResolvedValue(agent);
        await downloadFile(route, 'proxied.zip', vi.fn());
        expect(proxyMocks.getGameBananaDownloadProxyAgent).toHaveBeenCalledExactlyOnceWith(route);
        expect(options().agent).toBe(agent);
    });

    it('does not repeat the GameBanana-assigned server when the selector already ranked it', async () => {
        selectorMocks.getCandidates.mockResolvedValue([fastest, chosen, canonical]);
        await downloadFile(route, 'dedupe.zip', vi.fn());
        await expect(options().resolveRedirectCandidates!(chosen, options().signal)).resolves.toEqual([fastest, chosen]);
    });

    it('uses the GameBanana-assigned server if mirror selection fails', async () => {
        selectorMocks.getCandidates.mockRejectedValue(new Error('directory timed out'));
        vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        await downloadFile(route, 'fallback.zip', vi.fn());
        await expect(options().resolveRedirectCandidates!(chosen, options().signal)).resolves.toEqual([chosen]);
    });

    it('surfaces transfer failures and forwards cancellation to server selection', async () => {
        transferMocks.downloadTransfer.mockRejectedValueOnce(new Error('Download connection timed out'));
        await expect(downloadFile(route, 'failed.zip', vi.fn())).rejects.toThrow('Download connection timed out');
        transferMocks.downloadTransfer.mockResolvedValue(undefined);
        const abort = new AbortController();
        await downloadFile(route, 'cancelled.zip', vi.fn(), undefined, undefined, undefined, abort.signal);
        abort.abort();
        selectorMocks.getCandidates.mockRejectedValueOnce(new Error('selection cancelled'));
        const last = transferMocks.downloadTransfer.mock.calls.at(-1)![0] as DownloadTransferOptions;
        await expect(last.resolveRedirectCandidates!(chosen, abort.signal)).rejects.toThrow('selection cancelled');
    });
});
