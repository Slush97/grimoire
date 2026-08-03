// Round-trip and isolation tests for the gameinfo.gi performance patcher.
//
// The load-bearing guarantee is that apply -> remove returns the user's file
// byte for byte, for every bundled preset, on both EOL styles, whatever the
// starting file looked like. Everything else in this feature (preset
// switching, opt-ins, overrides, wipe recovery) is layered on top of that, so
// it is asserted here rather than trusted.
//
// The fixture is the stock Deadlock gameinfo.gi the presets were diffed
// against (see scripts/performance-presets.json).
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
    applyPerformanceConfig,
    getPerformanceConfigStatus,
    listPerformancePresets,
    removePerformanceConfig,
    resetPerformanceConfigOverrides,
} from './performanceConfig';

const STOCK = readFileSync(join(__dirname, '__fixtures__/stock-gameinfo.gi'), 'utf-8');
const STOCK_CRLF = STOCK.split('\n').join('\r\n');
const PRESETS = listPerformancePresets();

let gameRoot: string;
let gameinfo: string;
let sidecarPath: string;

beforeEach(() => {
    gameRoot = mkdtempSync(join(tmpdir(), 'grimoire-perf-'));
    const dir = join(gameRoot, 'game', 'citadel');
    mkdirSync(dir, { recursive: true });
    gameinfo = join(dir, 'gameinfo.gi');
    sidecarPath = join(dir, 'grimoire-performance.json');
    writeFileSync(gameinfo, STOCK, 'utf-8');
});

afterEach(() => {
    rmSync(gameRoot, { recursive: true, force: true });
});

const read = () => readFileSync(gameinfo, 'utf-8');
const write = (text: string) => writeFileSync(gameinfo, text, 'utf-8');
const sidecar = () => (existsSync(sidecarPath) ? JSON.parse(readFileSync(sidecarPath, 'utf-8')) : null);

/** Is `key` set on an active (uncommented) line? */
function activeHas(text: string, key: string): boolean {
    return text
        .split('\n')
        .some((line) => !line.trim().startsWith('//') && new RegExp(`(^|\\s)"?${key}"?\\s`).test(line));
}

/** Convar keys at the top level of the ConVars block. Nested constraint blocks
 *  (`rate { min/default/max }`) legitimately repeat their keys and are skipped. */
function topLevelConvarCounts(text: string): Map<string, number> {
    const start = text.indexOf('{', text.indexOf('\n    ConVars')) + 1;
    const counts = new Map<string, number>();
    let depth = 0;
    for (const line of text.slice(start).split('\n')) {
        const t = line.trim();
        if (t.startsWith('//')) continue;
        if (depth === 0 && t === '}') break;
        if (depth === 0) {
            const m = /^"?([A-Za-z_][\w.]*)"?\s+("[^"]*"|[^\s/]+)/.exec(t);
            if (m) counts.set(m[1], (counts.get(m[1]) ?? 0) + 1);
        }
        depth += (t.match(/\{/g) || []).length - (t.match(/\}/g) || []).length;
    }
    return counts;
}

