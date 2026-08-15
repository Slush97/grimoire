import type { GameBananaFile } from '../types/gamebanana';

/**
 * Identity signals for an installed file whose GameBanana file id is no
 * longer current (the author archived or deleted it). Used to find the
 * replacement among the mod's current files.
 */
export interface UpdateMatchSignals {
  /** The GameBanana file id Grimoire downloaded originally. */
  installedFileId: number;
  /** The author's per-file description ("header") captured at download time.
   *  Survives locally even when the file row was deleted from GameBanana. */
  fileDescription?: string;
  /** The original archive filename captured at download time (e.g.
   *  "galaxy_rem_gold.zip"). Like fileDescription, survives deletion. */
  sourceFileName?: string;
}

/** The installed-variant fields that decide whether an update is pending. */
export interface InstalledVariantUpdateState {
  gameBananaId?: number;
  gameBananaFileId?: number;
  ignoreUpdates?: boolean;
}

export interface InstalledFileUpdateCandidate extends InstalledVariantUpdateState, UpdateMatchSignals {
  id: string;
}

export interface FileUpdatePlan {
  /** Current GameBanana file id -> stale local mod ids it supersedes. */
  sourcesByTargetFileId: Map<number, string[]>;
  /** Stale local mods whose replacement is ambiguous and needs user choice. */
  unresolvedSourceIds: string[];
}

/**
 * True when any installed variant of `gameBananaId` points at a file id that is
 * no longer live on the mod page. An author who re-uploads a file gets a new
 * file id and the old row is usually deleted outright rather than archived, so
 * a missing id is the signal that the local copy has been superseded.
 *
 * `files` is the mod's full current file list, archived entries included. An
 * empty list means "not loaded yet" and never flags an update.
 */
export function hasPendingUpdate(
  gameBananaId: number,
  files: GameBananaFile[],
  installed: readonly InstalledVariantUpdateState[],
): boolean {
  const liveFileIds = new Set(files.filter((f) => !f.isArchived).map((f) => f.id));
  if (liveFileIds.size === 0) return false;
  return installed.some(
    (mod) =>
      mod.gameBananaId === gameBananaId &&
      typeof mod.gameBananaFileId === 'number' &&
      mod.gameBananaFileId > 0 &&
      !mod.ignoreUpdates &&
      !liveFileIds.has(mod.gameBananaFileId),
  );
}

/** Minimum share of the old filename's meaningful tokens that must reappear
 *  in a candidate's filename before a name-based match is trusted. */
const MIN_NAME_SCORE = 0.6;
/** Required lead over the runner-up candidate so near-ties stay manual. */
const MIN_NAME_MARGIN = 0.25;

/**
 * Resolve which current (non-archived) file supersedes an installed file
 * that is no longer current. Returns null when no single candidate is a
 * confident match: callers should fall back to a manual pick, never guess.
 *
 * Matching runs two signals in order:
 * 1. The author's per-file description. Authors keep these stable across
 *    re-uploads far more often than filenames (filenames usually gain a date
 *    or hash suffix per upload), so an exact normalized match that is unique
 *    among current files is decisive.
 * 2. Filename token overlap. Tokens that exist only to version an upload
 *    (pure numbers, "v2", hex hash suffixes) are dropped before comparing,
 *    so "redesign_standalone_v1_5.7z" matches
 *    "standalone_passive_items_redesign_06_04.7z" on {redesign, standalone}.
 *
 * @param signals identity of the installed file
 * @param files the mod's full file list from GameBanana, archived included
 *  (the archived entry for the installed file is the best source for its
 *  old name and description when nothing was captured locally)
 * @param excludeIds candidate file ids that are already spoken for (claimed
 *  by a sibling variant in the same update run, or already installed)
 */
