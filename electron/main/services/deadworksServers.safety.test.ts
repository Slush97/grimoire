import { beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { DeadworksContentItem } from '../../../src/types/deadworks';

const VPK = Buffer.from([0x34, 0x12, 0xaa, 0x55, 2, 0, 0, 0]);

const h = vi.hoisted(() => ({
    assertVpkSafety: vi.fn(),
    openExternal: vi.fn(),
    manifest: [] as DeadworksContentItem[],
}));
vi.mock('electron', () => ({ shell: { openExternal: h.openExternal } }));
vi.mock('./modSafety', () => ({ assertVpkSafety: h.assertVpkSafety }));
vi.mock('./system', () => ({ ensureDeadworksSearchPath: () => ({ configured: true }) }));
vi.mock('./extract', () => ({ find7zPath: () => ['7za'] }));
// The relay answers the manifest; every other URL is a compressed payload.
vi.mock('http', async (importOriginal) => {
    const { PassThrough } = await import('node:stream');
    const { EventEmitter } = await import('node:events');
    const get = (url: string, _options: unknown, respond: (res: unknown) => void) => {
        queueMicrotask(() => {
            const res = Object.assign(new PassThrough(), { statusCode: 200, headers: {} });
            respond(res);
            res.end(url.endsWith('/content') ? JSON.stringify({ items: h.manifest }) : 'bz2');
        });
        return new EventEmitter();
    };
    return { ...(await importOriginal<typeof import('http')>()), default: { get } };
});
// 7-Zip "decompresses" every payload into a minimal VPK.
vi.mock('child_process', async (importOriginal) => {
    const { PassThrough } = await import('node:stream');
    const { EventEmitter } = await import('node:events');
    const spawn = () => {
        const proc = Object.assign(new EventEmitter(), {
            stdout: new PassThrough(), stderr: new PassThrough(), kill: () => true,
        });
        queueMicrotask(() => {
            proc.stdout.end(VPK);
            setTimeout(() => proc.emit('close', 0), 0);
        });
        return proc;
    };
    return { ...(await importOriginal<typeof import('child_process')>()), spawn };
});

import { prepareAndConnect } from './deadworksServers';

const addon: DeadworksContentItem = {
    filename: 'hud', kind: 'addon', version: 2, compressed_size: 3, download_url: 'http://cdn.test/hud.vpk.bz2',
};
const map: DeadworksContentItem = {
    filename: 'arena', kind: 'map', version: 1, compressed_size: 3, download_url: 'http://cdn.test/arena.vpk.bz2',
};

function game() {
    const root = mkdtempSync(join(tmpdir(), 'deadworks-safety-'));
    const addons = join(root, 'game', 'citadel', 'deadworks_addons', 'vpks');
    const ledger = join(root, 'game', 'citadel', 'deadworks_cache', 'versions.json');
    return { root, addons, ledger };
}

function joinServer(root: string) {
    return prepareAndConnect(
        { deadlockPath: root, relayUrl: 'http://relay.test', serverId: 's1', serverName: 'Arena Night', addr: '1.2.3.4:27015' },
        () => {},
    );
}

describe('Deadworks addon safety', () => {
    beforeEach(() => {
        h.assertVpkSafety.mockReset();
        h.openExternal.mockReset();
        h.manifest = [addon];
    });

    it('reviews a download under the server name before it reaches the mounted folder', async () => {
        const { root, addons, ledger } = game();
        h.assertVpkSafety.mockImplementation(async () => {
            expect(existsSync(join(addons, 'hud.vpk'))).toBe(false);
            throw new Error('MOD_SAFETY_TRUST_REQUIRED: This version must be trusted before activation.');
        });

        const result = await joinServer(root);

        expect(h.assertVpkSafety).toHaveBeenCalledExactlyOnceWith(join(addons, 'hud.vpk.part'), {
            context: 'server', name: 'Arena Night',
        });
        expect(result).toMatchObject({ success: false, method: 'safety' });
        expect(readdirSync(addons)).toEqual([]);
        expect(existsSync(ledger) ? JSON.parse(readFileSync(ledger, 'utf8')).managed.hud : undefined).toBeUndefined();
        expect(h.openExternal).not.toHaveBeenCalled();
    });

    it('rechecks an addon already on disk and removes it when refused', async () => {
        const { root, addons, ledger } = game();
        mkdirSync(addons, { recursive: true });
        mkdirSync(join(ledger, '..'), { recursive: true });
        writeFileSync(join(addons, 'hud.vpk'), VPK);
        writeFileSync(ledger, JSON.stringify({ managed: { hud: { kind: 'addon', version: 2 } } }));
        h.assertVpkSafety.mockRejectedValue(new Error('MOD_SAFETY_BLOCKED: The archive could not be read or installed safely.'));

        const result = await joinServer(root);

        expect(h.assertVpkSafety).toHaveBeenCalledExactlyOnceWith(join(addons, 'hud.vpk'), {
            context: 'server', name: 'Arena Night',
        });
        expect(result).toMatchObject({ success: false, method: 'safety' });
        expect(existsSync(join(addons, 'hud.vpk'))).toBe(false);
        expect(JSON.parse(readFileSync(ledger, 'utf8')).managed.hud).toBeUndefined();
        expect(h.openExternal).not.toHaveBeenCalled();
    });

    it('places reviewed addons and joins', async () => {
        const { root, addons } = game();
        h.manifest = [map, addon];
        h.assertVpkSafety.mockResolvedValue(undefined);

        const result = await joinServer(root);

        expect(result).toMatchObject({ success: true, method: 'steam_connect' });
        expect(h.assertVpkSafety).toHaveBeenCalledExactlyOnceWith(join(addons, 'hud.vpk.part'), {
            context: 'server', name: 'Arena Night',
        });
        expect(readdirSync(addons)).toEqual(['hud.vpk']);
        expect(h.openExternal).toHaveBeenCalledWith('steam://connect/1.2.3.4:27015');
    });
});
