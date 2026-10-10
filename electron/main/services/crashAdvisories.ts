import { BrowserWindow } from 'electron';
import { createHash } from 'crypto';
import { promises as fs, existsSync } from 'fs';
import { join, dirname, relative, resolve } from 'path';
import { z } from 'zod';
import { getUserDataPath } from '../utils/paths';
import { getActiveDeadlockPath } from './settings';
import { getSteamRoots } from './steamRoots';
import { scanModsReadOnly, type Mod } from './mods';
import { isReservedPriorityVpkPath } from './deadlock';
import { getModMetadata } from './metadata';
import { parseVpkDirectoriesAsync, parseVpkEntryStats, readVpkEntryBytes } from './vpk';
import { gameSearchPaths } from './gameinfoSearchPaths';
import { observeModChanges } from './modChangeObservation';
import { crashResourceOwners, configurationForCrash, steamBuildAt, type CrashProvider } from './crashConfiguration';
import { readCrashDump, sessionForCrash, steamGameSessions } from './crashEvidence';
import type { CrashAdvisory } from '../../../src/types/crashAdvisory';

const RETENTION_MS = 14 * 24 * 60 * 60 * 1000;
const MAX_STATE_BYTES = 8 * 1024 * 1024;
const MAX_ENTRY_BYTES = 8 * 1024 * 1024;
const MAX_LOG_BYTES = 4 * 1024 * 1024;
const ownerSchema = z.object({ fingerprint: z.string().max(64), entryHash: z.string().max(64), name: z.string().max(300) });
const configurationSchema = z.object({ observedAt: z.number(), gameBuild: z.string().max(40),
    source: z.enum(['observed', 'launch']), owners: z.record(ownerSchema) });
const incidentSchema = z.object({ id: z.string().max(64), entry: z.string().max(300), error: z.string().max(2000),
    crashedAt: z.number(), gameBuild: z.string().max(40), attribution: z.enum(['recorded', 'last-known']),
    owner: ownerSchema, dismissed: z.boolean() });
const stateSchema = z.object({ version: z.literal(1), gamePath: z.string(), baseline: z.number(),
    configurations: z.array(configurationSchema).max(64), incidents: z.array(incidentSchema).max(200) });
type State = z.infer<typeof stateSchema>;
type CatalogMod = CrashProvider & { id: string; enabled: boolean };

let state: State | undefined;
let catalog: CatalogMod[] = [];
let currentBuild = '';
let active: CrashAdvisory[] = [];
let refreshing: Promise<void> | undefined;
let pendingChange = false;
let started = false;
let persistenceQueue: Promise<void> = Promise.resolve();
let savedBytes = '';
let steamRoots: string[] | undefined;
const launchObservations: { gamePath: string; mods: Mod[]; observedAt: number }[] = [];
const inspected = new Map<string, string>();
const fileCache = new Map<string, { signature: string; files: Record<string, string>; fingerprint: string }>();

const digest = (value: string | Buffer): string => createHash('sha256').update(value).digest('hex');
const statePath = (): string => join(getUserDataPath(), 'crash-advisories.json');

async function readTail(path: string, limit = MAX_LOG_BYTES): Promise<string> {
    const file = await fs.open(path, 'r');
    try {
        const size = (await file.stat()).size;
        const bytes = Buffer.alloc(Math.min(size, limit));
        const { bytesRead } = await file.read(bytes, 0, bytes.length, Math.max(0, size - bytes.length));
        return bytes.subarray(0, bytesRead).toString('utf8');
    } finally { await file.close(); }
}

async function loadState(gamePath: string): Promise<State> {
    if (state?.gamePath === gamePath) return state;
    inspected.clear();
    savedBytes = '';
    catalog = [];
    try {
        const bytes = await fs.readFile(statePath());
        if (bytes.length > MAX_STATE_BYTES) throw new Error('Diagnostic history is too large');
        const parsed = stateSchema.parse(JSON.parse(bytes.toString('utf8')));
        if (parsed.gamePath === gamePath) return state = parsed;
    } catch { /* Missing or damaged diagnostics establish a new quiet baseline. */ }
    return state = { version: 1, gamePath, baseline: Date.now(), configurations: [], incidents: [] };
}

