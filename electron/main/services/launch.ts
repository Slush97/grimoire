import { promises as fs, existsSync } from 'fs';
import { join } from 'path';
import { spawn } from 'child_process';
import { shell } from 'electron';
import { getUserDataPath } from '../utils/paths';
import { getAddonsPath, getDisabledPath } from './deadlock';

// Deadlock's Steam AppID — used for the steam://rungameid/... URI scheme.
const DEADLOCK_STEAM_APP_ID = 1422450;

// How long we wait for Deadlock.exe to appear after triggering a Steam launch
// before restoring anyway (Steam not installed, user cancelled the prompt, etc.).
const GAME_START_TIMEOUT_MS = 60_000;

// How long we wait after the game process appears before moving VPKs back.
// Gives Source 2 time to finish mounting the (empty) addons folder so the
// restored files don't get picked up in the current session.
const POST_START_GRACE_MS = 10_000;

// Retry configuration for Windows file-lock EBUSY/EACCES errors on rename.
const RESTORE_MAX_ATTEMPTS = 3;
const RESTORE_RETRY_DELAY_MS = 500;

/**
 * On-disk record of a vanilla-launch-in-progress. Written before any files
 * move so that if grimoire crashes mid-move we can still recover on restart.
 *
 * Lifecycle:
 *   - 'pending'  → we intend to move these files but haven't finished yet.
 *                  On recovery we assume some may already be moved and try to
 *                  restore whatever's in disabled/.
 *   - 'active'   → all files successfully stashed; the user is playing vanilla.
 *                  Normal restore path applies.
 */
export interface VanillaStash {
    version: 1;
    status: 'pending' | 'active';
    startedAt: string;
    mods: Array<{ fileName: string }>;
}

function getStashPath(): string {
    return join(getUserDataPath(), 'vanilla-stash.json');
}

/**
 * Atomic JSON write (write to temp, then rename) so a crash mid-write can't
 * leave a corrupt stash file.
 */
