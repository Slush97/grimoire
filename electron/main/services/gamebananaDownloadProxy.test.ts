import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const harness = vi.hoisted(() => ({ root: '', secure: true }));
vi.mock('electron', () => ({
    app: { getPath: () => harness.root },
    safeStorage: {
        isEncryptionAvailable: () => harness.secure,
        getSelectedStorageBackend: () => 'gnome_libsecret',
        encryptString: vi.fn(async (value: string) => Buffer.from([...value].reverse().join(''))),
        decryptString: vi.fn(async (value: Buffer) => [...value.toString()].reverse().join('')),
    },
}));

import { getGameBananaDownloadProxyAgent, getGameBananaDownloadProxyConfig, saveGameBananaDownloadProxyConfig } from './gamebananaDownloadProxy';

describe('download proxy settings', () => {
    beforeEach(() => { harness.root = mkdtempSync(join(tmpdir(), 'grimoire-proxy-')); harness.secure = true; });
    afterEach(() => rmSync(harness.root, { recursive: true, force: true }));

    it('starts direct and never proxies unrelated destinations', async () => {
        expect(getGameBananaDownloadProxyConfig()).toEqual({ enabled: false, url: '', hasCredentials: false });
        await saveGameBananaDownloadProxyConfig({ enabled: true, url: 'http://127.0.0.1:7890' });
        expect(await getGameBananaDownloadProxyAgent('https://example.com/file.zip')).toBeUndefined();
        expect(await getGameBananaDownloadProxyAgent('https://filecache46.gamebanana.com/mods/file.zip')).toBeDefined();
    });

    it('encrypts credentials and only returns a redacted endpoint to the renderer', async () => {
        const saved = await saveGameBananaDownloadProxyConfig({ enabled: true, url: 'http://alice:s%40cret@localhost:7890' });
        expect(saved).toEqual({ enabled: true, url: 'http://localhost:7890/', hasCredentials: true });
        const disk = readFileSync(join(harness.root, 'download-proxy.json'), 'utf8');
        expect(disk).not.toContain('alice');
        expect(disk).not.toContain('s%40cret');
        const agent = await getGameBananaDownloadProxyAgent('https://files.gamebanana.com/mods/file.zip');
        expect(agent).toBeDefined();
        expect(await saveGameBananaDownloadProxyConfig({ enabled: false, url: saved.url })).toEqual({ ...saved, enabled: false });
        expect(await saveGameBananaDownloadProxyConfig({ enabled: false, url: '' })).toEqual({ enabled: false, url: '', hasCredentials: false });
    });

    it('refuses credential persistence without a secure store but allows local endpoints', async () => {
        harness.secure = false;
        await expect(saveGameBananaDownloadProxyConfig({ enabled: true, url: 'socks5://alice:secret@localhost:1080' })).rejects.toThrow('Secure credential storage');
        await expect(saveGameBananaDownloadProxyConfig({ enabled: true, url: 'socks5://localhost:1080' })).resolves.toMatchObject({ enabled: true, hasCredentials: false });
    });

    it('fails closed on corrupt settings and lets an explicit clear repair them', async () => {
        writeFileSync(join(harness.root, 'download-proxy.json'), '{broken');
        await expect(getGameBananaDownloadProxyAgent('https://files.gamebanana.com/mods/file.zip')).rejects.toThrow('could not be read');
        await saveGameBananaDownloadProxyConfig({ enabled: false, url: '' });
        expect(await getGameBananaDownloadProxyAgent('https://files.gamebanana.com/mods/file.zip')).toBeUndefined();
    });

    it('serializes concurrent saves and keeps the final endpoint', async () => {
        await Promise.all([
            saveGameBananaDownloadProxyConfig({ enabled: true, url: 'http://alice:secret@localhost:7890' }),
            saveGameBananaDownloadProxyConfig({ enabled: false, url: 'http://localhost:7891' }),
        ]);
        expect(getGameBananaDownloadProxyConfig()).toEqual({ enabled: false, url: 'http://localhost:7891/', hasCredentials: false });
    });
});
