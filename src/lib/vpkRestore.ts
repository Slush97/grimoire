import type { Mod } from '../types/mod';

/**
 * Preserving per-VPK enabled state across a redownload/update. A replacement
 * download lands every VPK disabled, so before deleting the old install we
 * snapshot which VPKs were enabled (by their size-sorted `vpkIndex`), then
 * re-enable the matching siblings on the fresh install. Split out of Installed
 * so the matching rules are unit-tested.
 */
export type EnabledVpkRestoreSnapshot = {
  hadEnabled: boolean;
  enabledIndexes: Set<number>;
  enabledUnindexed: boolean;
};

export function getVpkIndex(mod: Pick<Mod, 'vpkIndex'>): number | undefined {
  return typeof mod.vpkIndex === 'number' && Number.isInteger(mod.vpkIndex) && mod.vpkIndex >= 0
    ? mod.vpkIndex
    : undefined;
}

export function createEnabledVpkRestoreSnapshot(
  targets: Array<{ enabled: boolean; vpkIndex?: number }>
): EnabledVpkRestoreSnapshot {
  const enabledIndexes = new Set<number>();
  let enabledUnindexed = false;
  for (const target of targets) {
    if (!target.enabled) continue;
    const index = getVpkIndex(target);
    if (index === undefined) {
      enabledUnindexed = true;
    } else {
      enabledIndexes.add(index);
    }
  }
  return {
    hadEnabled: enabledUnindexed || enabledIndexes.size > 0,
    enabledIndexes,
    enabledUnindexed,
  };
}

export function shouldRestoreVpkEnabled(
  mod: Mod,
  candidates: Mod[],
  snapshot: EnabledVpkRestoreSnapshot
): boolean {
  if (!snapshot.hadEnabled) return false;
  const hasIndexedCandidates = candidates.some((candidate) => getVpkIndex(candidate) !== undefined);
  const index = getVpkIndex(mod);
  if (hasIndexedCandidates) {
    // Snapshot carries no per-VPK index (the old install predates vpkIndex), but
    // the redownload assigned indexes. We can't map which sibling was on, so
    // honor the coarse "something was enabled" and restore every VPK, matching
    // the pre-index behavior. Without this, a multi-VPK mod installed before
    // vpkIndex existed silently lands fully disabled after an update.
    if (snapshot.enabledIndexes.size === 0) return snapshot.enabledUnindexed;
    return index === undefined ? snapshot.enabledUnindexed : snapshot.enabledIndexes.has(index);
  }
  return snapshot.enabledIndexes.size === 0 && snapshot.enabledUnindexed;
}
