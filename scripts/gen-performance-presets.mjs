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

async function resolveHead(repo) {
    const res = await fetch(`https://api.github.com/repos/${repo}/commits/HEAD`, {
        headers: { Accept: 'application/vnd.github+json' },
    });
    if (!res.ok) fail(`Could not resolve HEAD for ${repo} (${res.status})`);
    return (await res.json()).sha;
}

// ---------------------------------------------------------------------------
// gameinfo.gi parsing
//
// Valve KV: `Name` on its own line (or trailing) followed by `{ ... }` for
// sections, `key "value"` for entries, `//` for comments. We only need active
// (uncommented) entries and the section path each one sits under. Paths are
// relative to the inside of the root GameInfo block, matching the paths the
// patcher's findSectionByPath expects.
// ---------------------------------------------------------------------------

const ENTRY_RE = /^"?([A-Za-z_][\w.]*)"?[ \t]+("[^"]*"|[^\s/]+)/;
// A commented-out entry, e.g. `//GpuImplicitRendererManifest "1"` or the
// unquoted `//DisallowGameInfoConditionals 1`. These files are dense with
// prose comments, so the shape is kept tight: the value must be quoted or a
// number/bool token, and nothing may follow but another comment. That rejects
// `// r_shadows is a great convar` (value "is") while accepting real entries.
// Callers additionally require the key to exist in the stock baseline.
const COMMENTED_ENTRY_RE =
    /^"?([A-Za-z_][\w.]*)"?[ \t]+(?:"([^"]*)"|(-?[0-9.]+|true|false))[ \t]*(?:\/\/.*)?$/i;

function parseConfig(text) {
    const entries = new Map(); // "path/key" -> { path, key, value, order }
    const commented = new Set(); // "path/key" the config explicitly comments out
    const stack = [];
    let pending = null;
    let order = 0;

    const lines = text.split(/\r?\n/);
    for (const raw of lines) {
        const commentAt = raw.indexOf('//');
        const line = (commentAt >= 0 ? raw.slice(0, commentAt) : raw).trim();

        // Commented-out entries are how these configs express "delete this
        // stock key"; record them against the section we are currently in.
        if (commentAt >= 0 && !line) {
            const m = COMMENTED_ENTRY_RE.exec(raw.slice(commentAt + 2).trim());
            if (m) commented.add([...stack.slice(1), m[1]].join('/'));
        }
        if (!line) continue;

        // Braces can be alone on a line or trail the section name.
        let rest = line;
        while (rest.length) {
            if (rest.startsWith('{')) {
                stack.push(pending ?? '');
                pending = null;
                rest = rest.slice(1).trim();
                continue;
            }
            if (rest.startsWith('}')) {
                stack.pop();
                rest = rest.slice(1).trim();
                continue;
            }
            const brace = rest.indexOf('{');
            const close = rest.indexOf('}');
            const cut = [brace, close].filter((i) => i >= 0).sort((a, b) => a - b)[0];
            const chunk = (cut === undefined ? rest : rest.slice(0, cut)).trim();
            rest = cut === undefined ? '' : rest.slice(cut);

            if (!chunk) continue;
            const m = ENTRY_RE.exec(chunk);
            if (m && /^"?[A-Za-z_][\w.]*"?[ \t]+\S/.test(chunk)) {
                // Drop the root GameInfo level from the recorded path.
                const path = stack.slice(1);
                const key = m[1];
                const value = m[2].replace(/^"|"$/g, '');
                const id = [...path, key].join('/');
                // Later duplicates win: that is the last value the engine parses.
                entries.set(id, { path, key, value, order: entries.get(id)?.order ?? order++ });
            } else {
                pending = chunk.replace(/^"|"$/g, '');
            }
        }
    }
    return { entries, commented };
}

// ---------------------------------------------------------------------------
// Diff
// ---------------------------------------------------------------------------

function pathExcluded(path, excludedSections) {
    return excludedSections.some((ex) => ex.every((seg, i) => path[i] === seg));
}

