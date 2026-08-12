import type { GameBananaFile } from '../types/gamebanana';
import type { MergedModSource } from '../types/mod';
import { resolveUpdateTarget } from './updateFileMatch';

/** A merge source that can be swapped for a specific current GameBanana file. */
export interface ResolvedMergeSourceUpdate {
  source: MergedModSource;
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
  /** The stored file is gone and no single current file is a confident
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
 * download or rebuild. It deliberately does not touch `runUpdate`: the bulk
 * update path is load-bearing and unifying the two is a follow-up.
 *
 * Resolution per source, mirroring the standalone rules:
 * 1. `resolveUpdateTarget` on description then filename-token overlap. The
 *    FULL file list (archived included) goes in, because the archived row for
 *    the retired file is the best source of its old name and description.
 * 2. A single-current-file fallback, for the common case of an author
 *    consolidating several uploads into one.
 *
 * Anything that survives both without a confident match becomes `unresolved`
 * rather than a guess. Each candidate file is claimed at most once, so two
 * outdated sources from the same GameBanana mod can never both swap to it.
 *
 * @param staleSources merge sources whose recorded file id is no longer live
 * @param filesByModId full file lists keyed by GameBanana mod id, archived
 *  entries included. A missing key means the fetch failed.
 * @param alreadyClaimedFileIds file ids spoken for outside this plan (e.g.
 *  already installed as a standalone mod), so they are never re-downloaded
 */
export function planMergeSourceUpdates(
  staleSources: readonly MergedModSource[],
  filesByModId: ReadonlyMap<number, GameBananaFile[]>,
  alreadyClaimedFileIds?: ReadonlySet<number>,
): MergeSourceUpdatePlan {
  const resolved: ResolvedMergeSourceUpdate[] = [];
  const unresolved: UnresolvedMergeSource[] = [];
  const claimed = new Set<number>(alreadyClaimedFileIds ?? []);

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

    const section = source.section ?? 'Mod';
    const match = resolveUpdateTarget({ installedFileId }, files, claimed);
    if (match) {
      claimed.add(match.id);
      resolved.push({
        source,
        gameBananaId,
        fileId: match.id,
        fileName: match.fileName,
        section,
      });
      continue;
    }

    const liveFiles = files.filter((f) => !f.isArchived);
    if (liveFiles.length === 1 && !claimed.has(liveFiles[0].id)) {
      claimed.add(liveFiles[0].id);
      resolved.push({
        source,
        gameBananaId,
        fileId: liveFiles[0].id,
        fileName: liveFiles[0].fileName,
        section,
      });
      continue;
    }

    unresolved.push({ source, reason: 'no-match' });
  }

  return { resolved, unresolved };
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
