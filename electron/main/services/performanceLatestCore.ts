// Pure core of the "track latest" path for performance presets: build a
// runtime release from freshly fetched upstream texts, cache it on disk, and
// adapt it into the flat PerformancePreset shape the patcher applies. No
// electron or network imports; performanceLatest.ts owns those and injects
// what this module needs, which is what makes the safety gates testable.
//
// Trust model, in one paragraph: the bundled presets are generated from
// commits pinned by SHA and reviewed by a human at every refresh. A tracked
// latest release has neither pin nor reviewer, so this path compensates with
// mechanical gates: the fetched texts must look structurally like gameinfo.gi
// files (validateGameinfoText), the diff must stay within plausible bounds
// (validateGeneratedBody), the same exclusion tables the bundled presets use
// apply (CLASSIFICATION, including the dangerous-key patterns), and any
// gameplay-shaped key nobody has classified is withheld from the body rather
// than written. The in-place marker system is the final backstop: whatever
// was applied, Remove restores the stock file from the markers alone.
import { createHash } from 'crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import {
    CLASSIFICATION,
    getFamily,
    hasVersion,
    type OptInGroup,
    type PerformancePreset,
    type PerformancePresetFamily,
    type SectionOp,
} from './performanceConfigData';
import {
    generatePresetBody,
    parseConfig,
    validateGameinfoText,
    validateGeneratedBody,
} from './performancePresetGen';

/** One runtime-fetched upstream release of a preset, in a shape close enough
 *  to the bundled PresetRelease that the patcher cannot tell them apart. */
export interface LatestRelease {
    presetId: string;
    /** Version string written into the gameinfo.gi marker (charset [\w.]+).
     *  A tag-pinned source uses the tag with any leading 'v' stripped; a
     *  prose source (no tags to name a version) uses the short commit sha. */
    version: string;
    /** Human-facing ref: the tag itself, or the short sha for prose sources. */
    ref: string;
    refKind: 'tag' | 'prose';
    commit: string;
    /** Commit date, yyyy-mm-dd. */
    date: string;
    /** Commit of the stock baseline the diff was computed against. */
    baselineCommit: string;
    /** sha256 of the fetched upstream config file. */
    sha256: string;
    /** ISO timestamp of the fetch that produced this entry. */
    fetchedAt: string;
    sectionOps: SectionOp[];
    convars: Array<[string, string]>;
    optIn: Array<{ key: string; value: string; group: string }>;
    /** Keys held out of the body: gameplay-shaped keys nobody has classified
     *  yet, or opt-in keys upstream moved outside the ConVars block. They are
     *  simply never written; the UI reports the count. */
    withheld: string[];
    /** Set when the fetched file is byte-identical to a bundled release, whose
     *  version identity is then reused: the marker should say "v4.6", not a
     *  sha, when the content IS v4.6. */
    matchesBundled?: string;
}

interface LatestCacheFile {
    /** Newest known release per preset id (the tracked latest). */
    byPreset: Record<string, LatestRelease>;
    /** Last successful upstream check per preset id (ISO), for throttling. */
    checkedAt: Record<string, string>;
    /** Historical releases fetched on demand, per preset id, most recently
     *  fetched first. What lets a user pin an old upstream version and keep
     *  applying it offline: the built release persists here. */
    history: Record<string, LatestRelease[]>;
}

/** Fetched historical releases kept per preset. Generous, because an evicted
 *  release that a user still has pinned degrades to the bundled newest on the
 *  next apply; the cap only exists to stop the cache growing without bound. */
const HISTORY_CAP = 32;

const CACHE_FILENAME = 'performance-latest.json';

export function latestCachePath(dir: string): string {
    return join(dir, CACHE_FILENAME);
}

export function readLatestCache(dir: string): LatestCacheFile {
    try {
        const raw = readFileSync(latestCachePath(dir), 'utf-8');
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
            return {
                byPreset: parsed.byPreset ?? {},
                checkedAt: parsed.checkedAt ?? {},
                history: parsed.history ?? {},
            };
        }
    } catch {
        // Missing or corrupt cache reads as empty; the next check rebuilds it.
    }
    return { byPreset: {}, checkedAt: {}, history: {} };
}

export function writeLatestCache(dir: string, cache: LatestCacheFile): void {
    try {
        const file = latestCachePath(dir);
        if (!existsSync(dirname(file))) mkdirSync(dirname(file), { recursive: true });
        writeFileSync(file, JSON.stringify(cache), 'utf-8');
    } catch {
        // Best-effort: a failed cache write only costs a refetch next time.
    }
}

export function getCachedLatest(dir: string, presetId: string): LatestRelease | null {
    return readLatestCache(dir).byPreset[presetId] ?? null;
}

export function getCachedHistory(dir: string, presetId: string): LatestRelease[] {
    return readLatestCache(dir).history[presetId] ?? [];
}

/** Record a historical fetch, deduplicating by version (a refetch replaces the
 *  old entry and moves it to the front). */
export function upsertHistory(dir: string, release: LatestRelease): void {
    const cache = readLatestCache(dir);
    const rest = (cache.history[release.presetId] ?? []).filter(
        (r) => r.version !== release.version
    );
    cache.history[release.presetId] = [release, ...rest].slice(0, HISTORY_CAP);
    writeLatestCache(dir, cache);
}

/** How stale a successful check may be before the next one hits the network
 *  again. Checks run on user actions (opening the card, applying), so this is
 *  a debounce, not a schedule. */