function diffAgainstBaseline(baselineParsed, configParsed, manifest) {
    const baseline = baselineParsed.entries;
    const { entries: config, commented } = configParsed;
    const excludedSections = manifest.exclude.sections;
    const excludedKeys = new Set(manifest.exclude.keys.map((k) => k.key));
    const optInGroup = new Map(manifest.optIn.keys.map((k) => [k.key, k.group]));

    const sectionOps = [];
    const convars = [];
    const optIn = [];

    const included = (entry) =>
        !pathExcluded(entry.path, excludedSections) && !excludedKeys.has(entry.key);

    // Root-level keys (directly inside GameInfo) carry an empty parsed path.
    // Emit them under ['GameInfo'] so the patcher resolves a real section
    // rather than falling back to a whole-file scan.
    const opPath = (path) => (path.length ? path : ['GameInfo']);

    // Changed / added keys.
    for (const entry of [...config.values()].sort((a, b) => a.order - b.order)) {
        if (!included(entry)) continue;
        const base = baseline.get([...entry.path, entry.key].join('/'));
        if (base && base.value === entry.value) continue;

        if (optInGroup.has(entry.key)) {
            // The patcher applies opt-ins through the ConVars path. Every
            // classified key is a convar today; if upstream ever sets one in an
            // engine section, fail rather than silently apply it to the wrong
            // place (OptInControl would need a path first).
            if (!(entry.path.length === 1 && entry.path[0] === 'ConVars')) {
                fail(
                    `Opt-in key ${entry.key} appears under section ${entry.path.join('/') || 'GameInfo'}, ` +
                        `not ConVars. OptInControl has no path field, so this cannot be applied safely.`
                );
            }
            optIn.push({ key: entry.key, value: entry.value, group: optInGroup.get(entry.key) });
            continue;
        }
        if (entry.path.length === 1 && entry.path[0] === 'ConVars') {
            convars.push([entry.key, entry.value]);
        } else {
            sectionOps.push({ path: opPath(entry.path), key: entry.key, value: entry.value });
        }
    }

    // Deliberate deletions: a stock key the config comments out. Mere absence
    // is NOT a deletion. Several of these configs are partial or derived files
    // that simply never mention large parts of the stock gameinfo.gi, and
    // treating that as intent would comment out unrelated engine keys (Valve's
    // PGIVersion content hash among them). Excluded inside ConVars, where a
    // config's block is additive by construction.
    for (const id of commented) {
        const base = baseline.get(id);
        if (!base || !included(base)) continue;
        if (base.path.length === 1 && base.path[0] === 'ConVars') continue;
        if (optInGroup.has(base.key)) continue;
        if (config.has(id)) continue; // commented in one place, still active in another
        sectionOps.push({ path: opPath(base.path), key: base.key, remove: true });
    }

    // Stable order: section ops grouped by path, removals last within a path.
    sectionOps.sort((a, b) => {
        const pa = a.path.join('/');
        const pb = b.path.join('/');
        if (pa !== pb) return pa < pb ? -1 : 1;
        if (!!a.remove !== !!b.remove) return a.remove ? 1 : -1;
        return a.key < b.key ? -1 : 1;
    });

    return { sectionOps, convars, optIn };
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
    L.push(`// Convars that change what the player can see, or the camera framing,`);
    L.push(`// are pulled out of every preset into \`optIn\` and are applied only when`);
    L.push(`// the user turns them on. Grimoire does not enable enemy visibility or`);
    L.push(`// change someone's FOV as a side effect of a performance preset.`);
    L.push(`//`);
    L.push(`// Upstream licensing: the preset values below are derived from GPL-3.0`);
    L.push(`// projects, credited per preset in \`upstream\`.`);
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
    L.push(`/** A gameplay/visibility convar the preset's author set, held back from`);
    L.push(` *  the preset body and applied only on explicit opt-in. */`);
    L.push(`export interface OptInControl {`);
    L.push(`    key: string;`);
    L.push(`    /** The value this preset's author chose, used when the user opts in. */`);
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
    L.push(`/** Baseline the diffs were computed against, for provenance. */`);
    L.push(`export const BASELINE = {`);
    L.push(`    repo: ${q(manifest.baseline.repo)},`);
    L.push(`    commit: ${q(manifest.baseline.commit)},`);
    L.push(`    path: ${q(manifest.baseline.path)},`);
    L.push(`} as const;`);
    L.push(``);

    for (const p of presets) {
        L.push(`const ${p.constName}: PerformancePreset = {`);
        L.push(`    id: ${q(p.id)},`);
        L.push(`    name: ${q(p.name)},`);
        L.push(`    version: ${q(p.version)},`);
        L.push(`    tier: ${q(p.tier)},`);
        L.push(`    author: ${q(p.author)},`);
        if (p.unstable) L.push(`    unstable: true,`);
        L.push(`    upstream: {`);
        L.push(`        repo: ${q(p.upstream.repo)},`);
        L.push(`        url: ${q(p.upstream.url)},`);
        L.push(`        path: ${q(p.upstream.path)},`);
        L.push(`        ref: ${q(p.upstream.ref)},`);
        L.push(`        refKind: ${q(p.upstream.refKind)},`);
        L.push(`        commit: ${q(p.upstream.commit)},`);
        L.push(`        license: ${q(p.upstream.license)},`);
        L.push(`        credit: ${q(p.upstream.credit)},`);
        L.push(`    },`);

        L.push(`    sectionOps: [`);
        for (const op of p.sectionOps) {
            const path = `[${op.path.map(q).join(', ')}]`;
            L.push(
                op.remove
                    ? `        { path: ${path}, key: ${q(op.key)}, remove: true },`
                    : `        { path: ${path}, key: ${q(op.key)}, value: ${q(op.value)} },`
            );
        }
        L.push(`    ],`);

        L.push(`    convars: [`);
        for (const [k, v] of p.convars) L.push(`        [${q(k)}, ${q(v)}],`);
        L.push(`    ],`);

        L.push(`    optIn: [`);
        for (const o of p.optIn) {
            L.push(`        { key: ${q(o.key)}, value: ${q(o.value)}, group: ${q(o.group)} },`);
        }
        L.push(`    ],`);
        L.push(`};`);
        L.push(``);
    }

    L.push(`export const PRESETS: readonly PerformancePreset[] = [`);
    for (const p of presets) L.push(`    ${p.constName},`);
    L.push(`];`);
    L.push(``);
    L.push(`export const DEFAULT_PRESET_ID = ${q(presets.find((p) => p.isDefault).id)};`);
    L.push(``);
    L.push(`export function getPreset(id: string | null | undefined): PerformancePreset {`);
    L.push(`    return PRESETS.find((p) => p.id === id) ?? PRESETS.find((p) => p.id === DEFAULT_PRESET_ID)!;`);
    L.push(`}`);
    L.push(``);
    L.push(`/** UI labels for the opt-in groups are i18n keys; this maps group -> key. */`);
    L.push(`export const OPT_IN_GROUPS: Record<OptInGroup, string> = {`);
    for (const [g, label] of Object.entries(manifest.optIn.groups)) {
        L.push(`    ${g}: ${q(label)},`);
    }
    L.push(`};`);
    L.push(``);
    return L.join('\n');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const camel = (id) =>
    id.replace(/[^a-zA-Z0-9]+(.)/g, (_, c) => c.toUpperCase()).replace(/^./, (c) => c.toUpperCase());

async function main() {
    const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf-8'));

    if (REFRESH) {
        await refreshPins(manifest, REFRESH);
        return;
    }

    const baselineText = await fetchAt(
        manifest.baseline.repo,
        manifest.baseline.commit,
        manifest.baseline.path
    );
    verify(baselineText, manifest.baseline.sha256, `baseline ${manifest.baseline.path}`);
    const baseline = parseConfig(baselineText);
    console.log(`\n  baseline: ${baseline.entries.size} stock keys\n`);

    const presets = [];
    for (const entry of manifest.presets) {
        const source = manifest.sources[entry.source];
        if (!source) fail(`Preset ${entry.id} names unknown source ${entry.source}`);
        const text = await fetchAt(source.repo, source.commit, entry.path);
        verify(text, entry.sha256, `${entry.id} (${entry.path})`);

        const { sectionOps, convars, optIn } = diffAgainstBaseline(baseline, parseConfig(text), manifest);
        presets.push({
            ...entry,
            constName: camel(entry.id),
            isDefault: entry.default === true,
            version: source.ref.replace(/^v/, ''),
            upstream: { ...source, path: entry.path },
            sectionOps,
            convars,
            optIn,
        });
        console.log(
            `  ${entry.id.padEnd(16)} ${String(sectionOps.length).padStart(3)} section ops  ` +
                `${String(convars.length).padStart(3)} convars  ${String(optIn.length).padStart(2)} opt-in`
        );
    }

    if (!presets.some((p) => p.isDefault)) fail('No preset is marked "default": true in the manifest.');
    if (presets.filter((p) => p.isDefault).length > 1) fail('More than one preset is marked default.');

    // The whole point of the opt-in split: a classified key must never end up
    // in a preset body, where it would be applied without the user asking.
    const optInKeys = new Set(manifest.optIn.keys.map((k) => k.key));
    for (const p of presets) {
        const inBody = [
            ...p.convars.map(([k]) => k),
            ...p.sectionOps.map((op) => op.key),
        ].filter((k) => optInKeys.has(k));
        if (inBody.length) {
            fail(`Preset ${p.id} would apply gameplay convars directly: ${inBody.join(', ')}`);
        }
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

    for (const name of sourcesToBump) {
        const source = manifest.sources[name];
        const head = await resolveHead(source.repo);
        if (head === source.commit) {
            console.log(`  ${name}: already at ${head.slice(0, 8)}`);
        } else {
            console.log(`  ${name}: ${source.commit.slice(0, 8)} -> ${head.slice(0, 8)}`);
            source.commit = head;
        }
    }

    const bl = manifest.baseline;
    if (sourcesToBump.has('optimizationlock')) {
        bl.commit = manifest.sources.optimizationlock.commit;
        bl.sha256 = sha256(await fetchAt(bl.repo, bl.commit, bl.path));
    }
    for (const entry of manifest.presets) {
        if (!sourcesToBump.has(entry.source)) continue;
        const source = manifest.sources[entry.source];
        entry.sha256 = sha256(await fetchAt(source.repo, source.commit, entry.path));
    }

    writeFileSync(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`, 'utf-8');
    console.log(
        `\n  Pins updated. Review the manifest diff, set each source's "ref" to the\n` +
            `  new upstream version, then run \`pnpm perf:presets\` and review that diff.\n`
    );
}

await main();
