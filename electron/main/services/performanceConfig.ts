// Apply/remove one of the bundled performance presets by patching the user's
// gameinfo.gi in place (never replacing the file). Every change is tagged with
// an inline "grimoire-perf" marker so removal needs no external state: added
// lines are deleted, edited lines restore the recorded original value, and
// removed lines are uncommented. fixGameinfo (system.ts) only rewrites the
// SearchPaths block, so the two never fight over the same lines.
//
// Presets are generated from pinned upstream commits into
// performanceConfigData.ts (see scripts/gen-performance-presets.mjs). Switching
// preset reverses the applied one by its markers first, so the file always goes
// stock -> preset, never preset -> preset.
//
// Gameplay/visibility convars (enemy outlines, glows, FOV) are held out of the
// generated performance bodies so the UI can expose them individually. The
// creator's visibility/camera values are included by default; users can turn
// any of them off. Developer/testing controls remain explicit opt-ins.
//
// All patching runs on LF-normalized text and the file's original EOL style
// is restored on write: line-based regexes silently fail on CR-terminated
// lines otherwise (JS `.` does not match \r), which would inject duplicate
// convars with ambiguous engine precedence on Windows CRLF files.
import { createHash } from 'crypto';
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { getGameinfoPath } from './deadlock';
import type {
    PerformanceConfigStatus,
    PerformancePresetSummary,
} from '../../../src/types/electron';
import {
    DEFAULT_PRESET_ID,
    getPreset,
    hasVersion,
    PRESETS,
    type PerformancePreset,
    type SectionOp,
} from './performanceConfigData';

/** Resolves a preset at a version the bundle does not know. The track-latest
 *  path (performanceLatest.ts) registers one that reads its fetch cache, so a
 *  marker written by a track-latest apply still resolves to the exact
 *  definition that wrote the file; without that, harvesting would fall back to
 *  the bundled definition and treat the whole delta as drift. A hook rather
 *  than an import keeps this module free of electron so its tests stay plain. */
export type ExtraPresetResolver = (
    presetId: string,
    version: string | null | undefined
) => PerformancePreset | null;

let extraPresetResolver: ExtraPresetResolver | null = null;

export function setExtraPresetResolver(resolver: ExtraPresetResolver | null): void {
    extraPresetResolver = resolver;
}

/** Resolve a preset at a version: bundled releases first, then whatever the
 *  extra resolver knows (the track-latest cache), then the bundled fallback
 *  behavior getPreset already implements (newest release). The sentinel
 *  version 'latest' never names a bundled release, so it reaches the extra
 *  resolver and means "the newest fetched upstream release". */
function resolvePreset(
    presetId: string | null | undefined,
    version?: string | null
): PerformancePreset {
    const id = presetId ?? DEFAULT_PRESET_ID;
    if (version && !hasVersion(id, version)) {
        const extra = extraPresetResolver?.(id, version);
        if (extra && extra.id === id) return extra;
    }
    return getPreset(presetId, version === 'latest' ? null : version);
}

const MARKER = 'grimoire-perf';
// The BEGIN marker is the authoritative record of what is in the file: which
// preset, which upstream version, and which upstream commit that version was
// generated from. The commit is what makes "is the body in this file the body I
// bundle today?" answerable, because these upstreams version in prose: a
// regenerated preset can carry the same version string and a different body.
// The `@commit` group is optional so markers written before it existed still
// parse; a missing commit reads as "cannot prove it matches".
const BEGIN_RE =
    /Grimoire Performance Config BEGIN \(preset=([\w-]+) v(.+?)(?: @([0-9a-f]{6,40}))?\)/;
const GAMEINFO_BACKUP_SUFFIX = '.grimoire-bak';
// Applied-state sidecar, stored next to gameinfo.gi (game updates replace
// gameinfo.gi but leave foreign files alone). Owned by the main process only,
// so a renderer settings save can never clobber it. Its presence without the
// in-file BEGIN marker is how we detect "a game update wiped the config".
// Deliberately NOT named gameinfo.*: system.ts's findGameinfoCandidates
// surfaces gameinfo.* files as restore candidates and this is not one.
// Besides wiped-detection it carries the user's overrides: hand edits to
// preset-managed lines, harvested on reapply and layered onto every apply,
// so power-user tweaks survive reapplies, preset updates, and game-update
// wipes. Markers always record stock values (never override values), so
// Remove restores the original file regardless of overrides.
const STATE_FILENAME = 'grimoire-performance.json';

/** A user deviation from the preset for one managed key: a different value,
 *  or omit (the user deleted / commented out the preset line). Keys are
 *  `<section path>/<key>`, e.g. `ConVars/citadel_unit_status_use_new`. */
type OverrideEntry = { value?: string; omit?: boolean };
type Overrides = Record<string, OverrideEntry>;

/** Options for one apply. `presetId` picks which bundled preset to write;
 *  `optIns` are the gameplay/visibility convar keys to include (anything not
 *  listed stays out of the file). Undefined uses the creator defaults:
 *  visibility/camera on, developer/testing tools off. An explicit empty list
 *  disables every optional gameplay setting. `version` picks which bundled
 *  upstream release of that preset to write, defaulting to the newest. */
