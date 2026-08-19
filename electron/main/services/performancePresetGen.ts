// Pure gameinfo.gi preset generation: parse an upstream config, diff it
// against the stock baseline, and classify the result into a preset body plus
// held-out gameplay controls. No electron, fs, or network imports: the same
// logic runs in two very different places and must behave identically in both.
//
//   - Build time: scripts/gen-performance-presets.mjs runs it over the pinned
//     upstream commits and bakes the result into performanceConfigData.ts.
//     There, a classification problem is a HARD FAILURE: a human classifies
//     the new key before it can ship.
//   - Runtime: performanceLatest.ts runs it over a freshly fetched upstream
//     HEAD/tag when the user tracks the latest release. There is no human in
//     that loop, so a classification problem WITHHOLDS the key (it is simply
//     never written) and the UI reports how many were held back.
//
// The classification tables come from scripts/performance-presets.json; the
// generator emits them into performanceConfigData.ts (CLASSIFICATION) so the
// runtime path applies exactly the rules the bundled presets were built with.

export interface PresetGenClassification {
    /** Section paths never emitted into a preset (e.g. FileSystem, Hammer). */
    excludeSections: ReadonlyArray<readonly string[]>;
    /** Exact keys never written, whatever upstream sets. */
    excludeKeys: readonly string[];
    /** Case-insensitive regex sources for keys never written, whatever
     *  upstream sets. Insurance against upstream accidents (a timescale pushed
     *  to main by mistake) that exact-key lists cannot anticipate. */
    excludePatterns: readonly string[];
    /** Gameplay/visibility convars offered as individual opt-in controls. */
    optInKeys: ReadonlyArray<{ readonly key: string; readonly group: string }>;
    /** Case-insensitive regex sources: a key matching one of these must be
     *  classified deliberately (opt-in, excluded, or allowInBody) before it may
     *  ride in a preset body. */
    optInPatterns: readonly string[];
    /** Pattern-matching keys audited as genuine performance settings. */
    allowInBody: readonly string[];
}

export interface GenSectionOp {
    path: string[];
    key: string;
    value?: string;
    remove?: boolean;
}

export interface GenOptIn {
    key: string;
    value: string;
    group: string;
}

/** A key the generator could not safely place in the preset body.
 *  `misplaced-opt-in`: a classified opt-in key set outside the ConVars block
 *  (the opt-in mechanism has no section path, so it cannot be applied).
 *  `unclassified`: a gameplay-shaped key (matches optInPatterns) that no one
 *  has classified yet. */
export interface GenProblem {
    kind: 'misplaced-opt-in' | 'unclassified';
    key: string;
    /** Section path the key appeared under, '' for root. */
    where: string;
}

export interface GeneratedBody {
    sectionOps: GenSectionOp[];
    convars: Array<[string, string]>;
    optIn: GenOptIn[];
    /** Keys withheld from the outputs above; see GenProblem. */
    problems: GenProblem[];
}

interface ParsedEntry {
    path: string[];
    key: string;
    value: string;
    order: number;
}

export interface ParsedConfig {
    entries: Map<string, ParsedEntry>;
    commented: Set<string>;
}

// ---------------------------------------------------------------------------
// Parsing
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

