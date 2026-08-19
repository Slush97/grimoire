#!/usr/bin/env node
// Regenerate electron/main/services/performanceConfigData.ts from the pinned
// upstream configs listed in scripts/performance-presets.json.
//
// Grimoire never ships upstream's gameinfo.gi wholesale: it stores each preset
// as a section/key diff against the stock baseline and patches the user's own
// file in place. This script is what computes those diffs, so the bundled data
// is reproducible from pinned commits instead of hand-transcribed.
//
//   pnpm perf:presets                  regenerate the data file
//   pnpm perf:presets --check          verify the committed file is in sync
//   pnpm perf:presets --refresh all    move pins to each source's newest commit
//   pnpm perf:presets --refresh optilock-fps
//
// Every fetch is pinned to a commit SHA and verified against a recorded
// sha256. A mismatch is a hard failure: it means a tag moved, a branch was
// force-pushed, or the file changed under a pin we claimed was immutable.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
// The parse/diff/classify logic is shared with the runtime "track latest"
// path (performanceLatest.ts), so the app applies exactly the rules the
// bundled presets were built with. The package script runs this file through
// tsx so importing the shared TypeScript module also works on the repository's
// documented Node 20+ development baseline.
import {
    classificationFromManifest,
    generatePresetBody,
    parseConfig,
} from '../electron/main/services/performancePresetGen.ts';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = join(SCRIPT_DIR, '..');
const MANIFEST_PATH = join(SCRIPT_DIR, 'performance-presets.json');
const OUT_PATH = join(ROOT, 'electron/main/services/performanceConfigData.ts');

const argv = process.argv.slice(2);
const CHECK = argv.includes('--check');
const refreshIdx = argv.indexOf('--refresh');
const REFRESH = refreshIdx >= 0 ? (argv[refreshIdx + 1] ?? 'all') : null;

const sha256 = (text) => createHash('sha256').update(text, 'utf-8').digest('hex');

function fail(msg) {
    console.error(`\n  ${msg}\n`);
    process.exit(1);
}

// ---------------------------------------------------------------------------
// Fetch
// ---------------------------------------------------------------------------

async function fetchAt(repo, commit, path) {
    const url = `https://raw.githubusercontent.com/${repo}/${commit}/${path
        .split('/')
        .map(encodeURIComponent)
        .join('/')}`;
    const res = await fetch(url);
    if (!res.ok) fail(`Fetch failed (${res.status}) for ${repo}@${commit.slice(0, 8)} ${path}`);
    return res.text();
}

const GH = { headers: { Accept: 'application/vnd.github+json' } };

async function resolveHead(repo) {
    const res = await fetch(`https://api.github.com/repos/${repo}/commits/HEAD`, GH);
    if (!res.ok) fail(`Could not resolve HEAD for ${repo} (${res.status})`);
    return (await res.json()).sha;
}

// The commit a tag points at, dereferencing annotated tags. Returns null when
// the tag does not exist (upstream deleted or renamed it).
async function resolveTag(repo, tag) {
    const res = await fetch(
        `https://api.github.com/repos/${repo}/git/ref/tags/${encodeURIComponent(tag)}`,
        GH
    );
    if (res.status === 404) return null;
    if (!res.ok) fail(`Could not resolve tag ${tag} for ${repo} (${res.status})`);
    const ref = await res.json();
    if (ref.object.type !== 'tag') return ref.object.sha;
    const ann = await fetch(`https://api.github.com/repos/${repo}/git/tags/${ref.object.sha}`, GH);
    if (!ann.ok) fail(`Could not dereference annotated tag ${tag} for ${repo} (${ann.status})`);
    return (await ann.json()).object.sha;
}

async function latestReleaseTag(repo) {
    const res = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, GH);
    if (!res.ok) fail(`Could not read the latest release of ${repo} (${res.status})`);
    return (await res.json()).tag_name;
}

