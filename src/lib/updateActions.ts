import type { Mod } from '../types/mod';
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
 * installed files of the mod when omitted).
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

/** All installed variants of the submission shown by a mod page or update row. */
export function modUpdateGroup<T extends { gameBananaId?: number; sourceSection?: string }>(
  mods: readonly T[],
  gameBananaId: number | null,
  section = 'Mod',
): T[] {
  if (gameBananaId === null) return [];
  return mods.filter(mod => mod.gameBananaId === gameBananaId && (mod.sourceSection ?? 'Mod') === section);
}

/** The update workflow groups by submission and section, independently of local cards. */
export function groupModUpdates(mods: readonly Mod[], updateIds: ReadonlySet<string>) {
  if (updateIds.size === 0) return [];
  const groups = new Map<string, { key: string; name: string; pending: Mod[]; installed: Mod[] }>();
  for (const mod of mods) {
    const key = mod.gameBananaId
      ? `${mod.sourceSection ?? 'Mod'}:${mod.gameBananaId}`
      : mod.id;
    let group = groups.get(key);
    if (!group) {
      group = { key, name: mod.name, pending: [], installed: [] };
      groups.set(key, group);
    }
    group.installed.push(mod);
    if (updateIds.has(mod.id) && !mod.ignoreUpdates) group.pending.push(mod);
  }
  return [...groups.values()].filter(group => group.pending.length > 0);
}

/** A stale installed file the details view offers to replace explicitly. */
export interface ReplaceableFile {
  /** The stale GameBanana file id. */
  fileId: number;
  /** Description captured at install, falling back to the archive filename. */
  label: string;
  fileName: string;
}

export function replaceableFilesFor(
  needsPick: readonly number[],
  installed: readonly { gameBananaFileId?: number; sourceFileName?: string; fileDescription?: string; fileName: string }[],
): ReplaceableFile[] {
  return needsPick.map((fileId) => {
    const mod = installed.find((candidate) => candidate.gameBananaFileId === fileId);
    const fileName = mod?.sourceFileName || mod?.fileName || String(fileId);
    return { fileId, label: mod?.fileDescription?.trim() || fileName, fileName };
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
 * only after the user confirmed exactly that replacement, and may only target
 * a file that is not installed. A matched successor that is already installed
 * is promoted: the host skips the download and removes only its predecessor.
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
  const sameFile = installed.filter((mod) => mod.gameBananaFileId === fileId).map((mod) => mod.id);
  if (
    replaceFileId !== undefined &&
    replaceFileId !== fileId &&
    sameFile.length === 0 &&
    (!scopeFileIds || scopeFileIds.has(replaceFileId)) &&
    classification.states.get(replaceFileId)?.kind === 'needs-pick' &&
    classification.currentFileIds.has(fileId)
  ) {
    return { kind: 'replace', replacedModIds: classification.sourceIds.get(replaceFileId) ?? [] };
  }

  const replaced = summarizeUpdateScope(classification, scopeFileIds).targets.get(fileId);
  if (replaced) return { kind: 'update', replacedModIds: replaced };

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
 * fetched file rows. Only a classified successor is applied. A file with no
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
