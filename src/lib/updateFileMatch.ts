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
