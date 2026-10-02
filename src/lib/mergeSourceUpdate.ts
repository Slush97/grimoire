import type { MergedModSource } from '../types/mod';
import { classifyModFiles, type FileUpdateState, type UpdateFileRow } from './updateFileMatch';

/** Merge sources that can be swapped for a specific current GameBanana file. */
export interface ResolvedMergeSourceUpdate {
  /** Every source cut from the same stale GameBanana file. A multi-VPK
   *  archive yields several, and they share one replacement download. */
  sources: MergedModSource[];
  gameBananaId: number;
  fileId: number;
  fileName: string;
  section: string;
}

export type UnresolvedReason =
  /** The manifest never recorded a GameBanana id / file id for this source
   *  (hand-placed VPK, or a merge built before provenance capture). */
  | 'no-provenance'
  /** The mod page's file list could not be fetched. */
  | 'files-unavailable'
  /** The stored file is no longer current and no current file is a confident
   *  replacement. Guessing here would silently swap unrelated content. */
  | 'no-match';

export interface UnresolvedMergeSource {
  source: MergedModSource;
  reason: UnresolvedReason;
}

export interface MergeSourceUpdatePlan {
  resolved: ResolvedMergeSourceUpdate[];
  unresolved: UnresolvedMergeSource[];
}

/** Why one source was left behind by an update run. Extends the resolution
 *  reasons with the two failure modes that only surface once downloading
 *  starts. */
export type MergeSourceSkipReason =
  | UnresolvedReason
  | 'download-failed'
  /** The replacement archive produced several VPKs and nothing identifies
   *  which one supersedes the source. The files stay installed standalone. */
  | 'multi-vpk';

export interface MergeSourceUpdateSkip {
  modName: string;
  reason: MergeSourceSkipReason;
}

export interface MergeSourceUpdateOutcome {
  /** Sources actually swapped into the rebuilt merge. */
  updated: number;
  skipped: MergeSourceUpdateSkip[];
}

/**
 * Decide which current GameBanana file supersedes each outdated merge source.
 *
 * This is the merge-side counterpart to the resolution `runUpdate` does for
 * standalone mods, kept as a pure function so it can be tested without any
 * download or rebuild.
 *
 * Resolution uses the same classifier as standalone files (`classifyModFiles`)
 * over the FULL file list, archived rows included, because the archived row
 * for the retired file is the best source of its old name and description.
 * Only a confident successor resolves. Anything else becomes `unresolved`
 * rather than a guess, a successor is claimed by at most one stale file, and
 * sources from one stale file resolve together so it is downloaded once.
 *
 * @param staleSources merge sources whose recorded file id is no longer live
 * @param filesByModId full file lists keyed by GameBanana mod id, archived
 *  entries included. A missing key means the fetch failed.
 * @param alreadyClaimedFileIds file ids spoken for outside this plan (e.g.
 *  already installed as a standalone mod), so they are never re-downloaded
 */
export function planMergeSourceUpdates(
  staleSources: readonly MergedModSource[],
  filesByModId: ReadonlyMap<number, readonly UpdateFileRow[]>,
  alreadyClaimedFileIds?: ReadonlySet<number>,
): MergeSourceUpdatePlan {
  const resolvedByFileId = new Map<number, ResolvedMergeSourceUpdate>();
  const unresolved: UnresolvedMergeSource[] = [];
  const statesByModId = new Map<number, Map<number, FileUpdateState>>();
  const entries = staleSources.map((source) => ({
    id: source.fileName,
    gameBananaId: source.gameBananaId,
    gameBananaFileId: source.gameBananaFileId,
  }));

  for (const source of staleSources) {
    const gameBananaId = source.gameBananaId;
    const installedFileId = source.gameBananaFileId;
    if (typeof gameBananaId !== 'number' || typeof installedFileId !== 'number' || installedFileId <= 0) {
      unresolved.push({ source, reason: 'no-provenance' });
      continue;
    }

    const files = filesByModId.get(gameBananaId);
    if (!files) {
      unresolved.push({ source, reason: 'files-unavailable' });
      continue;
    }

    let states = statesByModId.get(gameBananaId);
    if (!states) {
      states = classifyModFiles(gameBananaId, files, entries, alreadyClaimedFileIds).states;
      statesByModId.set(gameBananaId, states);
    }
    const state = states.get(installedFileId);
    if (state?.kind !== 'update') {
      unresolved.push({ source, reason: 'no-match' });
      continue;
    }
    const shared = resolvedByFileId.get(installedFileId);
    if (shared) {
      shared.sources.push(source);
      continue;
    }
    resolvedByFileId.set(installedFileId, {
      sources: [source],
      gameBananaId,
      fileId: state.target.id,
      fileName: state.target.fileName,
      section: source.section ?? 'Mod',
    });
  }

  return { resolved: [...resolvedByFileId.values()], unresolved };
}

/** GameBanana mod ids whose file lists a plan needs, deduped. */
export function mergeSourceModIds(staleSources: readonly MergedModSource[]): Map<number, string> {
  const ids = new Map<number, string>();
  for (const source of staleSources) {
    if (typeof source.gameBananaId !== 'number') continue;
    if (!ids.has(source.gameBananaId)) ids.set(source.gameBananaId, source.section ?? 'Mod');
  }
  return ids;
}
