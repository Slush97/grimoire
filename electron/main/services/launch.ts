import { promises as fs, existsSync } from 'fs';
import { join, basename, dirname } from 'path';
import { spawn } from 'child_process';
import { shell } from 'electron';
import { getUserDataPath } from '../utils/paths';
import { getAddonsPath, getDisabledPath, getAddonFolderPaths, getCitadelPath } from './deadlock';
import { loadSettings } from './settings';
import { writeLaunchOptions, readLaunchOptions, isSteamRunning } from './launchOptions';

// Deadlock's Steam AppID — used for the steam://rungameid/... URI scheme.
const DEADLOCK_STEAM_APP_ID = 1422450;
const DEADLOCK_PROCESS_NAME = 'deadlock.exe';

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
    /** Each stashed VPK plus the addon folder it came from, so restore returns
     *  it to the right place. `folder` is the addon root basename: "addons" for
     *  the base folder, "addonsN" for an overflow folder. Absent on stashes
     *  written before multi-folder overflow existed; those are all base addons. */
    mods: Array<{ fileName: string; folder?: string }>;
}

/** Absolute path of an addon root folder from the basename recorded in the
 *  stash ("addons" -> base citadel/addons, "addonsN" -> citadel/addonsN). */
function originFolderPath(deadlockPath: string, folder: string): string {
    return folder === 'addons'
        ? getAddonsPath(deadlockPath)
        : join(getCitadelPath(deadlockPath), folder);
}

/**
 * Where a stashed VPK lives while parked. Base-addons files stay flat in
 * `.disabled/` (byte-identical to the pre-overflow stash format, so a
 * non-overflow user's vanilla launch is unchanged). Overflow addonsN files go in
 * a per-folder subfolder of `.disabled/` so a pakNN name (which legitimately
 * repeats across folders) can't collide in the shared parking lot.
 */