export interface ApplyOptions {
    presetId?: string;
    version?: string | null;
    optIns?: string[];
    resetOverrides?: boolean;
}

/** The convars a preset writes for a given opt-in selection: its performance
 *  body plus only the opted-in gameplay controls, in preset order. */
function effectiveConvars(
    preset: PerformancePreset,
    optIns: string[] | undefined
): ReadonlyArray<readonly [string, string]> {
    if (!optIns?.length) return preset.convars;
    const enabled = new Set(optIns);
    const extra = preset.optIn
        .filter((control) => enabled.has(control.key))
        .map((control) => [control.key, control.value] as const);
    return extra.length ? [...preset.convars, ...extra] : preset.convars;
}

/** Creator-authored settings that form the default experience. Debug and
 *  hideout tooling is intentionally excluded: it is useful for config authors,
 *  but is not part of normal gameplay. */
function creatorDefaultOptIns(preset: PerformancePreset): string[] {
    return preset.optIn
        .filter((control) => control.group !== 'devtools')
        .map((control) => control.key);
}

function statePath(gameinfoPath: string): string {
    return join(dirname(gameinfoPath), STATE_FILENAME);
}

function backupPathFor(gameinfoPath: string): string {
    return `${gameinfoPath}${GAMEINFO_BACKUP_SUFFIX}`;
}

function hasConVars(text: string): boolean {
    const normalized = text.includes('\r\n') ? text.split('\r\n').join('\n') : text;
    return findSectionByPath(normalized, ['ConVars']) !== null;
}

// True when gameinfo.gi is too broken to patch (empty or missing its ConVars
// section, e.g. the user cleared it in the external editor) AND a Grimoire
// backup that is itself intact exists to restore from. Lets the UI offer a
// one-click recovery instead of dead-ending on the "no ConVars section"
// error. `content` is the raw live-file text (any EOL style). The backup is
// validated too: restoring an equally-broken backup would help no one.
function canRestoreBackup(gameinfoPath: string, content: string): boolean {
    if (hasConVars(content)) return false;
    try {
        return hasConVars(readFileSync(backupPathFor(gameinfoPath), 'utf-8'));
    } catch {
        return false; // no backup, or unreadable
    }
}

// ---------------------------------------------------------------------------
// gameinfo.gi text helpers. The file is Valve KV: sections are `Name {...}`,
// entries are `key "value"` (values quoted, keys usually bare), comments are
// `//`. All edits are line-based so untouched lines keep their exact bytes.
// ---------------------------------------------------------------------------

function stripComment(line: string): string {
    const idx = line.indexOf('//');
    return idx >= 0 ? line.slice(0, idx) : line;
}

// Locate a `name { ... }` block via balanced-brace scanning, searching only
// within [from, to). Returns the body range (inside the braces) or null.
// Comment-only mentions of the name don't match because they are never
// followed by an opening brace on the uncommented part of the text.
function findSection(
    content: string,
    name: string,
    from: number,
    to: number
): { bodyStart: number; bodyEnd: number } | null {
    const re = new RegExp(`(^|[\\s}])${name}\\s*\\{`, 'g');
    re.lastIndex = from;
    let match: RegExpExecArray | null;
    while ((match = re.exec(content)) && match.index < to) {
        // Skip matches on commented lines.
        const lineStart = content.lastIndexOf('\n', match.index) + 1;
        const lineText = content.slice(lineStart, content.indexOf('{', match.index));
        if (lineText.includes('//')) continue;

        const bodyStart = content.indexOf('{', match.index) + 1;
        let depth = 1;
        for (let i = bodyStart; i < to; i++) {
            const ch = content[i];
            if (ch === '{') depth++;
            else if (ch === '}') {
                depth--;
                if (depth === 0) return { bodyStart, bodyEnd: i };
            }
        }
        return null; // unbalanced
    }
    return null;
}

function findSectionByPath(
    content: string,
    path: string[]
): { bodyStart: number; bodyEnd: number } | null {
    let range = { bodyStart: 0, bodyEnd: content.length };
    for (const name of path) {
        const next = findSection(content, name, range.bodyStart, range.bodyEnd);
        if (!next) return null;
        range = next;
    }
    return range;
}

// Indentation used by the section's first non-empty line, so injected lines
// match the file's existing style (tabs in the stock file, spaces in some
// community configs).
function detectIndent(body: string): string {
    for (const line of body.split('\n')) {
        const m = /^([ \t]+)\S/.exec(line);
        if (m) return m[1];
    }
    return '\t\t';
}

// Match `key "value"` (or bare-token value) at the start of an uncommented
// line. Returns the pieces needed to rewrite just the value.
function matchEntryLine(
    line: string,
    key: string
): { prefix: string; value: string; suffix: string } | null {
    const re = new RegExp(`^([ \\t]*"?${key}"?[ \\t]+)("[^"]*"|[^\\s/]+)(.*)$`);
    const m = re.exec(line);
    if (!m) return null;
    // Reject hits where the key only appears inside a comment.
    const beforeKey = stripComment(line);
    if (!new RegExp(`(^|[ \\t"])${key}([ \\t"]|$)`).test(beforeKey)) return null;
    return { prefix: m[1], value: m[2], suffix: m[3] };
}

