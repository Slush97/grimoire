import type { Mod } from '../types/mod';

/**
 * Preserving per-VPK enabled state across a redownload/update. A replacement
 * download lands every VPK disabled, so before deleting the old install we
 * snapshot which VPKs were enabled, then re-enable the matching siblings on
 * the fresh install. A sibling is matched by where it sat in the archive when
 * both installs recorded that, else by its size-sorted `vpkIndex`, which
 * drifts when an update adds a part or changes which part is biggest. Split
 * out of Installed so the matching rules are unit-tested.
 */
export type EnabledVpkRestoreSnapshot = {
  hadEnabled: boolean;
  /** Two or more VPKs and every one enabled: parts that run together, so
   *  every part of the new archive comes back on, new parts included. One
   *  enabled VPK is not enough, it may be the one variant the user kept. */
  allPartsEnabled: boolean;
  enabledIndexes: Set<number>;
  enabledUnindexed: boolean;
  enabledByArchivePath: Map<string, boolean>;
};

export type GlobalVpkRestoreSnapshot = {
  hadGlobal: boolean;
  allGlobal: boolean;
  ambiguous: boolean;
  globalIndexes: Set<number>;
  globalUnindexed: boolean;
  globalByArchivePath: Map<string, boolean>;
};

export function getVpkIndex(mod: Pick<Mod, 'vpkIndex'>): number | undefined {
  return typeof mod.vpkIndex === 'number' && Number.isInteger(mod.vpkIndex) && mod.vpkIndex >= 0
    ? mod.vpkIndex
    : undefined;
}

/** `Body/Hero_Body_dir.vpk` -> `body/hero_body`. */
function archiveStem(path: string): string {
  return path.toLowerCase().replace(/(_dir)?\.vpk$/, '');
}

function recordArchivePath(states: Map<string, boolean>, archiveVpkPath: string | undefined, state: boolean): void {
  if (!archiveVpkPath) return;
  const stem = archiveStem(archiveVpkPath);
  states.set(stem, state || !!states.get(stem));
}

/**
 * The state of the old VPK the fresh one replaces, by archive path: the same
 * path, else the longest old path that one of the two starts with, so an
 * author re-tagging `hero_body` as `hero_body_v2` still maps. null when
 * nothing matches or equally close matches disagree; undefined when either
 * side has no paths (installs from before they were recorded).
 */
function stateByArchivePath(
  mod: Pick<Mod, 'archiveVpkPath'>,
  old: ReadonlyMap<string, boolean>,
): boolean | null | undefined {
  if (!mod.archiveVpkPath || old.size === 0) return undefined;
  const stem = archiveStem(mod.archiveVpkPath);
  const exact = old.get(stem);
  if (exact !== undefined) return exact;
  let longest = 0;
  const states = new Set<boolean>();
  for (const [oldStem, state] of old) {
    if (!stem.startsWith(oldStem) && !oldStem.startsWith(stem)) continue;
    const overlap = Math.min(stem.length, oldStem.length);
    if (overlap > longest) {
      longest = overlap;
      states.clear();
    }
    if (overlap === longest) states.add(state);
  }
  return states.size === 1 ? [...states][0] : null;
}

export function createEnabledVpkRestoreSnapshot(
  targets: Array<{ enabled: boolean; vpkIndex?: number; archiveVpkPath?: string }>
): EnabledVpkRestoreSnapshot {
  const enabledIndexes = new Set<number>();
  const enabledByArchivePath = new Map<string, boolean>();
  let enabledUnindexed = false;
  for (const target of targets) {
    recordArchivePath(enabledByArchivePath, target.archiveVpkPath, target.enabled);
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
    allPartsEnabled: targets.length > 1 && targets.every((target) => target.enabled),
    enabledIndexes,
    enabledUnindexed,
    enabledByArchivePath,
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
  const named = stateByArchivePath(mod, snapshot.enabledByArchivePath);
  if (named !== undefined) return named ?? snapshot.allPartsEnabled;
  if (snapshot.allPartsEnabled) return true;
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
  targets: Array<{ priorityMod?: boolean; vpkIndex?: number; archiveVpkPath?: string }>
): GlobalVpkRestoreSnapshot {
  const globalIndexes = new Set<number>();
  const globalByArchivePath = new Map<string, boolean>();
  let globalUnindexed = false;
  for (const target of targets) {
    recordArchivePath(globalByArchivePath, target.archiveVpkPath, !!target.priorityMod);
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
    globalByArchivePath,
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
  const named = stateByArchivePath(mod, snapshot.globalByArchivePath);
  if (named !== undefined) return named ?? snapshot.allGlobal;
  if (snapshot.allGlobal) return true;
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
