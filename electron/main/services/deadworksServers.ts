// Deadworks custom-server browser: relay client + content provisioning + connect.
//
// This is the desktop equivalent of the Deadworks launcher's Tauri backend, but
// everything here is plain Node and fully cross-platform. Joining a Deadworks
// server needs no Windows binary: we fetch the server's content manifest from a
// relay, download/decompress the required VPKs into citadel/deadworks_addons,
// make sure gameinfo.gi mounts them, and hand off to Steam via
// steam://connect/<ip:port>. (Hosting a server still needs Windows; that is out
// of scope for the client.)

import { createWriteStream, existsSync, readFileSync, writeFileSync, renameSync, unlinkSync, openSync, readSync, closeSync } from 'fs';
import { join } from 'path';
import http from 'http';
import https from 'https';
import dgram from 'dgram';
import { spawn } from 'child_process';
import { shell } from 'electron';
import { find7zPath } from './extract';
import {
    getDeadworksAddonsPath,
    getDeadworksMapsPath,
    getDeadworksVersionsPath,
} from './deadlock';
import { ensureDeadworksSearchPath } from './system';
import type {
    DeadworksServer,
    DeadworksContentItem,
    DeadworksConnectProgress,
    DeadworksConnectResult,
    DeadworksRelayStats,
} from '../../../src/types/deadworks';

// VPK directory magic (0x55aa1234, little-endian). Every Source 2 VPK starts
// with it; we verify after decompression so a corrupt or hostile payload never
// lands on the canonical path.
const VPK_MAGIC = Buffer.from([0x34, 0x12, 0xaa, 0x55]);

// Hard ceiling on a decompressed VPK (4 GiB) to bound a bz2-bomb manifest.
const MAX_VPK_BYTES = 4 * 1024 * 1024 * 1024;

const A2S_INFO = Buffer.from('FFFFFFFF54536F7572636520456E67696E6520517565727900', 'hex');

interface VersionEntry {
    kind: string;
    version: number;
}
interface VersionsState {
    managed: Record<string, VersionEntry>;
}

// ── Validation ───────────────────────────────────────────────────────────────

/** Reject anything but a single safe path component, mirroring the relay's
 *  schema guard so a malicious manifest can't traverse out of the content dir. */
function validateFilename(name: string): void {
    if (!name || name.length > 128) throw new Error(`invalid content filename: ${name}`);
    if (name === '.' || name === '..') throw new Error(`invalid content filename: ${name}`);
    if (name.includes('\0') || /[/\\:*?"<>|]/.test(name)) throw new Error(`content filename has reserved characters: ${name}`);
}

const IP_PORT_RE = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3}):(\d{1,5})$/;
function isValidIpPort(addr: string): boolean {
    const m = IP_PORT_RE.exec(addr);
    if (!m) return false;
    const octetsOk = [m[1], m[2], m[3], m[4]].every((o) => Number(o) <= 255);
    const port = Number(m[5]);
    return octetsOk && port > 0 && port <= 65535;
}

// ── Relay HTTP ───────────────────────────────────────────────────────────────

function normalizeRelayUrl(relayUrl: string): string {
    return relayUrl.replace(/\/+$/, '');
}

async function getJson<T>(url: string, timeoutMs = 8000): Promise<T> {
    const lib = url.startsWith('https') ? https : http;
    return new Promise<T>((resolve, reject) => {
        const req = lib.get(url, { timeout: timeoutMs }, (res) => {
            const status = res.statusCode ?? 0;
            if (status >= 300 && status < 400 && res.headers.location) {
                res.resume();
                getJson<T>(new URL(res.headers.location, url).toString(), timeoutMs).then(resolve, reject);
                return;
            }
            if (status < 200 || status >= 300) {
                res.resume();
                reject(new Error(`HTTP ${status} from ${url}`));
                return;
            }
            const chunks: Buffer[] = [];
            res.on('data', (c) => chunks.push(c as Buffer));
            res.on('end', () => {
                try {
                    resolve(JSON.parse(Buffer.concat(chunks).toString('utf-8')) as T);
                } catch (e) {
                    reject(new Error(`Malformed JSON from ${url}: ${e}`));
                }
            });
        });
        req.on('timeout', () => req.destroy(new Error(`Timed out contacting ${url}`)));
        req.on('error', reject);
    });
}

/** Coerce either relay shape (our /v1 serverPublic or a deadworks /api Server)
 *  into a DeadworksServer with safe defaults. */