// The key of an active `key "value"` entry line, or null.
function entryKey(line: string): string | null {
    const m = /^[ \t]*"?([A-Za-z_]\w*)"?[ \t]+("[^"]*"|[^\s/]+)/.exec(stripComment(line));
    return m ? m[1] : null;
}

const quote = (v: string) => `"${v.replace(/^"|"$/g, '')}"`;
const unquote = (v: string) => v.replace(/^"|"$/g, '');

// ---------------------------------------------------------------------------
// Overrides: harvest hand edits so they survive reapply and wipes
// ---------------------------------------------------------------------------

/** What the file's own BEGIN marker records about the applied preset. `commit`
 *  is null on markers written before it was recorded. */
interface AppliedMarker {
    version: string;
    commit: string | null;
}

function readMarker(match: RegExpExecArray): AppliedMarker {
    return { version: match[2], commit: match[3] ?? null };
}

/** Is the body in the file the body this build generates for that preset?
 *  A marker with no commit cannot prove it, so it counts as "no". */
function isCurrentDefinition(preset: PerformancePreset, marker: AppliedMarker): boolean {
    if (marker.version !== preset.version) return false;
    return marker.commit !== null && preset.upstream.commit.startsWith(marker.commit);
}

// Bare key -> preset value + override key. null marks a bare key that appears
// more than once in the preset (ambiguous: harvesting it could attribute a
// value to the wrong section, so we skip it). Remove-type ops carry no value
// and are not overridable.
//
// Opt-in controls are indexed too, even when the user has not enabled them.
// They are keys this preset owns, and the alternative is worse: an opted-in
// convar in a file whose sidecar is missing or stale (hand-copied gameinfo,
// deleted sidecar) would look like a convar the user added by hand and get
// banked as a permanent override, surviving the user opting back out.
function presetKeyIndex(
    preset: PerformancePreset,
    convars: ReadonlyArray<readonly [string, string]>
): Map<string, { okey: string; value: string } | null> {
    const idx = new Map<string, { okey: string; value: string } | null>();
    const put = (bare: string, okey: string, value: string) => {
        idx.set(bare, idx.has(bare) ? null : { okey, value });
    };
    for (const [key, value] of convars) put(key, `ConVars/${key}`, value);
    for (const control of preset.optIn) put(control.key, `ConVars/${control.key}`, control.value);
    for (const op of preset.sectionOps) {
        if (!op.remove) put(op.key, `${op.path.join('/')}/${op.key}`, op.value!);
    }
    return idx;
}

// Read the user's deviations out of an applied file (LF-normalized): edits to
// marker-tagged lines, commented-out or deleted preset convars, and the
// user's own convars added inside the marked block. Runs on every reapply, so
// the result is a complete snapshot (reverting a line back to the preset
// value drops its override). Deletions are only detected for ConVars block
// keys: a missing section-op key usually means a game update restructured
// the section, not user intent.
//
// `marker` is what the file's own BEGIN line says was written. When it does not
// match the preset we bundle today, the body on disk was written by a DIFFERENT
// definition of this same preset (a Grimoire update moved it), and most of what
// this function reads stops meaning what it says:
//
//   - a value that differs from the preset value may just be a value the bump
//     changed, not a value the user typed
//   - a marker-added key the preset no longer lists is a key the bump dropped,
//     not a convar the user added
//   - a preset key with no line in the file is a key the bump added, not a line
//     the user deleted
//
// Inferring user intent across that gap pinned stale upstream values forever,
// suppressed every key the new version added, and (worst) re-applied gameplay
// convars the creator-setting split keeps individually controllable. So when
// the definition has moved, only the unambiguous signal counts: a marker line
// the user commented out. Overrides banked while the definitions matched are
// untouched; the caller still layers them.
function harvestOverrides(
    content: string,
    preset: PerformancePreset,
    convars: ReadonlyArray<readonly [string, string]>,
    marker: AppliedMarker | null
): Overrides {
    const idx = presetKeyIndex(preset, convars);
    const overrides: Overrides = {};
    const addedToken = `// ${MARKER} added`;
    const wasRe = new RegExp(`^(.*?) // ${MARKER} was ("[^"]*"|\\S+)\\s*$`);
    // The file was written by a different definition of this preset, so value
    // and absence inferences are not attributable to the user.
    const drift = marker !== null && !isCurrentDefinition(preset, marker);

    for (const line of content.split('\n')) {
        const addedAt = line.indexOf(addedToken);
        if (addedAt >= 0) {
            const body = line.slice(0, addedAt);
            const isCommented = /^[ \t]*\/\//.test(body);
            const active = isCommented ? body.replace(/^[ \t]*\/\/[ \t]*/, '') : body;
            const key = entryKey(active);
            if (!key) continue;
            const entry = matchEntryLine(active, key);
            const managed = idx.get(key);
            if (managed === null) continue; // ambiguous bare key
            if (!managed) {
                // Not in the preset: the user's own convar inside our block,
                // unless the preset definition moved under us (see above).
                if (!drift && !isCommented && entry) {
                    overrides[`ConVars/${key}`] = { value: unquote(entry.value) };
                }
                continue;
            }
            if (isCommented) overrides[managed.okey] = { omit: true };
            else if (!drift && entry && unquote(entry.value) !== managed.value) {
                overrides[managed.okey] = { value: unquote(entry.value) };
            }
            continue;
        }
        const was = wasRe.exec(line);
        if (was && !drift) {
            const key = entryKey(was[1]);
            const entry = key ? matchEntryLine(was[1], key) : null;
            const managed = key ? idx.get(key) : null;
            if (managed && entry && unquote(entry.value) !== managed.value) {
                overrides[managed.okey] = { value: unquote(entry.value) };
            }
        }
    }

    // Deleted preset convars: every applied convar key is present after an
    // apply (edited in place or injected), so one with no active entry left in
    // the ConVars section was removed by the user. Absence proves nothing once
    // the preset definition has moved.
    const convarRange = drift ? null : findSectionByPath(content, ['ConVars']);
    if (convarRange) {
        const activeKeys = new Set(
            content
                .slice(convarRange.bodyStart, convarRange.bodyEnd)
                .split('\n')
                .map(entryKey)
                .filter(Boolean)
        );
        for (const [key] of convars) {
            if (!activeKeys.has(key)) overrides[`ConVars/${key}`] = { omit: true };
        }
    }
    return overrides;
}

