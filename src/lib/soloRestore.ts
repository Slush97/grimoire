import type { Mod } from '../types/mod';

/**
 * "Start with only this mod enabled" solo testing. Soloing disables every other
 * mod; restoring brings the previous enabled set back. The catch is that
 * disabling a mod renames its VPK into `.disabled/`, which changes its metaKey
 * and therefore its `id`, so a restore snapshot can't hold ids. We snapshot a
 * stable identity key instead and re-match it against the current (post-solo)
 * mod list. Split out of the store so the matching rules are unit-tested.
 */

export interface TogglePlan {
  /** Mod ids to enable. */
  enable: string[];
  /** Mod ids to disable. */
  disable: string[];
}

type IdentityFields = Pick<
  Mod,
  'gameBananaId' | 'gameBananaFileId' | 'vpkIndex' | 'sha256' | 'name' | 'size'
>;

/**
 * Stable identity for a mod across the id churn that enable/disable causes.
 * Prefer GameBanana file identity (survives the rename), then content hash,
 * then name+size for local imports that carry neither.
 */
export function modRestoreKey(m: IdentityFields): string {
  if (typeof m.gameBananaFileId === 'number') {
    return `gb:${m.gameBananaId ?? ''}:${m.gameBananaFileId}:${m.vpkIndex ?? ''}`;
  }
  if (m.sha256) return `sha:${m.sha256}`;
  return `nm:${m.name}:${m.size}`;
}

/**
 * Enable exactly `enableIds` and disable every other currently-enabled mod.
 * Ids in `enableIds` that are already enabled (or unknown) contribute nothing.
 */
export function planSolo(mods: Mod[], enableIds: string[]): TogglePlan {
  const enableSet = new Set(enableIds);
  const byId = new Map(mods.map((m) => [m.id, m]));
  const disable = mods.filter((m) => m.enabled && !enableSet.has(m.id)).map((m) => m.id);
  const enable = enableIds.filter((id) => {
    const m = byId.get(id);
    return !!m && !m.enabled;
  });
  return { enable, disable };
}

/**
 * Bring the enabled set back to the snapshot identified by `keys`: enable any
 * currently-disabled mod whose key is in the snapshot, disable any currently-
 * enabled mod whose key is not. Keys with no matching mod (e.g. a mod deleted
 * mid-test) are simply skipped.
 */
export function planRestore(mods: Mod[], keys: string[]): TogglePlan {
  const keySet = new Set(keys);
  const enable = mods
    .filter((m) => !m.enabled && keySet.has(modRestoreKey(m)))
    .map((m) => m.id);
  const disable = mods
    .filter((m) => m.enabled && !keySet.has(modRestoreKey(m)))
    .map((m) => m.id);
  return { enable, disable };
}