const CHECK_TTL_MS = 5 * 60 * 1000;

export function isCheckFresh(dir: string, presetId: string, now: Date): boolean {
    const at = readLatestCache(dir).checkedAt[presetId];
    if (!at) return false;
    const t = Date.parse(at);
    return Number.isFinite(t) && now.getTime() - t < CHECK_TTL_MS;
}

const sha256 = (text: string) => createHash('sha256').update(text, 'utf-8').digest('hex');

/** The version string a runtime release writes into the marker. Must satisfy
 *  the marker charset ([\w.]+). */
function versionFor(refKind: 'tag' | 'prose', ref: string, commit: string): string {
    return refKind === 'tag' ? ref.replace(/^v/, '') : commit.slice(0, 8);
}

export interface BuildLatestInput {
    presetId: string;
    refKind: 'tag' | 'prose';
    /** Tag name for tag sources; ignored for prose (the sha names the ref). */
    ref: string;
    commit: string;
    /** Commit date, yyyy-mm-dd. */
    date: string;
    baselineCommit: string;
    baselineText: string;
    configText: string;
    now: Date;
}

export type BuildLatestResult =
    | { ok: true; release: LatestRelease }
    | { ok: false; error: string };

/** Turn fetched upstream texts into a cached runtime release, or refuse with a
 *  reason. Refusal means the caller falls back to the bundled preset. */
export function buildLatestRelease(input: BuildLatestInput): BuildLatestResult {
    const family = getFamily(input.presetId);
    if (family.id !== input.presetId) {
        return { ok: false, error: `unknown preset id ${input.presetId}` };
    }

    for (const [text, label] of [
        [input.baselineText, 'baseline gameinfo.gi'],
        [input.configText, 'upstream config'],
    ] as const) {
        const problem = validateGameinfoText(text, label);
        if (problem) return { ok: false, error: problem };
    }

    const configHash = sha256(input.configText);
    // Byte-identical to a bundled release: reuse its version identity so the
    // marker names the release a human actually reviewed. The body is still
    // rebuilt from the fetched texts (the baseline may be newer than the one
    // the bundled diff used, and a diff against today's stock file is the one
    // that can be patched into the file the user actually has).
    const bundledTwin = family.releases.find((r) => r.sha256 === configHash);

    const baseline = parseConfig(input.baselineText);
    const config = parseConfig(input.configText);
    const body = generatePresetBody(baseline, config, CLASSIFICATION);
    const bodyProblem = validateGeneratedBody(baseline, config, body);
    if (bodyProblem) return { ok: false, error: bodyProblem };

    const ref = input.refKind === 'tag' ? input.ref : input.commit.slice(0, 8);
    let version = bundledTwin?.version ?? versionFor(input.refKind, input.ref, input.commit);
    // A version string that collides with a DIFFERENT bundled release would
    // make the marker ambiguous (resolution prefers bundled definitions).
    // Upstreams reuse version-ish tags rarely, but rarely is not never.
    if (!bundledTwin && hasVersion(input.presetId, version)) {
        version = `${version}.${input.commit.slice(0, 8)}`;
    }

    const release: LatestRelease = {
        presetId: input.presetId,
        version,
        ref,
        refKind: input.refKind,
        commit: input.commit,
        date: input.date,
        baselineCommit: input.baselineCommit,
        sha256: configHash,
        fetchedAt: input.now.toISOString(),
        sectionOps: body.sectionOps,
        convars: body.convars,
        optIn: body.optIn,
        withheld: [...new Set(body.problems.map((p) => p.key))],
        ...(bundledTwin ? { matchesBundled: bundledTwin.version } : {}),
    };
    return { ok: true, release };
}

/** Adapt a runtime release into the flat shape the patcher applies. From here
 *  on, nothing downstream can tell it from a bundled release. */
export function latestAsPreset(release: LatestRelease): PerformancePreset {
    const family = getFamily(release.presetId);
    return {
        id: family.id,
        name: family.name,
        version: release.version,
        tier: family.tier,
        author: family.author,
        ...(family.unstable ? { unstable: true } : {}),
        upstream: {
            ...family.upstream,
            ref: release.ref,
            refKind: release.refKind,
            commit: release.commit,
        },
        sectionOps: release.sectionOps,
        convars: release.convars,
        // Groups come from the same manifest tables the bundled data was
        // generated with, so the cast is between two views of one source.
        optIn: release.optIn.map((o) => ({ ...o, group: o.group as OptInGroup })),
    };
}

/** Resolve a preset at a version the bundle does not know, from the cache:
 *  the tracked latest (which alone answers the 'latest' sentinel), then the
 *  fetched historical releases. Used for markers written by a track-latest or
 *  pinned-historical apply. */
export function resolveCachedPreset(
    dir: string,
    presetId: string,
    version: string | null | undefined
): PerformancePreset | null {
    const cached = getCachedLatest(dir, presetId);
    if (cached && (version === 'latest' || version === cached.version)) {
        return latestAsPreset(cached);
    }
    if (version && version !== 'latest') {
        const historical = getCachedHistory(dir, presetId).find((r) => r.version === version);
        if (historical) return latestAsPreset(historical);
    }
    return null;
}

/** True when applying `release` would write the same body the newest bundled
 *  release writes; the card uses it to say "already up to date". */
export function latestMatchesBundledNewest(
    family: PerformancePresetFamily,
    release: LatestRelease
): boolean {
    return release.matchesBundled === family.releases[0].version;
}