function normalizeServer(raw: Record<string, unknown>): DeadworksServer {
    const s = raw as Partial<DeadworksServer>;
    return {
        id: String(s.id ?? ''),
        name: String(s.name ?? 'Unnamed server'),
        address: String(s.address ?? s.raw_address ?? ''),
        raw_address: String(s.raw_address ?? s.address ?? ''),
        region: String(s.region ?? ''),
        online: s.online ?? true,
        player_count: Number(s.player_count ?? 0),
        max_players: Number(s.max_players ?? 0),
        version: String(s.version ?? ''),
        visibility: (s.visibility as DeadworksServer['visibility']) ?? 'public',
        password_protected: Boolean(s.password_protected),
        map: String(s.map ?? ''),
        players: Array.isArray(s.players) ? s.players : [],
        mods: Array.isArray(s.mods) ? s.mods : [],
        content_addons: Array.isArray(s.content_addons) ? s.content_addons : [],
        extra_maps: Array.isArray(s.extra_maps) ? s.extra_maps : [],
        content: Array.isArray(s.content) ? s.content : undefined,
        last_heartbeat: (s.last_heartbeat as string | null) ?? null,
    };
}

/** List live servers. Tries the deadworks-shaped `/api` endpoint first (the
 *  default relay, api.deadworks.net, only serves that shape), falling back to
 *  our `/v1` API. Our own grimoire-relay serves both, so either order works. */
export async function fetchServers(relayUrl: string): Promise<DeadworksServer[]> {
    const base = normalizeRelayUrl(relayUrl);
    let data: { servers?: unknown[] };
    try {
        data = await getJson<{ servers?: unknown[] }>(`${base}/api/servers`);
    } catch {
        data = await getJson<{ servers?: unknown[] }>(`${base}/v1/servers`);
    }
    const servers = Array.isArray(data.servers) ? data.servers : [];
    return servers.map((s) => normalizeServer(s as Record<string, unknown>));
}

export async function fetchServerContent(relayUrl: string, serverId: string): Promise<DeadworksContentItem[]> {
    const base = normalizeRelayUrl(relayUrl);
    let data: { items?: DeadworksContentItem[] };
    try {
        data = await getJson<{ items?: DeadworksContentItem[] }>(`${base}/api/servers/${serverId}/content`);
    } catch {
        data = await getJson<{ items?: DeadworksContentItem[] }>(`${base}/v1/servers/${serverId}/content`);
    }
    return Array.isArray(data.items) ? data.items : [];
}

export async function fetchRelayStats(relayUrl: string): Promise<DeadworksRelayStats | null> {
    try {
        return await getJson<DeadworksRelayStats>(`${normalizeRelayUrl(relayUrl)}/v1/stats`);
    } catch {
        return null;
    }
}

// ── A2S ping ─────────────────────────────────────────────────────────────────

/** Source A2S_INFO ping. Returns round-trip ms, or -1 on no answer.
 *
 *  The ping is the time to the FIRST response packet, which is one round trip.
 *  A server typically answers A2S_INFO with an S2C_CHALLENGE (0x41) before it
 *  will return real info, but that challenge packet has itself completed a full
 *  round trip, so it is the correct thing to time. Waiting for the post-challenge
 *  reply instead would measure two round trips and report roughly double the
 *  real latency. */
export function pingServer(addr: string): Promise<number> {
    const [host, portStr] = addr.includes(':') ? addr.split(':') : [addr, '27015'];
    const port = Number(portStr) || 27015;

    return new Promise<number>((resolve) => {
        const socket = dgram.createSocket('udp4');
        const start = Date.now();
        let settled = false;
        const done = (ms: number) => {
            if (settled) return;
            settled = true;
            try { socket.close(); } catch { /* already closed */ }
            resolve(ms);
        };
        const timer = setTimeout(() => done(-1), 3000);
        timer.unref?.();

        socket.on('error', () => { clearTimeout(timer); done(-1); });
        // First packet back (challenge or info) = one round trip = the ping.
        socket.on('message', () => {
            clearTimeout(timer);
            done(Date.now() - start);
        });
        socket.send(A2S_INFO, port, host, (err) => { if (err) { clearTimeout(timer); done(-1); } });
    });
}

// ── Version ledger ───────────────────────────────────────────────────────────

function loadVersions(deadlockPath: string): VersionsState {
    const path = getDeadworksVersionsPath(deadlockPath);
    if (!existsSync(path)) return { managed: {} };
    try {
        const parsed = JSON.parse(readFileSync(path, 'utf-8')) as VersionsState;
        return parsed.managed ? parsed : { managed: {} };
    } catch {
        return { managed: {} };
    }
}

function saveVersions(deadlockPath: string, state: VersionsState): void {
    writeFileSync(getDeadworksVersionsPath(deadlockPath), JSON.stringify(state, null, 2), 'utf-8');
}

// ── Download + decompress ────────────────────────────────────────────────────

