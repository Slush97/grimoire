import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync, chmodSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { isSteamRunning } from './launchOptions';

// Rather than mock child_process, put a fake `pgrep` at the front of PATH that
// logs its argv and reports a match only for the pattern named in GRIMOIRE_TEST_MATCH.
// That exercises the real spawn, so a wrong flag or a dropped second probe
// shows up here instead of at runtime.
let root: string;
let argvLog: string;
let realPath: string | undefined;
let realPlatform: PropertyDescriptor | undefined;

function setPlatform(value: NodeJS.Platform) {
    Object.defineProperty(process, 'platform', { value, configurable: true });
}

/** Args of every pgrep invocation since the last reset, one per line. */
function pgrepCalls(): string[] {
    if (!existsSync(argvLog)) return [];
    return readFileSync(argvLog, 'utf8').split('\n').filter(Boolean);
}

beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'grimoire-launchopts-'));
    argvLog = join(root, 'pgrep-argv.txt');

    const fakePgrep = join(root, 'pgrep');
    writeFileSync(
        fakePgrep,
        [
            '#!/bin/sh',
            `printf '%s\\n' "$*" >> "${argvLog}"`,
            'case "$*" in',
            '  *"$GRIMOIRE_TEST_MATCH"*) exit 0 ;;',
            'esac',
            'exit 1',
        ].join('\n') + '\n',
    );
    chmodSync(fakePgrep, 0o755);

    realPath = process.env.PATH;
    process.env.PATH = `${root}:${realPath ?? ''}`;
    realPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
});

afterAll(() => {
    process.env.PATH = realPath;
    delete process.env.GRIMOIRE_TEST_MATCH;
    if (realPlatform) Object.defineProperty(process, 'platform', realPlatform);
    rmSync(root, { recursive: true, force: true });
});

beforeEach(() => {
    rmSync(argvLog, { force: true });
    // A pattern no invocation can contain, so "nothing is running" is the default.
    process.env.GRIMOIRE_TEST_MATCH = '__no_match__';
});

describe('isSteamRunning on darwin', () => {
    beforeEach(() => setPlatform('darwin'));

    it('detects the bottle Steam, which is a Windows steam.exe under Wine', async () => {
        // The regression this guards: `pgrep -x steam` matches the *native*
        // client only. With only that probe, a running bottle Steam reads as
        // "not running" and syncLaunchOptionsToSteam rewrites a localconfig.vdf
        // Steam is holding open, losing the user's launch options on shutdown.
        process.env.GRIMOIRE_TEST_MATCH = 'steam\\.exe';
        expect(await isSteamRunning()).toBe(true);
    });

    it('still detects a native Steam client', async () => {
        process.env.GRIMOIRE_TEST_MATCH = '-x steam';
        expect(await isSteamRunning()).toBe(true);
    });

    it('reports not running only when neither Steam is up', async () => {
        expect(await isSteamRunning()).toBe(false);
    });

    it('probes both the native and the bottled Steam', async () => {
        await isSteamRunning();
        const calls = pgrepCalls();
        expect(calls).toHaveLength(2);
        expect(calls).toContain('-x steam');
        expect(calls).toContain('-f steam\\.exe');
    });
});

describe('isSteamRunning on linux', () => {
    beforeEach(() => setPlatform('linux'));

    it('matches the client binary by exact name', async () => {
        process.env.GRIMOIRE_TEST_MATCH = '-x steam';
        expect(await isSteamRunning()).toBe(true);
    });

    // -f would match any process with "steam" anywhere in its argv, including
    // Grimoire itself when a Steam path is on the command line.
    it('does not fall back to a full-cmdline match', async () => {
        await isSteamRunning();
        expect(pgrepCalls()).toEqual(['-x steam']);
    });
});
