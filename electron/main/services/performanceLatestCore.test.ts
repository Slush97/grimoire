// Tests for the runtime "track latest" core: the safety gates that stand in
// for the human reviewer the bundled presets get, the cache round-trip, and
// the end-to-end contract that a cached latest release applies and removes
// through the patcher exactly like a bundled one.
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
    buildLatestRelease,
    getCachedHistory,
    getCachedLatest,
    isCheckFresh,
    latestAsPreset,
    readLatestCache,
    resolveCachedPreset,
    upsertHistory,
    writeLatestCache,
    type BuildLatestInput,
    type LatestRelease,
} from './performanceLatestCore';
import { validateGameinfoText } from './performancePresetGen';
import { getFamily } from './performanceConfigData';
import {
    applyPerformanceConfig,
    getPerformanceConfigStatus,
    removePerformanceConfig,
    setExtraPresetResolver,
} from './performanceConfig';

// ---------------------------------------------------------------------------
// Synthetic upstream files, large and dense enough to pass the sanity gates
// (>=10KB, >=150 baseline entries, >=100 config entries) while staying fully
// under the test's control.
// ---------------------------------------------------------------------------

const PAD = Array.from(
    { length: 120 },
    (_, i) => `// padding comment line ${i} to keep this synthetic file plausibly sized`
).join('\n');

function baselineText(): string {
    const convars = Array.from({ length: 160 }, (_, i) => `\t\tstock_cv_${i} "0"`).join('\n');
    return `${PAD}
"GameInfo"
{
\tgame\t\t"Citadel"
\tConVars
\t{
${convars}
\t\tcitadel_player_outline_enemies "true"
\t}
\tEngine2
\t{
\t\tLowLatency "0"
\t\tRenderingPipeline
\t\t{
\t\t\tShadowQuality "2"
\t\t}
\t}
}
`;
}

/** A config that changes stock values, adds new perf convars, sets an opt-in
 *  key, sneaks in an unclassified gameplay-shaped key and a blocklisted key,
 *  edits an engine section, and comments a stock engine key out. */
function configText(): string {
    const kept = Array.from({ length: 150 }, (_, i) => `\t\tstock_cv_${i} "0"`).join('\n');
    return `${PAD}
"GameInfo"
{
\tgame\t\t"Citadel"
\tConVars
\t{
${kept}
\t\tstock_cv_150 "9"
\t\tnew_perf_toggle "1"
\t\tcitadel_player_outline_enemies "false"
\t\tr_brand_new_glow_thing "0"
\t\ttimescale "0.5"
\t}
\tEngine2
\t{
\t\t// LowLatency "0"
\t\tRenderingPipeline
\t\t{
\t\t\tShadowQuality "0"
\t\t}
\t}
}
`;
}

function input(overrides: Partial<BuildLatestInput> = {}): BuildLatestInput {
    return {
        presetId: 'sqooky-default',
        refKind: 'prose',
        ref: '',
        commit: 'abcdef0123456789abcdef0123456789abcdef01',
        date: '2026-08-15',
        baselineCommit: '1111111111111111111111111111111111111111',
        baselineText: baselineText(),
        configText: configText(),
        now: new Date('2026-08-18T12:00:00Z'),
        ...overrides,
    };
}

describe('buildLatestRelease gates', () => {
    it('builds a release with the diff classified like the bundled generator', () => {
        const result = buildLatestRelease(input());
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        const r = result.release;

        // Changed + added performance convars ride in the body.
        expect(r.convars).toContainEqual(['stock_cv_150', '9']);
        expect(r.convars).toContainEqual(['new_perf_toggle', '1']);
        // The opt-in split holds at runtime: the outline key is a control, not
        // a body convar.
        expect(r.convars.some(([k]) => k === 'citadel_player_outline_enemies')).toBe(false);
        expect(r.optIn).toContainEqual({
            key: 'citadel_player_outline_enemies',
            value: 'false',
            group: 'visibility',
        });
        // Unclassified gameplay-shaped keys are withheld, not written.
        expect(r.withheld).toContain('r_brand_new_glow_thing');
        expect(r.convars.some(([k]) => k === 'r_brand_new_glow_thing')).toBe(false);
        // Blocklisted keys (the accidental-timescale insurance) vanish
        // entirely: not in the body, not even surfaced as withheld.
        expect(r.convars.some(([k]) => k === 'timescale')).toBe(false);
        expect(r.sectionOps.some((op) => op.key === 'timescale')).toBe(false);
        expect(r.withheld).not.toContain('timescale');
        // Section edits and commented-out stock keys become ops.
        expect(r.sectionOps).toContainEqual({
            path: ['Engine2', 'RenderingPipeline'],
            key: 'ShadowQuality',
            value: '0',
        });
        expect(r.sectionOps).toContainEqual({ path: ['Engine2'], key: 'LowLatency', remove: true });

        // A prose source is versioned by its short sha, marker-charset-safe.
        expect(r.version).toBe('abcdef01');
        expect(r.version).toMatch(/^[\w.]+$/);
    });

    it('names tag releases by the tag and dodges collisions with bundled versions', () => {
        const tagged = buildLatestRelease(
            input({ presetId: 'optilock-fps', refKind: 'tag', ref: 'v9.9' })
        );
        expect(tagged.ok).toBe(true);
        if (tagged.ok) expect(tagged.release.version).toBe('9.9');

        // v4.2 is a bundled optilock-fps release; different content under the
        // same tag must not impersonate it.
        const colliding = buildLatestRelease(
            input({ presetId: 'optilock-fps', refKind: 'tag', ref: 'v4.2' })
        );
        expect(colliding.ok).toBe(true);
        if (colliding.ok) {
            expect(colliding.release.version).toBe('4.2.abcdef01');
            expect(colliding.release.version).toMatch(/^[\w.]+$/);
        }
    });

    it('refuses implausible texts', () => {
        expect(buildLatestRelease(input({ configText: 'tiny' })).ok).toBe(false);
        expect(
            buildLatestRelease(input({ configText: configText().replace(/\}\s*$/, '') })).ok
        ).toBe(false);
        expect(buildLatestRelease(input({ presetId: 'no-such-preset' })).ok).toBe(false);
        // An HTML error page is not a gameinfo.gi, however big it is.
        const html = `<html>${'x'.repeat(20000)}</html>`;
        expect(buildLatestRelease(input({ baselineText: html })).ok).toBe(false);
    });
});