// ---------------------------------------------------------------------------
// Apply
// ---------------------------------------------------------------------------

// Apply one op inside its section: edit existing entries in place (tagging
// the original value), or insert a new tagged line after the opening brace.
// Every active occurrence is edited, not just the first: some files (e.g. a
// manually installed OptimizationLock config) carry duplicate keys, and
// leaving one at a different value would reintroduce the engine-precedence
// ambiguity the edit-in-place strategy exists to avoid. Returns the updated
// content, or null when the section doesn't exist (a game update may
// restructure the file; we skip rather than guess).
function applyOp(content: string, op: SectionOp): string | null {
    const range = findSectionByPath(content, op.path);
    if (!range) return null;

    const body = content.slice(range.bodyStart, range.bodyEnd);
    const lines = body.split('\n');

    let edited = false;
    for (let i = 0; i < lines.length; i++) {
        const entry = matchEntryLine(lines[i], op.key);
        if (!entry) continue;
        if (op.remove) {
            const indent = /^[ \t]*/.exec(lines[i])![0];
            lines[i] = `${indent}// ${MARKER} removed: ${lines[i].trim()}`;
        } else {
            lines[i] = `${entry.prefix}${quote(op.value!)}${entry.suffix} // ${MARKER} was ${entry.value}`;
        }
        edited = true;
    }
    if (edited) {
        return content.slice(0, range.bodyStart) + lines.join('\n') + content.slice(range.bodyEnd);
    }

    if (op.remove) return content; // nothing to remove; engine default already active
    const indent = detectIndent(body);
    const added = `\n${indent}${op.key} ${quote(op.value!)} // ${MARKER} added`;
    return content.slice(0, range.bodyStart) + added + content.slice(range.bodyStart);
}

