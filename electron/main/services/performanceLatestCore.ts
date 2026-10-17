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
    generateVideoBody,
    keyExcluded,
    parseConfig,
    parseVideoConfig,
    pathExcluded,
    validateGameinfoText,
    validateGeneratedBody,
    validateVideoText,
} from './performancePresetGen';

/** One runtime-fetched upstream release of a preset, in a shape close enough
 *  to the bundled PresetRelease that the patcher cannot tell them apart. */
export interface LatestRelease {
    presetId: string;
    /** Version string written into the gameinfo.gi marker. A tag-pinned source
     *  uses the tag with any leading 'v' stripped; a prose source (no tags to
     *  name a version) uses the short commit sha. */
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
    /** Classified settings from the video.txt upstream ships next to the
     *  config; empty when it ships none. Absent on entries cached before
     *  video.txt support, which are rebuilt on the next check. */
    video?: Array<[string, string]>;
    /** sha256 of that video.txt, null when there is none. */
    videoSha256?: string | null;
    /** For a preset that ships several video.txt files, the ones besides the
     *  default (`video`) that this release ships. Absent on entries cached
     *  before variant support, which such a preset rebuilds on the next check. */
    videoVariants?: Array<{ id: string; sha256: string; video: Array<[string, string]> }>;
    /** Keys held out of the body: gameplay-shaped keys nobody has classified
     *  yet, or opt-in keys upstream moved outside the ConVars block. They are
     *  simply never written; the UI reports the count. */
    withheld: string[];
    /** Set when the fetched file is byte-identical to a bundled release, whose
     *  version identity is then reused: the marker should say "v4.6", not a
     *  sha, when the content IS v4.6. */
    matchesBundled?: string;
    /** Fingerprint of the classification rules the body was built with. Absent
     *  on entries cached before it existed, which are rebuilt on the next check. */
    classification?: string;
}

interface LatestCacheFile {
    /** Newest known release per preset id (the tracked latest). */
    byPreset: Record<string, LatestRelease>;
    /** Last successful upstream check per preset id (ISO), for throttling. */
    checkedAt: Record<string, string>;
}

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
            };
        }
    } catch {
        // Missing or corrupt cache reads as empty; the next check rebuilds it.
    }
    return { byPreset: {}, checkedAt: {} };
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

// A body cached under other rules is rebuilt on the next check. Re-filtering in
// latestAsPreset can drop a newly excluded key, but it cannot bring back one
// that was excluded when the body was fetched (r_render_portals, 2026-10-16).
const CLASSIFICATION_HASH = sha256(JSON.stringify(CLASSIFICATION)).slice(0, 16);

/** The version string a runtime release writes into the marker. Git ref names
 *  can contain punctuation such as '-' and '/', so the marker parser treats
 *  the commit delimiter (` @<sha>`) as the boundary instead of restricting
 *  this value to a smaller synthetic charset. */
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
    /** The video.txt next to the config upstream, null when there is none.
     *  For a preset that ships several, the default variant's. */
    videoText: string | null;
    /** The other video.txt variants found next to the config. */
    videoVariantTexts?: Array<{ id: string; text: string }>;
    now: Date;
}

export type BuildLatestResult =
    | { ok: true; release: LatestRelease }
    | { ok: false; error: string };

/** Turn fetched upstream texts into a cached runtime release, or refuse with a
 *  reason. Refusal means the caller falls back to the bundled preset. */