// Author date (yyyy-mm-dd) of a commit. Release order is decided by this, not
// by tag name: OptiLock tagged v4.0d a day after v4.1, so sorting by name would
// present a rollback list in the wrong order.
async function commitDate(repo, commit) {
    const res = await fetch(`https://api.github.com/repos/${repo}/commits/${commit}`, GH);
    if (!res.ok) fail(`Could not read commit ${commit.slice(0, 8)} of ${repo} (${res.status})`);
    return (await res.json()).commit.author.date.slice(0, 10);
}

// A source pinned with refKind 'tag' claims, in the UI, that the preset comes
// from a published release. Tags are mutable, so that claim can quietly become
// false. The commit is still what we fetch and the sha256 still gates content:
// this check exists so the *provenance* cannot lie either.
async function verifyTagPins(manifest) {
    for (const [name, source] of Object.entries(manifest.sources)) {
        if (source.refKind !== 'tag') continue;
        for (const release of source.releases) {
            const sha = await resolveTag(source.repo, release.ref);
            if (sha === release.commit) continue;
            fail(
                sha === null
                    ? `Source "${name}" claims tag ${release.ref}, which no longer exists in ${source.repo}.\n` +
                          `  The pin still fetches ${release.commit.slice(0, 8)}, but the card would show a\n` +
                          `  release that upstream deleted. Point "ref" at a live tag, or set\n` +
                          `  "refKind": "prose" to state the version without claiming a release.`
                    : `Source "${name}" pins ${release.commit.slice(0, 8)} but tag ${release.ref} now points at ${sha.slice(0, 8)}.\n` +
                          `  A moved tag means the release the card credits is not the code we ship.\n` +
                          `  Move the pin deliberately:  pnpm perf:presets --refresh ${name}`
            );
        }
    }
}

// Releases must be newest-first, because "roll back one step" is defined by
// position in this list. Upstream tag names do not reliably sort into release
// order, so the recorded date is the authority and a manifest that contradicts
// it is a bug, not a preference.
function verifyReleaseOrder(manifest) {
    for (const [name, source] of Object.entries(manifest.sources)) {
        const releases = source.releases;
        if (!Array.isArray(releases) || releases.length === 0) {
            fail(`Source "${name}" has no "releases" array.`);
        }
        for (let i = 1; i < releases.length; i++) {
            if (releases[i - 1].date >= releases[i].date) continue;
            fail(
                `Source "${name}" lists releases out of order: ${releases[i - 1].ref} ` +
                    `(${releases[i - 1].date}) comes before ${releases[i].ref} (${releases[i].date}).\n` +
                    `  Releases are newest-first because that is the order the version picker\n` +
                    `  offers as "roll back one step". Sort by date, not by tag name.`
            );
        }
        const dupes = releases.map((r) => r.ref).filter((r, i, a) => a.indexOf(r) !== i);
        if (dupes.length) fail(`Source "${name}" lists release ${dupes[0]} more than once.`);
    }
}

// ---------------------------------------------------------------------------
// Diff (shared logic in performancePresetGen.ts; this wrapper turns runtime
// "withhold" problems into the build-time hard failures they must be here)
// ---------------------------------------------------------------------------

function diffAgainstBaseline(baselineParsed, configParsed, classification, unclassifiedSink) {
    const body = generatePresetBody(baselineParsed, configParsed, classification);
    for (const problem of body.problems) {
        if (problem.kind === 'misplaced-opt-in') {
            fail(
                `Opt-in key ${problem.key} appears under section ${problem.where || 'GameInfo'}, ` +
                    `not ConVars. OptInControl has no path field, so this cannot be applied safely.`
            );
        }
        // Unclassified gameplay-shaped keys are aggregated across every preset
        // and release so the failure message lists all of them at once.
        unclassifiedSink(problem.key);
    }
    return body;
}

// ---------------------------------------------------------------------------
// Emit
// ---------------------------------------------------------------------------