export function applyPerformanceConfig(
    deadlockPath: string | null,
    opts?: ApplyOptions
): PerformanceConfigStatus {
    if (!deadlockPath) return status('error', 'Deadlock path not configured.');
    const gameinfoPath = getGameinfoPath(deadlockPath);
    if (!existsSync(gameinfoPath)) {
        return status('error', 'gameinfo.gi not found. Configure your Deadlock path first.');
    }

    const preset = resolvePreset(opts?.presetId ?? DEFAULT_PRESET_ID, opts?.version);
    const optIns = (opts?.optIns ?? creatorDefaultOptIns(preset)).filter((key) =>
        preset.optIn.some((control) => control.key === key)
    );
    const convars = effectiveConvars(preset, optIns);

    try {
        const original = readFileSync(gameinfoPath, 'utf-8');
        const crlf = original.includes('\r\n');

        // Work in LF-space (see header comment), restore the EOL style on write.
        let content = crlf ? original.split('\r\n').join('\n') : original;

        const sidecar = readAppliedState(gameinfoPath);
        const saved = allOverrides(sidecar);
        // What is in the file right now, which is not necessarily what we are
        // about to write: the user may be switching presets.
        const applied = BEGIN_RE.exec(content);
        // Resolve the applied preset at the version its own marker records, not
        // at the newest one we bundle. Overrides are harvested against it, so
        // reading a rolled-back file with the newest definition would attribute
        // every difference between the two releases to the user. A version the
        // bundle does not know may still resolve from the track-latest cache.
        const appliedPreset = applied ? resolvePreset(applied[1], applied[2]) : null;
        const switching = appliedPreset !== null && appliedPreset.id !== preset.id;

        // Hand edits are harvested against the preset that is actually in the
        // file (its keys and values are the ones on disk) and banked under that
        // preset's id. What we then layer on is the incoming preset's own
        // saved overrides: a value the user chose for one preset is rarely the
        // right value for a differently-tuned one.
        //
        // The marker is passed too: if it does not describe the definition we
        // bundle for that preset today, the file's body predates a Grimoire
        // update and only its unambiguous signals can be read (see
        // harvestOverrides).
        if (applied && appliedPreset && !opts?.resetOverrides) {
            const appliedOptIns = sidecar?.optIns ?? [];
            saved[appliedPreset.id] = harvestOverrides(
                content,
                appliedPreset,
                effectiveConvars(appliedPreset, appliedOptIns),
                readMarker(applied)
            );
        }
        let overrides: Overrides = {};
        if (!opts?.resetOverrides) {
            overrides = saved[preset.id] ?? {};
        } else {
            delete saved[preset.id];
        }

        // Reapplying or switching starts from a clean base, so the file always
        // goes stock -> preset and never accumulates two presets' markers.
        if (applied) content = removeMarkers(content);

        // One-time recovery copy of the oldest version we have seen, shared
        // with fixGameinfo's backup so the user has a single restore point.
        // Only capture a structurally sane file (has ConVars): backing up an
        // already-empty/corrupt gameinfo would poison the single restore point
        // and make "Restore Backup" a no-op.
        const backupPath = backupPathFor(gameinfoPath);
        if (!existsSync(backupPath) && hasConVars(original)) {
            try {
                writeFileSync(backupPath, original, 'utf-8');
            } catch {
                // Best-effort: a failed backup must not block the apply.
            }
        }

        const skipped: string[] = [];
        for (const op of preset.sectionOps) {
            const okey = `${op.path.join('/')}/${op.key}`;
            const override = overrides[okey];
            if (override?.omit) continue;
            const effective =
                override?.value !== undefined && !op.remove
                    ? { ...op, value: override.value }
                    : op;
            const next = applyOp(content, effective);
            if (next === null) skipped.push(okey);
            else content = next;
        }

        // ConVars: edit keys that already exist (stock entries) in place, and
        // inject the rest as one marked block right after `ConVars {`, the
        // insertion point these configs' own instructions use. Never both:
        // a duplicate convar would have ambiguous engine precedence.
        let convarRange = findSectionByPath(content, ['ConVars']);
        if (!convarRange) {
            const restorable = canRestoreBackup(gameinfoPath, original);
            const how = restorable
                ? 'Restore the Grimoire backup below, or verify game files in Steam, then try again.'
                : 'Verify game files in Steam and try again.';
            return status('error', `gameinfo.gi has no ConVars section. ${how}`, 0, restorable);
        }
        const existingKeys = new Set(
            content
                .slice(convarRange.bodyStart, convarRange.bodyEnd)
                .split('\n')
                .map(entryKey)
                .filter(Boolean)
        );
        const toInject: Array<readonly [string, string]> = [];
        for (const [key, value] of convars) {
            const override = overrides[`ConVars/${key}`];
            if (override?.omit) continue;
            const effective = override?.value ?? value;
            if (existingKeys.has(key)) {
                content = applyOp(content, { path: ['ConVars'], key, value: effective })!;
            } else {
                toInject.push([key, effective]);
            }
        }
        // The user's own convars (added inside the marked block by hand and
        // harvested as overrides) ride along in the injected block.
        const presetConvarKeys = new Set(convars.map(([key]) => key));
        for (const [okey, override] of Object.entries(overrides)) {
            if (!okey.startsWith('ConVars/') || override.value === undefined) continue;
            const key = okey.slice('ConVars/'.length);
            if (presetConvarKeys.has(key)) continue;
            if (existingKeys.has(key)) {
                content = applyOp(content, { path: ['ConVars'], key, value: override.value })!;
            } else {
                toInject.push([key, override.value]);
            }
        }
        convarRange = findSectionByPath(content, ['ConVars'])!;
        const indent = detectIndent(content.slice(convarRange.bodyStart, convarRange.bodyEnd));
        const width = toInject.length ? Math.max(...toInject.map(([k]) => k.length)) + 1 : 0;
        const optInNote = optIns.length
            ? `${indent}// Includes ${optIns.length} creator gameplay setting${optIns.length === 1 ? '' : 's'} [${MARKER}]`
            : null;
        const block = [
            `${indent}// ==== Grimoire Performance Config BEGIN (preset=${preset.id} v${preset.version} @${preset.upstream.commit.slice(0, 12)}) ====`,
            `${indent}// ${preset.name}: values from ${preset.upstream.credit} (${preset.upstream.license}) [${MARKER}]`,
            `${indent}// ${preset.upstream.url} @ ${preset.upstream.commit.slice(0, 12)} [${MARKER}]`,
            ...(optInNote ? [optInNote] : []),
            `${indent}// remove or change preset via Grimoire Settings [${MARKER}]`,
            ...toInject.map(([k, v]) => `${indent}${k.padEnd(width)}${quote(v)} // ${MARKER} added`),
            `${indent}// ==== Grimoire Performance Config END ====`,
        ].join('\n');
        // Insert after the rest of the `ConVars {` line, not immediately after
        // the brace. Some configs leave trailing whitespace there ("\t{\t "),
        // and splicing at the brace would carry those characters onto our END
        // marker line, which Remove deletes whole: the round-trip would then
        // silently drop them. Only skip past whitespace, so a file that opens
        // the block and starts an entry on the same line still splices safely.
        const lineEnd = content.indexOf('\n', convarRange.bodyStart);
        const tail =
            lineEnd >= 0 && !content.slice(convarRange.bodyStart, lineEnd).trim()
                ? lineEnd
                : convarRange.bodyStart;
        content = content.slice(0, tail) + '\n' + block + content.slice(tail);

        // Sanity: line-based edits must never unbalance the file.
        if (braceCount(content) !== braceCount(original)) {
            return status('error', 'Patch produced an unbalanced gameinfo.gi; no changes were written.');
        }

        const finalText = crlf ? content.split('\n').join('\r\n') : content;
        writeFileSync(gameinfoPath, finalText, 'utf-8');
        saved[preset.id] = overrides;
        writeAppliedState(gameinfoPath, {
            presetId: preset.id,
            version: preset.version,
            contentHash: sha256(finalText),
            optIns,
            overridesByPreset: saved,
        });

        const kept = Object.keys(overrides).length;
        const keptNote = kept ? ` Kept ${kept} of your override${kept === 1 ? '' : 's'}.` : '';
        const switchNote = switching ? ` Replaced ${appliedPreset.name}.` : '';
        const note = skipped.length
            ? ` (${skipped.length} setting${skipped.length === 1 ? '' : 's'} skipped: section not found, likely changed by a game update)`
            : '';
        return status(
            'applied',
            `${preset.name} v${preset.version} applied${note}.${switchNote}${keptNote}`,
            kept,
            false,
            preset
        );
    } catch (err) {
        return status('error', `Failed to apply performance config: ${err}`);
    }
}

