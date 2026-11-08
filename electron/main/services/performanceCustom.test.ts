import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const h = vi.hoisted(() => ({ dir: '' }));
vi.mock('electron', () => ({ app: { getPath: () => h.dir } }));
vi.mock('./rateLimiter', () => ({ githubRateLimiter: { acquire: async () => {} } }));
vi.mock('./steamRoots', () => ({ getSteamRoots: () => [] }));
import { buildCustomPerformancePreset, parsePerformanceRepository, validatePerformancePath } from './performanceCustomCore';
import { deleteCustomPerformancePreset, importPerformancePreset, inspectPerformanceRepository, listCustomPerformancePresets, markPerformanceAddonImported, preparePerformanceAddon, resolveCustomPerformancePreset, saveCustomPerformanceToggles } from './performanceCustom';
import { applyPerformanceConfig, getPerformanceConfigStatus, reapplyWipedPerformanceConfig, removePerformanceConfig, setExtraPresetResolver } from './performanceConfig';

const SHA = 'abcdef1234'.repeat(4);
const STOCK = readFileSync(join(__dirname, '__fixtures__/stock-gameinfo.gi'), 'utf8');
const CONFIG = STOCK.replace(/ConVars\s*\{/, 'ConVars\n{\ncustom_perf_value "2"\nr_lightmap_size "0"\nexec "bad.cfg"');
let failFetch = false;
let requests: string[];
let repoFiles: Array<{ path: string; type: string; mode: string; size: number }>;
let configText: string;
const VIDEO = '"video.cfg"\n{\n"VendorID" "123"\n"DeviceID" "456"\n' + [
    ['defaultres', '800'], ['defaultresheight', '600'], ['refreshrate_numerator', '60'],
    ['r_texture_stream_mip_bias', '8'], ['shaderquality', '-1'], ['cpu_level', '0'], ['gpu_level', '0'], ['mem_level', '0'],
].map(([key, value]) => `"setting.${key}" "${value}"`).join('\n') + '\n}\n';

beforeEach(() => {
    h.dir = mkdtempSync(join(tmpdir(), 'grimoire-custom-test-'));
    failFetch = false;
    requests = [];
    configText = CONFIG;
    repoFiles = [
        { path: 'gameinfo.gi', type: 'blob', mode: '100644', size: CONFIG.length },
        { path: 'addons/pak01_dir.vpk', type: 'blob', mode: '100644', size: 3 },
        { path: 'optional-addons/pak02_dir.vpk', type: 'blob', mode: '100644', size: 3 },
        { path: 'addons/symlink.vpk', type: 'blob', mode: '120000', size: 3 },
        { path: 'addons/split_dir.vpk', type: 'blob', mode: '100644', size: 3 },
        { path: 'addons/split_000.vpk', type: 'blob', mode: '100644', size: 3 },
    ];
    setExtraPresetResolver(resolveCustomPerformancePreset);
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
        requests.push(url);
        if (failFetch) throw new Error('Offline');
        if (url.includes('/commits?')) return Response.json([{ sha: SHA, commit: { committer: { date: '2026-11-07T00:00:00Z' } } }]);
        if (url.includes(`/commits/${SHA}`)) return Response.json({ sha: SHA, commit: { committer: { date: '2026-11-07T00:00:00Z' } } });
        if (url.includes('/git/trees/')) return Response.json({ truncated: false, tree: repoFiles });
        if (url.includes('/Sqooky/')) return new Response(STOCK);
        if (url.endsWith('/gameinfo.gi') || url.endsWith('/gameinfo.txt')) return new Response(configText);
        if (/\/video[^/]*\.txt$/.test(url)) return new Response(VIDEO);
        if (url.endsWith('.vpk')) return new Response('vpk');
        return new Response('', { status: 404 });
    }));
});

afterEach(() => {
    setExtraPresetResolver(null);
    vi.unstubAllGlobals();
    rmSync(h.dir, { recursive: true, force: true });
});

const importPreset = () => importPerformancePreset({ repository: 'person/config', name: 'My preset', configPath: 'gameinfo.gi' });

