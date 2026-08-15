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

export type GlobalVpkRestoreSnapshot = {
  hadGlobal: boolean;
  allGlobal: boolean;
  ambiguous: boolean;
  globalIndexes: Set<number>;
  globalUnindexed: boolean;
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
  // An update can change archive topology (for example, V4 shipped several
  // indexed VPKs while V5 consolidates them into one unindexed VPK). With only
  // one possible replacement there is no ambiguity: preserve the coarse fact
  // that the old install was enabled even when its old index cannot match.
  if (candidates.length === 1) return true;
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

export function createGlobalVpkRestoreSnapshot(
  targets: Array<{ priorityMod?: boolean; vpkIndex?: number }>
): GlobalVpkRestoreSnapshot {
  const globalIndexes = new Set<number>();
  let globalUnindexed = false;
  for (const target of targets) {
    if (!target.priorityMod) continue;
    const index = getVpkIndex(target);
    if (index === undefined) {
      globalUnindexed = true;
    } else {
      globalIndexes.add(index);
    }
  }
  const allGlobal = targets.length > 0 && targets.every((target) => !!target.priorityMod);
  return {
    hadGlobal: globalUnindexed || globalIndexes.size > 0,
    allGlobal,
    ambiguous: globalUnindexed && !allGlobal,
    globalIndexes,
    globalUnindexed,
  };
}

export function shouldRestoreVpkGlobal(
  mod: Mod,
  candidates: Mod[],
  snapshot: GlobalVpkRestoreSnapshot
): boolean {
  if (!snapshot.hadGlobal) return false;
  // As with enabled state, a sole replacement is the unambiguous destination
  // even if the author's new archive no longer carries the old VPK index.
  if (candidates.length === 1) return !snapshot.ambiguous;
  const hasIndexedCandidates = candidates.some((candidate) => getVpkIndex(candidate) !== undefined);
  const index = getVpkIndex(mod);
  if (hasIndexedCandidates) {
    if (snapshot.globalIndexes.size === 0) return snapshot.globalUnindexed && snapshot.allGlobal;
    return index === undefined ? snapshot.globalUnindexed : snapshot.globalIndexes.has(index);
  }
  return snapshot.globalIndexes.size === 0 && snapshot.globalUnindexed && snapshot.allGlobal;
}

export type ReplacementVpkRestoreFailure = {
  action: 'global' | 'enable';
  mod: Mod;
  error: unknown;
};

export async function restoreReplacementVpkState(
  candidates: Mod[],
  enabledSnapshot: EnabledVpkRestoreSnapshot,
  globalSnapshot: GlobalVpkRestoreSnapshot,
  operations: {
    setGlobal: (modId: string) => Promise<void>;
    enable: (modId: string) => Promise<void>;
  }
): Promise<ReplacementVpkRestoreFailure[]> {
  const failures: ReplacementVpkRestoreFailure[] = [];
  for (const mod of candidates) {
    if (!mod.priorityMod && shouldRestoreVpkGlobal(mod, candidates, globalSnapshot)) {
      try {
        await operations.setGlobal(mod.id);
      } catch (error) {
        failures.push({ action: 'global', mod, error });
      }
    }
    if (!mod.enabled && shouldRestoreVpkEnabled(mod, candidates, enabledSnapshot)) {
      try {
        await operations.enable(mod.id);
      } catch (error) {
        failures.push({ action: 'enable', mod, error });
      }
    }
  }
  return failures;
}
