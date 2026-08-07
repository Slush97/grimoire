import { createServer, type Server } from 'http';
import { mkdtempSync } from 'fs';
import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const harness = vi.hoisted(() => ({ userData: '' }));
const selectorMocks = vi.hoisted(() => ({ getCandidates: vi.fn() }));
const transferMocks = vi.hoisted(() => ({ downloadTransfer: vi.fn() }));

vi.mock('electron', () => ({
    app: { getPath: () => harness.userData, getVersion: () => 'test' },
    BrowserWindow: class BrowserWindow {
        static getAllWindows() { return []; }
    },
}));
vi.mock('@grimoire/social-types/heroes', () => ({ inferHeroFromTitle: () => null }));
vi.mock('./gameBananaFileServers', () => ({
    gameBananaFileServerSelector: { getCandidates: selectorMocks.getCandidates },
}));
vi.mock('./downloadTransfer', () => ({ downloadTransfer: transferMocks.downloadTransfer }));

import { downloadFile } from './download';

async function listen(server: Server): Promise<number> {
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Test server did not bind');
    return address.port;
}

async function close(server: Server): Promise<void> {
    await new Promise<void>((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
    });
}

describe('downloadFile GameBanana fileserver handoff', () => {
    let root: string;

    beforeAll(() => {
        root = mkdtempSync(join(tmpdir(), 'download-fileserver-handoff-'));
        harness.userData = join(root, 'user-data');
    });

    beforeEach(() => {
        selectorMocks.getCandidates.mockReset();
        transferMocks.downloadTransfer.mockReset();
    });

    afterAll(async () => {
        await fs.rm(root, { recursive: true, force: true });
    });

    it('turns a GameBanana filecache redirect into an ordered failover transfer', async () => {
        const directUrl = 'https://filecache20.gamebanana.com/mods/uhd.zip?token=fixture';
        const fastestUrl = 'https://filecache45.gamebanana.com/mods/uhd.zip?token=fixture';
        const secondUrl = 'https://filecache12.gamebanana.com/mods/uhd.zip?token=fixture';
        const server = createServer((_request, response) => {
            response.writeHead(307, { Location: directUrl });
            response.end();
        });
        const port = await listen(server);
        const destinationPath = join(root, 'uhd.zip');
        const statuses: unknown[] = [];
        selectorMocks.getCandidates.mockResolvedValue([
            fastestUrl,
            secondUrl,
            'https://files.gamebanana.com/mods/uhd.zip?token=fixture',
        ]);
        transferMocks.downloadTransfer.mockImplementation(async (options) => {
            options.onServerStatus?.({ phase: 'selected', server: 'filecache45' });
        });

        try {
            await downloadFile(
                `http://127.0.0.1:${port}/dl/123`,
                destinationPath,
                vi.fn(),
                undefined,
                undefined,
                undefined,
                undefined,
                (status) => statuses.push(status),
            );
        } finally {
            await close(server);
        }

        expect(selectorMocks.getCandidates).toHaveBeenCalledWith(
            'https://files.gamebanana.com/mods/uhd.zip?token=fixture',
            expect.any(AbortSignal),
        );
        expect(transferMocks.downloadTransfer).toHaveBeenCalledWith(expect.objectContaining({
            candidateUrls: [fastestUrl, secondUrl, directUrl],
            destinationPath,
            connectionTimeoutMs: 30_000,
            stallTimeoutMs: 60_000,
        }));
        expect(statuses).toEqual([
            { phase: 'selected', server: 'filecache45' },
        ]);
    });
});
