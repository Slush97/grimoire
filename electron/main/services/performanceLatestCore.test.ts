// Tests for the runtime "track latest" core: the safety gates that stand in
// for the human reviewer the bundled presets get, the cache round-trip, and
// the end-to-end contract that a cached latest release applies and removes
// through the patcher exactly like a bundled one.
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

// Without this, video.txt resolution would find the real Steam userdata.
vi.mock('./steamRoots', () => ({ getSteamRoots: () => [] }));
import {
    buildLatestRelease,
    cachedLatestIsCurrent,
    getCachedLatest,
    isCheckFresh,
    latestAsPreset,
    readLatestCache,
    resolveCachedPreset,
    writeLatestCache,
    type BuildLatestInput,
    type LatestRelease,
} from './performanceLatestCore';
import { generateVideoBody, validateGameinfoText } from './performancePresetGen';
import { CLASSIFICATION, getFamily } from './performanceConfigData';
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
        videoText: null,
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
            input({ presetId: 'optilock-fps', refKind: 'tag', ref: 'v9.9-beta.1' })
        );
        expect(tagged.ok).toBe(true);
        if (tagged.ok) expect(tagged.release.version).toBe('9.9-beta.1');

        // Different content under a bundled release's tag must not impersonate it.
        const bundled = getFamily('optilock-fps').releases[0];
        const colliding = buildLatestRelease(
            input({ presetId: 'optilock-fps', refKind: 'tag', ref: bundled.ref })
        );
        expect(colliding.ok).toBe(true);
        if (colliding.ok) {
            expect(colliding.release.version).toBe(`${bundled.version}.abcdef01`);
        }
    });

    it('leaves the list-valued RenderModes section alone', () => {
        // Stock lists seven `game` render modes; a config written before Valve
        // added ShadowSilhouette ends on FrontDepth, which used to diff to a
        // `game "FrontDepth"` op that the patcher wrote over every mode.
        const withModes = (text: string, modes: string[]) =>
            text.replace(
                /\n\}\n$/,
                `\n\tMaterialSystem2\n\t{\n\t\tRenderModes\n\t\t{\n${modes
                    .map((m) => `\t\t\tgame "${m}"`)
                    .join('\n')}\n\t\t}\n\t}\n}\n`
            );
        const result = buildLatestRelease(
            input({
                baselineText: withModes(baselineText(), ['Default', 'FrontDepth', 'ShadowSilhouette']),
                configText: withModes(configText(), ['Default', 'FrontDepth']),
            })
        );
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.release.sectionOps.some((op) => op.path[0] === 'MaterialSystem2')).toBe(false);
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

    const VIDEO = [
        '\t"setting.defaultres"\t\t"-1"',
        '\t"setting.monitor_index"\t\t"0"',
        '\t"setting.mat_vsync"\t\t"0"',
        '\t"setting.r_shadows"\t\t"0"',
        '\t"setting.r_citadel_outlines"\t\t"1"',
        '\t"setting.r_new_glow_quality"\t\t"0"',
        '\t"setting.r_texture_stream_mip_bias"\t\t"4"',
        '\t"setting.shaderquality"\t\t"0"',
        '\t"setting.cpu_level"\t\t"1"',
        '}',
    ].join('\n');

    it('classifies a fetched video.txt like the bundled generator', () => {
        const result = buildLatestRelease(input({ presetId: 'sqooky-testing', videoText: VIDEO }));
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        // Display keys and the opt-in convar are dropped, the unclassified
        // gameplay-shaped key is withheld, and render settings remain.
        expect(result.release.video).toEqual([
            ['r_shadows', '0'],
            ['r_texture_stream_mip_bias', '4'],
            ['shaderquality', '0'],
            ['cpu_level', '1'],
        ]);
        expect(result.release.withheld).toContain('r_new_glow_quality');
        expect(latestAsPreset(result.release).video).toEqual(result.release.video);
    });

    it("keeps a verbatim source's display settings and shipped values", () => {
        const result = buildLatestRelease(
            input({ presetId: 'optilock-fps', videoText: VIDEO.replace('"4"', '"8"') })
        );
        if (!result.ok) throw new Error(result.error);
        // The opt-in convar and the unclassified key still stay out.
        expect(result.release.video).toEqual([
            ['defaultres', '-1'],
            ['monitor_index', '0'],
            ['mat_vsync', '0'],
            ['r_shadows', '0'],
            ['r_texture_stream_mip_bias', '8'],
            ['shaderquality', '0'],
            ['cpu_level', '1'],
        ]);
        expect(result.release.withheld).toContain('r_new_glow_quality');
    });

    it('refuses a fetched video.txt that is not one', () => {
        expect(buildLatestRelease(input({ videoText: '<html>nope</html>' })).ok).toBe(false);
    });

    it('treats a cache entry from before video.txt support as having none', () => {
        const result = buildLatestRelease(input({ presetId: 'optilock-fps', videoText: VIDEO }));
        if (!result.ok) throw new Error(result.error);
        expect(latestAsPreset({ ...result.release, video: undefined }).video).toEqual([]);
    });

    describe('video.txt variants', () => {
        const ULTRA = 'optilock-ultra-potato';
        const SHADOWS = VIDEO.replace('"setting.shaderquality"\t\t"0"', '"setting.shaderquality"\t\t"-1"');

        it('keeps the other variants of a preset that ships several, default first', () => {
            const result = buildLatestRelease(
                input({ presetId: ULTRA, videoText: VIDEO, videoVariantTexts: [{ id: 'shadows', text: SHADOWS }] })
            );
            if (!result.ok) throw new Error(result.error);
            expect(result.release.videoVariants).toHaveLength(1);
            expect(result.release.videoVariants![0].id).toBe('shadows');
            expect(result.release.videoVariants![0].video).toContainEqual(['shaderquality', '-1']);

            const preset = latestAsPreset(result.release);
            expect(preset.videoVariants!.map((v) => v.id)).toEqual(['noShadows', 'shadows']);
            expect(preset.videoVariants![0].video).toEqual(preset.video);
        });

        it('records an empty list, not nothing, when a release ships only the default', () => {
            const result = buildLatestRelease(input({ presetId: ULTRA, videoText: VIDEO }));
            if (!result.ok) throw new Error(result.error);
            expect(result.release.videoVariants).toEqual([]);
            expect(latestAsPreset(result.release).videoVariants).toBeUndefined();
        });

        it('ignores variant texts for a preset that ships one video.txt', () => {
            const result = buildLatestRelease(
                input({ presetId: 'optilock-fps', videoText: VIDEO, videoVariantTexts: [{ id: 'shadows', text: SHADOWS }] })
            );
            if (!result.ok) throw new Error(result.error);
            expect(result.release.videoVariants).toBeUndefined();
        });

        it('refuses a variant that ships without the default, or is not a video.txt', () => {
            expect(
                buildLatestRelease(
                    input({ presetId: ULTRA, videoText: null, videoVariantTexts: [{ id: 'shadows', text: SHADOWS }] })
                ).ok
            ).toBe(false);
            expect(
                buildLatestRelease(
                    input({ presetId: ULTRA, videoText: VIDEO, videoVariantTexts: [{ id: 'shadows', text: '<html>' }] })
                ).ok
            ).toBe(false);
        });

        it('rebuilds a cached entry from before variant support instead of reusing it', () => {
            const built = buildLatestRelease(input({ presetId: ULTRA, videoText: VIDEO }));
            if (!built.ok) throw new Error(built.error);
            const { commit, baselineCommit } = built.release;
            const family = getFamily(ULTRA);
            expect(cachedLatestIsCurrent(family, built.release, commit, baselineCommit)).toBe(true);
            expect(
                cachedLatestIsCurrent(family, { ...built.release, videoVariants: undefined }, commit, baselineCommit)
            ).toBe(false);
            expect(cachedLatestIsCurrent(family, built.release, 'other', baselineCommit)).toBe(false);
            // Built under other classification rules, or before they were recorded.
            expect(
                cachedLatestIsCurrent(family, { ...built.release, classification: 'other' }, commit, baselineCommit)
            ).toBe(false);
            expect(
                cachedLatestIsCurrent(family, { ...built.release, classification: undefined }, commit, baselineCommit)
            ).toBe(false);

            // A preset with a single video.txt never needed the field.
            const fps = buildLatestRelease(input({ presetId: 'optilock-fps', videoText: VIDEO }));
            if (!fps.ok) throw new Error(fps.error);
            expect(cachedLatestIsCurrent(getFamily('optilock-fps'), fps.release, commit, baselineCommit)).toBe(true);
            expect(
                cachedLatestIsCurrent(getFamily('optilock-fps'), { ...fps.release, video: undefined }, commit, baselineCommit)
            ).toBe(false);
        });
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

describe('generateVideoBody caps', () => {
    // Past 4 OptiLock needs its Sinner's Light Fix VPK, which Grimoire does not install.
    it('lowers mip bias above 4 and leaves lower values alone', () => {
        const capped = (value: string) =>
            generateVideoBody([['r_texture_stream_mip_bias', value]], CLASSIFICATION).settings;
        expect(capped('6')).toEqual([['r_texture_stream_mip_bias', '4']]);
        expect(capped('4')).toEqual([['r_texture_stream_mip_bias', '4']]);
        expect(capped('2')).toEqual([['r_texture_stream_mip_bias', '2']]);
    });

    it('leaves a verbatim body uncapped and caps the rest', () => {
        expect(
            generateVideoBody([['r_texture_stream_mip_bias', '8']], CLASSIFICATION, true).settings
        ).toEqual([['r_texture_stream_mip_bias', '8']]);
    });

    // Verbatim (OptiLock) bodies keep the shipped value: dacooder asked for it.
    it('caps every bundled release that is not verbatim', () => {
        for (const id of ['sqooky-testing']) {
            for (const release of getFamily(id).releases) {
                const bias = release.video.find(([key]) => key === 'r_texture_stream_mip_bias');
                if (bias) expect(Number(bias[1])).toBeLessThanOrEqual(4);
            }
        }
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
        });
        expect(getCachedLatest(dir, r.presetId)).toEqual(r);
        expect(isCheckFresh(dir, r.presetId, new Date('2026-08-18T12:04:00Z'))).toBe(true);
        expect(isCheckFresh(dir, r.presetId, new Date('2026-08-18T12:06:00Z'))).toBe(false);
        expect(getCachedLatest(dir, 'other-preset')).toBeNull();
    });

    it('reads a missing or corrupt cache as empty', () => {
        expect(readLatestCache(dir)).toEqual({ byPreset: {}, checkedAt: {} });
        writeFileSync(join(dir, 'performance-latest.json'), '{not json', 'utf-8');
        expect(readLatestCache(dir)).toEqual({ byPreset: {}, checkedAt: {} });
    });

    it("resolves the 'latest' sentinel and the release's own version, nothing else", () => {
        const r = release();
        writeLatestCache(dir, { byPreset: { [r.presetId]: r }, checkedAt: {} });
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

    it('drops ops an older build cached for a section that is now excluded', () => {
        const r = release();
        const renderModes = { path: ['MaterialSystem2', 'RenderModes'], key: 'game', value: 'FrontDepth' };
        writeLatestCache(dir, {
            byPreset: { [r.presetId]: { ...r, sectionOps: [...r.sectionOps, renderModes] } },
            checkedAt: {},
        });
        const preset = resolveCachedPreset(dir, r.presetId, 'latest');
        expect(preset?.sectionOps).toEqual(r.sectionOps);
    });

    it('drops convars an older build cached for a key that is now excluded', () => {
        const r = release();
        writeLatestCache(dir, {
            byPreset: { [r.presetId]: { ...r, convars: [...r.convars, ['r_lightmap_size', '0']] } },
            checkedAt: {},
        });
        const preset = resolveCachedPreset(dir, r.presetId, 'latest');
        expect(preset?.convars).toEqual(r.convars);
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

    it('recognizes and reapplies a tracked tag whose version contains punctuation', () => {
        const built = buildLatestRelease(
            input({ refKind: 'tag', ref: 'v9.9-beta.1', commit: 'bb11cc22'.repeat(5) })
        );
        if (!built.ok) throw new Error(built.error);
        writeLatestCache(cacheDir, {
            byPreset: { [built.release.presetId]: built.release },
            checkedAt: {},
        });

        const original = read();
        const applied = applyPerformanceConfig(gameRoot, {
            presetId: 'sqooky-default',
            version: 'latest',
        });
        expect(applied.appliedVersion).toBe('9.9-beta.1');
        expect(getPerformanceConfigStatus(gameRoot).state).toBe('applied');

        const reapplied = applyPerformanceConfig(gameRoot, {
            presetId: 'sqooky-default',
            version: 'latest',
        });
        expect(reapplied.state).toBe('applied');
        expect(read().match(/Grimoire Performance Config BEGIN/g)).toHaveLength(1);

        expect(removePerformanceConfig(gameRoot).state).toBe('not-applied');
        expect(read()).toBe(original);
    });

    it('writes the picked video.txt variant of a tracked release', () => {
        const video = (shaderquality: string) =>
            [
                '"video.cfg"',
                '{',
                `\t"setting.shaderquality"\t\t"${shaderquality}"`,
                ...['cpu_level', 'gpu_level', 'r_shadows', 'r_citadel_ssao', 'mem_level'].map(
                    (key) => `\t"setting.${key}"\t\t"${shaderquality === '3' ? '2' : '0'}"`
                ),
                '}',
                '',
            ].join('\n');
        const built = buildLatestRelease(
            input({
                presetId: 'optilock-ultra-potato',
                refKind: 'tag',
                ref: 'v9.0',
                videoText: video('0'),
                videoVariantTexts: [{ id: 'shadows', text: video('-1') }],
            })
        );
        if (!built.ok) throw new Error(built.error);
        writeLatestCache(cacheDir, {
            byPreset: { [built.release.presetId]: built.release },
            checkedAt: {},
        });
        const cfg = join(gameRoot, 'game', 'citadel', 'cfg');
        mkdirSync(cfg, { recursive: true });
        const videoPath = join(cfg, 'video.txt');
        const original = video('3');
        writeFileSync(videoPath, original, 'utf-8');

        const applied = applyPerformanceConfig(gameRoot, {
            presetId: 'optilock-ultra-potato',
            version: 'latest',
            videoVariant: 'shadows',
        });
        expect(applied.state).toBe('applied');
        expect(readFileSync(videoPath, 'utf-8')).toContain('"setting.shaderquality"\t\t"-1"');
        expect(getPerformanceConfigStatus(gameRoot).appliedVideoVariant).toBe('shadows');

        applyPerformanceConfig(gameRoot, { presetId: 'optilock-ultra-potato', version: 'latest' });
        expect(readFileSync(videoPath, 'utf-8')).toContain('"setting.shaderquality"\t\t"0"');

        removePerformanceConfig(gameRoot);
        expect(readFileSync(videoPath, 'utf-8')).toBe(original);
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
