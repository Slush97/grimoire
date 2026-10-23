import type { MergedModSource } from '../types/mod';
import {
  classifyModFiles,
  isDownloadableUpdate,
  isUpdateFlagged,
  type InstalledUpdateEntry,
  type UpdateFileRow,
} from './updateFileMatch';

/** The installed-mod fields the update check reads. */
export interface UpdateCheckMod extends InstalledUpdateEntry {
  merged?: { sources: readonly MergedModSource[] };
}

export interface UpdateFlags {
  /** Local mod ids whose installed file has a successor or needs a pick. */
  updatesAvailable: Set<string>;
  /** Merged mod id -> fileNames of absorbed sources in the same state. */
  staleMergeSources: Map<string, Set<string>>;
  /** The subset of `staleMergeSources` an update can resolve to a file to
   *  download. The rest need a manual extract or unmerge. */
  updatableMergeSources: Map<string, Set<string>>;
}

/** The GameBanana installs absorbed into every merge, as classifier entries.
 *  Classifying standalone files passes these as `otherInstalls`, so a file the
 *  user already has inside a merge is never proposed as a successor to download
 *  again, and the merge's stale sources compete with the standalone ones for
 *  the same uploads. */
export function mergeSourceInstalls(mods: readonly UpdateCheckMod[]): InstalledUpdateEntry[] {
  return mods.flatMap((mod) =>
    (mod.merged?.sources ?? []).map((source) => ({
      id: source.fileName,
      gameBananaId: source.gameBananaId,
      gameBananaFileId: source.gameBananaFileId,
      ignoreUpdates: mod.ignoreUpdates,
    })),
  );
}

/** Every install a merge's sources compete with: the standalone mods and the
 *  sources of every other merge. */
export function installsOutsideMerge(mods: readonly UpdateCheckMod[], mergeId: string): InstalledUpdateEntry[] {
  const others = mods.filter((mod) => mod.id !== mergeId);
  return [...others.filter((mod) => !mod.merged), ...mergeSourceInstalls(others)];
}

/** GameBanana file ids absorbed into any merge. */
export function mergeSourceFileIds(mods: readonly UpdateCheckMod[]): Set<number> {
  const ids = new Set<number>();
  for (const mod of mods) {
    for (const source of mod.merged?.sources ?? []) {
      if (typeof source.gameBananaFileId === 'number') ids.add(source.gameBananaFileId);
    }
  }
  return ids;
}

/**
 * Flag installed files from cached file rows with the shared classifier, so
 * the cards, "Update all" and the details views agree on what is an update.
 * Mods whose rows are missing (not fetched, or the fetch failed) are skipped.
 *
 * @param mods the visible installed mods (absorbed merge sources excluded;
 *  merged mods carry their sources' provenance in `merged.sources`)
 */
export function computeUpdateFlags(
  mods: readonly UpdateCheckMod[],
  rowsByModId: ReadonlyMap<number, readonly UpdateFileRow[]>,
  autoMatchRemainingFiles = false,
): UpdateFlags {
  const mergedInstalls = mergeSourceInstalls(mods);
  const updatesAvailable = new Set<string>();
  const gameBananaIds = new Set<number>();
  for (const mod of mods) {
    if (typeof mod.gameBananaId === 'number') gameBananaIds.add(mod.gameBananaId);
  }
  for (const gameBananaId of gameBananaIds) {
    const rows = rowsByModId.get(gameBananaId);
    if (!rows) continue;
    const { states, sourceIds } = classifyModFiles(gameBananaId, rows, mods, mergedInstalls, autoMatchRemainingFiles);
    for (const [fileId, state] of states) {
      if (!isUpdateFlagged(state)) continue;
      for (const id of sourceIds.get(fileId) ?? []) updatesAvailable.add(id);
    }
  }

  const staleMergeSources = new Map<string, Set<string>>();
  const updatableMergeSources = new Map<string, Set<string>>();
  for (const mod of mods) {
    if (!mod.merged || mod.ignoreUpdates) continue;
    const stale = new Set<string>();
    const updatable = new Set<string>();
    const outside = installsOutsideMerge(mods, mod.id);
    for (const [gameBananaId, sources] of mergeSourcesByModId(mod.merged.sources)) {
      const rows = rowsByModId.get(gameBananaId);
      if (!rows) continue;
      const { states } = classifyModFiles(
        gameBananaId,
        rows,
        sources.map((source) => ({ id: source.fileName, gameBananaId, gameBananaFileId: source.fileId })),
        outside,
        autoMatchRemainingFiles,
      );
      for (const source of sources) {
        const state = states.get(source.fileId);
        if (isUpdateFlagged(state)) stale.add(source.fileName);
        if (isDownloadableUpdate(state)) updatable.add(source.fileName);
      }
    }
    if (stale.size > 0) staleMergeSources.set(mod.id, stale);
    if (updatable.size > 0) updatableMergeSources.set(mod.id, updatable);
  }

  return { updatesAvailable, staleMergeSources, updatableMergeSources };
}

/** Sources with GameBanana provenance, grouped by mod id. */
function mergeSourcesByModId(
  sources: readonly MergedModSource[],
): Map<number, Array<{ fileName: string; fileId: number }>> {
  const grouped = new Map<number, Array<{ fileName: string; fileId: number }>>();
  for (const { fileName, gameBananaId, gameBananaFileId } of sources) {
    if (typeof gameBananaId !== 'number') continue;
    if (typeof gameBananaFileId !== 'number' || gameBananaFileId <= 0) continue;
    const group = grouped.get(gameBananaId) ?? [];
    group.push({ fileName, fileId: gameBananaFileId });
    grouped.set(gameBananaId, group);
  }
  return grouped;
}