function saveState(value: State): Promise<void> {
    const bytes = JSON.stringify(value);
    if (Buffer.byteLength(bytes) > MAX_STATE_BYTES) return Promise.resolve();
    const path = statePath();
    persistenceQueue = persistenceQueue.catch(() => {}).then(async () => {
        if (bytes === savedBytes) return;
        const temp = `${path}.tmp`;
        await fs.mkdir(dirname(path), { recursive: true });
        await fs.writeFile(temp, bytes, 'utf8');
        await fs.rename(temp, path);
        savedBytes = bytes;
    });
    return persistenceQueue;
}

async function modResources(mod: Mod): Promise<{ files: Record<string, string>; fingerprint: string }> {
    const siblings = (await fs.readdir(dirname(mod.path))).filter(name => name === mod.fileName ||
        name.startsWith(mod.fileName.replace(/_dir\.vpk$/i, '_')) && /_\d+\.vpk$/i.test(name)).sort();
    const signatureForFiles = async (): Promise<string> => JSON.stringify(await Promise.all(siblings.map(async name => {
        const stat = await fs.stat(join(dirname(mod.path), name));
        return [name, stat.size, stat.mtimeMs];
    })));
    const signature = await signatureForFiles();
    const cached = fileCache.get(mod.path);
    if (cached?.signature === signature) return cached;
    const stats = parseVpkEntryStats(mod.path);
    if (!stats) throw new Error('Unreadable mod index');
    const files: Record<string, string> = {};
    for (const entry of stats) {
        const path = entry.path.replace(/\\/g, '/').toLowerCase();
        if (!/^(panorama\/layout\/.+\.vxml_c|scripts\/.+\.vdata_c)$/.test(path)) continue;
        const bytes = entry.size <= MAX_ENTRY_BYTES ? readVpkEntryBytes(mod.path, entry.path) : null;
        files[path] = bytes ? digest(bytes) : '';
        // Let mod actions and the main event loop progress between resource reads.
        await new Promise<void>(done => setImmediate(done));
    }
    if (signature !== await signatureForFiles()) throw new Error('Mod changed during diagnostic read');
    // Resource identity survives slot renames and metadata enrichment. Identical
    // installed resource sets remain ambiguous and never select a culprit.
    const fingerprint = digest(JSON.stringify(Object.entries(files).sort()));
    const result = { signature, files, fingerprint };
    fileCache.set(mod.path, result);
    return result;
}

async function readBuild(gamePath: string): Promise<string> {
    try {
        const manifest = await fs.readFile(join(gamePath, '..', '..', 'appmanifest_1422450.acf'), 'utf8');
        return manifest.match(/"buildid"\s+"(\d+)"/i)?.[1] ?? '';
    } catch { return ''; }
}

async function readGameinfo(gamePath: string): Promise<string | null> {
    try { return await fs.readFile(join(gamePath, 'game/citadel/gameinfo.gi'), 'utf8'); }
    catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw error;
    }
}

async function captureConfiguration(gamePath: string, value: State, launch?: { mods: Mod[]; observedAt: number }): Promise<void> {
    const observedAt = launch?.observedAt ?? Date.now();
    const mods = await scanModsReadOnly(gamePath);
    if (launch && launch.mods.some(mod => !mods.some(current => current.path === mod.path && current.enabled === mod.enabled))) return;
    const gameinfo = await readGameinfo(gamePath);
    const mounts = gameinfo === null ? null : gameSearchPaths(gameinfo);
    currentBuild = await readBuild(gamePath);
    // Warm indexes in the existing worker pool rather than parsing VPK trees
    // synchronously on the main thread.
    const stockPath = join(gamePath, 'game/citadel/pak01_dir.vpk');
    const paths = await parseVpkDirectoriesAsync([...mods.map(mod => mod.path), stockPath]);
    const next: CatalogMod[] = [];
    for (const mod of mods) {
        const resources = await modResources(mod);
        const metadata = getModMetadata(mod.metaKey);
        next.push({ ...resources, fingerprint: isReservedPriorityVpkPath(mod.path) ? '' : resources.fingerprint, id: mod.id, enabled: mod.enabled, priority: mod.priority,
            root: relative(join(gamePath, 'game'), dirname(mod.path)).replace(/\\/g, '/').replace(/\/\.disabled$/, '').toLowerCase(),
            name: (metadata?.modName ?? mod.name).slice(0, 300) });
    }
    // A concurrent rename/update invalidates this observation. Retry on the next
    // refresh instead of recording a mixture of two installations.
    if (gameinfo !== await readGameinfo(gamePath)) return;
    const after = await scanModsReadOnly(gamePath);
    const beforeSignature = JSON.stringify(mods.map(mod => [mod.path, mod.enabled, mod.priority, mod.size]));
    if (beforeSignature !== JSON.stringify(after.map(mod => [mod.path, mod.enabled, mod.priority, mod.size]))) return;
    catalog = next;
    const stock = new Set((paths.get(stockPath) ?? []).map(entry => entry.replace(/\\/g, '/').toLowerCase()));
    // An unknown or unreadable stock mount cannot establish precedence.
    const owners = mounts && paths.get(stockPath) ? crashResourceOwners(next.filter(mod => mod.enabled), mounts, stock) : {};
    // Loose files can override VPK resources. Do not assign those to a VPK mod.
    for (const entry of Object.keys(owners)) {
        if (mounts?.some(root => existsSync(join(gamePath, 'game', root, entry)))) delete owners[entry];
    }
    const last = value.configurations[value.configurations.length - 1];
    if (launch || last?.gameBuild !== currentBuild || JSON.stringify(last.owners) !== JSON.stringify(owners)) {
        value.configurations.push({ observedAt, gameBuild: currentBuild, source: launch ? 'launch' : 'observed', owners });
        value.configurations = value.configurations.sort((a, b) => a.observedAt - b.observedAt).slice(-64);
    }
}