describe('validateGameinfoText', () => {
    it('accepts a plausible file and names what is wrong otherwise', () => {
        expect(validateGameinfoText(baselineText(), 'x')).toBeNull();
        expect(validateGameinfoText('short', 'x')).toMatch(/small/);
        expect(validateGameinfoText(baselineText().replace('ConVars', 'NoVars'), 'x')).toMatch(
            /ConVars/
        );
        // Braces inside comments must not count.
        const commented = baselineText().replace('// padding comment line 0', '// stray { brace');
        expect(validateGameinfoText(commented, 'x')).toBeNull();
    });
});

describe('cache round-trip and resolution', () => {
    let dir: string;

    beforeEach(() => {
        dir = mkdtempSync(join(tmpdir(), 'grimoire-latest-'));
    });
    afterEach(() => {
        rmSync(dir, { recursive: true, force: true });
    });

    function release(): LatestRelease {
        const built = buildLatestRelease(input());
        if (!built.ok) throw new Error(built.error);
        return built.release;
    }

    it('persists releases and check timestamps', () => {
        const r = release();
        writeLatestCache(dir, {
            byPreset: { [r.presetId]: r },
            checkedAt: { [r.presetId]: '2026-08-18T12:00:00Z' },
            history: {},
        });
        expect(getCachedLatest(dir, r.presetId)).toEqual(r);
        expect(isCheckFresh(dir, r.presetId, new Date('2026-08-18T12:04:00Z'))).toBe(true);
        expect(isCheckFresh(dir, r.presetId, new Date('2026-08-18T12:06:00Z'))).toBe(false);
        expect(getCachedLatest(dir, 'other-preset')).toBeNull();
    });

    it('reads a missing or corrupt cache as empty', () => {
        expect(readLatestCache(dir)).toEqual({ byPreset: {}, checkedAt: {}, history: {} });
        writeFileSync(join(dir, 'performance-latest.json'), '{not json', 'utf-8');
        expect(readLatestCache(dir)).toEqual({ byPreset: {}, checkedAt: {}, history: {} });
    });

    it('keeps fetched historical releases and resolves pins from them', () => {
        const r = release();
        const older: LatestRelease = {
            ...r,
            version: '11111111',
            ref: '11111111',
            commit: '1111111111111111111111111111111111111111',
        };
        upsertHistory(dir, r);
        upsertHistory(dir, older);
        expect(getCachedHistory(dir, r.presetId).map((x) => x.version)).toEqual([
            '11111111',
            r.version,
        ]);
        // A refetch replaces its old entry and moves it to the front.
        upsertHistory(dir, { ...r });
        expect(getCachedHistory(dir, r.presetId).map((x) => x.version)).toEqual([
            r.version,
            '11111111',
        ]);
        // Pins resolve from history alone (no tracked-latest entry needed)...
        expect(resolveCachedPreset(dir, r.presetId, '11111111')?.version).toBe('11111111');
        // ...but the 'latest' sentinel never does: it means "what the last
        // check said was newest", which history cannot answer.
        expect(resolveCachedPreset(dir, r.presetId, 'latest')).toBeNull();
    });

    it("resolves the 'latest' sentinel and the release's own version, nothing else", () => {
        const r = release();
        writeLatestCache(dir, { byPreset: { [r.presetId]: r }, checkedAt: {}, history: {} });
        expect(resolveCachedPreset(dir, r.presetId, 'latest')?.version).toBe(r.version);
        expect(resolveCachedPreset(dir, r.presetId, r.version)?.version).toBe(r.version);
        expect(resolveCachedPreset(dir, r.presetId, '2.8.2')).toBeNull();
        expect(resolveCachedPreset(dir, 'sqooky-testing', 'latest')).toBeNull();
    });

    it('adapts a release into the flat preset shape the patcher applies', () => {
        const r = release();
        const preset = latestAsPreset(r);
        expect(preset.id).toBe('sqooky-default');
        expect(preset.version).toBe(r.version);
        expect(preset.upstream.commit).toBe(r.commit);
        expect(preset.convars).toEqual(r.convars);
        expect(preset.optIn[0].group).toBe('visibility');
    });
});