function downloadToFile(
    url: string,
    destPath: string,
    onProgress: (downloaded: number, total: number) => void,
    timeoutMs = 30000,
): Promise<void> {
    const lib = url.startsWith('https') ? https : http;
    return new Promise<void>((resolve, reject) => {
        const req = lib.get(url, { timeout: timeoutMs }, (res) => {
            const status = res.statusCode ?? 0;
            if (status >= 300 && status < 400 && res.headers.location) {
                res.resume();
                downloadToFile(new URL(res.headers.location, url).toString(), destPath, onProgress, timeoutMs).then(resolve, reject);
                return;
            }
            if (status < 200 || status >= 300) {
                res.resume();
                reject(new Error(`Download failed: HTTP ${status}`));
                return;
            }
            const total = Number(res.headers['content-length'] ?? 0);
            let downloaded = 0;
            const out = createWriteStream(destPath);
            res.on('data', (chunk: Buffer) => {
                downloaded += chunk.length;
                onProgress(downloaded, total);
            });
            res.pipe(out);
            out.on('finish', () => out.close(() => resolve()));
            out.on('error', reject);
            res.on('error', reject);
        });
        req.on('timeout', () => req.destroy(new Error('Download timed out')));
        req.on('error', reject);
    });
}

/** Decompress a `.bz2` to `destPath` using the bundled 7-Zip binary, streaming
 *  to stdout so we never have to guess the inner entry name. Enforces
 *  MAX_VPK_BYTES so a bomb can't fill the disk. */
function decompressBz2(
    bz2Path: string,
    destPath: string,
    onProgress: (written: number) => void,
): Promise<void> {
    return new Promise<void>((resolve, reject) => {
        // Use the same resolver as the archive extractor: it rewrites the bundled
        // 7za path to its app.asar.unpacked location (binaries inside the asar
        // can't be spawned) and falls back to a system 7-Zip / PATH lookup.
        const sevenZip = find7zPath()[0];
        const proc = spawn(sevenZip, ['e', '-so', bz2Path], { stdio: ['ignore', 'pipe', 'pipe'] });
        const out = createWriteStream(destPath);
        let written = 0;
        let settled = false;
        let streamDone = false;
        let exitCode: number | null = null;
        let exited = false;
        let stderr = '';

        const fail = (err: Error) => {
            if (settled) return;
            settled = true;
            try { proc.kill(); } catch { /* noop */ }
            out.destroy();
            reject(err);
        };

        // Resolve only once the output stream has fully flushed AND 7-Zip has
        // exited cleanly; otherwise a nonzero exit that arrives after the pipe
        // closes would be lost and a truncated VPK would slip through.
        const maybeResolve = () => {
            if (settled || !streamDone || !exited) return;
            if (exitCode !== 0) {
                fail(new Error(`bz2 decompression failed: ${stderr.trim() || `exit ${exitCode}`}`));
                return;
            }
            settled = true;
            resolve();
        };

        proc.stdout.on('data', (chunk: Buffer) => {
            written += chunk.length;
            if (written > MAX_VPK_BYTES) {
                fail(new Error('Decompressed content exceeds the maximum allowed size'));
                return;
            }
            onProgress(written);
        });
        proc.stdout.pipe(out);
        proc.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
        proc.on('error', (e) => fail(new Error(`7-Zip failed to start: ${e.message}`)));
        out.on('error', fail);
        out.on('finish', () => { streamDone = true; maybeResolve(); });
        proc.on('close', (code) => { exited = true; exitCode = code; maybeResolve(); });
    });
}

function verifyVpkMagic(path: string): void {
    const fd = openSync(path, 'r');
    try {
        const buf = Buffer.alloc(4);
        readSync(fd, buf, 0, 4, 0);
        if (!buf.equals(VPK_MAGIC)) {
            throw new Error(`downloaded content is not a valid VPK (magic mismatch): ${path}`);
        }
    } finally {
        closeSync(fd);
    }
}

// ── Connect orchestration ────────────────────────────────────────────────────

function emitConnect(addr: string): DeadworksConnectResult {
    if (!isValidIpPort(addr)) {
        return { success: false, method: 'none', message: `Invalid server address: ${addr}` };
    }
    void shell.openExternal(`steam://connect/${addr}`);
    return { success: true, method: 'steam_connect', message: `Opening steam://connect/${addr}` };
}

export interface PrepareAndConnectArgs {
    deadlockPath: string;
    relayUrl: string;
    serverId: string;
    addr: string;
}

/**
 * Provision a server's required content, then hand off to Steam to join.
 *
 * Steps: fetch the manifest, ensure gameinfo.gi mounts the deadworks path,
 * download + bz2-decompress + magic-verify each VPK into its target folder
 * (skipping versions we already hold), then open steam://connect.
 */
