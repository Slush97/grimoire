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
