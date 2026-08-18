// Network half of "track latest" for performance presets: resolve what the
// newest upstream release is (GitHub API), fetch it plus the current stock
// baseline (raw.githubusercontent), and hand both to performanceLatestCore to
// gate, diff, and cache. Runs only on user actions (opening the Performance
// card with tracking on, or applying); there is no background polling, and a
// fresh install with the feature off never touches the network from here.
//
// Sources resolve differently on purpose:
//   - A tag-pinned source (OptiLock) tracks its newest *published release*,
//     which is a deliberate upstream act.
//   - A prose source (OptimizationLock publishes no tags) tracks the newest
//     commit touching the config file on the default branch. That is exactly
//     as unreviewed as it sounds, which is why performanceLatestCore's gates
//     exist and why anything they cannot vouch for is withheld, not written.
import { app } from 'electron';
import {
    BASELINE,
    getFamily,
    PRESETS,
    type PerformancePresetFamily,
} from './performanceConfigData';
import {
    buildLatestRelease,
    getCachedLatest,
    isCheckFresh,
    latestMatchesBundledNewest,
    readLatestCache,
    resolveCachedPreset,
    writeLatestCache,
    type LatestRelease,
} from './performanceLatestCore';
import { setExtraPresetResolver } from './performanceConfig';
import { githubRateLimiter } from './rateLimiter';
import type { PerformanceLatestInfo } from '../../../src/types/electron';

const FETCH_TIMEOUT_MS = 20_000;
// Identifies the client to GitHub, which rejects UA-less API requests. Static
// string, no version or install identifier: this is not telemetry.
const USER_AGENT = 'grimoire-mod-manager';

function cacheDir(): string {
    return app.getPath('userData');
}

// Markers written by a track-latest apply carry a version the bundle does not
// know; this lets the patcher's harvest/status paths resolve them from the
// cache instead of falling back to a definition that never wrote the file.
setExtraPresetResolver((presetId, version) => resolveCachedPreset(cacheDir(), presetId, version));

