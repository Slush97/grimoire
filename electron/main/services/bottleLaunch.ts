// Launching Windows Steam inside a CrossOver bottle (macOS only).
//
// On Windows and Linux we hand Steam a steam:// URL and the OS routes it. That
// cannot work on macOS: the URL handler is the native Steam client, which has
// no Deadlock depot and would simply do nothing. The game only exists inside a
// Wine prefix, so we have to invoke that prefix's steam.exe directly.

import { existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { spawn } from 'child_process';
import type { SteamBottle } from './steamRoots';

/**
 * CrossOver's Wine loader, relative to the app bundle. This is the supported
 * CLI entry point (a Perl wrapper that sets up CX_ROOT, the bottle env, and the
 * graphics backend) rather than the raw wineloader binary.
 */
const CROSSOVER_WINE_SUBPATH = 'Contents/SharedSupport/CrossOver/bin/wine';

/** Locations to look for CrossOver, in priority order. */
function crossOverCandidates(): string[] {
    return [
        '/Applications/CrossOver.app',
        join(homedir(), 'Applications/CrossOver.app'),
    ];
}

/**
 * Absolute path to CrossOver's wine wrapper, or null when CrossOver is not
 * installed. `GRIMOIRE_WINE` overrides the search, which is how a user on a
 * different Wine build (or a non-standard install location) opts in.
 */
export function findBottleRunner(): string | null {
    const override = process.env.GRIMOIRE_WINE;
    if (override) return existsSync(override) ? override : null;

    for (const app of crossOverCandidates()) {
        const wine = join(app, CROSSOVER_WINE_SUBPATH);
        if (existsSync(wine)) return wine;
    }
    return null;
}

/** Thrown when we know the game is in a bottle but cannot drive that bottle. */
export class BottleRunnerMissingError extends Error {
    constructor() {
        super(
            'Deadlock is installed inside a CrossOver bottle, but CrossOver could not be found. ' +
            'Install CrossOver, or set GRIMOIRE_WINE to your Wine binary.'
        );
        this.name = 'BottleRunnerMissingError';
    }
}

/**
 * Ask the bottle's Steam to launch an app, and return once the request has been
 * handed off. Deliberately does not wait for the game: callers poll for the
 * process separately, exactly as they do on the other platforms.
 *
 * The child is detached and its stdio discarded so a long-lived Wine process
 * tree does not keep a handle on Grimoire (and so quitting Grimoire mid-session
 * cannot take the game down with it).
 */
export function launchAppInBottle(bottle: SteamBottle, appId: string | number): void {
    const runner = findBottleRunner();
    if (!runner) throw new BottleRunnerMissingError();

    const steamExe = join(bottle.steamRoot, 'steam.exe');
    if (!existsSync(steamExe)) {
        throw new Error(`No steam.exe in bottle "${bottle.name}" at ${bottle.steamRoot}`);
    }

    const child = spawn(
        runner,
        ['--bottle', bottle.name, '--', steamExe, '-applaunch', String(appId)],
        { detached: true, stdio: 'ignore' }
    );
    child.unref();
}
