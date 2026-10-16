// Network half of track-latest, against a stubbed GitHub: which files it
// fetches for a preset that ships several video.txt variants, and that a cache
// entry written before variant support is rebuilt rather than reused.
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const h = vi.hoisted(() => ({ userData: '' }));
vi.mock('electron', () => ({ app: { getPath: () => h.userData } }));
vi.mock('./rateLimiter', () => ({ githubRateLimiter: { acquire: async () => {} } }));
vi.mock('./steamRoots', () => ({ getSteamRoots: () => [] }));
import { checkPerformanceLatest } from './performanceLatest';
import { readLatestCache, writeLatestCache, type LatestRelease } from './performanceLatestCore';

const SHA = 'feed'.repeat(10);
const BASE = 'base'.repeat(10);
const ULTRA = 'optilock-ultra-potato';
const DIR = 'https://raw.githubusercontent.com/dacooderr/OptiLock/' + SHA + '/OptiLock%20Ultra%20Potato%20Config/';

const PAD = Array.from({ length: 120 }, (_, i) => `// padding comment line ${i} to keep this file plausibly sized`).join('\n');
const gameinfo = (convars: string[]) =>
    `${PAD}\n"GameInfo"\n{\n\tgame\t\t"Citadel"\n\tConVars\n\t{\n${convars.map((c) => `\t\t${c}`).join('\n')}\n\t}\n}\n`;
const BASELINE = gameinfo(Array.from({ length: 160 }, (_, i) => `stock_cv_${i} "0"`));
const CONFIG = gameinfo([...Array.from({ length: 160 }, (_, i) => `stock_cv_${i} "0"`), 'new_perf_toggle "1"']);
const video = (shaderquality: string) =>
    [
        '"video.cfg"',
        '{',
        `\t"setting.shaderquality"\t\t"${shaderquality}"`,
        ...['cpu_level', 'gpu_level', 'r_shadows', 'r_citadel_ssao', 'mem_level'].map(
            (key) => `\t"setting.${key}"\t\t"0"`
        ),
        '}',
    ].join('\n');

let fetched: string[];

beforeEach(() => {
    h.userData = mkdtempSync(join(tmpdir(), 'grimoire-latest-net-'));
    fetched = [];
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
    vi.stubGlobal(
        'fetch',
        vi.fn(async (url: string) => {
            fetched.push(url);
            if (url.endsWith('/releases/latest')) return json({ tag_name: 'v9.0' });
            if (url.includes('/git/ref/tags/')) return json({ object: { type: 'commit', sha: SHA } });
            if (url.includes(`/commits/${SHA}`)) return json({ commit: { author: { date: '2026-10-20T00:00:00Z' } } });
            if (url.includes('/commits?path=')) {
                return json([{ sha: BASE, commit: { author: { date: '2026-10-13T00:00:00Z' } } }]);
            }
            if (url.includes(`/Sqooky/OptimizationLock/${BASE}/`)) return new Response(BASELINE);
            if (url === DIR + 'gameinfo.gi') return new Response(CONFIG);
            // Only the old name of the default variant exists at this commit,
            // as at OptiLock v5.5.
            if (url === DIR + 'video.txt') return new Response(video('-1'));
            if (url === DIR + 'video(Shadows).txt') return new Response(video('0'));
            return new Response('not found', { status: 404 });
        })
    );
});

afterEach(() => {
    vi.unstubAllGlobals();
    rmSync(h.userData, { recursive: true, force: true });
});

describe('checkPerformanceLatest with video.txt variants', () => {
    it('fetches every variant, trying each name the default has had', async () => {
        const info = await checkPerformanceLatest(ULTRA, true);
        expect(info.error).toBeNull();
        expect(info.version).toBe('9.0');
        expect(fetched).toContain(DIR + 'video(No%20Shadows).txt');

        const cached = readLatestCache(h.userData).byPreset[ULTRA];
        expect(cached.video).toContainEqual(['shaderquality', '-1']);
        expect(cached.videoVariants).toEqual([
            expect.objectContaining({ id: 'shadows', video: expect.arrayContaining([['shaderquality', '0']]) }),
        ]);
    });

    it('rebuilds an entry cached before variant support instead of reusing it', async () => {
        const stale: LatestRelease = {
            presetId: ULTRA,
            version: '9.0',
            ref: 'v9.0',
            refKind: 'tag',
            commit: SHA,
            date: '2026-10-20',
            baselineCommit: BASE,
            sha256: 'x',
            fetchedAt: '2026-10-20T00:00:00Z',
            sectionOps: [],
            convars: [],
            optIn: [],
            video: [['shaderquality', '-1']],
            videoSha256: 'y',
            withheld: [],
        };
        writeLatestCache(h.userData, { byPreset: { [ULTRA]: stale }, checkedAt: {} });

        await checkPerformanceLatest(ULTRA);
        expect(fetched).toContain(DIR + 'gameinfo.gi');
        expect(readLatestCache(h.userData).byPreset[ULTRA].videoVariants).toHaveLength(1);

        // Now current, so the next check reuses it without fetching the files.
        fetched = [];
        writeLatestCache(h.userData, { ...readLatestCache(h.userData), checkedAt: {} });
        await checkPerformanceLatest(ULTRA);
        expect(fetched).not.toContain(DIR + 'gameinfo.gi');
    });
});
