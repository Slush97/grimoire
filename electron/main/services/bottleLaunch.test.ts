import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, chmodSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { launchAppInBottle, findBottleRunner, BottleRunnerMissingError } from './bottleLaunch';
import type { SteamBottle } from './steamRoots';

// Rather than mock child_process, point GRIMOIRE_WINE at a real script that
// records its argv. That exercises the actual spawn call, so a broken argument
// order or a missing separator shows up here instead of at runtime.
let root: string;
let fakeWine: string;
let argvLog: string;
let bottle: SteamBottle;

beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'grimoire-launch-'));
    argvLog = join(root, 'argv.txt');
    fakeWine = join(root, 'fake-wine');
    writeFileSync(fakeWine, `#!/bin/sh\nprintf '%s\\n' "$@" > "${argvLog}"\n`);
    chmodSync(fakeWine, 0o755);

    const steamRoot = join(root, 'Bottles', 'Deadlock', 'drive_c', 'Program Files (x86)', 'Steam');
    mkdirSync(steamRoot, { recursive: true });
    writeFileSync(join(steamRoot, 'steam.exe'), 'stub');
    bottle = { name: 'Deadlock', bottlePath: join(root, 'Bottles', 'Deadlock'), steamRoot };
});

afterAll(() => {
    rmSync(root, { recursive: true, force: true });
});

afterEach(() => {
    delete process.env.GRIMOIRE_WINE;
});

/** Wait for the detached child to write its log, since spawn is async. */
async function readArgv(): Promise<string[]> {
    for (let attempt = 0; attempt < 50; attempt++) {
        if (existsSync(argvLog)) {
            const lines = readFileSync(argvLog, 'utf-8').trim().split('\n');
            if (lines.length > 1) return lines;
        }
        await new Promise((r) => setTimeout(r, 20));
    }
    throw new Error('fake wine never ran');
}

describe('launchAppInBottle', () => {
    it('invokes the runner with the bottle, a separator, and the app id', async () => {
        process.env.GRIMOIRE_WINE = fakeWine;
        launchAppInBottle(bottle, 1422450);

        expect(await readArgv()).toEqual([
            '--bottle',
            'Deadlock',
            '--',
            join(bottle.steamRoot, 'steam.exe'),
            '-applaunch',
            '1422450',
        ]);
    });

    it('fails loudly when no Wine runner is available', () => {
        process.env.GRIMOIRE_WINE = join(root, 'nope');
        expect(() => launchAppInBottle(bottle, 1422450)).toThrow(BottleRunnerMissingError);
    });

    it('fails when the bottle has no steam.exe', () => {
        process.env.GRIMOIRE_WINE = fakeWine;
        const empty: SteamBottle = { ...bottle, steamRoot: join(root, 'empty') };
        expect(() => launchAppInBottle(empty, 1422450)).toThrow(/No steam\.exe/);
    });
});

describe('findBottleRunner', () => {
    it('honours the GRIMOIRE_WINE override', () => {
        process.env.GRIMOIRE_WINE = fakeWine;
        expect(findBottleRunner()).toBe(fakeWine);
    });

    it('reports nothing rather than a bad path when the override does not exist', () => {
        process.env.GRIMOIRE_WINE = join(root, 'nope');
        expect(findBottleRunner()).toBeNull();
    });
});