/** Reapply the pure preset, discarding the user's saved overrides. */
export function resetPerformanceConfigOverrides(
    deadlockPath: string | null,
    opts?: Omit<ApplyOptions, 'resetOverrides'>
): PerformanceConfigStatus {
    return applyPerformanceConfig(deadlockPath, { ...opts, resetOverrides: true });
}

function braceCount(content: string): number {
    let n = 0;
    for (const ch of content) if (ch === '{' || ch === '}') n++;
    return n;
}

// ---------------------------------------------------------------------------
// Remove
// ---------------------------------------------------------------------------

// Reverse every marked line. Input and output are LF-normalized.
function removeMarkers(content: string): string {
    const wasRe = new RegExp(`^(.*?) // ${MARKER} was ("[^"]*"|\\S+)\\s*$`);
    const removedRe = new RegExp(`^([ \\t]*)// ${MARKER} removed: (.*)$`);
    const out: string[] = [];
    for (const line of content.split('\n')) {
        // Block header/footer + injected entries: drop the line entirely.
        // Only lines Grimoire wrote carry these exact markers, so a manually
        // installed OptimizationLock config (full of "OptimizationLock"
        // comments of its own) is never touched.
        if (
            line.includes(`// ${MARKER} added`) ||
            line.includes(`[${MARKER}]`) ||
            /Grimoire Performance Config (BEGIN|END)/.test(line)
        ) {
            continue;
        }
        // Edited stock entry: restore the recorded original value.
        const was = wasRe.exec(line);
        if (was) {
            const key = entryKey(was[1]);
            const entry = key ? matchEntryLine(was[1], key) : null;
            if (entry) {
                out.push(`${entry.prefix}${was[2]}${entry.suffix}`);
                continue;
            }
        }
        // Commented-out stock entry: bring the original line back.
        const removed = removedRe.exec(line);
        if (removed) {
            out.push(`${removed[1]}${removed[2]}`);
            continue;
        }
        out.push(line);
    }
    return out.join('\n');
}

export function removePerformanceConfig(deadlockPath: string | null): PerformanceConfigStatus {
    if (!deadlockPath) return status('error', 'Deadlock path not configured.');
    const gameinfoPath = getGameinfoPath(deadlockPath);
    if (!existsSync(gameinfoPath)) {
        return status('error', 'gameinfo.gi not found.');
    }
    try {
        const content = readFileSync(gameinfoPath, 'utf-8');
        if (!content.includes(MARKER)) {
            clearAppliedState(gameinfoPath);
            return status('not-applied', 'No performance config to remove.');
        }
        const crlf = content.includes('\r\n');
        const restored = removeMarkers(crlf ? content.split('\r\n').join('\n') : content);
        writeFileSync(gameinfoPath, crlf ? restored.split('\n').join('\r\n') : restored, 'utf-8');
        clearAppliedState(gameinfoPath);
        return status('not-applied', 'Performance config removed; stock values restored.');
    } catch (err) {
        return status('error', `Failed to remove performance config: ${err}`);
    }
}

/** Restore gameinfo.gi from the Grimoire backup (.grimoire-bak), the pristine
 *  pre-apply copy shared with fixGameinfo. Recovery for an emptied or corrupt
 *  file the preset can no longer patch; after restoring, Apply runs normally.
 *  The applied-state sidecar is left intact so the user's saved overrides
 *  re-layer on the next apply. Refuses when no backup exists. */