async function writeStash(stash: VanillaStash): Promise<void> {
    const path = getStashPath();
    const tmp = `${path}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(stash, null, 2), 'utf-8');
    await fs.rename(tmp, path);
}

export async function readStash(): Promise<VanillaStash | null> {
    const path = getStashPath();
    if (!existsSync(path)) return null;
    try {
        const content = await fs.readFile(path, 'utf-8');
        const parsed = JSON.parse(content) as VanillaStash;
        if (parsed?.version !== 1 || !Array.isArray(parsed.mods)) return null;
        return parsed;
    } catch {
        return null;
    }
}

async function deleteStash(): Promise<void> {
    const path = getStashPath();
    if (existsSync(path)) {
        await fs.unlink(path).catch(() => { /* ignore */ });
    }
}

export async function hasActiveVanillaStash(): Promise<boolean> {
    return !!(await readStash());
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Check whether Deadlock.exe is currently running. Platform-specific; we only
 * implement Windows (the game is effectively Windows-only; on other platforms
 * we conservatively assume "not running" so restore proceeds after the grace
 * period).
 */
async function isDeadlockRunning(): Promise<boolean> {
    if (process.platform !== 'win32') return false;
    return new Promise<boolean>((resolve) => {
        const proc = spawn('tasklist.exe', ['/FI', 'IMAGENAME eq deadlock.exe', '/NH'], {
            windowsHide: true,
        });
        let stdout = '';
        proc.stdout?.on('data', (chunk) => { stdout += chunk.toString(); });
        proc.on('close', () => {
            resolve(/deadlock\.exe/i.test(stdout));
        });
        proc.on('error', () => resolve(false));
    });
}

/**
 * Stash every VPK currently in the addons folder: record them to the stash
 * file first (so a crash mid-move leaves a recoverable breadcrumb), then move
 * the files into disabled/. Mark the stash 'active' only once all moves succeed.
 *
 * If a move fails mid-operation, we leave the stash at 'pending' and rethrow.
 * The caller (or next app startup) can then invoke restoreFromStash to
 * reassemble whatever state made it to disk.
 */
async function stashEnabledMods(deadlockPath: string): Promise<VanillaStash> {
    const addonsPath = getAddonsPath(deadlockPath);
    const disabledPath = getDisabledPath(deadlockPath);

    const entries = await fs.readdir(addonsPath);
    // Stash only VPK files (addons folder may contain other junk).
    const vpks = entries.filter((e) => e.toLowerCase().endsWith('.vpk'));

    const stash: VanillaStash = {
        version: 1,
        status: 'pending',
        startedAt: new Date().toISOString(),
        mods: vpks.map((fileName) => ({ fileName })),
    };
    await writeStash(stash);

    for (const fileName of vpks) {
        const from = join(addonsPath, fileName);
        const to = join(disabledPath, fileName);
        if (existsSync(to)) {
            // Disabled folder already has a file with this name. This shouldn't
            // happen in normal operation (enable/disable handles collisions),
            // but be safe: skip rather than overwrite the disabled copy.
            continue;
        }
        await fs.rename(from, to);
    }

    stash.status = 'active';
    await writeStash(stash);
    return stash;
}

export interface RestoreResult {
    restored: number;
    skipped: number;
    failed: string[];
}

/**
 * Move stashed VPKs from disabled/ back to addons/, with retries for transient
 * Windows file locks. Deletes the stash only if every file is accounted for.
 *
 * Hazard notes:
 * - If the game is still running and holds a handle on the _dir.vpk, Windows
 *   will fail the rename with EBUSY/EPERM. We retry a few times then give up
 *   and leave the stash in place so the user can hit "Restore now" after they
 *   quit the game.
 * - If a stashed file is already back in addons/ (user manually moved it),
 *   we skip rather than clobber.
 * - If the stashed file vanished from disabled/ (user deleted it), we skip.
 */
export async function restoreFromStash(
    deadlockPath: string,
    stash: VanillaStash
): Promise<RestoreResult> {
    const addonsPath = getAddonsPath(deadlockPath);
    const disabledPath = getDisabledPath(deadlockPath);

    let restored = 0;
    let skipped = 0;
    const failed: string[] = [];

    for (const { fileName } of stash.mods) {
        const from = join(disabledPath, fileName);
        const to = join(addonsPath, fileName);

        if (!existsSync(from)) {
            skipped++;
            continue;
        }
        if (existsSync(to)) {
            // Collision — don't clobber whatever's already there.
            skipped++;
            continue;
        }

        let ok = false;
        let lastErr: unknown;
        for (let attempt = 0; attempt < RESTORE_MAX_ATTEMPTS; attempt++) {
            try {
                await fs.rename(from, to);
                ok = true;
                break;
            } catch (err) {
                lastErr = err;
                if (attempt < RESTORE_MAX_ATTEMPTS - 1) {
                    await sleep(RESTORE_RETRY_DELAY_MS);
                }
            }
        }
        if (ok) {
            restored++;
        } else {
            console.error(`[launch] Failed to restore ${fileName}:`, lastErr);
            failed.push(fileName);
        }
    }

    if (failed.length === 0) {
        await deleteStash();
    }

    return { restored, skipped, failed };
}

/**
 * In-memory single-flight lock. Prevents the user from rapidly double-clicking
 * a launch button or interleaving modded/vanilla launches while a prior one's
 * state is still mutating.
 */
let launchInFlight = false;

/**
 * Background task: wait for the game to actually start (polls tasklist), then
 * wait a grace period, then restore. Deliberately fire-and-forget — callers
 * shouldn't await this because we're still technically "done" once Steam has
 * been asked to launch.
 */
function scheduleMidLaunchRestore(
    deadlockPath: string,
    onComplete?: (result: RestoreResult) => void
): void {
    void (async () => {
        const started = Date.now();
        let sawGame = false;
        while (Date.now() - started < GAME_START_TIMEOUT_MS) {
            if (await isDeadlockRunning()) {
                sawGame = true;
                break;
            }
            await sleep(1000);
        }

        // Whether or not the game appeared, grace, then restore. If the user
        // never launched (Steam closed, cancelled the prompt), restoring after
        // the timeout just undoes the stash — that's the correct recovery.
        if (sawGame) {
            await sleep(POST_START_GRACE_MS);
        }

        const stash = await readStash();
        if (!stash) return; // Already restored (e.g. user clicked Restore now).

        const result = await restoreFromStash(deadlockPath, stash);
        onComplete?.(result);
    })();
}

/**
 * Trigger Steam to launch Deadlock. Doesn't wait for the game to actually start.
 */
async function triggerSteamLaunch(): Promise<void> {
    await shell.openExternal(`steam://rungameid/${DEADLOCK_STEAM_APP_ID}`);
}