describe('custom performance presets', () => {
    const addFile = (path: string) => repoFiles.push({ path, type: 'blob', mode: '100644', size: 100 });

    it('keeps addon import history across reads without changing the preset version', async () => {
        const imported = await importPreset();
        markPerformanceAddonImported(imported.id, 'addons/pak01_dir.vpk');
        markPerformanceAddonImported(imported.id, 'addons/pak01_dir.vpk');
        markPerformanceAddonImported(imported.id, 'unlisted.vpk');
        const stored = listCustomPerformancePresets()[0];
        expect(stored.custom!.importedAddons).toEqual(['addons/pak01_dir.vpk']);
        expect(stored.version).toBe(imported.version);
    });

    it('inspects files without downloading payloads and imports the inspected commit', async () => {
        addFile('cfg/video.txt'); addFile('autoexec.cfg'); addFile('old.rar');
        const inspection = await inspectPerformanceRepository('person/config');
        expect(inspection.configPaths).toEqual(['gameinfo.gi']);
        expect(inspection.videoPaths).toEqual(['cfg/video.txt']);
        expect(inspection.addons.map((addon) => addon.path)).toEqual(['addons/pak01_dir.vpk', 'optional-addons/pak02_dir.vpk']);
        expect(inspection.unsupportedPaths).toEqual(['autoexec.cfg', 'old.rar']);
        expect(requests.some((url) => url.includes('raw.githubusercontent'))).toBe(false);
        requests = [];
        const imported = await importPerformancePreset({ repository: 'person/config', name: 'Pinned', configPath: 'gameinfo.gi', commit: inspection.commit });
        expect(requests.some((url) => url.includes('/commits?'))).toBe(false);
        expect(imported.custom!.videoPath).toBe('cfg/video.txt');
        expect(imported.versions[0].videoSettingCount).toBe(5);
    });

    it('requires a choice for ambiguous video variants and fetches only the selected file', async () => {
        addFile('video(No Shadows).txt'); addFile('video(Shadows).txt');
        await expect(importPreset()).rejects.toThrow('Several video files');
        const imported = await importPerformancePreset({ repository: 'person/config', name: 'Shadows', configPath: 'gameinfo.gi', videoPath: 'video(Shadows).txt' });
        expect(imported.custom!.videoPath).toBe('video(Shadows).txt');
        expect(requests.some((url) => url.endsWith('video(No%20Shadows).txt'))).toBe(false);
        expect(requests.some((url) => url.endsWith('video(Shadows).txt'))).toBe(true);
        await expect(importPerformancePreset({ repository: 'person/config', name: 'Bad', configPath: 'gameinfo.gi', videoPath: 'missing.txt' })).rejects.toThrow('Video path');
    });

    it('skips unsupported repository paths without blocking inspection or import', async () => {
        // OptimizationLock includes this unrelated placeholder file.
        addFile('maximumfps or minimum spec config and resources here/#');
        addFile('../gameinfo.gi'); addFile('invalid?/video.txt'); addFile('invalid#/addon.vpk');
        addFile('cfg/video.txt');
        const inspection = await inspectPerformanceRepository('person/config');
        expect(inspection.configPaths).toEqual(['gameinfo.gi']);
        expect(inspection.videoPaths).toEqual(['cfg/video.txt']);
        expect(inspection.addons.map((addon) => addon.path)).toEqual(['addons/pak01_dir.vpk', 'optional-addons/pak02_dir.vpk']);
        const imported = await importPreset();
        expect(imported.custom!.configPath).toBe('gameinfo.gi');
        expect(imported.custom!.videoPath).toBe('cfg/video.txt');
        await expect(importPerformancePreset({ repository: 'person/config', name: 'Invalid', configPath: '../gameinfo.gi' })).rejects.toThrow('relative file path');
        expect(requests.some((url) => url.includes('invalid') || url.includes('/../'))).toBe(false);
    });

    it('accepts a ConVars-only gameinfo.txt without accepting arbitrary console scripts', async () => {
        addFile('gameinfo.txt');
        configText = 'ConVars\n{\ncustom_perf_value "2"\n' + Array.from({ length: 160 }, (_, i) =>
            `performance_setting_${i} "0" // A representative comment documenting this performance setting.`).join('\n') + '\n}\n';
        const imported = await importPerformancePreset({ repository: 'person/config', name: 'Pasted block', configPath: 'gameinfo.txt' });
        expect(resolveCustomPerformancePreset(imported.id)!.convars).toContainEqual(['custom_perf_value', '2']);
        configText = 'exec autoexec.cfg';
        await expect(importPerformancePreset({ repository: 'person/config', name: 'Script', configPath: 'gameinfo.txt' })).rejects.toThrow();
    });

    it('round-trips video-only imports while preserving display settings and capping mip bias', async () => {
        addFile('video.txt');
        const imported = await importPerformancePreset({ repository: 'person/config', name: 'Video', configPath: null, videoPath: 'video.txt' });
        expect(resolveCustomPerformancePreset(imported.id)!.convars).toEqual([]);
        expect(resolveCustomPerformancePreset(imported.id)!.video).toContainEqual(['r_texture_stream_mip_bias', '4']);
        const game = join(h.dir, 'game', 'citadel');
        mkdirSync(join(game, 'cfg'), { recursive: true });
        const videoFile = join(game, 'cfg', 'video.txt');
        const originalVideo = VIDEO.replace('"123"', '"987"').replace('"800"', '"2560"').replace('"600"', '"1440"').replace('"60"', '"165"');
        writeFileSync(join(game, 'gameinfo.gi'), STOCK);
        writeFileSync(videoFile, originalVideo);
        expect(applyPerformanceConfig(h.dir, { presetId: imported.id }).state).toBe('applied');
        const written = readFileSync(videoFile, 'utf8');
        expect(written).toContain('"VendorID" "987"');
        expect(written).toContain('"setting.defaultres" "2560"');
        expect(written).toContain('"setting.refreshrate_numerator" "165"');
        expect(removePerformanceConfig(h.dir).state).toBe('not-applied');
        expect(readFileSync(videoFile, 'utf8')).toBe(originalVideo);
        expect(readFileSync(join(game, 'gameinfo.gi'), 'utf8')).toBe(STOCK);
    });

    it('does not offer convar toggles that the paired video file would override', async () => {
        addFile('video.txt');
        configText = CONFIG.replace('custom_perf_value "2"', 'custom_perf_value "2"\nr_texture_stream_mip_bias "8"');
        const imported = await importPreset();
        expect(resolveCustomPerformancePreset(imported.id)!.convars).toContainEqual(['r_texture_stream_mip_bias', '8']);
        expect(imported.custom!.availableConvars.some((entry) => entry.key === 'r_texture_stream_mip_bias')).toBe(false);
        expect(() => saveCustomPerformanceToggles(imported.id, [{ key: 'r_texture_stream_mip_bias', label: 'Textures' }])).toThrow();
    });

    it('accepts GitHub URLs and shorthand but rejects other hosts and path traversal', () => {
        expect(parsePerformanceRepository('https://github.com/person/config.git/')).toBe('person/config');
        expect(parsePerformanceRepository('person/config')).toBe('person/config');
        for (const bad of ['https://github.com.evil.test/a/b', 'https://gitlab.com/a/b', 'a/b/tree/main', 'a/..', 'a/b?ref=x', 'https://user@github.com/a/b']) {
            expect(() => parsePerformanceRepository(bad)).toThrow();
        }
        for (const bad of ['/gameinfo.gi', '../gameinfo.gi', 'x/../gameinfo.gi', 'x\\gameinfo.gi', 'x//gameinfo.gi', 'x\n.gi']) {
            expect(() => validatePerformancePath(bad)).toThrow();
        }
        expect(validatePerformancePath('My config/gameinfo.gi')).toBe('My config/gameinfo.gi');
    });

    it('pins downloads and keeps the imported preset available offline with safety exclusions', async () => {
        const imported = await importPreset();
        expect(imported.upstream.commit).toBe(SHA);
        expect(requests.filter((url) => url.includes('raw.githubusercontent.com/person/')).every((url) => url.includes(SHA))).toBe(true);
        expect(imported.custom!.addons.map((entry) => entry.path)).toEqual(['addons/pak01_dir.vpk', 'optional-addons/pak02_dir.vpk']);
        failFetch = true;
        const preset = resolveCustomPerformancePreset(imported.id)!;
        expect(preset.sectionOps).toEqual([]);
        expect(preset.convars).toContainEqual(['custom_perf_value', '2']);
        expect(preset.convars.map(([key]) => key)).not.toContain('r_lightmap_size');
        expect(preset.convars.map(([key]) => key)).not.toContain('exec');
        expect(listCustomPerformancePresets()[0].id).toBe(imported.id);
        expect(() => resolveCustomPerformancePreset(imported.id, 'missing')).toThrow();
    });

    it('makes selected values optional, survives wipe recovery, and removes byte for byte', async () => {
        const imported = await importPreset();
        saveCustomPerformanceToggles(imported.id, [{ key: 'custom_perf_value', label: 'My toggle' }]);
        const current = listCustomPerformancePresets()[0];
        expect(current.version).not.toBe(imported.version);
        expect(() => saveCustomPerformanceToggles(imported.id, [{ key: 'exec', label: 'Bad' }])).toThrow();
        const game = join(h.dir, 'game', 'citadel');
        mkdirSync(game, { recursive: true });
        const file = join(game, 'gameinfo.gi');
        writeFileSync(file, STOCK);
        expect(applyPerformanceConfig(h.dir, { presetId: imported.id, optIns: [] }).state).toBe('applied');
        expect(readFileSync(file, 'utf8')).not.toContain('custom_perf_value');
        expect(applyPerformanceConfig(h.dir, { presetId: imported.id, optIns: ['custom_perf_value'] }).state).toBe('applied');
        expect(readFileSync(file, 'utf8')).toContain('custom_perf_value "2"');
        expect(getPerformanceConfigStatus(h.dir).appliedPresetId).toBe(imported.id);
        writeFileSync(file, STOCK);
        expect(getPerformanceConfigStatus(h.dir).state).toBe('wiped');
        expect(reapplyWipedPerformanceConfig(h.dir).state).toBe('applied');
        expect(readFileSync(file, 'utf8')).toContain('custom_perf_value "2"');
        expect(removePerformanceConfig(h.dir).state).toBe('not-applied');
        expect(readFileSync(file, 'utf8')).toBe(STOCK);
    });

    it('never falls back to a bundled preset when a custom entry is missing', async () => {
        const imported = await importPreset();
        deleteCustomPerformancePreset(imported.id);
        const game = join(h.dir, 'game', 'citadel');
        mkdirSync(game, { recursive: true });
        writeFileSync(join(game, 'gameinfo.gi'), STOCK);
        expect(applyPerformanceConfig(h.dir, { presetId: imported.id }).state).toBe('error');
        expect(readFileSync(join(game, 'gameinfo.gi'), 'utf8')).toBe(STOCK);
    });

    it('downloads only inspected addons on demand and provides cleanup', async () => {
        const imported = await importPreset();
        expect(requests.some((url) => url.endsWith('.vpk'))).toBe(false);
        await expect(preparePerformanceAddon(imported.id, '../evil.vpk')).rejects.toThrow();
        const download = await preparePerformanceAddon(imported.id, 'optional-addons/pak02_dir.vpk');
        expect(readFileSync(download.item.vpkPath, 'utf8')).toBe('vpk');
        expect(requests.at(-1)).toContain(`/${SHA}/optional-addons/pak02_dir.vpk`);
        await download.cleanup();
        expect(existsSync(download.item.vpkPath)).toBe(false);
    });

    it('does not damage saved imports on failed fetches or malformed config values', async () => {
        const imported = await importPreset();
        failFetch = true;
        await expect(importPreset()).rejects.toThrow('Offline');
        expect(listCustomPerformancePresets()).toHaveLength(1);
        const records = JSON.parse(readFileSync(join(h.dir, 'performance-custom.json'), 'utf8'));
        records[0].input.configText = CONFIG.replace('custom_perf_value "2"', 'custom_perf_value "2; quit"');
        expect(() => buildCustomPerformancePreset(records[0])).toThrow('Unsupported config value');
        expect(listCustomPerformancePresets()[0].id).toBe(imported.id);
    });
});
