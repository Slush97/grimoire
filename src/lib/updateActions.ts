import {
  isUpdateFlagged,
  type InstalledUpdateEntry,
  type ModUpdateClassification,
} from './updateFileMatch';

export interface UpdateScopeSummary {
  /** A file in scope has a confident successor or needs an explicit pick. */
  flagged: boolean;
  /** A file in scope was archived by its author and nothing replaces it. */
  archived: boolean;
  /** Successor file id -> local mod ids it replaces. These rows read "Update". */
  targets: Map<number, string[]>;
  /** Stale GameBanana file ids that only an explicit "Replace" may resolve. */
  needsPick: number[];
}

/**
 * What a details view shows for the installed files in `scopeFileIds` (all
 * installed files of the mod when omitted). Installed scopes it to the entry
 * that opened the view; Browse looks at every installed file.
 */
export function summarizeUpdateScope(
  classification: ModUpdateClassification,
  scopeFileIds?: ReadonlySet<number>,
): UpdateScopeSummary {
  const summary: UpdateScopeSummary = { flagged: false, archived: false, targets: new Map(), needsPick: [] };
  for (const [fileId, state] of classification.states) {
    if (scopeFileIds && !scopeFileIds.has(fileId)) continue;
    if (state.kind === 'archived') summary.archived = true;
    if (!isUpdateFlagged(state)) continue;
    summary.flagged = true;
    if (state.kind === 'update') {
      summary.targets.set(state.target.id, classification.sourceIds.get(fileId) ?? []);
    } else {
      summary.needsPick.push(fileId);
    }
  }
  return summary;
}

/** Local ids of every VPK extracted from the same GameBanana file as `modId`
 *  (just `modId` without GameBanana provenance). Update state is per file, so
 *  ignoring updates applies to all of them. */
export function sameFileModIds(mods: readonly InstalledUpdateEntry[], modId: string): string[] {
  const mod = mods.find((candidate) => candidate.id === modId);
  if (!mod || typeof mod.gameBananaId !== 'number' || typeof mod.gameBananaFileId !== 'number') return [modId];
  return mods
    .filter(
      (candidate) =>
        candidate.gameBananaId === mod.gameBananaId && candidate.gameBananaFileId === mod.gameBananaFileId,
    )
    .map((candidate) => candidate.id);
}

/** A stale installed file the details view offers to replace explicitly. */
export interface ReplaceableFile {
  /** The stale GameBanana file id. */
  fileId: number;
  /** How the confirmation names it: the archive name captured at install. */
  label: string;
}

export function replaceableFilesFor(
  needsPick: readonly number[],
  installed: readonly { gameBananaFileId?: number; sourceFileName?: string; fileDescription?: string; fileName: string }[],
): ReplaceableFile[] {
  return needsPick.map((fileId) => {
    const mod = installed.find((candidate) => candidate.gameBananaFileId === fileId);
    return { fileId, label: mod?.sourceFileName ?? mod?.fileDescription ?? mod?.fileName ?? String(fileId) };
  });
}

export type FileDownloadDecision =
  /** A new file next to whatever is installed. Deletes nothing. */
  | { kind: 'install'; replacedModIds: string[] }
  /** Re-download a file the user already has, replacing its installed VPKs. */
  | { kind: 'reinstall'; replacedModIds: string[] }
  /** The confident successor of a stale file in scope, replacing that file. */
  | { kind: 'update'; replacedModIds: string[] }
  /** A confirmed "Replace <stale file> with this" for a file with no successor. */
  | { kind: 'replace'; replacedModIds: string[] };

/**
 * Decide what downloading `fileId` from a details view does to the installed
 * files: which local mods get deleted once it lands. A plain click only ever
 * replaces the stale file it is the confident successor of, or reinstalls the
 * same file; everything else is an ordinary install that deletes nothing.
 * Replacing a stale file without a successor requires `replaceFileId`, set
 * only after the user confirmed exactly that replacement. When the picked
 * file is already installed (a promoted successor, or a replace onto a file
 * the user has), the host skips the download and only removes the replaced
 * mods.
 *
 * @param installed installed VPKs of this GameBanana mod
 */
export function decideFileDownload(
  fileId: number,
  classification: ModUpdateClassification,
  installed: readonly InstalledUpdateEntry[],
  options: { scopeFileIds?: ReadonlySet<number>; replaceFileId?: number } = {},
): FileDownloadDecision {
  const { scopeFileIds, replaceFileId } = options;
  if (
    replaceFileId !== undefined &&
    replaceFileId !== fileId &&
    (!scopeFileIds || scopeFileIds.has(replaceFileId)) &&
    classification.states.get(replaceFileId)?.kind === 'needs-pick' &&
    classification.currentFileIds.has(fileId)
  ) {
    return { kind: 'replace', replacedModIds: classification.sourceIds.get(replaceFileId) ?? [] };
  }

  const replaced = summarizeUpdateScope(classification, scopeFileIds).targets.get(fileId);
  if (replaced) return { kind: 'update', replacedModIds: replaced };

  const sameFile = installed.filter((mod) => mod.gameBananaFileId === fileId).map((mod) => mod.id);
  return sameFile.length > 0
    ? { kind: 'reinstall', replacedModIds: sameFile }
    : { kind: 'install', replacedModIds: [] };
}

export type UpdateRunStep =
  /** Replace with the successor: download it, or promote it when installed. */
  | { modId: string; kind: 'update'; fileId: number; promote: boolean }
  | { modId: string; kind: 'needs-pick' }
  | { modId: string; kind: 'skip' };

/**
 * Resolve each target of an "Update all" / group update run against freshly
 * fetched file rows. Only a confident successor is applied. A file with no
 * successor goes to the manual-pick queue when it was deleted, and is skipped
 * when it is current again, archived, ignored or unknown, so a retired file
 * never enters a batch.
 */
export function resolveUpdateRun(
  classification: ModUpdateClassification,
  targets: readonly InstalledUpdateEntry[],
): UpdateRunStep[] {
  return targets.map((target): UpdateRunStep => {
    const fileId = target.gameBananaFileId;
    const state = typeof fileId === 'number' ? classification.states.get(fileId) : undefined;
    if (target.ignoreUpdates || !state) return { modId: target.id, kind: 'skip' };
    if (state.kind === 'update') {
      return { modId: target.id, kind: 'update', fileId: state.target.id, promote: state.promote };
    }
    if (state.kind === 'needs-pick') return { modId: target.id, kind: 'needs-pick' };
    return { modId: target.id, kind: 'skip' };
  });
}