export function restorePerformanceConfigBackup(
    deadlockPath: string | null
): PerformanceConfigStatus {
    if (!deadlockPath) return status('error', 'Deadlock path not configured.');
    const gameinfoPath = getGameinfoPath(deadlockPath);
    const backupPath = backupPathFor(gameinfoPath);
    if (!existsSync(backupPath)) {
        return status(
            'error',
            'No Grimoire backup of gameinfo.gi to restore. Verify game files in Steam instead.'
        );
    }
    try {
        const backup = readFileSync(backupPath, 'utf-8');
        writeFileSync(gameinfoPath, backup, 'utf-8');
        // Markers are gone (the backup predates any apply) but the sidecar
        // stays, so this reads back as a clean "wiped" state: Reapply re-adds
        // the preset and folds the saved overrides back in.
        const sidecar = readAppliedState(gameinfoPath);
        const savedOverrides = Object.keys(
            allOverrides(sidecar)[sidecar?.presetId ?? DEFAULT_PRESET_ID] ?? {}
        ).length;
        const note = savedOverrides
            ? ` Your ${savedOverrides} saved override${savedOverrides === 1 ? '' : 's'} will be restored on reapply.`
            : '';
        return status(
            'wiped',
            `Restored gameinfo.gi from the Grimoire backup. Reapply to re-add the performance config.${note}`,
            savedOverrides
        );
    } catch (err) {
        return status('error', `Failed to restore gameinfo.gi backup: ${err}`);
    }
}

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

/** The selectable presets, flattened for the renderer (which must not import
 *  the generated data module: it lives in the main process). */
export function listPerformancePresets(): PerformancePresetSummary[] {
    return PRESETS.map((family) => {
        // Top-level fields describe the newest release, which is what a caller
        // that never touches the version picker gets. `versions` carries the
        // rest, newest first.
        const newest = family.releases[0];
        const summarize = (release: (typeof family.releases)[number]) => ({
            version: release.version,
            ref: release.ref,
            refKind: release.refKind,
            commit: release.commit,
            date: release.date,
            settingCount: release.convars.length + release.sectionOps.length,
            optIn: release.optIn.map((control) => ({
                key: control.key,
                value: control.value,
                group: control.group,
            })),
        });
        return {
            id: family.id,
            name: family.name,
            version: newest.version,
            tier: family.tier,
            author: family.author,
            unstable: family.unstable === true,
            isDefault: family.id === DEFAULT_PRESET_ID,
            settingCount: newest.convars.length + newest.sectionOps.length,
            upstream: {
                url: family.upstream.url,
                repo: family.upstream.repo,
                ref: newest.ref,
                refKind: newest.refKind,
                commit: newest.commit,
                license: family.upstream.license,
                credit: family.upstream.credit,
            },
            optIn: newest.optIn.map((control) => ({
                key: control.key,
                value: control.value,
                group: control.group,
            })),
            versions: family.releases.map(summarize),
        };
    });
}

export function getPerformanceConfigStatus(deadlockPath: string | null): PerformanceConfigStatus {
    if (!deadlockPath) return status('not-applied', 'Deadlock path not configured.');
    const gameinfoPath = getGameinfoPath(deadlockPath);
    if (!existsSync(gameinfoPath)) return status('not-applied', 'gameinfo.gi not found.');

    try {
        const content = readFileSync(gameinfoPath, 'utf-8');
        const begin = BEGIN_RE.exec(content);
        if (begin) {
            // The sidecar records a hash of the exact bytes Grimoire wrote, so
            // a mismatch while the markers are intact means hand edits. Old
            // sidecars without a hash just never set the flag.
            const sidecar = readAppliedState(gameinfoPath);
            const handEdited =
                typeof sidecar?.contentHash === 'string' && sidecar.contentHash !== sha256(content);
            // The marker is authoritative for which preset is in the file: the
            // sidecar can be stale or absent (hand-installed, restored backup).
            const appliedId = begin[1];
            const known = PRESETS.find((p) => p.id === appliedId) ?? null;
            const overrideCount = Object.keys(allOverrides(sidecar)[appliedId] ?? {}).length;
            const appliedName = known?.name ?? appliedId;
            // "Newest we bundle", not "the one the user picked": the selection
            // lives in renderer settings, so the card decides whether a newer
            // release is a nag ("you are behind") or a note ("you rolled back
            // on purpose"). Main only reports the two facts.
            const newestVersion = known?.releases[0].version ?? null;
            const base =
                newestVersion && begin[2] !== newestVersion
                    ? `${appliedName} v${begin[2]} is applied; v${newestVersion} is available (reapply to update).`
                    : `${appliedName} v${begin[2]} is applied.`;
            const overrideNote = overrideCount
                ? ` Keeping ${overrideCount} of your override${overrideCount === 1 ? '' : 's'}.`
                : '';
            return {
                state: 'applied',
                appliedPresetId: appliedId,
                appliedVersion: begin[2],
                // For a preset we do not bundle (a marker from a newer or
                // hand-written Grimoire), report the file's own version rather
                // than the default preset's: claiming an update is available
                // from an unrelated preset would be a lie.
                bundledVersion: newestVersion ?? begin[2],
                appliedOptIns: sidecar?.optIns ?? [],
                handEdited,
                overrideCount,
                message: handEdited
                    ? `${base}${overrideNote} The file has manual edits: Reapply folds them into your overrides.`
                    : `${base}${overrideNote}`,
            };
        }
        // Applied before, but the markers are gone: a game update replaced
        // gameinfo.gi (Valve resets it on major patches), or the user cleared
        // the file by hand. If the file is too broken to patch (no ConVars)
        // and we hold a backup, point at the restore path rather than a
        // Reapply that will only error.
        const wipedSidecar = readAppliedState(gameinfoPath);
        if (wipedSidecar) {
            const wipedId = wipedSidecar.presetId ?? DEFAULT_PRESET_ID;
            const savedOverrides = Object.keys(allOverrides(wipedSidecar)[wipedId] ?? {}).length;
            const restorable = canRestoreBackup(gameinfoPath, content);
            // Resolve at the version the sidecar recorded: a user who rolled
            // back to an older release and then got wiped by a game update
            // should be offered their release back, not quietly moved to the
            // newest one they had already rejected.
            const wipedPreset = resolvePreset(wipedId, wipedSidecar.version);
            if (restorable) {
                return status(
                    'wiped',
                    'gameinfo.gi is empty or corrupt. Restore the Grimoire backup (or verify game files in Steam), then reapply.',
                    savedOverrides,
                    true,
                    wipedPreset
                );
            }
            const restoreNote = savedOverrides
                ? ` Your ${savedOverrides} saved override${savedOverrides === 1 ? '' : 's'} will be restored too.`
                : '';
            return status(
                'wiped',
                `A game update reset gameinfo.gi and removed ${wipedPreset.name}. Reapply to restore it.${restoreNote}`,
                savedOverrides,
                false,
                wipedPreset
            );
        }
        return status('not-applied', 'Performance config is not applied.');
    } catch (err) {
        return status('error', `Failed to read gameinfo.gi: ${err}`);
    }
}