async function githubFetch(url: string, accept: string): Promise<Response> {
    await githubRateLimiter.acquire();
    return fetch(url, {
        headers: { Accept: accept, 'User-Agent': USER_AGENT },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
}

async function githubJson(url: string): Promise<unknown> {
    const res = await githubFetch(url, 'application/vnd.github+json');
    if (!res.ok) throw new Error(`GitHub API ${res.status} for ${url}`);
    return res.json();
}

async function fetchRaw(repo: string, commit: string, path: string): Promise<string> {
    const url = `https://raw.githubusercontent.com/${repo}/${commit}/${path
        .split('/')
        .map(encodeURIComponent)
        .join('/')}`;
    const res = await githubFetch(url, 'text/plain');
    if (!res.ok) throw new Error(`Fetch ${res.status} for ${repo}@${commit.slice(0, 8)} ${path}`);
    return res.text();
}

/** Newest commit on the default branch that touched `path`. */
async function latestCommitFor(
    repo: string,
    path: string
): Promise<{ sha: string; date: string }> {
    const url = `https://api.github.com/repos/${repo}/commits?path=${encodeURIComponent(path)}&per_page=1`;
    const list = (await githubJson(url)) as Array<{
        sha: string;
        commit: { author?: { date?: string }; committer?: { date?: string } };
    }>;
    const head = Array.isArray(list) ? list[0] : undefined;
    const date = head?.commit?.author?.date ?? head?.commit?.committer?.date;
    if (!head?.sha || !date) throw new Error(`No commit history for ${repo} ${path}`);
    return { sha: head.sha, date: date.slice(0, 10) };
}

/** The commit a tag points at, dereferencing annotated tags. */
async function resolveTag(repo: string, tag: string): Promise<string> {
    const ref = (await githubJson(
        `https://api.github.com/repos/${repo}/git/ref/tags/${encodeURIComponent(tag)}`
    )) as { object: { type: string; sha: string } };
    if (ref.object.type !== 'tag') return ref.object.sha;
    const ann = (await githubJson(
        `https://api.github.com/repos/${repo}/git/tags/${ref.object.sha}`
    )) as { object: { sha: string } };
    return ann.object.sha;
}

async function commitDate(repo: string, sha: string): Promise<string> {
    const data = (await githubJson(`https://api.github.com/repos/${repo}/commits/${sha}`)) as {
        commit: { author?: { date?: string }; committer?: { date?: string } };
    };
    const date = data.commit?.author?.date ?? data.commit?.committer?.date;
    if (!date) throw new Error(`No commit date for ${repo}@${sha.slice(0, 8)}`);
    return date.slice(0, 10);
}

interface ResolvedUpstream {
    refKind: 'tag' | 'prose';
    ref: string;
    commit: string;
    date: string;
}

async function resolveUpstream(family: PerformancePresetFamily): Promise<ResolvedUpstream> {
    const repo = family.upstream.repo;
    // The source's ref discipline is a property of the source, recorded on
    // every bundled release; the newest one speaks for the family.
    if (family.releases[0].refKind === 'tag') {
        const release = (await githubJson(
            `https://api.github.com/repos/${repo}/releases/latest`
        )) as { tag_name?: string };
        if (!release.tag_name) throw new Error(`No published releases for ${repo}`);
        const commit = await resolveTag(repo, release.tag_name);
        return { refKind: 'tag', ref: release.tag_name, commit, date: await commitDate(repo, commit) };
    }
    const head = await latestCommitFor(repo, family.upstream.path);
    return { refKind: 'prose', ref: head.sha.slice(0, 8), commit: head.sha, date: head.date };
}

function toInfo(presetId: string, cached: LatestRelease | null, error?: string): PerformanceLatestInfo {
    return {
        presetId,
        version: cached?.version ?? null,
        ref: cached?.ref ?? null,
        refKind: cached?.refKind ?? null,
        commit: cached?.commit ?? null,
        date: cached?.date ?? null,
        fetchedAt: cached?.fetchedAt ?? null,
        withheldCount: cached?.withheld.length ?? 0,
        matchesBundled:
            cached && latestMatchesBundledNewest(getFamily(presetId), cached)
                ? cached.matchesBundled!
                : null,
        error: error ?? null,
    };
}

/** What the cache already knows, without touching the network. */
export function getPerformanceLatestInfo(presetId: string): PerformanceLatestInfo {
    return toInfo(presetId, getCachedLatest(cacheDir(), presetId));
}

/** Resolve and fetch the newest upstream release of `presetId`, updating the
 *  cache. Network errors degrade to whatever the cache already holds, with the
 *  error carried alongside: the caller then applies bundled or cached data,
 *  which is the designed offline behavior, not a failure of it. */
export async function checkPerformanceLatest(
    presetId: string,
    force = false
): Promise<PerformanceLatestInfo> {
    const dir = cacheDir();
    if (!PRESETS.some((p) => p.id === presetId)) {
        return toInfo(presetId, null, `Unknown preset id: ${presetId}`);
    }
    const now = new Date();
    if (!force && isCheckFresh(dir, presetId, now)) {
        return toInfo(presetId, getCachedLatest(dir, presetId));
    }

    const family = getFamily(presetId);
    try {
        const upstream = await resolveUpstream(family);
        const baselineHead = await latestCommitFor(BASELINE.repo, BASELINE.path);

        const cache = readLatestCache(dir);
        const cached = cache.byPreset[presetId] ?? null;
        if (
            cached &&
            cached.commit === upstream.commit &&
            cached.baselineCommit === baselineHead.sha
        ) {
            cache.checkedAt[presetId] = now.toISOString();
            writeLatestCache(dir, cache);
            return toInfo(presetId, cached);
        }

        const [baselineText, configText] = await Promise.all([
            fetchRaw(BASELINE.repo, baselineHead.sha, BASELINE.path),
            fetchRaw(family.upstream.repo, upstream.commit, family.upstream.path),
        ]);

        const built = buildLatestRelease({
            presetId,
            refKind: upstream.refKind,
            ref: upstream.ref,
            commit: upstream.commit,
            date: upstream.date,
            baselineCommit: baselineHead.sha,
            baselineText,
            configText,
            now,
        });
        if (!built.ok) {
            // Keep the previous good entry: a refused fetch must not evict a
            // release that already passed the gates.
            return toInfo(presetId, cached, `Upstream latest was rejected: ${built.error}`);
        }

        cache.byPreset[presetId] = built.release;
        cache.checkedAt[presetId] = now.toISOString();
        writeLatestCache(dir, cache);
        return toInfo(presetId, built.release);
    } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        return toInfo(presetId, getCachedLatest(dir, presetId), detail);
    }
}