export function resolveUpdateTarget(
  signals: UpdateMatchSignals,
  files: GameBananaFile[],
  excludeIds?: ReadonlySet<number>,
): GameBananaFile | null {
  const candidates = files.filter(
    (f) => !f.isArchived && f.id !== signals.installedFileId && !excludeIds?.has(f.id),
  );
  if (candidates.length === 0) return null;

  const oldEntry = files.find((f) => f.id === signals.installedFileId);
  const oldDescription = normalizeText(signals.fileDescription ?? oldEntry?.description ?? '');
  const oldName = signals.sourceFileName || oldEntry?.fileName || '';

  if (oldDescription) {
    const descMatches = candidates.filter(
      (f) => normalizeText(f.description ?? '') === oldDescription,
    );
    if (descMatches.length === 1) return descMatches[0];
    // Zero or several description matches: fall through to filename matching
    // rather than guessing between identically-described files.
  }

  const oldTokens = tokenizeFileName(oldName);
  if (oldTokens.size === 0) return null;

  const scored = candidates
    .map((file) => {
      const tokens = tokenizeFileName(file.fileName);
      let overlap = 0;
      for (const token of oldTokens) {
        if (tokens.has(token)) overlap += 1;
      }
      return { file, score: overlap / oldTokens.size };
    })
    .sort((a, b) => b.score - a.score);

  const best = scored[0];
  const runnerUp = scored[1];
  if (best.score >= MIN_NAME_SCORE && (!runnerUp || best.score - runnerUp.score >= MIN_NAME_MARGIN)) {
    return best.file;
  }
  return null;
}

/**
 * Plan the per-file update actions shown in ModDetailsModal. Existing current
 * siblings are valid destinations (updating can promote one without another
 * download), while uninstalled targets are claimed once so unrelated stale
 * variants are never silently collapsed into the same replacement.
 */
export function planFileUpdates(
  gameBananaId: number,
  files: GameBananaFile[],
  installed: readonly InstalledFileUpdateCandidate[],
): FileUpdatePlan {
  const liveFiles = files.filter((file) => !file.isArchived);
  const liveIds = new Set(liveFiles.map((file) => file.id));
  const installedLiveIds = new Set(
    installed
      .filter(
        (mod) =>
          mod.gameBananaId === gameBananaId &&
          typeof mod.gameBananaFileId === 'number' &&
          liveIds.has(mod.gameBananaFileId),
      )
      .map((mod) => mod.gameBananaFileId!),
  );
  const stale = installed.filter(
    (mod) =>
      mod.gameBananaId === gameBananaId &&
      typeof mod.gameBananaFileId === 'number' &&
      mod.gameBananaFileId > 0 &&
      !mod.ignoreUpdates &&
      !liveIds.has(mod.gameBananaFileId),
  );

  const sourcesByTargetFileId = new Map<number, string[]>();
  const unresolvedSourceIds: string[] = [];
  const claimedUninstalledIds = new Set<number>();
  const resolvedByOldFileId = new Map<number, number>();

  for (const source of stale) {
    const oldFileId = source.gameBananaFileId!;
    let targetId = resolvedByOldFileId.get(oldFileId);
    if (targetId === undefined) {
      const match = resolveUpdateTarget(source, files, claimedUninstalledIds);
      if (match) {
        targetId = match.id;
      } else if (
        liveFiles.length === 1 &&
        (installedLiveIds.has(liveFiles[0].id) || !claimedUninstalledIds.has(liveFiles[0].id))
      ) {
        targetId = liveFiles[0].id;
      }
      if (targetId !== undefined) {
        resolvedByOldFileId.set(oldFileId, targetId);
        if (!installedLiveIds.has(targetId)) claimedUninstalledIds.add(targetId);
      }
    }

    if (targetId === undefined) {
      unresolvedSourceIds.push(source.id);
      continue;
    }
    const sources = sourcesByTargetFileId.get(targetId) ?? [];
    sources.push(source.id);
    sourcesByTargetFileId.set(targetId, sources);
  }

  return { sourcesByTargetFileId, unresolvedSourceIds };
}

/** Lowercase, strip punctuation, collapse whitespace. "Current/Max Health"
 *  and "current max health" compare equal. */
function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Split a filename into the tokens that identify the variant, dropping the
 *  archive extension and tokens that only version an upload: pure numbers
 *  (dates, counters), "v"-prefixed versions, hex hash suffixes like "8388e",
 *  and single characters. */
function tokenizeFileName(fileName: string): Set<string> {
  const stem = fileName.replace(/\.(zip|rar|7z|vpk|gz|tar)$/i, '');
  const tokens = new Set<string>();
  for (const raw of stem.toLowerCase().split(/[^a-z0-9]+/)) {
    if (raw.length < 2) continue;
    if (/^\d+$/.test(raw)) continue;
    if (/^v\d+$/.test(raw)) continue;
    if (/^[0-9a-f]+$/.test(raw) && /\d/.test(raw)) continue;
    tokens.add(raw);
  }
  return tokens;
}
