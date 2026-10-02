import type { MergedModSource } from '../types/mod';
import {
  classifyModFiles,
  isUpdateFlagged,
  type InstalledUpdateEntry,
  type UpdateFileRow,
} from './updateFileMatch';

/** The installed-mod fields the update check reads. */
export interface UpdateCheckMod extends InstalledUpdateEntry {
  merged?: { sources: readonly MergedModSource[] };
}

/**
 * File rows per GameBanana mod id, populated by the Installed update check.
 * Module scope so it survives page navigation within a session and every
 * installed file of one mod shares one fetch.
 */
export const updateCheckCache = new Map<number, UpdateFileRow[]>();

export interface UpdateFlags {
  /** Local mod ids whose installed file has a successor or needs a pick. */
  updatesAvailable: Set<string>;
  /** Merged mod id -> fileNames of absorbed sources in the same state. */
  staleMergeSources: Map<string, Set<string>>;
}

/** GameBanana file ids absorbed into any merge. Classifying standalone files
 *  passes these as `otherInstalledFileIds`, so a file the user already has
 *  inside a merge is never proposed as a successor to download again. */
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
): UpdateFlags {
  const merged = mergeSourceFileIds(mods);
  const updatesAvailable = new Set<string>();
  const gameBananaIds = new Set<number>();
  for (const mod of mods) {
    if (typeof mod.gameBananaId === 'number') gameBananaIds.add(mod.gameBananaId);
  }
  for (const gameBananaId of gameBananaIds) {
    const rows = rowsByModId.get(gameBananaId);
    if (!rows) continue;
    const { states, sourceIds } = classifyModFiles(gameBananaId, rows, mods, merged);
    for (const [fileId, state] of states) {
      if (!isUpdateFlagged(state)) continue;
      for (const id of sourceIds.get(fileId) ?? []) updatesAvailable.add(id);
    }
  }

  const staleMergeSources = new Map<string, Set<string>>();
  for (const mod of mods) {
    if (!mod.merged || mod.ignoreUpdates) continue;
    const stale = new Set<string>();
    for (const [gameBananaId, sources] of mergeSourcesByModId(mod.merged.sources)) {
      const rows = rowsByModId.get(gameBananaId);
      if (!rows) continue;
      const { states } = classifyModFiles(
        gameBananaId,
        rows,
        sources.map((source) => ({ id: source.fileName, gameBananaId, gameBananaFileId: source.fileId })),
        installedFileIdsOf(gameBananaId, mods),
      );
      for (const source of sources) {
        if (isUpdateFlagged(states.get(source.fileId))) stale.add(source.fileName);
      }
    }
    if (stale.size > 0) staleMergeSources.set(mod.id, stale);
  }

  return { updatesAvailable, staleMergeSources };
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

/** File ids of `gameBananaId` installed standalone or inside any merge. */
function installedFileIdsOf(gameBananaId: number, mods: readonly UpdateCheckMod[]): Set<number> {
  const ids = new Set<number>();
  for (const mod of mods) {
    if (mod.gameBananaId === gameBananaId && typeof mod.gameBananaFileId === 'number') ids.add(mod.gameBananaFileId);
    for (const source of mod.merged?.sources ?? []) {
      if (source.gameBananaId === gameBananaId && typeof source.gameBananaFileId === 'number') {
        ids.add(source.gameBananaFileId);
      }
    }
  }
  return ids;
}
