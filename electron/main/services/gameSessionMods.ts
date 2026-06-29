import { isDeadlockRunning } from './launch';
import type { Mod } from './mods';

export const GAME_RUNNING_MOD_LOCK_MESSAGE = 'Game is running';

interface RunningGameSnapshot {
    lockedModIds: Set<string>;
    lockedMetaKeys: Set<string>;
}

let snapshot: RunningGameSnapshot | null = null;

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

export async function syncRunningGameModSnapshotFromMods(mods: Mod[]): Promise<{ running: boolean }> {
    const running = await isDeadlockRunning();
    return syncKnownRunningGameModSnapshot(running, mods);
}

export function syncKnownRunningGameModSnapshot(running: boolean, mods: Mod[]): { running: boolean } {
    if (!running) {
        clearLoadedGameMods();
        return { running: false };
    }

    if (!snapshot) {
        captureLoadedGameMods(mods);
    }

    return { running: true };
}
