import type { GameBananaFile } from '../types/gamebanana';

/** The parts of a GameBanana file row the update classifier reads. Both the
 *  full details payload and the slim update-check file list satisfy it. */
export type UpdateFileRow = Pick<GameBananaFile, 'id' | 'fileName' | 'isArchived' | 'description' | 'dateAdded'>;

/** One installed VPK, as the update classifier sees it. Several VPKs extracted
 *  from one archive share a GameBanana file id and are classified together. */
export interface InstalledUpdateEntry {
  /** Local mod id. */
  id: string;
  gameBananaId?: number;
  gameBananaFileId?: number;
  ignoreUpdates?: boolean;
  /** The author's per-file description captured at download time. Survives
   *  locally after the row is deleted from GameBanana. */
  fileDescription?: string;
  /** The archive filename stem captured at download time. */
  sourceFileName?: string;
}

export type SuccessorEvidence = 'description' | 'name';

export type FileUpdateState =
  /** The installed file id is still a current (non-archived) row. */
  | { kind: 'current' }
  /** A confident successor exists among the current files. `promote` means
   *  the user already has it installed: applying the update removes the stale
   *  file and moves its state onto the installed one, with no download. */
  | { kind: 'update'; target: UpdateFileRow; via: SuccessorEvidence; promote: boolean }
  /** The row was deleted and nothing is a confident successor. Flagged, but
   *  only an explicit user choice may replace it. */
  | { kind: 'needs-pick' }
  /** The author archived the row and nothing is a confident successor.
   *  Informational, never an update. */
  | { kind: 'archived' }
  /** Every installed VPK of the file has ignoreUpdates set. */
  | { kind: 'ignored' }
  /** No usable file list, so nothing can be said. */
  | { kind: 'unknown' };

export interface ModUpdateClassification {
  /** One state per installed GameBanana file id. */
  states: Map<number, FileUpdateState>;
  /** Local mod ids per installed GameBanana file id, minus VPKs with
   *  ignoreUpdates set. These are the installs an update may replace. */
  sourceIds: Map<number, string[]>;
  currentFileIds: Set<number>;
}

/** Minimum symmetric token overlap before a filename match is trusted. */
const MIN_NAME_SCORE = 0.6;
/** Required lead over the runner-up so near-ties stay unresolved. */
const MIN_NAME_MARGIN = 0.2;
/** Rows uploaded this close together belong to one upload session: they are
 *  alternatives of each other, never successors, and a description shared
 *  inside one session labels alternatives rather than a lineage. */
const UPLOAD_SESSION_SECONDS = 60 * 60;

export function isUpdateFlagged(state: FileUpdateState | undefined): boolean {
  return state?.kind === 'update' || state?.kind === 'needs-pick';
}

interface StaleFile {
  fileId: number;
  row: UpdateFileRow | undefined;
  description: string;
  fileName: string;
}

interface Winner {
  target: UpdateFileRow;
  via: SuccessorEvidence;
  promote: boolean;
}

interface Proposal extends Winner {
  fileId: number;
  /** 2 = description and filename agree, 1 = one signal alone. */
  strength: number;
  nameScore: number;
}

/**
 * Decide, per installed GameBanana file of one mod, whether it is current, has
 * a confident successor, needs an explicit pick, or was retired by the author.
 *
 * GameBanana has no file lineage: every upload is a new row, and authors
 * archive rows for unrelated reasons (an old version, a retired optional
 * addon, a legacy alternate kept on purpose). So "no longer current" alone
 * never means "update". A successor is looked for among current files
 * uploaded after the installed row's upload session (all current files when
 * the row is gone), and must be confident:
 * - a description match that is unique among those files and not shared by
 *   another row from the installed file's own upload session, or
 * - a filename-token match among the files whose name keeps every word of the
 *   old one: the only one with exactly those words, or one whose overlap is
 *   at least 0.6 and leads the runner-up by 0.2.
 * If description and filename point at different files, neither is trusted.
 * A successor among `installed` is a promotion; one installed elsewhere
 * (`otherInstalledFileIds`) is never proposed. All stale
 * files are matched before any claim is settled, so input order never changes
 * the outcome: when two stale files want the same successor the stronger match
 * wins and a tie leaves both unresolved.
 *
 * A sole current upload must satisfy the same matching rules. Sharing one
 * filename word is not enough: it may be the remaining color or optional
 * variant, rather than a successor of the installed file.
 *
 * @param otherInstalledFileIds file ids installed outside `installed` (inside
 *  a merge, or standalone when classifying merge sources), which are never
 *  proposed as successors
 */