export function buildLatestRelease(input: BuildLatestInput): BuildLatestResult {
    const family = getFamily(input.presetId);
    const verbatim = family.upstream.verbatimVideo === true;
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
    const variantTexts = family.upstream.videoFiles ? (input.videoVariantTexts ?? []) : [];
    if (input.videoText === null && variantTexts.length) {
        return { ok: false, error: `video.txt variant ${variantTexts[0].id} ships without the default one` };
    }
    const videoTexts: Array<[string | null, string]> = [
        [input.videoText, 'upstream video.txt'],
        ...variantTexts.map((v): [string, string] => [v.text, `upstream ${v.id} video.txt`]),
    ];
    for (const [text, label] of videoTexts) {
        if (text === null) continue;
        const problem = validateVideoText(text, label);
        if (problem) return { ok: false, error: problem };
    }

    const configHash = sha256(input.configText);
    const videoHash = input.videoText === null ? null : sha256(input.videoText);
    const variants = variantTexts.map((v) => ({
        id: v.id,
        sha256: sha256(v.text),
        video: generateVideoBody(parseVideoConfig(v.text), CLASSIFICATION, verbatim),
    }));
    const variantKey = (list: ReadonlyArray<{ id: string; sha256: string }>) =>
        list.map((v) => `${v.id}:${v.sha256}`).join(',');
    // Byte-identical to a bundled release: reuse its version identity so the
    // marker names the release a human actually reviewed. The body is still
    // rebuilt from the fetched texts (the baseline may be newer than the one
    // the bundled diff used, and a diff against today's stock file is the one
    // that can be patched into the file the user actually has).
    const bundledTwin = family.releases.find(
        (r) =>
            r.sha256 === configHash &&
            r.videoSha256 === videoHash &&
            variantKey(r.videoVariants ?? []) === variantKey(variants)
    );

    const baseline = parseConfig(input.baselineText);
    const config = parseConfig(input.configText);
    const body = generatePresetBody(baseline, config, CLASSIFICATION);
    const bodyProblem = validateGeneratedBody(baseline, config, body);
    if (bodyProblem) return { ok: false, error: bodyProblem };
    const video =
        input.videoText === null
            ? { settings: [], problems: [] }
            : generateVideoBody(parseVideoConfig(input.videoText), CLASSIFICATION, verbatim);

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
        video: video.settings,
        videoSha256: videoHash,
        ...(family.upstream.videoFiles
            ? {
                  videoVariants: variants.map((v) => ({
                      id: v.id,
                      sha256: v.sha256,
                      video: v.video.settings,
                  })),
              }
            : {}),
        withheld: [
            ...new Set(
                [...body.problems, ...video.problems, ...variants.flatMap((v) => v.video.problems)].map(
                    (p) => p.key
                )
            ),
        ],
        ...(bundledTwin ? { matchesBundled: bundledTwin.version } : {}),
        classification: CLASSIFICATION_HASH,
    };
    return { ok: true, release };
}

/** Adapt a runtime release into the flat shape the patcher applies. From here
 *  on, nothing downstream can tell it from a bundled release. */
export function latestAsPreset(release: LatestRelease): PerformancePreset {
    const family = getFamily(release.presetId);
    const verbatim = family.upstream.verbatimVideo === true;
    const video = generateVideoBody(release.video ?? [], CLASSIFICATION, verbatim).settings;
    const defaultVariant = family.upstream.videoFiles?.[0].variant;
    const kept = (key: string) => !keyExcluded(key, CLASSIFICATION);
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
        // A cached body was classified by whichever Grimoire fetched it.
        // Today's exclusions still apply: RenderModes and r_lightmap_size were
        // excluded after older builds had cached bodies that wrote to them.
        sectionOps: release.sectionOps.filter(
            (op) => !pathExcluded(op.path, CLASSIFICATION.excludeSections) && kept(op.key)
        ),
        convars: release.convars.filter(([key]) => kept(key)),
        // Groups come from the same manifest tables the bundled data was
        // generated with, so the cast is between two views of one source.
        optIn: release.optIn.map((o) => ({ ...o, group: o.group as OptInGroup })),
        // Reclassified for the same reason as sectionOps.
        video,
        ...(defaultVariant && release.videoVariants?.length
            ? {
                  videoVariants: [
                      { id: defaultVariant, video },
                      ...release.videoVariants.map((v) => ({
                          id: v.id,
                          video: generateVideoBody(v.video, CLASSIFICATION, verbatim).settings,
                      })),
                  ],
              }
            : {}),
    };
}

/** Resolve a preset at a version the bundle does not know from the cached
 *  tracked latest, which also answers the 'latest' sentinel. Used for markers
 *  written by a track-latest apply. */
export function resolveCachedPreset(
    dir: string,
    presetId: string,
    version: string | null | undefined
): PerformancePreset | null {
    const cached = getCachedLatest(dir, presetId);
    if (cached && (version === 'latest' || version === cached.version)) {
        return latestAsPreset(cached);
    }
    return null;
}

/** Whether a cached tracked-latest entry still describes `commit` diffed
 *  against `baselineCommit`. An entry cached before video.txt support has no
 *  `video`, and one cached before variant support has no `videoVariants`
 *  (for a preset that ships several): both are rebuilt rather than applied
 *  without those video settings. */
export function cachedLatestIsCurrent(
    family: PerformancePresetFamily,
    cached: LatestRelease,
    commit: string,
    baselineCommit: string
): boolean {
    return (
        cached.commit === commit &&
        cached.baselineCommit === baselineCommit &&
        cached.classification === CLASSIFICATION_HASH &&
        cached.video !== undefined &&
        (!family.upstream.videoFiles || cached.videoVariants !== undefined)
    );
}

/** True when applying `release` would write the same body the newest bundled
 *  release writes; the card uses it to say "already up to date". */
export function latestMatchesBundledNewest(
    family: PerformancePresetFamily,
    release: LatestRelease
): boolean {
    return release.matchesBundled === family.releases[0].version;
}
