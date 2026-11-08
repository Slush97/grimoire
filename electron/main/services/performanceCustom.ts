import { app } from 'electron';
import { randomUUID } from 'crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs';
import { mkdtemp, rm, writeFile } from 'fs/promises';
import { basename, join } from 'path';
import { tmpdir } from 'os';
import type { CustomPerformanceImport, CustomPerformanceToggle, PerformanceRepositoryInspection } from '../../../src/types/performanceCustom';
import { isPerformanceConfigPath, isPerformanceVideoPath, standalonePerformanceAddons, suggestedPerformanceVideoPath } from '../../../src/lib/performanceRepository';
import { BASELINE } from './performanceConfigData';
import { githubRateLimiter } from './rateLimiter';
import { buildCustomPerformancePreset, parsePerformanceRepository, validatePerformancePath, validatePerformanceToggles, type CustomPerformanceRecord } from './performanceCustomCore';

function storePath() { return join(app.getPath('userData'), 'performance-custom.json'); }

function readRecords(): CustomPerformanceRecord[] {
    if (!existsSync(storePath())) return [];
    // Do not silently overwrite a damaged store on the next import.
    const records: unknown = JSON.parse(readFileSync(storePath(), 'utf8'));
    if (!Array.isArray(records)) throw new Error('Invalid custom performance preset store.');
    return records as CustomPerformanceRecord[];
}

function writeRecords(records: CustomPerformanceRecord[]) {
    mkdirSync(app.getPath('userData'), { recursive: true });
    const file = storePath();
    writeFileSync(`${file}.tmp`, JSON.stringify(records), 'utf8');
    renameSync(`${file}.tmp`, file);
}

function getRecord(id: string) {
    const record = readRecords().find((entry) => entry.id === id);
    if (!record) throw new Error('Custom preset not found.');
    return record;
}

/** Bound response bodies while streaming, not after allocating the whole file. */
async function githubBytes(url: string, maxBytes: number, timeoutMs = 60_000): Promise<Buffer> {
    await githubRateLimiter.acquire();
    const response = await fetch(url, {
        headers: { 'User-Agent': 'grimoire-mod-manager' },
        signal: AbortSignal.timeout(timeoutMs), redirect: 'error',
    });
    if (!response.ok || !response.body) throw new Error(`GitHub request failed (${response.status}).`);
    const reader = response.body.getReader();
    let size = 0;
    const chunks: Uint8Array[] = [];
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            size += value.length;
            if (size > maxBytes) throw new Error('Repository file exceeds the size limit.');
            chunks.push(value);
        }
    } finally { await reader.cancel(); }
    return Buffer.concat(chunks);
}

function rawUrl(repo: string, sha: string, path: string) {
    return `https://raw.githubusercontent.com/${parsePerformanceRepository(repo)}/${sha}/${validatePerformancePath(path).split('/').map(encodeURIComponent).join('/')}`;
}

async function inspectRepository(repository: string, requestedCommit?: string) {
    const repo = parsePerformanceRepository(repository);
    if (requestedCommit !== undefined && !/^[a-f0-9]{40}$/.test(requestedCommit)) throw new Error('Invalid repository commit.');
    const endpoint = requestedCommit ? `/commits/${requestedCommit}` : '/commits?per_page=1';
    const response = JSON.parse((await githubBytes(`https://api.github.com/repos/${repo}${endpoint}`, 1_000_000)).toString());
    const head = requestedCommit ? response : response?.[0];
    const commit = head?.sha;
    const date = head?.commit?.committer?.date;
    if (!/^[a-f0-9]{40}$/.test(commit) || typeof date !== 'string') throw new Error('Could not resolve the repository commit.');
    if (requestedCommit && commit !== requestedCommit) throw new Error('Repository commit did not match the selection.');
    const tree = JSON.parse((await githubBytes(`https://api.github.com/repos/${repo}/git/trees/${commit}?recursive=1`, 8_000_000)).toString());
    if (tree.truncated || !Array.isArray(tree.tree)) throw new Error('Repository is too large to inspect.');
    const files = (tree.tree as Array<{ path: string; type: string; mode: string; size: number }>).filter((entry) =>
        entry.type === 'blob' && (entry.mode === '100644' || entry.mode === '100755') && Number.isSafeInteger(entry.size) && entry.size >= 0)
        .flatMap(({ path, size }) => {
            // An unrelated file with an unsupported name must not hide usable presets.
            try { return [{ path: validatePerformancePath(path), size }]; }
            catch { return []; }
        });
    const inspection: PerformanceRepositoryInspection = {
        repository: repo, commit, date: date.slice(0, 10),
        configPaths: files.filter((file) => isPerformanceConfigPath(file.path)).map((file) => file.path),
        videoPaths: files.filter((file) => isPerformanceVideoPath(file.path)).map((file) => file.path),
        addons: standalonePerformanceAddons(files).filter((file) => file.size <= 128 * 1024 * 1024),
        unsupportedPaths: files.filter((file) => /\.(?:cfg|zip|rar|7z)$/i.test(file.path)).map((file) => file.path),
    };
    return { inspection, files };
}