export function classifyModFiles(
  gameBananaId: number,
  files: readonly UpdateFileRow[],
  installed: readonly InstalledUpdateEntry[],
  otherInstalledFileIds?: ReadonlySet<number>,
): ModUpdateClassification {
  const groups = new Map<number, InstalledUpdateEntry[]>();
  for (const entry of installed) {
    const fileId = entry.gameBananaFileId;
    if (entry.gameBananaId !== gameBananaId || typeof fileId !== 'number' || fileId <= 0) continue;
    const group = groups.get(fileId) ?? [];
    group.push(entry);
    groups.set(fileId, group);
  }

  const states = new Map<number, FileUpdateState>();
  const sourceIds = new Map<number, string[]>();
  const currentRows = files.filter((file) => !file.isArchived);
  const currentFileIds = new Set(currentRows.map((file) => file.id));
  const stale: StaleFile[] = [];

  for (const [fileId, entries] of groups) {
    sourceIds.set(fileId, entries.filter((entry) => !entry.ignoreUpdates).map((entry) => entry.id));
    const row = files.find((file) => file.id === fileId);
    if (files.length === 0) {
      states.set(fileId, { kind: 'unknown' });
    } else if (currentFileIds.has(fileId)) {
      states.set(fileId, { kind: 'current' });
    } else if (entries.every((entry) => entry.ignoreUpdates)) {
      states.set(fileId, { kind: 'ignored' });
    } else if (currentRows.length === 0) {
      states.set(fileId, row ? { kind: 'archived' } : { kind: 'unknown' });
    } else {
      stale.push({
        fileId,
        row,
        description: entries.find((entry) => entry.fileDescription)?.fileDescription ?? row?.description ?? '',
        fileName: entries.find((entry) => entry.sourceFileName)?.sourceFileName ?? row?.fileName ?? '',
      });
    }
  }

  const installedElsewhere = (fileId: number) => !groups.has(fileId) && !!otherInstalledFileIds?.has(fileId);
  const proposalsByTarget = new Map<number, Proposal[]>();
  for (const file of stale) {
    const proposal = proposeSuccessor(file, files, currentRows, groups);
    if (!proposal || installedElsewhere(proposal.target.id)) continue;
    const claims = proposalsByTarget.get(proposal.target.id) ?? [];
    claims.push(proposal);
    proposalsByTarget.set(proposal.target.id, claims);
  }

  const winners = new Map<number, Winner>();
  for (const claims of proposalsByTarget.values()) {
    claims.sort(compareProposals);
    if (claims.length === 1 || compareProposals(claims[0], claims[1]) < 0) {
      winners.set(claims[0].fileId, claims[0]);
    }
  }

  for (const file of stale) {
    const winner = winners.get(file.fileId);
    states.set(
      file.fileId,
      winner
        ? { kind: 'update', target: winner.target, via: winner.via, promote: winner.promote }
        : file.row
          ? { kind: 'archived' }
          : { kind: 'needs-pick' },
    );
  }

  return { states, sourceIds, currentFileIds };
}

/** Current rows uploaded after the stale row's upload session. A file uploaded
 *  alongside or before it coexisted with it, so it is an alternative, never
 *  its successor. A deleted row has no date, so every current row counts. */
function newerThanSession(file: StaleFile, rows: readonly UpdateFileRow[]): UpdateFileRow[] {
  const uploaded = file.row?.dateAdded;
  if (!uploaded) return [...rows];
  return rows.filter((row) => !row.dateAdded || row.dateAdded > uploaded + UPLOAD_SESSION_SECONDS);
}

function proposeSuccessor(
  file: StaleFile,
  files: readonly UpdateFileRow[],
  currentRows: readonly UpdateFileRow[],
  installedHere: ReadonlyMap<number, unknown>,
): Proposal | null {
  const newer = newerThanSession(file, currentRows);

  const description = normalizeText(file.description);
  let byDescription: UpdateFileRow | null = null;
  if (description && !sharedWithinUploadSession(file.row, description, files)) {
    const matches = newer.filter((row) => normalizeText(row.description ?? '') === description);
    if (matches.length === 1) byDescription = matches[0];
  }
  const byName = matchByName(file.fileName, newer);
  if (byDescription && byName && byDescription.id !== byName.file.id) return null;

  const target = byDescription ?? byName?.file;
  if (!target) return null;

  return {
    fileId: file.fileId,
    target,
    via: byDescription ? 'description' : 'name',
    promote: installedHere.has(target.id),
    strength: byDescription && byName ? 2 : 1,
    nameScore: byName?.score ?? 0,
  };
}

/** Stronger claims sort first. 0 means indistinguishable. */
function compareProposals(a: Proposal, b: Proposal): number {
  return b.strength - a.strength || b.nameScore - a.nameScore;
}