export function parseConfig(text: string): ParsedConfig {
    const entries = new Map<string, ParsedEntry>();
    const commented = new Set<string>(); // "path/key" the config explicitly comments out
    const stack: string[] = [];
    let pending: string | null = null;
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
// Diff + classification
// ---------------------------------------------------------------------------

function pathExcluded(path: string[], excludedSections: ReadonlyArray<readonly string[]>): boolean {
    return excludedSections.some((ex) => ex.every((seg, i) => path[i] === seg));
}

/** Diff `config` against `baseline` and classify the result. Never throws on
 *  content: anything it cannot place safely comes back in `problems` and is
 *  withheld from the body, so callers choose between failing (build) and
 *  reporting (runtime). */
export function generatePresetBody(
    baselineParsed: ParsedConfig,
    configParsed: ParsedConfig,
    classification: PresetGenClassification
): GeneratedBody {
    const baseline = baselineParsed.entries;
    const { entries: config, commented } = configParsed;
    const excludedKeys = new Set(classification.excludeKeys);
    const excludePatterns = classification.excludePatterns.map((p) => new RegExp(p, 'i'));
    const optInGroup = new Map(classification.optInKeys.map((k) => [k.key, k.group]));
    const optInPatterns = classification.optInPatterns.map((p) => new RegExp(p, 'i'));
    const allowedInBody = new Set(classification.allowInBody);

    const sectionOps: GenSectionOp[] = [];
    const convars: Array<[string, string]> = [];
    const optIn: GenOptIn[] = [];
    const problems: GenProblem[] = [];

    const included = (entry: { path: string[]; key: string }) =>
        !pathExcluded(entry.path, classification.excludeSections) &&
        !excludedKeys.has(entry.key) &&
        !excludePatterns.some((re) => re.test(entry.key));

    // A gameplay-shaped key nobody has classified. The hand-audited opt-in
    // list is only as good as the last audit of the upstream files; these
    // patterns are what make it hold across upstream bumps.
    const unclassified = (key: string) =>
        !allowedInBody.has(key) && optInPatterns.some((re) => re.test(key));

    // Root-level keys (directly inside GameInfo) carry an empty parsed path.
    // Emit them under ['GameInfo'] so the patcher resolves a real section
    // rather than falling back to a whole-file scan.
    const opPath = (path: string[]) => (path.length ? path : ['GameInfo']);

    // Changed / added keys.
    for (const entry of [...config.values()].sort((a, b) => a.order - b.order)) {
        if (!included(entry)) continue;
        const base = baseline.get([...entry.path, entry.key].join('/'));
        if (base && base.value === entry.value) continue;

        if (optInGroup.has(entry.key)) {
            // The patcher applies opt-ins through the ConVars path. Every
            // classified key is a convar today; one set in an engine section
            // cannot be applied safely (OptInControl carries no path).
            if (!(entry.path.length === 1 && entry.path[0] === 'ConVars')) {
                problems.push({
                    kind: 'misplaced-opt-in',
                    key: entry.key,
                    where: entry.path.join('/'),
                });
                continue;
            }
            optIn.push({ key: entry.key, value: entry.value, group: optInGroup.get(entry.key)! });
            continue;
        }
        if (unclassified(entry.key)) {
            problems.push({ kind: 'unclassified', key: entry.key, where: entry.path.join('/') });
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
        if (unclassified(base.key)) {
            problems.push({ kind: 'unclassified', key: base.key, where: base.path.join('/') });
            continue;
        }
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

    return { sectionOps, convars, optIn, problems };
}

// ---------------------------------------------------------------------------
// Sanity checks for texts fetched at runtime
// ---------------------------------------------------------------------------

/** Bounds on what a plausible gameinfo.gi and its diff look like. A fetched
 *  file failing these is a truncated download, an HTML error page, or an
 *  upstream restructuring big enough that a human should look first. */
const MIN_TEXT_BYTES = 10_000;
const MAX_TEXT_BYTES = 2_000_000;
const MIN_BASELINE_ENTRIES = 150;
const MIN_CONFIG_ENTRIES = 100;
const MAX_CONVARS = 1500;
const MAX_SECTION_OPS = 600;

/** Quick structural sanity for a fetched gameinfo.gi-shaped text. Returns an
 *  error description, or null when the text looks plausible. */
export function validateGameinfoText(text: string, label: string): string | null {
    if (text.length < MIN_TEXT_BYTES) return `${label} is implausibly small (${text.length} bytes)`;
    if (text.length > MAX_TEXT_BYTES) return `${label} is implausibly large (${text.length} bytes)`;
    if (!/\bGameInfo\b/.test(text)) return `${label} has no GameInfo block`;
    if (!/\bConVars\b/.test(text)) return `${label} has no ConVars block`;
    let depth = 0;
    for (const rawLine of text.split(/\r?\n/)) {
        const commentAt = rawLine.indexOf('//');
        const line = commentAt >= 0 ? rawLine.slice(0, commentAt) : rawLine;
        for (const ch of line) {
            if (ch === '{') depth++;
            else if (ch === '}') depth--;
            if (depth < 0) return `${label} has unbalanced braces`;
        }
    }
    if (depth !== 0) return `${label} has unbalanced braces`;
    return null;
}

/** Sanity for a generated body plus the parses it came from. Returns an error
 *  description, or null when the result is plausible enough to apply. */
export function validateGeneratedBody(
    baseline: ParsedConfig,
    config: ParsedConfig,
    body: GeneratedBody
): string | null {
    if (baseline.entries.size < MIN_BASELINE_ENTRIES) {
        return `baseline parsed to only ${baseline.entries.size} entries`;
    }
    if (config.entries.size < MIN_CONFIG_ENTRIES) {
        return `config parsed to only ${config.entries.size} entries`;
    }
    if (body.convars.length > MAX_CONVARS) {
        return `diff produced ${body.convars.length} convars (cap ${MAX_CONVARS})`;
    }
    if (body.sectionOps.length > MAX_SECTION_OPS) {
        return `diff produced ${body.sectionOps.length} section ops (cap ${MAX_SECTION_OPS})`;
    }
    return null;
}

// ---------------------------------------------------------------------------
// Manifest bridge
// ---------------------------------------------------------------------------

/** Shape of the classification-bearing parts of
 *  scripts/performance-presets.json. */
interface ManifestLike {
    exclude: {
        sections: string[][];
        keys: Array<{ key: string }>;
        patterns?: Array<{ pattern: string }>;
    };
    optIn: {
        keys: Array<{ key: string; group: string }>;
        patterns?: string[];
        allowInBody?: Array<{ key: string }>;
    };
}

/** Extract the classification tables from the pin manifest, the single source
 *  both the build-time generator and the emitted CLASSIFICATION use. */
export function classificationFromManifest(manifest: ManifestLike): PresetGenClassification {
    return {
        excludeSections: manifest.exclude.sections,
        excludeKeys: manifest.exclude.keys.map((k) => k.key),
        excludePatterns: (manifest.exclude.patterns ?? []).map((p) => p.pattern),
        optInKeys: manifest.optIn.keys.map((k) => ({ key: k.key, group: k.group })),
        optInPatterns: manifest.optIn.patterns ?? [],
        allowInBody: (manifest.optIn.allowInBody ?? []).map((k) => k.key),
    };
}