export async function prepareAndConnect(
    args: PrepareAndConnectArgs,
    onProgress: (p: DeadworksConnectProgress) => void,
): Promise<DeadworksConnectResult> {
    const { deadlockPath, relayUrl, serverId, addr } = args;
    if (!isValidIpPort(addr)) {
        return { success: false, method: 'none', message: `Invalid server address: ${addr}` };
    }

    onProgress({ name: '', status: 'fetching', bytesDownloaded: 0, totalBytes: 0, itemIndex: 0, totalItems: 0 });
    const items = await fetchServerContent(relayUrl, serverId);
    items.forEach((i) => validateFilename(i.filename));

    // No content required: dial immediately.
    if (items.length === 0) {
        onProgress({ name: '', status: 'connecting', bytesDownloaded: 0, totalBytes: 0, itemIndex: 0, totalItems: 0 });
        return emitConnect(addr);
    }

    // Provision the content roots, then make sure gameinfo.gi mounts them. We do
    // this before downloading so a locked/unparseable gameinfo fails fast with a
    // clear message instead of after a long download.
    const addonsDir = getDeadworksAddonsPath(deadlockPath);
    const mapsDir = getDeadworksMapsPath(deadlockPath);
    const gi = ensureDeadworksSearchPath(deadlockPath);
    if (!gi.configured) {
        return {
            success: false,
            method: 'gameinfo',
            message: `Could not configure gameinfo.gi for Deadworks content: ${gi.message}. Close Deadlock and try again.`,
        };
    }

    const state = loadVersions(deadlockPath);
    const total = items.length;

    for (let idx = 0; idx < total; idx++) {
        const item = items[idx];
        const targetDir = item.kind === 'map' ? mapsDir : addonsDir;
        const destVpk = join(targetDir, `${item.filename}.vpk`);
        const displayName = item.kind === 'map' ? `Map: ${item.filename}` : item.filename;

        const current = existsSync(destVpk)
            && state.managed[item.filename]?.version === item.version
            && state.managed[item.filename]?.kind === item.kind;
        if (current) {
            onProgress({ name: displayName, status: 'ready', bytesDownloaded: item.compressed_size, totalBytes: item.compressed_size, itemIndex: idx, totalItems: total });
            continue;
        }

        onProgress({ name: displayName, status: 'checking', bytesDownloaded: 0, totalBytes: item.compressed_size, itemIndex: idx, totalItems: total });

        const bz2Tmp = `${destVpk}.bz2.part`;
        const vpkTmp = `${destVpk}.part`;
        try {
            await downloadToFile(item.download_url, bz2Tmp, (downloaded, totalBytes) => {
                onProgress({ name: displayName, status: 'downloading', bytesDownloaded: downloaded, totalBytes: totalBytes || item.compressed_size, itemIndex: idx, totalItems: total });
            });
            await decompressBz2(bz2Tmp, vpkTmp, (written) => {
                onProgress({ name: displayName, status: 'decompressing', bytesDownloaded: written, totalBytes: item.compressed_size * 3, itemIndex: idx, totalItems: total });
            });
            safeUnlink(bz2Tmp);
            verifyVpkMagic(vpkTmp);
            // Atomic-ish replace onto the canonical path. If Deadlock has the old
            // VPK open this throws EBUSY/EPERM; surface a recoverable message.
            try {
                renameSync(vpkTmp, destVpk);
            } catch (e) {
                safeUnlink(vpkTmp);
                const code = (e as NodeJS.ErrnoException).code;
                if (code === 'EBUSY' || code === 'EPERM' || code === 'EACCES') {
                    return {
                        success: false,
                        method: 'file_in_use',
                        message: `${item.filename}.vpk is in use by Deadlock. Fully quit the game and try again.`,
                    };
                }
                throw e;
            }
        } catch (e) {
            safeUnlink(bz2Tmp);
            safeUnlink(vpkTmp);
            return { success: false, method: 'download', message: `Failed to prepare ${displayName}: ${(e as Error).message}` };
        }

        state.managed[item.filename] = { kind: item.kind, version: item.version };
        saveVersions(deadlockPath, state);
        onProgress({ name: displayName, status: 'ready', bytesDownloaded: item.compressed_size, totalBytes: item.compressed_size, itemIndex: idx, totalItems: total });
    }

    onProgress({ name: '', status: 'connecting', bytesDownloaded: 0, totalBytes: 0, itemIndex: 0, totalItems: 0 });
    return emitConnect(addr);
}

function safeUnlink(path: string): void {
    try {
        if (existsSync(path)) unlinkSync(path);
    } catch {
        /* best-effort temp cleanup */
    }
}
