// Apply/remove the bundled OptimizationLock performance preset by patching
// the user's gameinfo.gi in place (never replacing the file). Every change is
// tagged with an inline "grimoire-perf" marker so removal needs no external
// state: added lines are deleted, edited lines restore the recorded original
// value, and removed lines are uncommented. fixGameinfo (system.ts) only
// rewrites the SearchPaths block, so the two never fight over the same lines.
//
// All patching runs on LF-normalized text and the file's original EOL style
// is restored on write: line-based regexes silently fail on CR-terminated
// lines otherwise (JS `.` does not match \r), which would inject duplicate
// convars with ambiguous engine precedence on Windows CRLF files.
import { createHash } from 'crypto';
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { getGameinfoPath } from './deadlock';
import type { PerformanceConfigStatus } from '../../../src/types/electron';
import {
    CONVARS,
    PRESET_ID,
    PRESET_VERSION,
    SECTION_OPS,
    type SectionOp,
} from './performanceConfigData';

const MARKER = 'grimoire-perf';
const BEGIN_RE = /Grimoire Performance Config BEGIN \(preset=([\w-]+) v([\w.]+)\)/;
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

function statePath(gameinfoPath: string): string {
    return join(dirname(gameinfoPath), STATE_FILENAME);
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

// Bare key -> preset value + override key. null marks a bare key that appears
// more than once in the preset (ambiguous: harvesting it could attribute a
// value to the wrong section, so we skip it). Remove-type ops carry no value
// and are not overridable.
function presetKeyIndex(): Map<string, { okey: string; value: string } | null> {
    const idx = new Map<string, { okey: string; value: string } | null>();
    const put = (bare: string, okey: string, value: string) => {
        idx.set(bare, idx.has(bare) ? null : { okey, value });
    };
    for (const [key, value] of CONVARS) put(key, `ConVars/${key}`, value);
    for (const op of SECTION_OPS) {
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
function harvestOverrides(content: string): Overrides {
    const idx = presetKeyIndex();
    const overrides: Overrides = {};
    const addedToken = `// ${MARKER} added`;
    const wasRe = new RegExp(`^(.*?) // ${MARKER} was ("[^"]*"|\\S+)\\s*$`);

    for (const line of content.split('\n')) {
        const addedAt = line.indexOf(addedToken);
        if (addedAt >= 0) {
            const body = line.slice(0, addedAt);
            const isCommented = /^[ \t]*\/\//.test(body);
            const active = isCommented ? body.replace(/^[ \t]*\/\/[ \t]*/, '') : body;
            const key = entryKey(active);
            if (!key) continue;
            const entry = matchEntryLine(active, key);
            const preset = idx.get(key);
            if (preset === null) continue; // ambiguous bare key
            if (!preset) {
                // Not in the preset: the user's own convar inside our block.
                if (!isCommented && entry) {
                    overrides[`ConVars/${key}`] = { value: unquote(entry.value) };
                }
                continue;
            }
            if (isCommented) overrides[preset.okey] = { omit: true };
            else if (entry && unquote(entry.value) !== preset.value) {
                overrides[preset.okey] = { value: unquote(entry.value) };
            }
            continue;
        }
        const was = wasRe.exec(line);
        if (was) {
            const key = entryKey(was[1]);
            const entry = key ? matchEntryLine(was[1], key) : null;
            const preset = key ? idx.get(key) : null;
            if (preset && entry && unquote(entry.value) !== preset.value) {
                overrides[preset.okey] = { value: unquote(entry.value) };
            }
        }
    }

    // Deleted preset convars: every CONVARS key is present after an apply
    // (edited in place or injected), so one with no active entry left in the
    // ConVars section was removed by the user.
    const convarRange = findSectionByPath(content, ['ConVars']);
    if (convarRange) {
        const activeKeys = new Set(
            content
                .slice(convarRange.bodyStart, convarRange.bodyEnd)
                .split('\n')
                .map(entryKey)
                .filter(Boolean)
        );
        for (const [key] of CONVARS) {
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
    opts?: { resetOverrides?: boolean }
): PerformanceConfigStatus {
    if (!deadlockPath) return status('error', 'Deadlock path not configured.');
    const gameinfoPath = getGameinfoPath(deadlockPath);
    if (!existsSync(gameinfoPath)) {
        return status('error', 'gameinfo.gi not found. Configure your Deadlock path first.');
    }

    try {
        const original = readFileSync(gameinfoPath, 'utf-8');
        const crlf = original.includes('\r\n');

        // Work in LF-space (see header comment), restore the EOL style on write.
        let content = crlf ? original.split('\r\n').join('\n') : original;
        // User overrides: harvested fresh from the file when a config is
        // present (so hand edits made since the last apply are captured), or
        // carried over from the sidecar when a game update wiped the file.
        let overrides: Overrides = {};
        if (!opts?.resetOverrides) {
            overrides = BEGIN_RE.test(content)
                ? harvestOverrides(content)
                : (readAppliedState(gameinfoPath)?.overrides ?? {});
        }
        // Reapplying (e.g. after a preset data update) starts from a clean base.
        if (BEGIN_RE.test(content)) content = removeMarkers(content);

        // One-time recovery copy of the oldest version we have seen, shared
        // with fixGameinfo's backup so the user has a single restore point.
        const backupPath = `${gameinfoPath}${GAMEINFO_BACKUP_SUFFIX}`;
        if (!existsSync(backupPath)) {
            try {
                writeFileSync(backupPath, original, 'utf-8');
            } catch {
                // Best-effort: a failed backup must not block the apply.
            }
        }

        const skipped: string[] = [];
        for (const op of SECTION_OPS) {
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
        // insertion point OptimizationLock's own instructions use. Never both:
        // a duplicate convar would have ambiguous engine precedence.
        let convarRange = findSectionByPath(content, ['ConVars']);
        if (!convarRange) {
            return status('error', 'gameinfo.gi has no ConVars section. Verify game files in Steam and try again.');
        }
        const existingKeys = new Set(
            content
                .slice(convarRange.bodyStart, convarRange.bodyEnd)
                .split('\n')
                .map(entryKey)
                .filter(Boolean)
        );
        const toInject: Array<readonly [string, string]> = [];
        for (const [key, value] of CONVARS) {
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
        const presetConvarKeys = new Set(CONVARS.map(([key]) => key));
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
        const block = [
            `${indent}// ==== Grimoire Performance Config BEGIN (preset=${PRESET_ID} v${PRESET_VERSION}) ====`,
            `${indent}// Values from OptimizationLock by Sqooky and contributors (GPL-3.0) [${MARKER}]`,
            `${indent}// https://github.com/Sqooky/OptimizationLock - remove via Grimoire Settings [${MARKER}]`,
            ...toInject.map(([k, v]) => `${indent}${k.padEnd(width)}${quote(v)} // ${MARKER} added`),
            `${indent}// ==== Grimoire Performance Config END ====`,
        ].join('\n');
        content =
            content.slice(0, convarRange.bodyStart) + '\n' + block + content.slice(convarRange.bodyStart);

        // Sanity: line-based edits must never unbalance the file.
        if (braceCount(content) !== braceCount(original)) {
            return status('error', 'Patch produced an unbalanced gameinfo.gi; no changes were written.');
        }

        const finalText = crlf ? content.split('\n').join('\r\n') : content;
        writeFileSync(gameinfoPath, finalText, 'utf-8');
        writeAppliedState(gameinfoPath, true, sha256(finalText), overrides);

        const kept = Object.keys(overrides).length;
        const keptNote = kept
            ? ` Kept ${kept} of your override${kept === 1 ? '' : 's'}.`
            : '';
        const note = skipped.length
            ? ` (${skipped.length} setting${skipped.length === 1 ? '' : 's'} skipped: section not found, likely changed by a game update)`
            : '';
        return status('applied', `Performance config v${PRESET_VERSION} applied${note}.${keptNote}`, kept);
    } catch (err) {
        return status('error', `Failed to apply performance config: ${err}`);
    }
}

/** Reapply the pure preset, discarding the user's saved overrides. */
export function resetPerformanceConfigOverrides(
    deadlockPath: string | null
): PerformanceConfigStatus {
    return applyPerformanceConfig(deadlockPath, { resetOverrides: true });
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
            writeAppliedState(gameinfoPath, false);
            return status('not-applied', 'No performance config to remove.');
        }
        const crlf = content.includes('\r\n');
        const restored = removeMarkers(crlf ? content.split('\r\n').join('\n') : content);
        writeFileSync(gameinfoPath, crlf ? restored.split('\n').join('\r\n') : restored, 'utf-8');
        writeAppliedState(gameinfoPath, false);
        return status('not-applied', 'Performance config removed; stock values restored.');
    } catch (err) {
        return status('error', `Failed to remove performance config: ${err}`);
    }
}

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

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
            const overrideCount = Object.keys(sidecar?.overrides ?? {}).length;
            const base =
                begin[2] === PRESET_VERSION
                    ? `Performance config v${begin[2]} is applied.`
                    : `Performance config v${begin[2]} is applied; v${PRESET_VERSION} is available (reapply to update).`;
            const overrideNote = overrideCount
                ? ` Keeping ${overrideCount} of your override${overrideCount === 1 ? '' : 's'}.`
                : '';
            return {
                state: 'applied',
                appliedVersion: begin[2],
                bundledVersion: PRESET_VERSION,
                handEdited,
                overrideCount,
                message: handEdited
                    ? `${base}${overrideNote} The file has manual edits: Reapply folds them into your overrides.`
                    : `${base}${overrideNote}`,
            };
        }
        // Applied before, but the markers are gone: a game update replaced
        // gameinfo.gi (Valve resets it on major patches).
        const wipedSidecar = readAppliedState(gameinfoPath);
        if (wipedSidecar) {
            const savedOverrides = Object.keys(wipedSidecar.overrides ?? {}).length;
            const restoreNote = savedOverrides
                ? ` Your ${savedOverrides} saved override${savedOverrides === 1 ? '' : 's'} will be restored too.`
                : '';
            return status(
                'wiped',
                `A game update reset gameinfo.gi and removed the performance config. Reapply to restore it.${restoreNote}`,
                savedOverrides
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
    overrideCount = 0
): PerformanceConfigStatus {
    return {
        state,
        appliedVersion: state === 'applied' ? PRESET_VERSION : null,
        bundledVersion: PRESET_VERSION,
        overrideCount,
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
    overrides?: Overrides;
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
    applied: boolean,
    contentHash?: string,
    overrides?: Overrides
): void {
    const file = statePath(gameinfoPath);
    try {
        if (applied) {
            const state: AppliedState = { presetId: PRESET_ID, version: PRESET_VERSION, contentHash };
            if (overrides && Object.keys(overrides).length) state.overrides = overrides;
            writeFileSync(file, JSON.stringify(state), 'utf-8');
        } else if (existsSync(file)) {
            unlinkSync(file);
        }
    } catch {
        // Best-effort: losing the sidecar only degrades wiped-detection to
        // "not applied"; it must never fail the apply/remove itself.
    }
}
