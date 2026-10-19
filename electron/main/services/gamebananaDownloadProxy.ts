import { app, safeStorage } from 'electron';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import type { Agent } from 'http';
import { z } from 'zod';
import type { GameBananaDownloadProxyConfig } from '../../../src/types/electron';
import { createDownloadProxyAgent, fetchThroughDownloadProxy, isGameBananaProxyTarget, parseDownloadProxyUrl } from './downloadProxyTransport';

const configSchema = z.object({ enabled: z.boolean(), url: z.string().max(2048) });
const storedSchema = configSchema.extend({ credentials: z.string().optional() });
let cachedAgent: { key: string; agent: Promise<Agent> } | undefined;
let pendingSave = Promise.resolve();

function configPath(): string {
    return join(app.getPath('userData'), 'download-proxy.json');
}

function readConfig(): z.infer<typeof storedSchema> {
    const path = configPath();
    if (!existsSync(path)) return { enabled: false, url: '' };
    try {
        const raw: unknown = JSON.parse(readFileSync(path, 'utf8'));
        const stored = storedSchema.parse(raw);
        if (stored.url) {
            const url = parseDownloadProxyUrl(stored.url);
            if (url.username || url.password) throw new Error();
        } else if (stored.enabled) throw new Error();
        return stored;
    } catch {
        throw new Error('Download proxy settings could not be read. Save the proxy again or clear it.');
    }
}

export function getGameBananaDownloadProxyConfig(): GameBananaDownloadProxyConfig {
    const stored = readConfig();
    return { enabled: stored.enabled, url: stored.url, hasCredentials: Boolean(stored.credentials) };
}

export function saveGameBananaDownloadProxyConfig(input: unknown): Promise<GameBananaDownloadProxyConfig> {
    const save = pendingSave.then(() => saveConfig(input));
    pendingSave = save.then(() => undefined, () => undefined);
    return save;
}

async function saveConfig(input: unknown): Promise<GameBananaDownloadProxyConfig> {
    const { enabled, url: value } = configSchema.parse(input);
    const stored: z.infer<typeof storedSchema> = { enabled, url: '' };
    if (value.trim()) {
        const url = parseDownloadProxyUrl(value);
        const username = url.username;
        const password = url.password;
        url.username = '';
        url.password = '';
        stored.url = url.toString();
        if (username || password) {
            const secure = safeStorage.isEncryptionAvailable() &&
                (process.platform !== 'linux' || !['basic_text', 'unknown'].includes(safeStorage.getSelectedStorageBackend()));
            if (!secure) throw new Error('Secure credential storage is unavailable. Use a local proxy without credentials.');
            const encrypted = await safeStorage.encryptString(JSON.stringify({ username, password }));
            stored.credentials = encrypted.toString('base64');
        } else {
            // Saving the redacted endpoint preserves its existing credentials.
            try {
                const previous = readConfig();
                if (previous.url === stored.url) stored.credentials = previous.credentials;
            } catch { /* Explicitly saving a new endpoint also repairs a corrupt config. */ }
        }
    } else if (enabled) {
        throw new Error('Enter a proxy URL before enabling the download proxy.');
    }
    const path = configPath();
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(`${path}.tmp`, JSON.stringify(stored), { mode: 0o600 });
    renameSync(`${path}.tmp`, path);
    cachedAgent = undefined;
    return getGameBananaDownloadProxyConfig();
}

export async function getGameBananaDownloadProxyAgent(target: string): Promise<Agent | undefined> {
    if (!isGameBananaProxyTarget(new URL(target))) return undefined;
    const stored = readConfig();
    if (!stored.enabled) return undefined;
    const key = JSON.stringify(stored);
    if (cachedAgent?.key !== key) {
        const agent = (async () => {
            const url = parseDownloadProxyUrl(stored.url);
            if (stored.credentials) {
                try {
                    const plaintext = await safeStorage.decryptString(Buffer.from(stored.credentials, 'base64'));
                    const raw: unknown = JSON.parse(plaintext);
                    const credentials = z.object({ username: z.string(), password: z.string() }).parse(raw);
                    url.username = credentials.username;
                    url.password = credentials.password;
                } catch {
                    throw new Error('The saved proxy credentials could not be read. Enter the proxy URL again.');
                }
            }
            return createDownloadProxyAgent(url);
        })();
        cachedAgent = { key, agent };
        // A temporarily locked keychain can be retried on the next request.
        void agent.catch(() => { if (cachedAgent?.agent === agent) cachedAgent = undefined; });
    }
    return cachedAgent.agent;
}

export const fetchGameBananaDownload: typeof globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    const agent = await getGameBananaDownloadProxyAgent(request.url);
    return agent ? fetchThroughDownloadProxy(request, agent) : globalThis.fetch(input, init);
};
