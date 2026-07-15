import { isDeadlockRunning } from './launch';
import type { Mod } from './mods';

export const GAME_RUNNING_MOD_LOCK_MESSAGE = 'Game is running';

interface RunningGameSnapshot {
    lockedModIds: Set<string>;
    lockedMetaKeys: Set<string>;
}

let snapshot: RunningGameSnapshot | null = null;

// Running state computed once per mod-mutation batch (see beginModMutationRunningScope).
let lockScopedRunning: boolean | undefined;

// While Deadlock is launching it isn't visible to pgrep/tasklist for ~10-30s.
// markLaunchGrace keeps the beforeLaunch snapshot alive across that window so
// the 3s status poll can't wipe it before the process appears.
let launchGraceUntil = 0;

function makeSnapshot(mods: Mod[]): RunningGameSnapshot {
    const enabled = mods.filter((mod) => mod.enabled);
    return {
        lockedModIds: new Set(enabled.map((mod) => mod.id)),
        lockedMetaKeys: new Set(enabled.map((mod) => mod.metaKey)),
    };
}

export function captureLoadedGameMods(mods: Mod[]): void {
    snapshot = makeSnapshot(mods);
}

export function captureEmptyGameMods(): void {
    snapshot = {
        lockedModIds: new Set(),
        lockedMetaKeys: new Set(),
    };
}

export function clearLoadedGameMods(): void {
    snapshot = null;
    launchGraceUntil = 0;
}

export function hasRunningGameModSnapshot(): boolean {
    return snapshot !== null;
}

export function isLoadedGameModLocked(mod: Pick<Mod, 'id' | 'metaKey' | 'enabled'>): boolean {
    if (!mod.enabled || !snapshot) return false;
    return snapshot.lockedModIds.has(mod.id) || snapshot.lockedMetaKeys.has(mod.metaKey);
}

export function assertCanMoveLoadedGameMod(mod: Pick<Mod, 'id' | 'metaKey' | 'enabled'>): void {
    if (isLoadedGameModLocked(mod)) {
        throw new Error(GAME_RUNNING_MOD_LOCK_MESSAGE);
    }
}

export function assertCanMoveLoadedGameMods(mods: Array<Pick<Mod, 'id' | 'metaKey' | 'enabled'>>): void {
    if (mods.some(isLoadedGameModLocked)) {
        throw new Error(GAME_RUNNING_MOD_LOCK_MESSAGE);
    }
}

/**
 * A single mod-folder mutation can fan out into many snapshot syncs
 * (applyProfile disables/enables/reorders N mods under one lock). Without this,
 * each sync spawns its own pgrep/tasklist. The mutation lock computes the
 * running state once via beginModMutationRunningScope and parks it here for the
 * whole batch; endModMutationRunningScope clears it in a finally.
 */
export async function beginModMutationRunningScope(): Promise<void> {
    lockScopedRunning = await isDeadlockRunning();
}

export function endModMutationRunningScope(): void {
    lockScopedRunning = undefined;
}

export function markLaunchGrace(ms = 60_000): void {
    launchGraceUntil = Date.now() + ms;
}

export async function syncRunningGameModSnapshotFromMods(mods: Mod[]): Promise<{ running: boolean }> {
    const running = lockScopedRunning ?? (await isDeadlockRunning());
    return syncKnownRunningGameModSnapshot(running, mods);
}

export function syncKnownRunningGameModSnapshot(running: boolean, mods: Mod[]): { running: boolean } {
    if (!running) {
        // Keep the beforeLaunch snapshot during the launch grace window: the
        // game isn't visible to pgrep/tasklist yet, but its loaded mods are
        // already locked in.
        if (snapshot && Date.now() < launchGraceUntil) {
            return { running: false };
        }
        clearLoadedGameMods();
        return { running: false };
    }

    launchGraceUntil = 0;
    if (!snapshot) {
        captureLoadedGameMods(mods);
    }

    return { running: true };
}