async function discoverReports(gamePath: string): Promise<string[]> {
    const roots = [...(steamRoots ??= getSteamRoots()).map(root => join(root, 'dumps')), join(gamePath, 'game/bin/win64')];
    const files: { path: string; modified: number }[] = [];
    for (const root of roots) {
        try {
            for (const name of await fs.readdir(root)) {
                if (!/^crash_deadlock\.exe_.*\.dmp$/i.test(name) && !/^deadlock_.*\.mdmp$/i.test(name)) continue;
                const path = join(root, name);
                const stat = await fs.stat(path);
                // Give the crash reporter time to finish; incomplete streams retry later.
                if (Date.now() - stat.mtimeMs < 2000 || stat.mtimeMs < Date.now() - RETENTION_MS) continue;
                const signature = `${stat.size}:${stat.mtimeMs}`;
                if (inspected.get(path) === signature) continue;
                files.push({ path, modified: stat.mtimeMs });
            }
        } catch { /* Missing report folders are normal. */ }
    }
    return files.sort((a, b) => b.modified - a.modified).slice(0, 32).map(file => file.path);
}

async function inspectReports(gamePath: string, value: State): Promise<void> {
    const roots = steamRoots ??= getSteamRoots();
    const processLogs = await Promise.all(roots.map(root => readTail(join(root, 'logs/gameprocess_log.txt')).catch(() => '')));
    const contentLogs = await Promise.all(roots.map(root => readTail(join(root, 'logs/content_log.txt')).catch(() => '')));
    const sessions = steamGameSessions(processLogs.join('\n')).sort((a, b) => a.startedAt - b.startedAt);
    const content = contentLogs.join('\n');
    for (const path of await discoverReports(gamePath)) {
        try {
            const before = await fs.stat(path);
            const evidence = await readCrashDump(path);
            const after = await fs.stat(path);
            if (before.size !== after.size || before.mtimeMs !== after.mtimeMs) continue;
            if (evidence && evidence.createdAt >= value.baseline && evidence.createdAt >= Date.now() - RETENTION_MS && evidence.createdAt <= Date.now() + 5000) {
                const session = sessionForCrash(evidence, sessions);
                const configuration = configurationForCrash(value.configurations, session?.startedAt ?? evidence.createdAt);
                const owner = configuration?.owners[evidence.entry];
                if (owner && configuration) {
                    const id = digest(JSON.stringify([evidence.pid, session?.startedAt ?? Math.floor(evidence.createdAt / 10000), evidence.entry]));
                    if (!value.incidents.some(incident => incident.id === id)) value.incidents.push({
                        id, entry: evidence.entry, error: evidence.error, crashedAt: evidence.createdAt,
                        gameBuild: steamBuildAt(content, session?.startedAt ?? evidence.createdAt) ?? configuration.gameBuild,
                        attribution: session && configuration.source === 'launch' &&
                            session.startedAt - configuration.observedAt < 60000 ? 'recorded' : 'last-known',
                        owner, dismissed: false,
                    });
                }
            }
            inspected.set(path, `${after.size}:${after.mtimeMs}`);
        } catch { /* An incomplete or unreadable report never becomes a warning. */ }
    }
    value.incidents = value.incidents.filter(incident => incident.crashedAt >= Date.now() - RETENTION_MS).slice(-200);
}

