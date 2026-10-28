import type { Mod } from '../types/mod';

// These messages cross IPC unchanged. Translate the warning shown to the user.
export const GAME_RUNNING_MOD_LOCK_MESSAGE = 'Game is running';
export const VANILLA_WINDOW_LOCK_MESSAGE = 'Vanilla launch in progress';

export function isGameRunningModLockError(error: unknown): boolean {
  const message = String(error);
  return message.includes(GAME_RUNNING_MOD_LOCK_MESSAGE) || message.includes(VANILLA_WINDOW_LOCK_MESSAGE);
}

export function isModLoadedInGame(mod: Pick<Mod, 'id' | 'enabled'> | undefined, loadedIds: ReadonlySet<string>): boolean {
  return !!mod?.enabled && loadedIds.has(mod.id);
}

/** Moving an item also shifts the items between its old and new positions. */
export function isReorderBlocked<T>(items: readonly T[], from: number, to: number, isLocked: (item: T) => boolean): boolean {
  return from !== to && items.slice(Math.min(from, to), Math.max(from, to) + 1).some(isLocked);
}
