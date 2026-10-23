import { isDeadlockRunning } from './launch';
import type { Mod } from './mods';
import { GAME_RUNNING_MOD_LOCK_MESSAGE } from '../../../src/lib/modLocks';

export { GAME_RUNNING_MOD_LOCK_MESSAGE };

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
    captureLoadedGameMods([]);
}

export function clearLoadedGameMods(): void {
    snapshot = null;
    launchGraceUntil = 0;
}

export function hasRunningGameModSnapshot(): boolean {
    return snapshot !== null;
}

export function getLoadedGameModIds(): string[] {
    return snapshot ? [...snapshot.lockedModIds] : [];
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

export async function syncRunningGameModSnapshotFromMods(mods: Mod[]): Promise<void> {
    const running = lockScopedRunning ?? (await isDeadlockRunning());
    syncKnownRunningGameModSnapshot(running, mods);
}

export function syncKnownRunningGameModSnapshot(running: boolean, mods: Mod[]): void {
    if (running) {
        launchGraceUntil = 0;
        if (!snapshot) {
            captureLoadedGameMods(mods);
        }
    } else if (!snapshot || Date.now() >= launchGraceUntil) {
        // Keep the launch snapshot until the process appears or the grace expires.
        clearLoadedGameMods();
    }
}