function stashSlotPath(disabledPath: string, folder: string, fileName: string): string {
    return folder === 'addons'
        ? join(disabledPath, fileName)
        : join(disabledPath, folder, fileName);
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
 * Check whether Deadlock is currently running. On Linux/Proton the kernel
 * comm name is truncated to 15 chars and Proton renames its main thread, so
 * exact-comm matching (pgrep -x) misses the game. Match against the full
 * cmdline (pgrep -f) instead, which finds both the game and its Proton
 * wrapper chain.
 */
export async function isDeadlockRunning(): Promise<boolean> {
    try {
        if (process.platform === 'win32') {
            const result = await runCommand('tasklist.exe', [
                '/FI',
                `IMAGENAME eq ${DEADLOCK_PROCESS_NAME}`,
                '/NH',
            ]);
            return /deadlock\.exe/i.test(result.stdout);
        }
        if (process.platform === 'linux') {
            const result = await runCommand('pgrep', ['-f', DEADLOCK_PROCESS_NAME]);
            return result.code === 0 && result.stdout.trim().length > 0;
        }
    } catch {
        return false;
    }
    return false;
}

export interface StopDeadlockResult {
    wasRunning: boolean;
    stopped: boolean;
}

interface CommandResult {
    code: number;
    stdout: string;
    stderr: string;
}

function runCommand(command: string, args: string[]): Promise<CommandResult> {
    return new Promise<CommandResult>((resolve, reject) => {
        const proc = spawn(command, args, { windowsHide: true });
        let stdout = '';
        let stderr = '';
        proc.stdout?.on('data', (chunk) => { stdout += chunk.toString(); });
        proc.stderr?.on('data', (chunk) => { stderr += chunk.toString(); });
        proc.on('close', (code) => {
            resolve({ code: code ?? 0, stdout, stderr });
        });
        proc.on('error', reject);
    });
}

async function requestDeadlockStop(force: boolean): Promise<CommandResult> {
    if (process.platform === 'win32') {
        return runCommand(
            'taskkill.exe',
            force
                ? ['/F', '/IM', DEADLOCK_PROCESS_NAME, '/T']
                : ['/IM', DEADLOCK_PROCESS_NAME, '/T']
        );
    }
    if (process.platform === 'linux') {
        return runCommand('pkill', [force ? '-KILL' : '-TERM', '-f', DEADLOCK_PROCESS_NAME]);
    }
    return { code: 0, stdout: '', stderr: '' };
}

export async function stopDeadlockGame(): Promise<StopDeadlockResult> {
    const wasRunning = await isDeadlockRunning();
    if (!wasRunning) {
        return { wasRunning: false, stopped: true };
    }

    const result = await requestDeadlockStop(false);
    await sleep(750);
    if (!(await isDeadlockRunning())) {
        return { wasRunning: true, stopped: true };
    }

    const forceResult = await requestDeadlockStop(true);
    if (forceResult.code !== 0 && await isDeadlockRunning()) {
        throw new Error(
            (forceResult.stderr || forceResult.stdout || result.stderr || result.stdout || 'Could not stop Deadlock.').trim()
        );
    }

    await sleep(750);
    return { wasRunning: true, stopped: !(await isDeadlockRunning()) };
}

/**
 * Stash every VPK across every addon folder (base citadel/addons plus any
 * overflow addonsN): record them to the stash file first (so a crash mid-move
 * leaves a recoverable breadcrumb that knows each file's origin folder), then
 * move the files into disabled/. Mark the stash 'active' only once all moves
 * succeed.
 *
 * If a move fails mid-operation, we leave the stash at 'pending' and rethrow.
 * The caller (or next app startup) can then invoke restoreFromStash to
 * reassemble whatever state made it to disk.
 */
async function stashEnabledMods(deadlockPath: string): Promise<VanillaStash> {
    const disabledPath = getDisabledPath(deadlockPath);

    // Enumerate every addon root (base citadel/addons first, then overflow
    // addons1, addons2, ...) and record each enabled VPK with its origin folder
    // BEFORE moving anything, so a crash mid-move leaves a recoverable breadcrumb
    // that knows where each file belongs.
    const mods: Array<{ fileName: string; folder: string }> = [];
    for (const folder of getAddonFolderPaths(deadlockPath)) {
        const name = basename(folder);
        let entries: string[];
        try {
            entries = await fs.readdir(folder);
        } catch {
            continue;
        }
        // Stash only VPK files (addon folders may contain other junk).
        for (const fileName of entries) {
            if (fileName.toLowerCase().endsWith('.vpk')) mods.push({ fileName, folder: name });
        }
    }

    const stash: VanillaStash = {
        version: 1,
        status: 'pending',
        startedAt: new Date().toISOString(),
        mods,
    };
    await writeStash(stash);

    for (const { fileName, folder } of mods) {
        const from = join(originFolderPath(deadlockPath, folder), fileName);
        const to = stashSlotPath(disabledPath, folder, fileName);
        if (existsSync(to)) {
            // Parking spot already taken. This shouldn't happen in normal
            // operation (enable/disable handles collisions, and overflow files
            // get a per-folder subfolder), but be safe: skip rather than
            // overwrite the parked copy.
            continue;
        }
        await fs.mkdir(dirname(to), { recursive: true });
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
 * Move stashed VPKs from disabled/ back to each one's origin addon folder (base
 * addons or an overflow addonsN, per the stash record), with retries for
 * transient Windows file locks. Deletes the stash only if every file is
 * accounted for.
 *
 * Hazard notes:
 * - If the game is still running and holds a handle on the _dir.vpk, Windows
 *   will fail the rename with EBUSY/EPERM. We retry a few times then give up
 *   and leave the stash in place so the user can hit "Restore now" after they
 *   quit the game.
 * - If a stashed file is already back in its origin folder (user manually moved
 *   it), we skip rather than clobber.
 * - If the stashed file vanished from disabled/ (user deleted it), we skip.
 */
export async function restoreFromStash(
    deadlockPath: string,
    stash: VanillaStash
): Promise<RestoreResult> {
    const disabledPath = getDisabledPath(deadlockPath);

    let restored = 0;
    let skipped = 0;
    const failed: string[] = [];

    for (const { fileName, folder } of stash.mods) {
        // Legacy stashes (pre-overflow) carry no folder; they're all base addons.
        const originFolder = folder ?? 'addons';
        const from = stashSlotPath(disabledPath, originFolder, fileName);
        const targetDir = originFolderPath(deadlockPath, originFolder);
        const to = join(targetDir, fileName);

        if (!existsSync(from)) {
            skipped++;
            continue;
        }
        if (existsSync(to)) {
            // Collision — don't clobber whatever's already there.
            skipped++;
            continue;
        }

        // The origin folder may have been emptied (overflow) but should still
        // exist; recreate it defensively so the rename lands.
        await fs.mkdir(targetDir, { recursive: true });

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
 * Sync the user's configured launch-options string into Steam's
 * localconfig.vdf for Deadlock. Best-effort: failures are logged and
 * swallowed so a broken Steam config can't block the user from launching.
 *
 * We only write when Steam isn't running — Steam clobbers localconfig.vdf on
 * shutdown, so a write while Steam is up gets undone moments later. The
 * caller (launchModded / launchVanilla) runs this BEFORE invoking the
 * Steam URL, which is the safe window: Steam will pick up our edit when it
 * starts.
 */
async function syncLaunchOptionsToSteam(): Promise<void> {
    const settings = loadSettings();
    const desired = settings.steamLaunchOptions ?? '';
    try {
        if (await isSteamRunning()) {
            console.warn('[launch] Steam already running — skipping launch-options sync to avoid clobber.');
            return;
        }
        // Only write if the value actually differs from what's on disk —
        // avoids a needless backup + rewrite of a multi-megabyte file on
        // every launch.
        const current = await readLaunchOptions();
        if (current && current.currentValue === desired) {
            return;
        }
        if (!current && !desired) {
            // Nothing set and nothing to set; skip even creating the entry.
            return;
        }
        await writeLaunchOptions(desired);
    } catch (err) {
        console.warn('[launch] Failed to sync launch options to Steam:', err);
    }
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
        await syncLaunchOptionsToSteam();
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
        await syncLaunchOptionsToSteam();
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
