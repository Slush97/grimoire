import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'fs';
import type { SpawnOptions } from 'child_process';
import { join } from 'path';
import { tmpdir } from 'os';
import { launchAppInBottle, findBottleRunner, BottleRunnerMissingError } from './bottleLaunch';
import type { SteamBottle } from './steamRoots';

// CrossOver's runner cannot run on Windows. Execute its fixture through Node
// while preserving the real detached spawn, arguments and stdio behavior.
vi.mock('child_process', async (importOriginal) => {
    const actual = await importOriginal<typeof import('child_process')>();
    return {
        ...actual,
        spawn: (command: string, args: string[], options: SpawnOptions) =>
            actual.spawn(process.execPath, [command, ...args], options),
    };
});

let root: string;
let fakeWine: string;
let argvLog: string;
let bottle: SteamBottle;

beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'grimoire-launch-'));
    argvLog = join(root, 'argv.txt');
    fakeWine = join(root, 'fake-wine.cjs');
    writeFileSync(fakeWine, [
        "const { writeFileSync } = require('node:fs');",
        `writeFileSync(${JSON.stringify(argvLog)}, process.argv.slice(2).join('\\n'));`,
    ].join('\n'));

    const steamRoot = join(root, 'Bottles', 'Deadlock', 'drive_c', 'Program Files (x86)', 'Steam');
    mkdirSync(steamRoot, { recursive: true });
    writeFileSync(join(steamRoot, 'steam.exe'), 'stub');
    bottle = { name: 'Deadlock', bottlePath: join(root, 'Bottles', 'Deadlock'), steamRoot };
});

afterAll(() => {
    rmSync(root, { recursive: true, force: true });
});

afterEach(() => {
    vi.unstubAllEnvs();
});

/** Wait for the detached child to write its log, since spawn is async. */
async function readArgv(): Promise<string[]> {
    return vi.waitFor(() => {
        const lines = readFileSync(argvLog, 'utf-8').trim().split('\n');
        expect(lines.length).toBeGreaterThan(1);
        return lines;
    }, { timeout: 5000 });
}

describe('launchAppInBottle', () => {
    it('invokes the runner with the bottle, a separator, and the app id', async () => {
        vi.stubEnv('GRIMOIRE_WINE', fakeWine);
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
        vi.stubEnv('GRIMOIRE_WINE', join(root, 'nope'));
        expect(() => launchAppInBottle(bottle, 1422450)).toThrow(BottleRunnerMissingError);
    });

    it('fails when the bottle has no steam.exe', () => {
        vi.stubEnv('GRIMOIRE_WINE', fakeWine);
        const empty: SteamBottle = { ...bottle, steamRoot: join(root, 'empty') };
        expect(() => launchAppInBottle(empty, 1422450)).toThrow(/No steam\.exe/);
    });
});

describe('findBottleRunner', () => {
    it('honours the GRIMOIRE_WINE override', () => {
        vi.stubEnv('GRIMOIRE_WINE', fakeWine);
        expect(findBottleRunner()).toBe(fakeWine);
    });

    it('reports nothing rather than a bad path when the override does not exist', () => {
        vi.stubEnv('GRIMOIRE_WINE', join(root, 'nope'));
        expect(findBottleRunner()).toBeNull();
    });
});