describe('performance presets', () => {
    it('bundles a default preset and unique ids', () => {
        expect(PRESETS.length).toBeGreaterThanOrEqual(4);
        expect(PRESETS.filter((p) => p.isDefault)).toHaveLength(1);
        expect(new Set(PRESETS.map((p) => p.id)).size).toBe(PRESETS.length);
    });

    it.each(PRESETS.map((p) => [p.id] as const))(
        '%s: apply then remove restores the file byte for byte (LF)',
        (id) => {
            expect(applyPerformanceConfig(gameRoot, { presetId: id }).state).toBe('applied');
            expect(read()).not.toBe(STOCK);
            expect(removePerformanceConfig(gameRoot).state).toBe('not-applied');
            expect(read()).toBe(STOCK);
        }
    );

    it.each(PRESETS.map((p) => [p.id] as const))(
        '%s: apply then remove restores the file byte for byte (CRLF)',
        (id) => {
            write(STOCK_CRLF);
            expect(applyPerformanceConfig(gameRoot, { presetId: id }).state).toBe('applied');
            removePerformanceConfig(gameRoot);
            expect(read()).toBe(STOCK_CRLF);
        }
    );

    it.each(PRESETS.map((p) => [p.id, p.version] as const))(
        '%s: writes a marker naming the preset and version',
        (id, version) => {
            applyPerformanceConfig(gameRoot, { presetId: id });
            expect(read()).toContain(`preset=${id} v${version}`);
        }
    );

    it.each(PRESETS.map((p) => [p.id] as const))(
        '%s: never writes a duplicate active convar, even with every opt-in on',
        (id) => {
            const preset = PRESETS.find((p) => p.id === id)!;
            applyPerformanceConfig(gameRoot, {
                presetId: id,
                optIns: preset.optIn.map((c) => c.key),
            });
            const dupes = [...topLevelConvarCounts(read())].filter(([, n]) => n > 1);
            expect(dupes).toEqual([]);
        }
    );

    it('is idempotent: applying repeatedly does not accumulate', () => {
        applyPerformanceConfig(gameRoot, { presetId: 'optilock-max' });
        const once = read();
        applyPerformanceConfig(gameRoot, { presetId: 'optilock-max' });
        applyPerformanceConfig(gameRoot, { presetId: 'optilock-max' });
        expect(read()).toBe(once);
    });

    // Regression: the block used to splice in immediately after the `{` of
    // `ConVars {`, so trailing whitespace on that line rode along on the END
    // marker and vanished when Remove deleted it.
    it('preserves trailing whitespace after the ConVars opening brace', () => {
        const withTrailing = STOCK.replace(/(\n\s*ConVars\r?\n\s*\{)/, '$1\t ');
        expect(withTrailing).not.toBe(STOCK);
        write(withTrailing);
        applyPerformanceConfig(gameRoot, { presetId: 'sqooky-default' });
        removePerformanceConfig(gameRoot);
        expect(read()).toBe(withTrailing);
    });
});

// Older releases are bundled so a user whose frame rate got worse after an
// upstream bump can go back. They are diffed against the CURRENT baseline, not
// the stock file of their own era, so "an old release still applies cleanly to
// today's gameinfo.gi" is an assumption that has to be tested rather than
// assumed: it is exactly what would rot silently as the game updates.
describe('preset version history', () => {
    /** Every (preset, bundled release) pair. */
    const ALL = PRESETS.flatMap((p) => p.versions.map((v) => [p.id, v.version] as const));

    it('every preset bundles at least one release, newest first', () => {
        for (const preset of PRESETS) {
            expect(preset.versions.length).toBeGreaterThanOrEqual(1);
            // The top-level fields must describe the newest release, or a caller
            // that ignores `versions` silently gets a different preset than the
            // one the card credits.
            expect(preset.versions[0].version).toBe(preset.version);
            const dates = preset.versions.map((v) => v.date);
            expect([...dates].sort().reverse()).toEqual(dates);
        }
    });

    it('no preset offers the same version twice', () => {
        for (const preset of PRESETS) {
            const versions = preset.versions.map((v) => v.version);
            expect(new Set(versions).size).toBe(versions.length);
        }
    });

    it.each(ALL)('%s v%s: apply then remove restores the file byte for byte', (id, version) => {
        expect(applyPerformanceConfig(gameRoot, { presetId: id, version }).state).toBe('applied');
        expect(read()).not.toBe(STOCK);
        expect(removePerformanceConfig(gameRoot).state).toBe('not-applied');
        expect(read()).toBe(STOCK);
    });

    it.each(ALL)('%s v%s: writes a marker naming that release', (id, version) => {
        applyPerformanceConfig(gameRoot, { presetId: id, version });
        expect(read()).toContain(`preset=${id} v${version}`);
        expect(sidecar()?.version).toBe(version);
    });

    it.each(ALL)('%s v%s: no duplicate active convars with every opt-in on', (id, version) => {
        const release = PRESETS.find((p) => p.id === id)!.versions.find(
            (v) => v.version === version
        )!;
        applyPerformanceConfig(gameRoot, {
            presetId: id,
            version,
            optIns: release.optIn.map((c) => c.key),
        });
        const dupes = [...topLevelConvarCounts(read())].filter(([, n]) => n > 1);
        expect(dupes).toEqual([]);
    });

    const rollbackable = PRESETS.filter((p) => p.versions.length > 1);

    it('at least one preset has something to roll back to', () => {
        expect(rollbackable.length).toBeGreaterThan(0);
    });

    it.each(rollbackable.map((p) => [p.id] as const))(
        '%s: rolling back from newest to older leaves a clean file',
        (id) => {
            const preset = PRESETS.find((p) => p.id === id)!;
            const older = preset.versions[preset.versions.length - 1].version;
            applyPerformanceConfig(gameRoot, { presetId: id, version: preset.version });
            expect(read()).toContain(`preset=${id} v${preset.version}`);

            // Rolling back goes through the same revert-then-inject path as a
            // preset switch, so the newer release's lines must be gone, not
            // merely overwritten where the two happen to share a key.
            applyPerformanceConfig(gameRoot, { presetId: id, version: older });
            const after = read();
            expect(after).toContain(`preset=${id} v${older}`);
            expect(after).not.toContain(`v${preset.version})`);
            expect([...topLevelConvarCounts(after)].filter(([, n]) => n > 1)).toEqual([]);

            expect(removePerformanceConfig(gameRoot).state).toBe('not-applied');
            expect(read()).toBe(STOCK);
        }
    );

    it('an unknown version falls back to the newest release', () => {
        // A saved pin naming a release that has aged out of the bundle must not
        // error or write nothing: the window slides on every upstream bump.
        applyPerformanceConfig(gameRoot, { presetId: 'sqooky-default', version: '0.0.1-gone' });
        const newest = PRESETS.find((p) => p.id === 'sqooky-default')!.version;
        expect(read()).toContain(`preset=sqooky-default v${newest}`);
    });

    // Release pairs where the newest holds back a gameplay key the older one
    // does not define at all. Asking for that key while the older release is
    // selected must drop it rather than write an unknown convar.
    const divergentOptIns = rollbackable.flatMap((p) =>
        p.versions.slice(1).flatMap((older) => {
            const onlyInNewest = p.versions[0].optIn
                .map((c) => c.key)
                .filter((key) => !older.optIn.some((c) => c.key === key));
            return onlyInNewest.length ? [[p.id, older.version, onlyInNewest] as const] : [];
        })
    );

    it('some release pair disagrees about opt-ins, so the next test is not vacuous', () => {
        expect(divergentOptIns.length).toBeGreaterThan(0);
    });

    it.each(divergentOptIns)(
        '%s v%s: opt-in keys are honoured per release, not per preset',
        (id, version, onlyInNewest) => {
            const preset = PRESETS.find((p) => p.id === id)!;
            applyPerformanceConfig(gameRoot, {
                presetId: id,
                version,
                // Ask for every newest-release opt-in while an older release is
                // selected: the ones that release does not define must be dropped.
                optIns: preset.versions[0].optIn.map((c) => c.key),
            });
            const text = read();
            for (const key of onlyInNewest) expect(activeHas(text, key)).toBe(false);
        }
    );
});

describe('gameplay opt-ins', () => {
    const withOptIns = PRESETS.filter((p) => p.optIn.length > 0);

    it('every preset holds back at least one gameplay convar', () => {
        expect(withOptIns.length).toBe(PRESETS.length);
    });

    it.each(withOptIns.map((p) => [p.id] as const))(
        '%s: applies no gameplay convar unless asked',
        (id) => {
            const preset = PRESETS.find((p) => p.id === id)!;
            applyPerformanceConfig(gameRoot, { presetId: id });
            const text = read();
            const leaked = preset.optIn.filter((c) => activeHas(text, c.key));
            expect(leaked.map((c) => c.key)).toEqual([]);
        }
    );

    it.each(withOptIns.map((p) => [p.id] as const))(
        '%s: writes exactly the opted-in keys and no others',
        (id) => {
            const preset = PRESETS.find((p) => p.id === id)!;
            const chosen = preset.optIn.slice(0, 2).map((c) => c.key);
            applyPerformanceConfig(gameRoot, { presetId: id, optIns: chosen });
            const text = read();
            for (const key of chosen) expect(activeHas(text, key)).toBe(true);
            const unwanted = preset.optIn
                .filter((c) => !chosen.includes(c.key) && activeHas(text, c.key))
                .map((c) => c.key);
            expect(unwanted).toEqual([]);
        }
    );

    it('removing after an opt-in apply still restores the file exactly', () => {
        const preset = PRESETS.find((p) => p.optIn.length)!;
        applyPerformanceConfig(gameRoot, {
            presetId: preset.id,
            optIns: preset.optIn.map((c) => c.key),
        });
        removePerformanceConfig(gameRoot);
        expect(read()).toBe(STOCK);
    });

    it('ignores opt-in keys the preset does not define', () => {
        applyPerformanceConfig(gameRoot, {
            presetId: 'sqooky-default',
            optIns: ['definitely_not_a_convar'],
        });
        expect(activeHas(read(), 'definitely_not_a_convar')).toBe(false);
    });
});

describe('preset switching', () => {
    it('replaces the previous preset instead of stacking on it', () => {
        applyPerformanceConfig(gameRoot, { presetId: 'sqooky-default' });
        const result = applyPerformanceConfig(gameRoot, { presetId: 'optilock-fps' });
        const text = read();

        expect(result.state).toBe('applied');
        expect(text).toContain('preset=optilock-fps');
        expect(text).not.toContain('preset=sqooky-default');
        expect(text.match(/Grimoire Performance Config BEGIN/g)).toHaveLength(1);
        expect(getPerformanceConfigStatus(gameRoot).appliedPresetId).toBe('optilock-fps');
    });

    it('restores the stock file after cycling through every preset', () => {
        for (const preset of PRESETS) applyPerformanceConfig(gameRoot, { presetId: preset.id });
        expect(read().match(/Grimoire Performance Config BEGIN/g)).toHaveLength(1);
        removePerformanceConfig(gameRoot);
        expect(read()).toBe(STOCK);
    });

    it('falls back to the default preset for an unknown id', () => {
        const result = applyPerformanceConfig(gameRoot, { presetId: 'no-such-preset' });
        expect(result.state).toBe('applied');
        expect(read()).toContain(`preset=${PRESETS.find((p) => p.isDefault)!.id}`);
    });
});

describe('overrides', () => {
    // Hand-edit whichever key the preset actually injected: which settings a
    // preset owns changes with every upstream bump.
    function editFirstInjectedKey(value: string): string {
        const line = read()
            .split('\n')
            .find((l) => l.includes('// grimoire-perf added') && /^\s*[A-Za-z_]/.test(l))!;
        const key = /^\s*"?([A-Za-z_][\w.]*)"?\s/.exec(line)![1];
        write(
            read().replace(
                new RegExp(`^(\\s*"?${key}"?\\s+)("[^"]*"|\\S+)(\\s*// grimoire-perf added)$`, 'm'),
                `$1"${value}"$3`
            )
        );
        return key;
    }

    // The key may sit under ConVars or under an engine section (injected
    // section ops carry the same marker), so match on the leaf rather than
    // assuming a path.
    const bankedValue = (presetId: string, key: string): string | undefined => {
        const map: Record<string, { value?: string }> =
            sidecar()?.overridesByPreset?.[presetId] ?? {};
        return Object.entries(map).find(([k]) => k.endsWith(`/${key}`))?.[1]?.value;
    };

    it('harvests a hand edit and keeps it across reapplies', () => {
        applyPerformanceConfig(gameRoot, { presetId: 'sqooky-default' });
        const key = editFirstInjectedKey('144');

        const result = applyPerformanceConfig(gameRoot, { presetId: 'sqooky-default' });
        expect(result.overrideCount).toBeGreaterThanOrEqual(1);
        expect(read()).toMatch(new RegExp(`${key}\\s+"144"`));
        expect(bankedValue('sqooky-default', key)).toBe('144');
    });

    it('does not carry an override into a differently tuned preset', () => {
        applyPerformanceConfig(gameRoot, { presetId: 'sqooky-default' });
        const key = editFirstInjectedKey('144');
        applyPerformanceConfig(gameRoot, { presetId: 'sqooky-default' });

        applyPerformanceConfig(gameRoot, { presetId: 'optilock-fps' });
        expect(read()).not.toMatch(new RegExp(`${key}\\s+"144"`));
        // Still remembered for the preset it was made against.
        expect(bankedValue('sqooky-default', key)).toBe('144');

        applyPerformanceConfig(gameRoot, { presetId: 'sqooky-default' });
        expect(read()).toMatch(new RegExp(`${key}\\s+"144"`));
    });

    it('drops overrides on reset', () => {
        applyPerformanceConfig(gameRoot, { presetId: 'sqooky-default' });
        const key = editFirstInjectedKey('144');
        applyPerformanceConfig(gameRoot, { presetId: 'sqooky-default' });

        resetPerformanceConfigOverrides(gameRoot, { presetId: 'sqooky-default' });
        expect(read()).not.toMatch(new RegExp(`${key}\\s+"144"`));
    });

    it('still removes cleanly with overrides in play', () => {
        applyPerformanceConfig(gameRoot, { presetId: 'sqooky-default' });
        editFirstInjectedKey('144');
        applyPerformanceConfig(gameRoot, { presetId: 'sqooky-default' });
        removePerformanceConfig(gameRoot);
        expect(read()).toBe(STOCK);
    });
});

describe('game-update wipe recovery', () => {
    it('detects a wipe and re-layers saved overrides on reapply', () => {
        applyPerformanceConfig(gameRoot, { presetId: 'sqooky-default' });
        const line = read()
            .split('\n')
            .find((l) => l.includes('// grimoire-perf added') && /^\s*[A-Za-z_]/.test(l))!;
        const key = /^\s*"?([A-Za-z_][\w.]*)"?\s/.exec(line)![1];
        write(
            read().replace(
                new RegExp(`^(\\s*"?${key}"?\\s+)("[^"]*"|\\S+)(\\s*// grimoire-perf added)$`, 'm'),
                '$1"144"$3'
            )
        );
        applyPerformanceConfig(gameRoot, { presetId: 'sqooky-default' });

        // A game update replaces gameinfo.gi but leaves the sidecar alone.
        write(STOCK);
        const status = getPerformanceConfigStatus(gameRoot);
        expect(status.state).toBe('wiped');
        expect(status.overrideCount).toBe(1);

        applyPerformanceConfig(gameRoot, { presetId: 'sqooky-default' });
        expect(read()).toMatch(new RegExp(`${key}\\s+"144"`));
    });

    // Sidecars written before multi-preset support stored one flat override
    // map; it belongs to whichever preset was applied at the time.
    it('migrates a legacy flat sidecar into the per-preset map', () => {
        applyPerformanceConfig(gameRoot, { presetId: 'sqooky-default' });
        writeFileSync(
            sidecarPath,
            JSON.stringify({
                presetId: 'sqooky-default',
                version: '2.4.6',
                overrides: { 'ConVars/r_ssao': { value: '1' } },
            }),
            'utf-8'
        );
        write(STOCK);

        const status = getPerformanceConfigStatus(gameRoot);
        expect(status.state).toBe('wiped');
        expect(status.overrideCount).toBe(1);

        applyPerformanceConfig(gameRoot, { presetId: 'sqooky-default' });
        expect(read()).toMatch(/r_ssao\s+"1"/);
        expect(sidecar().overridesByPreset['sqooky-default']['ConVars/r_ssao'].value).toBe('1');
        expect(sidecar().overrides).toBeUndefined();
    });
});

// A Grimoire update can change what a preset id MEANS: same id, different key
// list and values (sqooky-default went 2.4.6 -> 2.7 exactly this way). The file
// on disk still carries the old body, and the status message invites the user to
// reapply. Nothing about that older body is user intent, and reading it as such
// pinned retired upstream values forever, suppressed every key the new version
// added, and re-applied gameplay convars the opt-in split holds back.
describe('a bundled preset whose definition moved under an applied file', () => {
    const DEFAULT_ID = 'sqooky-default';

    /** Rewrite the applied file to look like an older version of the same
     *  preset wrote it: an older marker version, one convar the current body no
     *  longer lists, one current convar missing entirely, and a gameplay convar
     *  the old body used to apply outright. */
    function rewriteAsOlderVersion(optInKey: string, optInValue: string): string {
        const preset = PRESETS.find((p) => p.id === DEFAULT_ID)!;
        const lines = read().split('\n');
        const beginAt = lines.findIndex((l) => l.includes('Performance Config BEGIN'));
        lines[beginAt] = lines[beginAt].replace(`v${preset.version}`, 'v2.4.6');

        // A key the current body still has, deleted from the file the way an
        // older version that never shipped it would leave things.
        const droppedAt = lines.findIndex(
            (l, i) => i > beginAt && l.includes('// grimoire-perf added') && /^\s*[A-Za-z_]/.test(l)
        );
        const stillBundled = /^\s*"?([A-Za-z_][\w.]*)"?\s/.exec(lines[droppedAt])![1];
        lines.splice(droppedAt, 1);

        const indent = /^[ \t]*/.exec(lines[beginAt])![0];
        lines.splice(
            beginAt + 1,
            0,
            `${indent}retired_upstream_convar "7" // grimoire-perf added`,
            `${indent}${optInKey} "${optInValue}" // grimoire-perf added`
        );
        write(lines.join('\n'));
        return stillBundled;
    }

    it('does not mistake the older body for the user hand-editing the file', () => {
        const preset = PRESETS.find((p) => p.id === DEFAULT_ID)!;
        const control = preset.optIn[0];
        applyPerformanceConfig(gameRoot, { presetId: DEFAULT_ID });
        const stillBundled = rewriteAsOlderVersion(control.key, control.value);

        const result = applyPerformanceConfig(gameRoot, { presetId: DEFAULT_ID, optIns: [] });
        const text = read();

        expect(result.overrideCount).toBe(0);
        expect(sidecar().overridesByPreset).toBeUndefined();
        // A convar the new version retired does not come back as "the user's".
        expect(activeHas(text, 'retired_upstream_convar')).toBe(false);
        // A convar the new version adds is written, not suppressed as a deletion.
        expect(activeHas(text, stillBundled)).toBe(true);
        // And the gameplay convar the old body applied silently stays out.
        expect(activeHas(text, control.key)).toBe(false);
    });

    it('still honours a line the user commented out, the one unambiguous signal', () => {
        applyPerformanceConfig(gameRoot, { presetId: DEFAULT_ID });
        const preset = PRESETS.find((p) => p.id === DEFAULT_ID)!;
        const line = read()
            .split('\n')
            .find((l) => l.includes('// grimoire-perf added') && /^\s*[A-Za-z_]/.test(l))!;
        const key = /^\s*"?([A-Za-z_][\w.]*)"?\s/.exec(line)![1];
        write(
            read()
                .replace(line, line.replace(/^(\s*)/, '$1// '))
                .replace(`v${preset.version}`, 'v2.4.6')
        );

        applyPerformanceConfig(gameRoot, { presetId: DEFAULT_ID });
        expect(activeHas(read(), key)).toBe(false);
        // The key may sit under ConVars or under an engine section, so match on
        // the leaf rather than assuming a path.
        const banked: Record<string, unknown> = sidecar().overridesByPreset[DEFAULT_ID] ?? {};
        expect(Object.entries(banked).find(([k]) => k.endsWith(`/${key}`))?.[1]).toEqual({
            omit: true,
        });
    });

    // These upstreams version in prose (Sqooky publishes no tags at all), so a
    // regenerated preset can easily carry the same version string and a
    // different body. The marker records the pinned commit for that reason.
    it('notices a regenerated preset even when the version string is unchanged', () => {
        const preset = PRESETS.find((p) => p.id === DEFAULT_ID)!;
        const control = preset.optIn[0];
        applyPerformanceConfig(gameRoot, { presetId: DEFAULT_ID });
        write(read().replace(/@[0-9a-f]{12}\)/, '@0123456789ab)'));
        const stillBundled = (() => {
            const lines = read().split('\n');
            const at = lines.findIndex(
                (l) => l.includes('// grimoire-perf added') && /^\s*[A-Za-z_]/.test(l)
            );
            const key = /^\s*"?([A-Za-z_][\w.]*)"?\s/.exec(lines[at])![1];
            const indent = /^[ \t]*/.exec(lines[at])![0];
            lines.splice(at, 1, `${indent}${control.key} "${control.value}" // grimoire-perf added`);
            write(lines.join('\n'));
            return key;
        })();

        const result = applyPerformanceConfig(gameRoot, { presetId: DEFAULT_ID, optIns: [] });
        expect(result.overrideCount).toBe(0);
        expect(activeHas(read(), control.key)).toBe(false);
        expect(activeHas(read(), stillBundled)).toBe(true);
    });

    it('treats a marker with no recorded commit as unprovable rather than current', () => {
        applyPerformanceConfig(gameRoot, { presetId: DEFAULT_ID });
        // A marker in the shape written before the commit was recorded.
        write(read().replace(/ @[0-9a-f]{12}\)/, ')'));
        const indent = /^([ \t]*)\/\/ ==== Grimoire/m.exec(read())![1];
        write(
            read().replace(
                /(\/\/ ==== Grimoire Performance Config BEGIN[^\n]*\n)/,
                `$1${indent}retired_upstream_convar "7" // grimoire-perf added\n`
            )
        );

        const result = applyPerformanceConfig(gameRoot, { presetId: DEFAULT_ID });
        expect(result.overrideCount).toBe(0);
        expect(activeHas(read(), 'retired_upstream_convar')).toBe(false);
        // And the file is still fully reversible afterwards.
        removePerformanceConfig(gameRoot);
        expect(read()).toBe(STOCK);
    });

    it('keeps harvesting hand edits when the version has not moved', () => {
        applyPerformanceConfig(gameRoot, { presetId: DEFAULT_ID });
        const indent = /^([ \t]*)\/\/ ==== Grimoire/m.exec(read())![1];
        write(
            read().replace(
                /(\/\/ ==== Grimoire Performance Config BEGIN[^\n]*\n)/,
                `$1${indent}my_own_convar "3" // grimoire-perf added\n`
            )
        );

        const result = applyPerformanceConfig(gameRoot, { presetId: DEFAULT_ID });
        expect(result.overrideCount).toBe(1);
        expect(activeHas(read(), 'my_own_convar')).toBe(true);
    });
});

describe('opt-ins without a sidecar', () => {
    // The sidecar is the only record of which opt-ins were written. Losing it
    // (hand-copied gameinfo.gi, a wiped userData, a user tidying up) must not
    // turn an opted-in convar into a permanent user override that survives the
    // user turning it back off.
    it('does not turn an opted-in convar into a permanent override', () => {
        const preset = PRESETS.find((p) => p.optIn.length)!;
        const control = preset.optIn[0];
        applyPerformanceConfig(gameRoot, { presetId: preset.id, optIns: [control.key] });
        expect(activeHas(read(), control.key)).toBe(true);

        rmSync(sidecarPath, { force: true });
        applyPerformanceConfig(gameRoot, { presetId: preset.id, optIns: [] });

        expect(activeHas(read(), control.key)).toBe(false);
        expect(sidecar().overridesByPreset).toBeUndefined();
    });
});
