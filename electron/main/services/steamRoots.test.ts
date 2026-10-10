import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
    findSteamBottles,
    findBottleForPath,
    getSteamRoots,
    resolveBottleWindowsPath,
} from './steamRoots';

const home = vi.hoisted(() => ({ dir: '' }));
vi.mock('os', async (importOriginal) => {
    const os = await importOriginal<typeof import('os')>();
    return { ...os, homedir: () => home.dir || os.homedir() };
});

// A fixture that mirrors a real CrossOver bottles directory:
//
//   Deadlock/      Steam under "Program Files (x86)" (the usual case)
//   Deadlock2/     name-prefixed sibling, to catch sloppy startsWith matching
//   Office/        a bottle with no Steam at all
//   Legacy/        Steam under "Program Files" (64-bit installer layout)
//   notabottle     a plain file sitting in the bottles dir
let bottlesDir: string;
let hostLibrary: string;

beforeAll(() => {
    const root = mkdtempSync(join(tmpdir(), 'grimoire-bottles-'));
    bottlesDir = join(root, 'Bottles');
    hostLibrary = join(root, 'HostGames');
    mkdirSync(hostLibrary, { recursive: true });

    const makeBottle = (name: string, steamSubPath: string | null) => {
        const bottle = join(bottlesDir, name);
        const driveC = join(bottle, 'drive_c');
        mkdirSync(driveC, { recursive: true });
        if (steamSubPath) mkdirSync(join(driveC, steamSubPath), { recursive: true });

        return bottle;
    };

    makeBottle('Deadlock', join('Program Files (x86)', 'Steam'));
    makeBottle('Deadlock2', join('Program Files (x86)', 'Steam'));
    makeBottle('Office', null);
    makeBottle('Legacy', join('Program Files', 'Steam'));
    writeFileSync(join(bottlesDir, 'notabottle'), 'stray file');

});

afterAll(() => {
    rmSync(join(bottlesDir, '..'), { recursive: true, force: true });
});

describe('findSteamBottles', () => {
    it('finds only bottles that actually contain a Steam install', () => {
        const names = findSteamBottles(bottlesDir).map((b) => b.name);
        expect(names).toEqual(['Deadlock', 'Deadlock2', 'Legacy']);
    });

    it('handles the 64-bit "Program Files" layout as well as x86', () => {
        const legacy = findSteamBottles(bottlesDir).find((b) => b.name === 'Legacy')!;
        expect(legacy.steamRoot).toBe(
            join(bottlesDir, 'Legacy', 'drive_c', 'Program Files', 'Steam')
        );
    });

    it('returns empty rather than throwing when the bottles dir is absent', () => {
        expect(findSteamBottles(join(bottlesDir, 'does-not-exist'))).toEqual([]);
    });
});

describe('resolveBottleWindowsPath', () => {
    const map = () => ({
        'c:': join(bottlesDir, 'Deadlock', 'drive_c'),
        'd:': hostLibrary,
    });

    it('maps a drive_c Windows path to its host path', () => {
        expect(resolveBottleWindowsPath('C:\\Program Files (x86)\\Steam', map())).toBe(
            join(bottlesDir, 'Deadlock', 'drive_c', 'Program Files (x86)', 'Steam')
        );
    });

    it('maps a library on another drive letter out to its real location', () => {
        expect(resolveBottleWindowsPath('D:\\SteamLibrary', map())).toBe(
            join(hostLibrary, 'SteamLibrary')
        );
    });

    it('is case-insensitive about the drive letter', () => {
        expect(resolveBottleWindowsPath('c:\\Games', map())).toBe(
            join(bottlesDir, 'Deadlock', 'drive_c', 'Games')
        );
    });

    it('returns the drive root itself for a bare drive path', () => {
        expect(resolveBottleWindowsPath('C:\\', map())).toBe(
            join(bottlesDir, 'Deadlock', 'drive_c')
        );
    });

    it('returns null for a drive the prefix does not map', () => {
        expect(resolveBottleWindowsPath('E:\\SteamLibrary', map())).toBeNull();
    });

    it('returns null for something that is not a Windows path', () => {
        expect(resolveBottleWindowsPath('/usr/local/games', map())).toBeNull();
    });
});

describe('findBottleForPath', () => {
    it('matches the bottle root itself', () => {
        expect(findBottleForPath(join(bottlesDir, 'Deadlock'), bottlesDir)?.name).toBe('Deadlock');
    });

    it('finds the bottle containing a deep game path', () => {
        const gamePath = join(
            bottlesDir,
            'Deadlock',
            'drive_c',
            'Program Files (x86)',
            'Steam',
            'steamapps',
            'common',
            'Deadlock'
        );
        expect(findBottleForPath(gamePath, bottlesDir)?.name).toBe('Deadlock');
    });

    it('does not match a bottle whose name is a prefix of another', () => {
        const gamePath = join(bottlesDir, 'Deadlock2', 'drive_c', 'Program Files (x86)', 'Steam');
        expect(findBottleForPath(gamePath, bottlesDir)?.name).toBe('Deadlock2');
    });

    it('returns null for a path outside any bottle', () => {
        expect(findBottleForPath(hostLibrary, bottlesDir)).toBeNull();
    });

    it('does not match an unrelated folder with a bottle-name prefix', () => {
        expect(findBottleForPath(join(bottlesDir, 'DeadlockBackup', 'drive_c'), bottlesDir)).toBeNull();
    });
});

describe('getSteamRoots', () => {
    it('drops a Linux root that is a symlink to one already listed', () => {
        const platform = process.platform;
        home.dir = mkdtempSync(join(tmpdir(), 'grimoire-steam-home-'));
        try {
            Object.defineProperty(process, 'platform', { value: 'linux' });
            const real = join(home.dir, '.local/share/Steam');
            mkdirSync(real, { recursive: true });
            mkdirSync(join(home.dir, '.steam'));
            symlinkSync(real, join(home.dir, '.steam/steam'), 'junction');

            expect(getSteamRoots()).toEqual([
                join(home.dir, '.steam/steam'),
                join(home.dir, '.var/app/com.valvesoftware.Steam/.steam/steam'),
            ]);
        } finally {
            Object.defineProperty(process, 'platform', { value: platform });
            rmSync(home.dir, { recursive: true, force: true });
            home.dir = '';
        }
    });
});
