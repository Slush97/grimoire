/**
 * Defensive parser for Deadlock Mod Manager's (DMM) `state.json` — its
 * Tauri/zustand persisted store. We read it (never write it) to recover the
 * per-mod metadata that `.dmm.json` lacks: the GameBanana FILE id, the mod
 * name, the source filename, the thumbnail, and the profile name + per-profile
 * enabled/order. Pure (no Electron/fs) so it is unit-testable.
 *
 * On-disk shape is double-wrapped. The file is a Tauri-store object whose only
 * relevant key is the zustand persist name "local-config"; its value is the
 * standard zustand-persist envelope `{ "state": {...}, "version": N }`. Some
 * plugin-store versions store that value as a JSON STRING, others as an already
 * parsed object, so we handle both:
 *
 *   file -> JSON.parse -> obj["local-config"]
 *        -> (string ? JSON.parse : as-is) -> { state, version }
 *        -> .state.{localMods, profiles, activeProfileId, ...}
 *
 * CRITICAL: the GameBanana file id is NOT a stored field. DMM's client DTO
 * drops it and keeps only the download `url` (a GameBanana `_sDownloadUrl`,
 * canonically `https://gamebanana.com/dl/<fileId>`). We recover the file id by
 * parsing the trailing `/dl/<n>` integer. See fileIdFromDownloadUrl.
 *
 * The join key throughout is `remoteId` = the GameBanana SUBMISSION id (string).
 */

/** A normalized view of one DMM mod (from `localMods[]` or a profile's `mods[]`). */
export interface DmmStateMod {
  /** GameBanana submission id as stored (string). */
  remoteId: string;
  /** Parsed numeric submission id, or NaN if non-numeric (local mod). */
  submissionId: number;
  name?: string;
  category?: string;
  /** DMM's hero codename (heroOverride > detectedHero > hero). Informational
   *  only: we let Grimoire's VPK-tree inference assign the canonical hero. */
  hero?: string;
  thumbnailUrl?: string;
  /** GameBanana FILE id, recovered from the selected download URL. */
  fileId?: number;
  /** The selected download's filename (DMM's DTO `name`, e.g. "skin.zip"). */
  downloadFileName?: string;
  /** Per-mod load order (ascending; lower loads first). */
  installOrder?: number;
  /** On-disk VPK basenames DMM recorded for this mod, when present. */
  installedVpks?: string[];
}

export interface DmmStateProfile {
  id: string;
  name: string;
  folderName: string | null;
  isDefault: boolean;
  /** remoteId -> enabled. */
  enabledMods: Record<string, boolean>;
  mods: DmmStateMod[];
}