const q = (s) => `'${String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

function emit(manifest, presets) {
    const L = [];
    L.push(`// GENERATED FILE - DO NOT EDIT BY HAND.`);
    L.push(`//`);
    L.push(`// Regenerate with:  pnpm perf:presets`);
    L.push(`// Pins and exclusions live in scripts/performance-presets.json.`);
    L.push(`//`);
    L.push(`// Each preset is a section/key diff of a pinned upstream gameinfo.gi`);
    L.push(`// against the stock baseline, so Grimoire can patch the user's existing`);
    L.push(`// file in place instead of replacing it (which is how upstream ships).`);
    L.push(`// That keeps Grimoire's SearchPaths block (mods, overflow folders,`);
    L.push(`// deadworks content) and any game-update changes intact.`);
    L.push(`//`);
    L.push(`// Convars that change what the player can see, the camera framing, or`);
    L.push(`// expose developer tools are pulled out into \`optIn\`. This keeps them`);
    L.push(`// individually controllable: creator visibility/camera values default on,`);
    L.push(`// while developer/testing tools require explicit opt-in.`);
    L.push(`//`);
    L.push(`// Upstream licensing: the preset values below are derived from GPL-3.0`);
    L.push(`// projects, credited per preset in \`upstream\`.`);
    L.push(``);
    L.push(`import type { PresetGenClassification } from './performancePresetGen';`);
    L.push(``);
    L.push(`/** One key edit inside a gameinfo.gi section. \`remove: true\` comments the`);
    L.push(` *  existing line out (engine falls back to its built-in default), matching`);
    L.push(` *  upstream configs that delete stock keys outright. */`);
    L.push(`export interface SectionOp {`);
    L.push(`    /** Nested section path from the root GameInfo block, e.g. ['Engine2', 'RenderingPipeline']. */`);
    L.push(`    path: string[];`);
    L.push(`    key: string;`);
    L.push(`    value?: string;`);
    L.push(`    remove?: boolean;`);
    L.push(`}`);
    L.push(``);
    L.push(`/** A creator-authored gameplay/visibility convar kept separate from the`);
    L.push(` *  preset body so it can be controlled individually. */`);
    L.push(`export interface OptInControl {`);
    L.push(`    key: string;`);
    L.push(`    /** The value this preset's author chose, used when included. */`);
    L.push(`    value: string;`);
    L.push(`    group: OptInGroup;`);
    L.push(`}`);
    L.push(``);
    L.push(`export type OptInGroup = ${Object.keys(manifest.optIn.groups).map(q).join(' | ')};`);
    L.push(``);
    L.push(`export type PresetTier =`);
    L.push(`    ${[...new Set(presets.map((p) => p.tier))].map(q).join('\n    | ')};`);
    L.push(``);
    L.push(`export interface PresetUpstream {`);
    L.push(`    repo: string;`);
    L.push(`    url: string;`);
    L.push(`    /** Path of the source config inside the upstream repo. */`);
    L.push(`    path: string;`);
    L.push(`    /** Every path this file has lived at, current first. Upstreams rename`);
    L.push(`     *  their config folders across releases, so fetching a historical`);
    L.push(`     *  version tries these in order. */`);
    L.push(`    paths: string[];`);
    L.push(`    /** Human-facing upstream version (a git tag where one exists). */`);
    L.push(`    ref: string;`);
    L.push(`    /** Whether \`ref\` is a real git tag or a version stated in prose. */`);
    L.push(`    refKind: 'tag' | 'prose';`);
    L.push(`    /** Immutable pin. This, not \`ref\`, is what was fetched. */`);
    L.push(`    commit: string;`);
    L.push(`    license: string;`);
    L.push(`    credit: string;`);
    L.push(`}`);
    L.push(``);
    L.push(`/** One upstream release of a preset: the body as that release shipped it.`);
    L.push(` *  Users can pick an older release when a newer one runs worse for them, so`);
    L.push(` *  these are bundled rather than fetched. A rollback that needs the network`);
    L.push(` *  is not a rollback you can reach when something is broken. */`);
    L.push(`export interface PresetRelease {`);
    L.push(`    /** Upstream version with any leading 'v' stripped; goes in the file marker. */`);
    L.push(`    version: string;`);
    L.push(`    /** Human-facing upstream version (a git tag where one exists). */`);
    L.push(`    ref: string;`);
    L.push(`    refKind: 'tag' | 'prose';`);
    L.push(`    /** Immutable pin. This, not \`ref\`, is what was fetched. */`);
    L.push(`    commit: string;`);
    L.push(`    /** Upstream release date, yyyy-mm-dd. Tag names do not reliably sort`);
    L.push(`     *  into release order, so this is what the picker shows to disambiguate. */`);
    L.push(`    date: string;`);
    L.push(`    /** sha256 of the upstream source file this release was generated from.`);
    L.push(`     *  Lets the track-latest path recognize a fetched file as identical to`);
    L.push(`     *  a bundled release and reuse its version identity. */`);
    L.push(`    sha256: string;`);
    L.push(`    sectionOps: SectionOp[];`);
    L.push(`    convars: ReadonlyArray<readonly [string, string]>;`);
    L.push(`    optIn: OptInControl[];`);
    L.push(`}`);
    L.push(``);
    L.push(`/** A preset across all the upstream releases we bundle. Identity (name,`);
    L.push(` *  tier, author) is stable; only the body varies by release. Releases are`);
    L.push(` *  newest-first and always non-empty, and consecutive releases whose`);
    L.push(` *  upstream file was byte-identical are collapsed, so the picker never`);
    L.push(` *  offers two versions that would write the same thing. */`);
    L.push(`export interface PerformancePresetFamily {`);
    L.push(`    id: string;`);
    L.push(`    name: string;`);
    L.push(`    tier: PresetTier;`);
    L.push(`    author: string;`);
    L.push(`    /** Upstream itself labels this config experimental. */`);
    L.push(`    unstable?: boolean;`);
    L.push(`    /** Release-independent provenance. Per-release \`ref\`/\`commit\` live`);
    L.push(`     *  on each PresetRelease. */`);
    L.push(`    upstream: Omit<PresetUpstream, 'ref' | 'refKind' | 'commit'>;`);
    L.push(`    releases: PresetRelease[];`);
    L.push(`}`);
    L.push(``);
    L.push(`/** One preset resolved at one release: the flat shape the patcher works`);
    L.push(` *  with, so applying does not care that a version axis exists. */`);
    L.push(`export interface PerformancePreset {`);
    L.push(`    id: string;`);
    L.push(`    name: string;`);
    L.push(`    /** Upstream version with any leading 'v' stripped; goes in the file marker. */`);
    L.push(`    version: string;`);
    L.push(`    tier: PresetTier;`);
    L.push(`    author: string;`);
    L.push(`    /** Upstream itself labels this config experimental. */`);
    L.push(`    unstable?: boolean;`);
    L.push(`    upstream: PresetUpstream;`);
    L.push(`    sectionOps: SectionOp[];`);
    L.push(`    convars: ReadonlyArray<readonly [string, string]>;`);
    L.push(`    optIn: OptInControl[];`);
    L.push(`}`);
    L.push(``);
    L.push(`/** Baseline the diffs were computed against, for provenance. The repo and`);
    L.push(` *  path also tell the track-latest path where a fresh baseline lives. */`);
    L.push(`export const BASELINE = {`);
    L.push(`    repo: ${q(manifest.baseline.repo)},`);
    L.push(`    commit: ${q(manifest.baseline.commit)},`);
    L.push(`    path: ${q(manifest.baseline.path)},`);
    L.push(`} as const;`);
    L.push(``);
    L.push(`/** The classification tables the bundled presets were generated with, so`);
    L.push(` *  the runtime track-latest path applies exactly the same rules (excluded`);
    L.push(` *  sections/keys, opt-in split, unclassified-key withholding). */`);
    L.push(`export const CLASSIFICATION: PresetGenClassification = {`);
    const emitList = (name, items, mapper) => {
        L.push(`    ${name}: [`);
        for (const item of items) L.push(`        ${mapper(item)},`);
        L.push(`    ],`);
    };
    emitList('excludeSections', manifest.exclude.sections, (s) => `[${s.map(q).join(', ')}]`);
    emitList('excludeKeys', manifest.exclude.keys, (k) => q(k.key));
    emitList('excludePatterns', manifest.exclude.patterns ?? [], (p) => q(p.pattern));
    emitList('optInKeys', manifest.optIn.keys, (k) => `{ key: ${q(k.key)}, group: ${q(k.group)} }`);
    emitList('optInPatterns', manifest.optIn.patterns ?? [], q);
    emitList('allowInBody', manifest.optIn.allowInBody ?? [], (k) => q(k.key));
    L.push(`};`);
    L.push(``);

    for (const p of presets) {
        L.push(`const ${p.constName}: PerformancePresetFamily = {`);
        L.push(`    id: ${q(p.id)},`);
        L.push(`    name: ${q(p.name)},`);
        L.push(`    tier: ${q(p.tier)},`);
        L.push(`    author: ${q(p.author)},`);
        if (p.unstable) L.push(`    unstable: true,`);
        L.push(`    upstream: {`);
        L.push(`        repo: ${q(p.upstream.repo)},`);
        L.push(`        url: ${q(p.upstream.url)},`);
        L.push(`        path: ${q(p.upstream.path)},`);
        L.push(`        paths: [${p.upstream.paths.map(q).join(', ')}],`);
        L.push(`        license: ${q(p.upstream.license)},`);
        L.push(`        credit: ${q(p.upstream.credit)},`);
        L.push(`    },`);
        L.push(`    releases: [`);

        for (const r of p.releases) {
            L.push(`        {`);
            L.push(`            version: ${q(r.version)},`);
            L.push(`            ref: ${q(r.ref)},`);
            L.push(`            refKind: ${q(r.refKind)},`);
            L.push(`            commit: ${q(r.commit)},`);
            L.push(`            date: ${q(r.date)},`);
            L.push(`            sha256: ${q(r.sha256)},`);
            if (r.supersedes.length) {
                L.push(
                    `            // Byte-identical upstream in ${r.supersedes.join(', ')}, collapsed into this entry.`
                );
            }

            L.push(`            sectionOps: [`);
            for (const op of r.sectionOps) {
                const path = `[${op.path.map(q).join(', ')}]`;
                L.push(
                    op.remove
                        ? `                { path: ${path}, key: ${q(op.key)}, remove: true },`
                        : `                { path: ${path}, key: ${q(op.key)}, value: ${q(op.value)} },`
                );
            }
            L.push(`            ],`);

            L.push(`            convars: [`);
            for (const [k, v] of r.convars) L.push(`                [${q(k)}, ${q(v)}],`);
            L.push(`            ],`);

            L.push(`            optIn: [`);
            for (const o of r.optIn) {
                L.push(
                    `                { key: ${q(o.key)}, value: ${q(o.value)}, group: ${q(o.group)} },`
                );
            }
            L.push(`            ],`);
            L.push(`        },`);
        }

        L.push(`    ],`);
        L.push(`};`);
        L.push(``);
    }

    L.push(`export const PRESETS: readonly PerformancePresetFamily[] = [`);
    for (const p of presets) L.push(`    ${p.constName},`);
    L.push(`];`);
    L.push(``);
    L.push(`export const DEFAULT_PRESET_ID = ${q(presets.find((p) => p.isDefault).id)};`);
    L.push(``);
    L.push(`export function getFamily(id: string | null | undefined): PerformancePresetFamily {`);
    L.push(`    return PRESETS.find((p) => p.id === id) ?? PRESETS.find((p) => p.id === DEFAULT_PRESET_ID)!;`);
    L.push(`}`);
    L.push(``);
    L.push(`/** Resolve a preset at one release, flattened for the patcher.`);
    L.push(` *`);
    L.push(` *  An unknown \`version\` falls back to the newest release rather than`);
    L.push(` *  throwing: it is what a gameinfo.gi marker written by an older Grimoire`);
    L.push(` *  carries once that release ages out of the bundled window, and the caller`);
    L.push(` *  detects that case by comparing the marker itself (see isCurrentDefinition`);
    L.push(` *  in performanceConfig.ts), not by trusting this lookup. */`);
    L.push(`export function getPreset(`);
    L.push(`    id: string | null | undefined,`);
    L.push(`    version?: string | null`);
    L.push(`): PerformancePreset {`);
    L.push(`    const family = getFamily(id);`);
    L.push(`    const release =`);
    L.push(`        family.releases.find((r) => r.version === version) ?? family.releases[0];`);
    L.push(`    return {`);
    L.push(`        id: family.id,`);
    L.push(`        name: family.name,`);
    L.push(`        version: release.version,`);
    L.push(`        tier: family.tier,`);
    L.push(`        author: family.author,`);
    L.push(`        ...(family.unstable ? { unstable: true } : {}),`);
    L.push(`        upstream: {`);
    L.push(`            ...family.upstream,`);
    L.push(`            ref: release.ref,`);
    L.push(`            refKind: release.refKind,`);
    L.push(`            commit: release.commit,`);
    L.push(`        },`);
    L.push(`        sectionOps: release.sectionOps,`);
    L.push(`        convars: release.convars,`);
    L.push(`        optIn: release.optIn,`);
    L.push(`    };`);
    L.push(`}`);
    L.push(``);
    L.push(`/** True when \`version\` names a release this build actually bundles. */`);
    L.push(`export function hasVersion(id: string, version: string | null | undefined): boolean {`);
    L.push(`    return getFamily(id).releases.some((r) => r.version === version);`);
    L.push(`}`);
    L.push(``);
    // Group labels are deliberately NOT emitted here: they are user-facing
    // strings and live in src/locales/en/translation.json under
    // performance.optIn.group.*, where Weblate can reach them. A second copy in
    // generated main-process code would only rot.
    return L.join('\n');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const camel = (id) =>
    id.replace(/[^a-zA-Z0-9]+(.)/g, (_, c) => c.toUpperCase()).replace(/^./, (c) => c.toUpperCase());