export interface LaunchOptions {
    deadlockPath: string;
    onRestoreComplete?: (result: RestoreResult) => void;
}

/**
 * Launch the game with mods active. If a previous vanilla-launch stash is
 * still on disk (e.g. grimoire crashed during a prior vanilla session), we
 * restore mods first so the user actually gets a modded session.
 */
export async function launchModded({
    deadlockPath,
    onRestoreComplete,
}: LaunchOptions): Promise<void> {
    if (launchInFlight) {
        throw new Error('Another launch is already in progress');
    }
    launchInFlight = true;
    try {
        const stash = await readStash();
        if (stash) {
            const result = await restoreFromStash(deadlockPath, stash);
            onRestoreComplete?.(result);
            if (result.failed.length > 0) {
                throw new Error(
                    `Couldn't restore ${result.failed.length} mod(s) — make sure Deadlock is fully closed and try again.`
                );
            }
        }
        await triggerSteamLaunch();
    } finally {
        launchInFlight = false;
    }
}

/**
 * Launch the game WITHOUT any mods active. Stashes every VPK in addons/,
 * triggers Steam, then schedules a background restore after the game mounts.
 *
 * If the Steam launch itself fails, we immediately restore from the stash
 * we just wrote, leaving the user in exactly the state they were in before.
 */
export async function launchVanilla({
    deadlockPath,
    onRestoreComplete,
}: LaunchOptions): Promise<void> {
    if (launchInFlight) {
        throw new Error('Another launch is already in progress');
    }
    launchInFlight = true;

    // If there's already a stash on disk, don't stack. Caller should restore first.
    const existing = await readStash();
    if (existing) {
        launchInFlight = false;
        throw new Error(
            'A previous vanilla launch is still pending restore. Restore or retry first.'
        );
    }

    let stash: VanillaStash;
    try {
        stash = await stashEnabledMods(deadlockPath);
    } catch (err) {
        // Mid-stash failure — try to restore whatever made it into disabled/
        // before rethrowing, so we don't leave the user with half-moved files.
        const current = await readStash();
        if (current) {
            await restoreFromStash(deadlockPath, current);
        }
        launchInFlight = false;
        throw err;
    }

    try {
        await triggerSteamLaunch();
    } catch (err) {
        // Steam URL failed — immediately restore so the user isn't left with
        // no mods AND no game.
        await restoreFromStash(deadlockPath, stash);
        launchInFlight = false;
        throw err;
    }

    // Release the lock now; the background restore is independent.
    launchInFlight = false;
    scheduleMidLaunchRestore(deadlockPath, onRestoreComplete);
}

/**
 * Called on app startup. If a stash exists:
 *   - If Deadlock isn't running, restore immediately. Most common case: user
 *     quit grimoire during a vanilla session, then reopened it after closing
 *     the game.
 *   - If Deadlock IS running, the game has already mounted the (empty) addons
 *     folder, so it's safe to restore now — the restored files won't be seen
 *     until the next game launch. We still retry if Windows locks the files.
 */
export async function recoverFromStashOnStartup(
    deadlockPath: string
): Promise<RestoreResult | null> {
    const stash = await readStash();
    if (!stash) return null;
    return restoreFromStash(deadlockPath, stash);
}