function sharedWithinUploadSession(
  row: UpdateFileRow | undefined,
  description: string,
  files: readonly UpdateFileRow[],
): boolean {
  const uploaded = row?.dateAdded;
  if (!row || !uploaded) return false;
  return files.some(
    (other) =>
      other.id !== row.id &&
      !!other.dateAdded &&
      Math.abs(other.dateAdded - uploaded) <= UPLOAD_SESSION_SECONDS &&
      normalizeText(other.description ?? '') === description,
  );
}

/**
 * A successor's name keeps every word of the old one and may add some (a patch
 * tag like "ognb"). A name that drops a word ("jacket", "widefov", "en") names
 * a different variant. Among the files that keep every word, the one with the
 * same words wins outright; otherwise the closest must clear the score and
 * margin, so a near-tie stays unresolved.
 */
function matchByName(
  fileName: string,
  currentRows: readonly UpdateFileRow[],
): { file: UpdateFileRow; score: number } | null {
  const tokens = tokenizeFileName(fileName);
  if (tokens.size === 0) return null;

  const keeping = currentRows
    .map((file) => ({ file, tokens: tokenizeFileName(file.fileName) }))
    .filter((candidate) => [...tokens].every((token) => candidate.tokens.has(token)))
    // Every old word is shared, so the symmetric overlap is old size / new size.
    .map((candidate) => ({ file: candidate.file, score: tokens.size / candidate.tokens.size }))
    .sort((a, b) => b.score - a.score);
  const [best, runnerUp] = keeping;
  if (!best) return null;

  const identical = keeping.filter((candidate) => candidate.score === 1).length;
  if (identical === 1) return best;
  if (identical > 1) return null;
  if (best.score >= MIN_NAME_SCORE && (!runnerUp || best.score - runnerUp.score >= MIN_NAME_MARGIN)) {
    return best;
  }
  return null;
}

/** Lowercase, strip punctuation, collapse whitespace, keeping letters of every
 *  script. "Current/Max Health" and "current max health" compare equal; "Mina
 *  红色" and "Mina 蓝色" do not. */
function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

const MONTHS = [
  'january', 'february', 'march', 'april', 'may', 'june', 'july', 'august',
  'september', 'october', 'november', 'december',
];
const MONTH_ABBREVIATIONS = ['jan', 'feb', 'mar', 'apr', 'jun', 'jul', 'aug', 'sep', 'sept', 'oct', 'nov', 'dec'];
const ORDINAL_SUFFIXES = ['st', 'nd', 'rd', 'th'];
/** Whole words that label an upload rather than a variant. Only these (and
 *  full month names in a dated name) may be peeled off a glued run. */
const UPLOAD_WORDS = ['hotfix', 'fix', 'fixed', 'update', 'updated', 'new', 'final', 'latest', 'version'];
/** Dropped only as a run of their own, never peeled off a longer word. */
const STANDALONE_NOISE = ['ver', 'pak', 'dir'];

/** True when a run splits completely into `words` ("octoberhotfix"). */
function splitsInto(run: string, words: readonly string[]): boolean {
  if (run.length === 0) return true;
  return words.some((word) => run.startsWith(word) && splitsInto(run.slice(word.length), words));
}

/**
 * Split a filename into the letter runs that identify the variant. Digits
 * never identify a variant across uploads (dates, counters, versions glued to
 * a word like "qollock403", "coryv2" or "v34b"), so letter and digit runs are
 * split and the digits dropped, along with a "v" glued before a version, hex
 * upload hashes ("8388e"), single letters, upload words like "hotfix", and the
 * generic "pakNN_dir" stem. Month names and ordinal suffixes are dropped only
 * in a dated name, one with digits or an upload word ("echo_august_update");
 * "vindicta_october" keeps "october".
 */
export function tokenizeFileName(fileName: string): Set<string> {
  const stem = fileName.replace(/\.(zip|rar|7z|vpk|gz|tar)$/i, '').toLowerCase();
  const segments = stem.split(/[^a-z0-9]+/);
  const dated = /\d/.test(stem) || segments.some((segment) => UPLOAD_WORDS.includes(segment));
  const standalone = new Set([
    ...UPLOAD_WORDS,
    ...STANDALONE_NOISE,
    ...(dated ? [...MONTHS, ...MONTH_ABBREVIATIONS, ...ORDINAL_SUFFIXES] : []),
  ]);
  const glued = dated ? [...UPLOAD_WORDS, ...MONTHS] : UPLOAD_WORDS;
  const tokens = new Set<string>();
  for (const segment of segments) {
    if (/^[0-9a-f]+$/.test(segment) && /\d/.test(segment)) continue;
    for (const run of segment.replace(/([a-z]{3,})v(?=\d)/g, '$1').match(/[a-z]+/g) ?? []) {
      if (run.length < 2 || standalone.has(run) || splitsInto(run, glued)) continue;
      tokens.add(run);
    }
  }
  return tokens;
}