// Upstreams rename their config folders across releases (OptiLock v4.6 moved
// both presets). `path` is where the file lives NOW (and is what the runtime
// track-latest fetch uses); `pathByRef` pins the historical location for the
// older bundled releases that predate a rename.
const pathFor = (entry, ref) => entry.pathByRef?.[ref] ?? entry.path;

async function main() {
    const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf-8'));

    if (REFRESH) {
        await refreshPins(manifest, REFRESH);
        return;
    }

    verifyReleaseOrder(manifest);
    await verifyTagPins(manifest);

    const baselineText = await fetchAt(
        manifest.baseline.repo,
        manifest.baseline.commit,
        manifest.baseline.path
    );
    verify(baselineText, manifest.baseline.sha256, `baseline ${manifest.baseline.path}`);
    const baseline = parseConfig(baselineText);
    console.log(`\n  baseline: ${baseline.entries.size} stock keys\n`);

    const classification = classificationFromManifest(manifest);
    // key -> "preset@release" labels, aggregated so one failure lists them all.
    const unclassified = new Map();

    const presets = [];
    for (const entry of manifest.presets) {
        const source = manifest.sources[entry.source];
        if (!source) fail(`Preset ${entry.id} names unknown source ${entry.source}`);

        // Walk the source's releases newest-first, diffing each against the
        // CURRENT baseline. An old release is therefore stored as "what that
        // release changes relative to today's stock file", which is the only
        // thing that can be patched into the file the user actually has.
        const releases = [];
        for (const release of source.releases) {
            const expected = entry.sha256[release.ref];
            if (!expected) {
                fail(
                    `Preset ${entry.id} has no sha256 for release ${release.ref}.\n` +
                        `  Every release listed on source "${entry.source}" needs one, or the\n` +
                        `  content gate silently stops covering that version.`
                );
            }
            const path = pathFor(entry, release.ref);
            const text = await fetchAt(source.repo, release.commit, path);
            verify(text, expected, `${entry.id} (${path}) at ${release.ref}`);

            // Collapse a release whose upstream file is byte-identical to the
            // newer one already recorded: offering both would be two picker
            // entries that write exactly the same file.
            const previous = releases[releases.length - 1];
            if (previous && previous.sha256 === expected) {
                previous.supersedes.push(release.ref);
                continue;
            }

            const label = source.releases.length > 1 ? `${entry.id}@${release.ref}` : entry.id;
            const { sectionOps, convars, optIn } = diffAgainstBaseline(
                baseline,
                parseConfig(text),
                classification,
                (key) => {
                    if (!unclassified.has(key)) unclassified.set(key, []);
                    if (!unclassified.get(key).includes(label)) unclassified.get(key).push(label);
                }
            );
            releases.push({
                version: release.ref.replace(/^v/, ''),
                ref: release.ref,
                refKind: source.refKind,
                commit: release.commit,
                date: release.date,
                sha256: expected,
                supersedes: [],
                sectionOps,
                convars,
                optIn,
            });
        }

        presets.push({
            ...entry,
            constName: camel(entry.id),
            isDefault: entry.default === true,
            upstream: {
                repo: source.repo,
                url: source.url,
                path: entry.path,
                paths: [...new Set([entry.path, ...Object.values(entry.pathByRef ?? {})])],
                license: source.license,
                credit: source.credit,
            },
            releases,
        });

        const head = releases[0];
        const extra =
            releases.length > 1
                ? `  (+${releases.length - 1} older: ${releases.slice(1).map((r) => r.ref).join(', ')})`
                : '  (single version)';
        console.log(
            `  ${entry.id.padEnd(16)} ${String(head.sectionOps.length).padStart(3)} section ops  ` +
                `${String(head.convars.length).padStart(3)} convars  ${String(head.optIn.length).padStart(2)} opt-in` +
                extra
        );
    }

    if (!presets.some((p) => p.isDefault)) fail('No preset is marked "default": true in the manifest.');
    if (presets.filter((p) => p.isDefault).length > 1) fail('More than one preset is marked default.');

    // The whole point of this split: a classified key must never end up in a
    // preset body, where the UI could not expose it as an individual control.
    const optInKeys = new Set(manifest.optIn.keys.map((k) => k.key));
    for (const p of presets) {
        for (const r of p.releases) {
            const inBody = [
                ...r.convars.map(([k]) => k),
                ...r.sectionOps.map((op) => op.key),
            ].filter((k) => optInKeys.has(k));
            if (inBody.length) {
                fail(
                    `Preset ${p.id} at ${r.ref} would apply gameplay convars directly: ${inBody.join(', ')}`
                );
            }
        }
    }

    // The opt-in list is only as good as the last hand-audit of six upstream
    // files. The pattern check (now inside generatePresetBody) is what makes it
    // hold across a `--refresh`: a key that looks like a visibility or framing
    // setting has to be classified on purpose before it can ship in a preset
    // body. At build time an unclassified key is a hard failure; the runtime
    // track-latest path withholds it instead.
    if (unclassified.size) {
        const list = [...unclassified]
            .map(([key, ids]) => `    ${key}  (${ids.join(', ')})`)
            .join('\n');
        fail(
            `Unclassified gameplay-shaped keys would be applied without asking:\n\n${list}\n\n` +
                `  Each one matches scripts/performance-presets.json optIn.patterns, so it\n` +
                `  changes what the player sees or how the camera is framed until proven\n` +
                `  otherwise. Classify every one of them in that manifest:\n` +
                `    optIn.keys      offer it as a toggle (the usual answer)\n` +
                `    exclude.keys    never write it, with a "why"\n` +
                `    optIn.allowInBody  keep it in the body, with a "why" that says\n` +
                `                    it costs frames rather than changing what is visible`
        );
    }

    const output = emit(manifest, presets);

    if (CHECK) {
        const current = readFileSync(OUT_PATH, 'utf-8');
        if (current !== output) {
            fail(
                'performanceConfigData.ts is out of sync with scripts/performance-presets.json.\n' +
                    '  Run `pnpm perf:presets` and commit the result.'
            );
        }
        console.log('\n  performanceConfigData.ts is in sync with the pinned sources.\n');
        return;
    }

    writeFileSync(OUT_PATH, output, 'utf-8');
    console.log(`\n  Wrote ${presets.length} presets to electron/main/services/performanceConfigData.ts\n`);
}

