// Match-salt contribution to deadlock-api.com (opt-in, default OFF).
//
// Deadlock's client downloads post-match metadata from Valve's replay servers
// via URLs like http://replay406.valve.net/1422450/<match_id>_<salt>.meta.bz2,
// and Steam keeps those requests in its local HTTP cache. The four values in
// the URL ("salts") are what lets the community-run deadlock-api.com fetch a
// match's full metadata, so submitting them helps every player's stats.
//
// This service reimplements what the official deadlock-api-ingest tool does,
// minus its two privacy leaks: we never send a username/account id (the field
// is optional in the API schema) and we never ping statlocker.gg. The only
// thing that leaves the machine is match_id, cluster_id and the two salts:
// numbers that describe the match, not the player.
//
// Cache-file format note: the host and path are stored as null-separated
// fields in a small binary header (not a literal http:// URL), always within
// the first ~200 bytes. We read 512 to be safe and reconstruct the URL the
// same way the official tool does.

import { promises as fs } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { getUserDataPath } from '../utils/paths';
import { statsApiRateLimiter } from './rateLimiter';
import { GRIMOIRE_USER_AGENT } from './userAgent';
// Status shape is a wire type (crosses IPC), so it lives in the single-source
// declaration file alongside ElectronAPI (type-only import, erased at build).
import type { SaltIngestStatus } from '../../../src/types/electron';
export type { SaltIngestStatus };

const INGEST_URL = 'https://api.deadlock-api.com/v1/matches/salts';
const DEADLOCK_APP_ID = '1422450';
const HEADER_BYTES = 512;
const RESCAN_INTERVAL_MS = 15 * 60 * 1000;

export interface MatchSalts {
    match_id: number;
    cluster_id: number | null;
    metadata_salt: number | null;
    replay_salt: number | null;
}

interface PersistedState {
    /** Keys of already-submitted salts: "<match_id>:meta" / "<match_id>:dem". */
    submitted: string[];
    totalSubmitted: number;
}

let rescanTimer: NodeJS.Timeout | null = null;
let scanInFlight = false;
const status: SaltIngestStatus = {
    running: false,
    lastScanAt: null,
    lastScanFound: 0,
    totalSubmitted: 0,
    lastError: null,
};

function getStatePath(): string {
    return join(getUserDataPath(), 'salt-ingest.json');
}

async function loadState(): Promise<PersistedState> {
    try {
        const raw = await fs.readFile(getStatePath(), 'utf-8');
        const parsed = JSON.parse(raw) as Partial<PersistedState>;
        return {
            submitted: Array.isArray(parsed.submitted) ? parsed.submitted : [],
            totalSubmitted: typeof parsed.totalSubmitted === 'number' ? parsed.totalSubmitted : 0,
        };
    } catch {
        return { submitted: [], totalSubmitted: 0 };
    }
}

async function saveState(state: PersistedState): Promise<void> {
    const path = getStatePath();
    const tempPath = `${path}.tmp`;
    await fs.writeFile(tempPath, JSON.stringify(state), 'utf-8');
    await fs.rename(tempPath, path);
}

/**
 * Candidate Steam httpcache directories for this platform. The Linux paths
 * are commonly symlinks to one another, so callers dedupe via realpath.
 */
function getCandidateCacheDirs(): string[] {
    const home = homedir();
    if (process.platform === 'linux') {
        return [
            join(home, '.local/share/Steam/appcache/httpcache'),
            join(home, '.steam/steam/appcache/httpcache'),
            join(home, '.var/app/com.valvesoftware.Steam/.local/share/Steam/appcache/httpcache'),
        ];
    }
    if (process.platform === 'win32') {
        return [
            'C:\\Program Files (x86)\\Steam\\appcache\\httpcache',
            'C:\\Program Files\\Steam\\appcache\\httpcache',
        ];
    }
    return [join(home, 'Library/Application Support/Steam/appcache/httpcache')];
}

async function resolveCacheDirs(): Promise<string[]> {
    const seen = new Set<string>();
    for (const dir of getCandidateCacheDirs()) {
        try {
            seen.add(await fs.realpath(dir));
        } catch {
            // Directory doesn't exist on this machine; skip.
        }
    }
    return [...seen];
}

function isHostChar(byte: number): boolean {
    return (
        (byte >= 0x30 && byte <= 0x39) || // 0-9
        (byte >= 0x41 && byte <= 0x5a) || // A-Z
        (byte >= 0x61 && byte <= 0x7a) || // a-z
        byte === 0x2e // .
    );
}

const PATH_END_MARKERS = new Set([0x20, 0x27, 0x00, 0x0a, 0x0d, 0x22]); // space ' \0 \n \r "
const REPLAY_PATH_RE = /^\/1422450\/(\d+)_(\d+)\.(meta|dem)\.bz2$/;

/**
 * Extract replay salts from a cache-file header buffer. Mirrors the official
 * tool: find ".valve.net", walk back over host characters, require a host
 * starting with "replay", then take the path from the next "/" up to a
 * terminator byte. One cache file describes one request, so first hit wins.
 */