// ---------------------------------------------------------------------------
// End to end through the patcher: a cached latest release must be
// indistinguishable from a bundled one, including the byte-for-byte
// apply -> remove round trip and non-drift override harvesting.
// ---------------------------------------------------------------------------

describe('applying a tracked latest release', () => {
    let cacheDir: string;
    let gameRoot: string;
    let gameinfo: string;

    beforeEach(() => {
        cacheDir = mkdtempSync(join(tmpdir(), 'grimoire-latest-cache-'));
        gameRoot = mkdtempSync(join(tmpdir(), 'grimoire-latest-game-'));
        const dir = join(gameRoot, 'game', 'citadel');
        mkdirSync(dir, { recursive: true });
        gameinfo = join(dir, 'gameinfo.gi');
        // The user's live file is the synthetic stock baseline.
        writeFileSync(gameinfo, baselineText(), 'utf-8');

        const built = buildLatestRelease(input());
        if (!built.ok) throw new Error(built.error);
        writeLatestCache(cacheDir, {
            byPreset: { [built.release.presetId]: built.release },
            checkedAt: {},
            history: {},
        });
        setExtraPresetResolver((id, version) => resolveCachedPreset(cacheDir, id, version));
    });

    afterEach(() => {
        setExtraPresetResolver(null);
        rmSync(cacheDir, { recursive: true, force: true });
        rmSync(gameRoot, { recursive: true, force: true });
    });

    const read = () => readFileSync(gameinfo, 'utf-8');

    it('applies, reports, harvests overrides without drift, and removes byte-for-byte', () => {
        const original = read();

        const applied = applyPerformanceConfig(gameRoot, {
            presetId: 'sqooky-default',
            version: 'latest',
        });
        expect(applied.state).toBe('applied');
        expect(applied.appliedVersion).toBe('abcdef01');
        const afterApply = read();
        expect(afterApply).toContain('preset=sqooky-default vabcdef01 @abcdef012345');
        expect(afterApply).toContain('new_perf_toggle');
        // Withheld and blocklisted keys never reach the file.
        expect(afterApply).not.toContain('r_brand_new_glow_thing');
        expect(afterApply).not.toContain('timescale');

        const status = getPerformanceConfigStatus(gameRoot);
        expect(status.state).toBe('applied');
        expect(status.appliedVersion).toBe('abcdef01');

        // Hand-edit a managed value; a reapply must bank it as an override
        // (the cache still resolves this exact definition, so no drift).
        const edited = read().replace(
            /new_perf_toggle\s+"1"/,
            'new_perf_toggle "7"'
        );
        writeFileSync(gameinfo, edited, 'utf-8');
        const reapplied = applyPerformanceConfig(gameRoot, {
            presetId: 'sqooky-default',
            version: 'latest',
        });
        expect(reapplied.state).toBe('applied');
        expect(reapplied.overrideCount).toBe(1);
        expect(read()).toMatch(/new_perf_toggle\s+"7"/);

        const removed = removePerformanceConfig(gameRoot);
        expect(removed.state).toBe('not-applied');
        expect(read()).toBe(original);
    });

    it('applies a pinned historical version resolved from the history cache', () => {
        const built = buildLatestRelease(input());
        if (!built.ok) throw new Error(built.error);
        const historical: typeof built.release = {
            ...built.release,
            version: 'aa11bb22',
            ref: 'aa11bb22',
            commit: 'aa11bb22aa11bb22aa11bb22aa11bb22aa11bb22',
        };
        upsertHistory(cacheDir, historical);

        const applied = applyPerformanceConfig(gameRoot, {
            presetId: 'sqooky-default',
            version: 'aa11bb22',
        });
        expect(applied.state).toBe('applied');
        expect(applied.appliedVersion).toBe('aa11bb22');
        expect(read()).toContain('preset=sqooky-default vaa11bb22 @aa11bb22aa11');
    });

    it('falls back to the bundled newest release when the cache has nothing', () => {
        setExtraPresetResolver(() => null);
        const applied = applyPerformanceConfig(gameRoot, {
            presetId: 'sqooky-default',
            version: 'latest',
        });
        // The synthetic stock file cannot host every bundled section op, but
        // the version resolution is the point: 'latest' with no cache resolves
        // to the newest bundled release instead of failing.
        expect(applied.state).toBe('applied');
        expect(applied.appliedVersion).toBe(getFamily('sqooky-default').releases[0].version);
    });
});