function status(
    state: PerformanceConfigStatus['state'],
    message: string,
    overrideCount = 0,
    canRestore = false,
    preset?: PerformancePreset
): PerformanceConfigStatus {
    const target = preset ?? getPreset(DEFAULT_PRESET_ID);
    return {
        state,
        appliedPresetId: state === 'applied' || state === 'wiped' ? target.id : null,
        appliedVersion: state === 'applied' ? target.version : null,
        bundledVersion: target.version,
        overrideCount,
        ...(canRestore ? { canRestoreBackup: true } : {}),
        message,
    };
}

function sha256(text: string): string {
    return createHash('sha256').update(text, 'utf-8').digest('hex');
}

interface AppliedState {
    presetId: string;
    version: string;
    contentHash?: string;
    /** Opt-in gameplay convar keys written for `presetId`. */
    optIns?: string[];
    /** Overrides per preset id. Each preset is tuned differently, so a value
     *  the user picked under one is not carried into another. */
    overridesByPreset?: Record<string, Overrides>;
    /** Pre-multi-preset sidecars stored a single flat map. Read-only: migrated
     *  by `allOverrides` and never written again. */
    overrides?: Overrides;
}

/** Overrides keyed by preset id, migrating the flat single-preset shape that
 *  sidecars written before multi-preset support used. That map belongs to
 *  whichever preset was applied at the time, which is what `presetId` records. */
function allOverrides(state: AppliedState | null): Record<string, Overrides> {
    if (!state) return {};
    const byPreset = { ...(state.overridesByPreset ?? {}) };
    if (state.overrides && Object.keys(state.overrides).length) {
        const legacyId = state.presetId ?? DEFAULT_PRESET_ID;
        byPreset[legacyId] = { ...state.overrides, ...(byPreset[legacyId] ?? {}) };
    }
    return byPreset;
}

function readAppliedState(gameinfoPath: string): AppliedState | null {
    try {
        const raw = readFileSync(statePath(gameinfoPath), 'utf-8');
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed.presetId === 'string' ? parsed : null;
    } catch {
        return null;
    }
}

function writeAppliedState(
    gameinfoPath: string,
    state: {
        presetId: string;
        version: string;
        contentHash: string;
        optIns: string[];
        overridesByPreset: Record<string, Overrides>;
    }
): void {
    try {
        const trimmed: AppliedState = {
            presetId: state.presetId,
            version: state.version,
            contentHash: state.contentHash,
        };
        if (state.optIns.length) trimmed.optIns = state.optIns;
        // Drop presets whose override map went empty so the sidecar does not
        // grow a dead entry per preset the user tried.
        const kept = Object.entries(state.overridesByPreset).filter(
            ([, map]) => Object.keys(map).length > 0
        );
        if (kept.length) trimmed.overridesByPreset = Object.fromEntries(kept);
        writeFileSync(statePath(gameinfoPath), JSON.stringify(trimmed), 'utf-8');
    } catch {
        // Best-effort: losing the sidecar only degrades wiped-detection to
        // "not applied"; it must never fail the apply/remove itself.
    }
}

function clearAppliedState(gameinfoPath: string): void {
    try {
        const file = statePath(gameinfoPath);
        if (existsSync(file)) unlinkSync(file);
    } catch {
        // Best-effort, as above.
    }
}