function verify(text, expected, label) {
    const actual = sha256(text);
    if (actual === expected) return;
    fail(
        `Content hash mismatch for ${label}.\n` +
            `    expected ${expected}\n` +
            `    actual   ${actual}\n` +
            `  The pinned commit should be immutable, so this means the pin was\n` +
            `  edited by hand, the upstream repo was rewritten, or the fetch was\n` +
            `  tampered with. Do not regenerate until you know which.\n` +
            `  To move to newer upstream content deliberately:\n` +
            `    pnpm perf:presets --refresh all`
    );
}

// Move pins forward on purpose: re-resolve each source's HEAD, refetch, and
// rewrite the manifest's commit + sha256 fields. Never run implicitly.
async function refreshPins(manifest, target) {
    const wanted = target === 'all' ? null : target;
    const sourcesToBump = new Set(
        manifest.presets
            .filter((p) => !wanted || p.id === wanted || p.source === wanted)
            .map((p) => p.source)
    );
    if (!sourcesToBump.size) fail(`--refresh ${target} matched no preset or source.`);

    const depth = manifest.historyDepth ?? 3;

    for (const name of sourcesToBump) {
        const source = manifest.sources[name];
        // A tag-pinned source moves to its newest *release*, and `ref` moves
        // with it. Bumping such a source to a branch HEAD would leave the card
        // claiming a release the code no longer comes from until someone
        // remembered to hand-edit `ref`.
        const target =
            source.refKind === 'tag'
                ? await (async () => {
                      const tag = await latestReleaseTag(source.repo);
                      const sha = await resolveTag(source.repo, tag);
                      if (!sha) fail(`Latest release of ${source.repo} names tag ${tag}, which does not resolve.`);
                      return { ref: tag, commit: sha };
                  })()
                : { ref: source.releases[0].ref, commit: await resolveHead(source.repo) };

        const current = source.releases[0];
        if (target.commit === current.commit) {
            console.log(`  ${name}: already at ${current.ref} ${current.commit.slice(0, 8)}`);
            continue;
        }

        const date = await commitDate(source.repo, target.commit);
        // A prose-pinned source carries the previous release's `ref` forward
        // (the author states the version in a commit message, which we cannot
        // read reliably), so the new entry would collide with the one it
        // supersedes. Park it under a placeholder the human must replace: a
        // silent duplicate ref would make two different bodies claim one
        // version, and the picker would show the same name twice.
        const ref = source.releases.some((r) => r.ref === target.ref) ? 'UNRELEASED' : target.ref;

        source.releases.unshift({ ref, commit: target.commit, date });
        const dropped = source.releases.splice(depth);

        console.log(
            `  ${name}: + ${ref} ${target.commit.slice(0, 8)} (${date})` +
                (dropped.length ? `, aged out ${dropped.map((r) => r.ref).join(', ')}` : '')
        );
        if (ref === 'UNRELEASED') {
            console.log(
                `      ^ set this "ref" to the version ${source.repo} now states, by hand.`
            );
        }
    }

    const bl = manifest.baseline;
    if (sourcesToBump.has('optimizationlock')) {
        bl.commit = manifest.sources.optimizationlock.releases[0].commit;
        bl.sha256 = sha256(await fetchAt(bl.repo, bl.commit, bl.path));
    }
    for (const entry of manifest.presets) {
        if (!sourcesToBump.has(entry.source)) continue;
        const source = manifest.sources[entry.source];
        const hashes = {};
        for (const release of source.releases) {
            hashes[release.ref] = sha256(
                await fetchAt(source.repo, release.commit, pathFor(entry, release.ref))
            );
        }
        entry.sha256 = hashes;
    }

    writeFileSync(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`, 'utf-8');
    console.log(
        `\n  Pins updated. Review the manifest diff. Tag-pinned sources moved their\n` +
            `  "ref" with the release; a prose-pinned source parks the new entry under\n` +
            `  "UNRELEASED" for you to name. Then run \`pnpm perf:presets\` and review\n` +
            `  that diff: a new gameplay-shaped key will fail the run until classified.\n`
    );
}

await main();