export async function inspectPerformanceRepository(repository: string): Promise<PerformanceRepositoryInspection> {
    return (await inspectRepository(repository)).inspection;
}

export async function importPerformancePreset(input: CustomPerformanceImport) {
    const path = input.configPath === null ? null : validatePerformancePath(input.configPath.trim());
    if (path !== null && !isPerformanceConfigPath(path)) throw new Error('Choose a gameinfo.gi or gameinfo.txt file.');
    const name = input.name.trim();
    if (!name || name.length > 100) throw new Error('Enter a preset name (up to 100 characters).');
    const { inspection, files } = await inspectRepository(input.repository, input.commit);
    const { repository: repo, commit, date } = inspection;
    if (path && !inspection.configPaths.includes(path)) throw new Error('Config path was not found in the repository.');
    const videoPath = input.videoPath === undefined
        ? suggestedPerformanceVideoPath(path, inspection.videoPaths)
        : input.videoPath === null ? null : validatePerformancePath(input.videoPath);
    if (videoPath === undefined) throw new Error('Several video files match this config. Choose one before importing.');
    if (videoPath !== null && !inspection.videoPaths.includes(videoPath)) throw new Error('Video path was not found in the repository.');
    if (path === null && videoPath === null) throw new Error('Choose a gameinfo or video file to import.');
    for (const selected of [path, videoPath]) {
        if (selected && files.find((file) => file.path === selected)!.size > 1_000_000) throw new Error('Config file exceeds the size limit.');
    }
    const [config, baseline, video] = await Promise.all([
        path ? githubBytes(rawUrl(repo, commit, path), 1_000_000) : null,
        githubBytes(rawUrl(BASELINE.repo, BASELINE.commit, BASELINE.path), 1_000_000),
        videoPath ? githubBytes(rawUrl(repo, commit, videoPath), 1_000_000) : null,
    ]);
    const id = `custom-${randomUUID()}`;
    const record: CustomPerformanceRecord = {
        id, name, repo, configPath: path, videoPath, toggles: [],
        addons: inspection.addons,
        input: { presetId: id, refKind: 'prose', ref: commit.slice(0, 8), commit, date: date.slice(0, 10),
            baselineCommit: BASELINE.commit, baselineText: baseline.toString('utf8'), configText: (config ?? baseline).toString('utf8'),
            videoText: video?.toString('utf8') ?? null, now: new Date() },
    };
    const { summary } = buildCustomPerformancePreset(record);
    const records = readRecords();
    if (records.length >= 50) throw new Error('Remove a custom preset before adding another (limit 50).');
    writeRecords([...records, record]);
    return summary;
}

export function listCustomPerformancePresets() {
    return readRecords().map((record) => buildCustomPerformancePreset(record).summary);
}

export function resolveCustomPerformancePreset(id: string, version?: string | null) {
    if (!id.startsWith('custom-')) return null;
    const { preset } = buildCustomPerformancePreset(getRecord(id));
    if (version && version !== 'latest' && version !== preset.version) throw new Error('Custom preset version is unavailable.');
    return preset;
}

export function deleteCustomPerformancePreset(id: string) {
    getRecord(id);
    writeRecords(readRecords().filter((record) => record.id !== id));
}

export function saveCustomPerformanceToggles(id: string, toggles: CustomPerformanceToggle[]) {
    const records = readRecords();
    const record = records.find((entry) => entry.id === id);
    if (!record) throw new Error('Custom preset not found.');
    const available = buildCustomPerformancePreset(record).summary.custom!.availableConvars;
    record.toggles = validatePerformanceToggles(toggles, available);
    buildCustomPerformancePreset(record);
    writeRecords(records);
}

export function markPerformanceAddonImported(id: string, path: string) {
    const records = readRecords();
    const record = records.find((entry) => entry.id === id);
    if (!record || !record.addons.some((addon) => addon.path === path)) return;
    record.importedAddons = [...new Set([...(record.importedAddons ?? []), path])];
    writeRecords(records);
}

/** Download only a user-selected file from the inspected immutable tree.
 * The caller installs it through the normal VPK import pipeline, then cleans up. */
export async function preparePerformanceAddon(id: string, path: string) {
    const record = getRecord(id);
    const addon = record.addons.find((entry) => entry.path === path);
    if (!addon || addon.size > 128 * 1024 * 1024) throw new Error('Addon is unavailable or larger than 128 MiB.');
    const bytes = await githubBytes(rawUrl(record.repo, record.input.commit, addon.path), 128 * 1024 * 1024, 15 * 60_000);
    if (bytes.length !== addon.size) throw new Error('Addon size does not match the repository.');
    const dir = await mkdtemp(join(tmpdir(), 'grimoire-performance-'));
    const cleanup = () => rm(dir, { recursive: true, force: true });
    const vpkPath = join(dir, basename(addon.path));
    try { await writeFile(vpkPath, bytes); } catch (error) { await cleanup(); throw error; }
    return { item: { vpkPath, name: `${record.name}: ${addon.path}` }, cleanup };
}