function projectAdvisories(value: State): CrashAdvisory[] {
    const findings: CrashAdvisory[] = [];
    for (const incident of [...value.incidents].reverse()) {
        if (incident.dismissed || !currentBuild || incident.gameBuild !== currentBuild) continue;
        const matches = catalog.filter(mod => mod.fingerprint === incident.owner.fingerprint && mod.files[incident.entry] === incident.owner.entryHash);
        if (matches.length !== 1 || findings.some(finding => finding.modId === matches[0].id)) continue;
        const mod = matches[0];
        findings.push({ id: incident.id, entry: incident.entry, error: incident.error, crashedAt: incident.crashedAt,
            gameBuild: incident.gameBuild, attribution: incident.attribution, modId: mod.id, modName: mod.name, enabled: mod.enabled });
    }
    return findings;
}

/** Recorded context survives dismissal and installation of an updated mod. */
export async function getCrashReportContext(gamePath: string, crashedAt: number, entry: string): Promise<{
    gameBuild: string; suspectedMod: string; attribution: 'recorded' | 'last-known';
} | null> {
    const value = await loadState(gamePath);
    const incident = value.incidents.find(item => item.crashedAt === crashedAt && item.entry === entry);
    return incident ? { gameBuild: incident.gameBuild, suspectedMod: incident.owner.name, attribution: incident.attribution } : null;
}

function publishFindings(next: CrashAdvisory[]): void {
    if (JSON.stringify(next) === JSON.stringify(active)) return;
    active = next;
    for (const window of BrowserWindow.getAllWindows()) {
        if (!window.isDestroyed()) window.webContents.send('crash-advisories-changed', active);
    }
}

function publish(value: State): void { publishFindings(projectAdvisories(value)); }

/** Never await this from a launch or mod mutation. It writes diagnostics only. */
export function refreshCrashAdvisories(): Promise<void> {
    if (refreshing) { pendingChange = true; return refreshing; }
    refreshing = (async () => {
        do {
            pendingChange = false;
            const path = getActiveDeadlockPath();
            if (!path) { publishFindings([]); return; }
            const gamePath = resolve(path);
            const value = await loadState(gamePath);
            for (const launch of launchObservations.splice(0)) {
                if (launch.gamePath === gamePath) await captureConfiguration(gamePath, value, launch);
            }
            // Inspect against history BEFORE recording Steam's post-crash mount reset.
            await inspectReports(gamePath, value);
            await captureConfiguration(gamePath, value);
            publish(value);
            await saveState(value);
            // Deleted files should not accumulate in a long-running app's cache.
            if (fileCache.size > 2000) fileCache.clear();
            if (inspected.size > 500) inspected.clear();
        } while (pendingChange);
    })().catch(error => {
        console.warn('[crash-advisories] Diagnostic refresh skipped:', error instanceof Error ? error.message : 'Unknown error');
    }).finally(() => {
        refreshing = undefined;
    });
    return refreshing;
}

export function getCrashAdvisories(): CrashAdvisory[] { return active; }

/** Queue the prelaunch configuration without waiting on diagnostic I/O. */
export function recordCrashLaunchConfiguration(gamePath: string, mods: Mod[]): void {
    launchObservations.push({ gamePath: resolve(gamePath), mods: mods.map(mod => ({ ...mod })), observedAt: Date.now() });
    void refreshCrashAdvisories();
}

export async function dismissCrashAdvisory(id: string): Promise<CrashAdvisory[]> {
    // Serializing with refresh prevents a stale disk write resurrecting dismissals.
    if (refreshing) await refreshing;
    if (state) {
        const incident = state.incidents.find(candidate => candidate.id === id);
        if (incident) incident.dismissed = true;
        publish(state);
        await saveState(state).catch(() => { /* Session dismissal remains effective. */ });
    }
    return active;
}

export function startCrashAdvisories(): void {
    if (started) return;
    started = true;
    observeModChanges(() => { void refreshCrashAdvisories(); });
    const timer = setInterval(() => { void refreshCrashAdvisories(); }, 15000);
    timer.unref();
    void refreshCrashAdvisories();
}