export interface DmmState {
  activeProfileId?: string;
  localMods: DmmStateMod[];
  profiles: DmmStateProfile[];
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Recover the GameBanana file id from a DMM download URL. DMM stores only the
 *  `_sDownloadUrl` (`https://gamebanana.com/dl/<fileId>`), so the trailing
 *  `/dl/<n>` integer is the file `_idRow`. Returns undefined if not present. */
export function fileIdFromDownloadUrl(url: unknown): number | undefined {
  if (typeof url !== 'string') return undefined;
  const m = url.match(/\/dl\/(\d+)/);
  if (!m) return undefined;
  const id = Number(m[1]);
  return Number.isInteger(id) && id > 0 ? id : undefined;
}

function pickHero(mod: Record<string, unknown>): string | undefined {
  for (const key of ['heroOverride', 'detectedHero', 'hero']) {
    const v = mod[key];
    if (typeof v === 'string' && v.trim()) return v;
  }
  return undefined;
}

function normalizeMod(raw: unknown): DmmStateMod | null {
  if (!isObject(raw)) return null;
  const remoteId = raw.remoteId;
  if (typeof remoteId !== 'string' || !remoteId) return null;

  // selectedDownloads is the post-v11 array; tolerate a legacy singular
  // selectedDownload object too.
  const downloads: unknown[] = Array.isArray(raw.selectedDownloads)
    ? raw.selectedDownloads
    : isObject(raw.selectedDownload)
      ? [raw.selectedDownload]
      : [];
  const firstDownload = downloads.find(isObject) as Record<string, unknown> | undefined;

  const images = Array.isArray(raw.images) ? raw.images : [];
  const thumbnailUrl = images.find((i): i is string => typeof i === 'string' && !!i);

  const installedVpks = Array.isArray(raw.installedVpks)
    ? raw.installedVpks.filter((v): v is string => typeof v === 'string')
    : undefined;

  return {
    remoteId,
    submissionId: Number(remoteId),
    name: typeof raw.name === 'string' ? raw.name : undefined,
    category: typeof raw.category === 'string' ? raw.category : undefined,
    hero: pickHero(raw),
    thumbnailUrl,
    fileId: firstDownload ? fileIdFromDownloadUrl(firstDownload.url) : undefined,
    downloadFileName:
      firstDownload && typeof firstDownload.name === 'string' ? firstDownload.name : undefined,
    installOrder: typeof raw.installOrder === 'number' ? raw.installOrder : undefined,
    installedVpks,
  };
}

function normalizeProfile(id: string, raw: unknown): DmmStateProfile | null {
  if (!isObject(raw)) return null;
  const enabledMods: Record<string, boolean> = {};
  if (isObject(raw.enabledMods)) {
    for (const [rid, entry] of Object.entries(raw.enabledMods)) {
      if (isObject(entry) && typeof entry.enabled === 'boolean') enabledMods[rid] = entry.enabled;
    }
  }
  const mods = (Array.isArray(raw.mods) ? raw.mods : [])
    .map(normalizeMod)
    .filter((m): m is DmmStateMod => m !== null);

  return {
    id,
    name: typeof raw.name === 'string' && raw.name ? raw.name : id,
    folderName: typeof raw.folderName === 'string' ? raw.folderName : null,
    isDefault: raw.isDefault === true,
    enabledMods,
    mods,
  };
}

/** Unwrap the Tauri-store + zustand-persist envelope to the inner `state`
 *  object. Tolerant of: the value being a JSON string or an object; a missing
 *  "local-config" key (already-unwrapped input); and a missing `state` wrapper. */
export function unwrapDmmStateEnvelope(rawFileContents: string): Record<string, unknown> {
  let outer: unknown;
  try {
    outer = JSON.parse(rawFileContents);
  } catch (err) {
    throw new Error(
      `Not valid state.json (JSON parse failed): ${err instanceof Error ? err.message : String(err)}`
    );
  }
  if (!isObject(outer)) throw new Error('state.json must be a JSON object');

  // Layer 1: Tauri store key "local-config" (value may be string or object).
  let inner: unknown = 'local-config' in outer ? outer['local-config'] : outer;
  if (typeof inner === 'string') {
    try {
      inner = JSON.parse(inner);
    } catch (err) {
      throw new Error(
        `state.json "local-config" is not valid JSON: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }
  if (!isObject(inner)) throw new Error('state.json "local-config" must be an object');

  // Layer 2: zustand-persist wrapper { state, version }. Tolerate a store that
  // is already the bare state object.
  const state = isObject(inner.state) ? inner.state : inner;
  if (!isObject(state)) throw new Error('state.json has no usable state object');
  return state;
}

/** Parse raw `state.json` text into a normalized DmmState. Untrusted input:
 *  throws a human-readable message on envelope failure, but tolerates missing
 *  slices (returns empty arrays). */
export function parseDmmState(rawFileContents: string): DmmState {
  const state = unwrapDmmStateEnvelope(rawFileContents);

  const localMods = (Array.isArray(state.localMods) ? state.localMods : [])
    .map(normalizeMod)
    .filter((m): m is DmmStateMod => m !== null);

  const profiles: DmmStateProfile[] = [];
  if (isObject(state.profiles)) {
    for (const [id, raw] of Object.entries(state.profiles)) {
      const p = normalizeProfile(id, raw);
      if (p) profiles.push(p);
    }
  }

  return {
    activeProfileId: typeof state.activeProfileId === 'string' ? state.activeProfileId : undefined,
    localMods,
    profiles,
  };
}

/** Choose the profile to migrate: the named one, else the active one, else the
 *  default, else the first. Returns null when there are no profiles (callers
 *  then fall back to localMods). */
export function selectDmmProfile(state: DmmState, preferId?: string): DmmStateProfile | null {
  if (state.profiles.length === 0) return null;
  const byId = (id?: string) => (id ? state.profiles.find((p) => p.id === id) : undefined);
  return (
    byId(preferId) ??
    byId(state.activeProfileId) ??
    state.profiles.find((p) => p.isDefault) ??
    state.profiles[0]
  );
}

/** Build a submissionId -> DmmStateMod lookup for enrichment. Prefers a
 *  profile's own `mods[]` (its snapshot), falling back to `localMods`. Later
 *  duplicates do not clobber an earlier entry that already resolved a fileId. */
export function indexDmmStateBySubmission(
  state: DmmState,
  profile?: DmmStateProfile | null
): Map<number, DmmStateMod> {
  const index = new Map<number, DmmStateMod>();
  const sources = [profile?.mods ?? [], state.localMods];
  for (const list of sources) {
    for (const mod of list) {
      if (!Number.isInteger(mod.submissionId) || mod.submissionId <= 0) continue;
      const existing = index.get(mod.submissionId);
      if (!existing) {
        index.set(mod.submissionId, mod);
      } else if (existing.fileId === undefined && mod.fileId !== undefined) {
        index.set(mod.submissionId, mod);
      }
    }
  }
  return index;
}