export function parseSaltsFromHeader(data: Buffer): MatchSalts | null {
    const needle = Buffer.from('.valve.net');
    let searchFrom = 0;
    for (;;) {
        const idx = data.indexOf(needle, searchFrom);
        if (idx === -1) return null;
        searchFrom = idx + 1;

        let hostStart = idx;
        while (hostStart > 0 && isHostChar(data[hostStart - 1])) hostStart--;
        const host = data.subarray(hostStart, idx + needle.length).toString('latin1');
        if (!host.startsWith('replay')) continue;

        const slash = data.indexOf(0x2f, idx + needle.length); // '/'
        if (slash === -1) continue;
        let pathEnd = slash;
        while (pathEnd < data.length && !PATH_END_MARKERS.has(data[pathEnd])) pathEnd++;
        let path = data.subarray(slash, pathEnd).toString('latin1');
        if (!path.includes(DEADLOCK_APP_ID)) continue;

        const queryIdx = path.indexOf('?');
        if (queryIdx !== -1) path = path.slice(0, queryIdx);

        const match = REPLAY_PATH_RE.exec(path);
        if (!match) continue;

        const matchId = Number(match[1]);
        const salt = Number(match[2]);
        // Plausibility only; no hardcoded ceiling (the official tool rejects
        // match_id > 1e8, which live ids will outgrow within months).
        if (!Number.isSafeInteger(matchId) || matchId <= 0) continue;
        if (!Number.isSafeInteger(salt) || salt <= 0 || salt > 0xffffffff) continue;
        const clusterId = Number(host.slice('replay'.length, -'.valve.net'.length));

        return {
            match_id: matchId,
            cluster_id: Number.isSafeInteger(clusterId) ? clusterId : null,
            metadata_salt: match[3] === 'meta' ? salt : null,
            replay_salt: match[3] === 'dem' ? salt : null,
        };
    }
}

async function readHeader(filePath: string): Promise<Buffer | null> {
    let handle: fs.FileHandle | null = null;
    try {
        handle = await fs.open(filePath, 'r');
        const buf = Buffer.alloc(HEADER_BYTES);
        const { bytesRead } = await handle.read(buf, 0, HEADER_BYTES, 0);
        return buf.subarray(0, bytesRead);
    } catch {
        return null;
    } finally {
        await handle?.close().catch(() => undefined);
    }
}

async function scanDirForSalts(dir: string, results: MatchSalts[]): Promise<void> {
    let entries;
    try {
        entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
        return;
    }
    for (const entry of entries) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
            await scanDirForSalts(full, results);
        } else if (entry.isFile()) {
            const header = await readHeader(full);
            if (!header) continue;
            const salts = parseSaltsFromHeader(header);
            if (salts) results.push(salts);
        }
    }
}

function saltKey(s: MatchSalts): string {
    return `${s.match_id}:${s.metadata_salt !== null ? 'meta' : 'dem'}`;
}

async function submitSalts(salts: MatchSalts[]): Promise<void> {
    await statsApiRateLimiter.acquire();
    const res = await fetch(INGEST_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'User-Agent': GRIMOIRE_USER_AGENT,
        },
        body: JSON.stringify(salts),
    });
    if (!res.ok) {
        throw new Error(`ingest responded ${res.status}`);
    }
}

/**
 * One scan-and-submit pass. Failures leave the salts unmarked so the next
 * pass retries them; nothing is ever marked submitted without a 200.
 */
export async function runSaltScan(): Promise<void> {
    if (scanInFlight) return;
    scanInFlight = true;
    try {
        const dirs = await resolveCacheDirs();
        const found: MatchSalts[] = [];
        for (const dir of dirs) {
            await scanDirForSalts(dir, found);
        }
        status.lastScanAt = Date.now();
        status.lastScanFound = found.length;

        const state = await loadState();
        const submitted = new Set(state.submitted);
        const fresh = new Map<string, MatchSalts>();
        for (const salts of found) {
            const key = saltKey(salts);
            if (!submitted.has(key)) fresh.set(key, salts);
        }
        if (fresh.size === 0) {
            status.lastError = null;
            return;
        }

        await submitSalts([...fresh.values()]);
        for (const key of fresh.keys()) submitted.add(key);
        state.submitted = [...submitted];
        state.totalSubmitted += fresh.size;
        await saveState(state);
        status.totalSubmitted = state.totalSubmitted;
        status.lastError = null;
        console.log(`[SaltIngest] Contributed ${fresh.size} match salt(s) to deadlock-api.com`);
    } catch (error) {
        status.lastError = error instanceof Error ? error.message : String(error);
        console.warn('[SaltIngest] Scan failed:', status.lastError);
    } finally {
        scanInFlight = false;
    }
}

export function startSaltIngest(): void {
    if (rescanTimer) return;
    status.running = true;
    void loadState().then((state) => {
        status.totalSubmitted = state.totalSubmitted;
    });
    void runSaltScan();
    rescanTimer = setInterval(() => void runSaltScan(), RESCAN_INTERVAL_MS);
}

export function stopSaltIngest(): void {
    if (rescanTimer) {
        clearInterval(rescanTimer);
        rescanTimer = null;
    }
    status.running = false;
}

export function getSaltIngestStatus(): SaltIngestStatus {
    return { ...status };
}
