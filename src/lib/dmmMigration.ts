/**
 * DMM -> Grimoire migration planner (pure). Combines DMM's two local sources
 * into an ordered list of "adopt this VPK with this metadata" instructions. The
 * DMM reader (electron/main/services/modInterchange/dmmReader.ts) turns the
 * plan into a manager-neutral interchange document, which the interchange
 * importer then adopts. No re-download, no DMM cloud.
 *
 * Authority split:
 *  - `.dmm.json` (DmmManifest) is the authority for WHICH VPK files are on disk,
 *    their enabled state, shard, and load order. It is the addons-folder manifest.
 *  - `state.json` (DmmState, indexed by DMM id) enriches each mod with the
 *    GameBanana file id, name, author, source filename, and thumbnail.
 *
 * When `.dmm.json` is absent we synthesize an equivalent manifest from a
 * state.json profile (manifestFromDmmProfile) so the same planner drives both.
 *
 * DMM ids come in three shapes: `123` (GameBanana mod), `snd-123` (GameBanana
 * sound) and `local-<uuid>` (added from disk). All three are planned.
 *
 * Hero is deliberately NOT carried into the plan: DMM stores a lowercase
 * codename ("vyper") that does not map 1:1 to Grimoire's canonical hero names,
 * and Grimoire's enrichMod infers the hero from the adopted VPK's file tree
 * anyway. That inference is the "auto recognize" behavior we want.
 */

import { parseDmmManifest, type DmmManifest, type DmmManifestEntry } from './dmmManifest';
import {
  parseDmmState,
  selectDmmProfile,
  indexDmmStateBySubmission,
  indexDmmStateByRemoteId,
  type DmmStateMod,
  type DmmStateProfile,
} from './dmmState';

/** DMM's mod ids: `123` (GameBanana mod), `snd-123` (GameBanana sound) or
 *  `local-<uuid>` (a mod the user added from disk). */
export type DmmModIdentity =
  | { kind: 'mod' | 'sound'; dmmId: string; submissionId: number }
  | { kind: 'local'; dmmId: string; localId: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseDmmModId(key: string): DmmModIdentity | null {
  const gb = key.match(/^(snd-)?([1-9]\d*)$/);
  if (gb) {
    const submissionId = Number(gb[2]);
    if (!Number.isSafeInteger(submissionId)) return null;
    return { kind: gb[1] ? 'sound' : 'mod', dmmId: key, submissionId };
  }
  if (key.startsWith('local-') && UUID_RE.test(key.slice(6))) {
    return { kind: 'local', dmmId: key, localId: key.slice(6).toLowerCase() };
  }
  return null;
}

export interface DmmAdoptionEntry {
  /** DMM's own id for the mod (`123`, `snd-123`, `local-<uuid>`). */
  dmmId: string;
  kind: DmmModIdentity['kind'];
  /** GameBanana submission id; 0 for local mods, which have none. */
  submissionId: number;
  /** DMM's UUID for local mods. */
  localId?: string;
  /** DMM shard the enabled VPKs live in (1 = the profile folder). */
  shard: number;
  /** GameBanana file id when recoverable from state.json; else undefined
   *  (Grimoire treats undefined as "unknown version" for update detection). */
  fileId?: number;
  modName?: string;
  author?: string;
  description?: string;
  categoryName?: string;
  thumbnailUrl?: string;
  /** Label fallback: stem of the source archive/download filename. */
  sourceFileName?: string;
  /** Original VPK names the user picked in DMM (mod-store fallback). */
  selectedVpkNames?: string[];
  enabled: boolean;
  /** Grimoire load-order priority (lower loads first). */
  priority: number;
  /** On-disk VPK basenames belonging to this mod, ALL of which are adopted and
   *  tagged with this mod's identity (a DMM mod may ship several VPKs). Contested
   *  files (also listed by another mod through stale DMM bookkeeping) are removed
   *  here and awarded to a single owner, so two mods never fight over one slot. */
  vpkFiles: string[];
}

export interface DmmAdoptionPlan {
  profileName: string;
  entries: DmmAdoptionEntry[];
  warnings: string[];
  /** How many entries resolved a concrete GameBanana file id. */
  resolvedFileIdCount: number;
}

export interface DmmAdoptionOptions {
  /** Name for the Grimoire profile produced. Defaults to "Imported from DMM". */
  profileName?: string;
  /** Fallback VPK paths discovered on disk by submission id, used when DMM's
   *  data records no filename for a mod (some installs leave installedVpks
   *  empty for the actively-loaded `<submissionId>_*.vpk` files in addons). */
  extraVpkBySubmission?: Map<number, string[]>;
  /** Same fallback keyed by DMM id, which also covers sound and local mods. */
  extraVpkByDmmId?: Map<string, string[]>;
  /** state.json lookup by DMM id (covers sound and local mods). */
  stateByDmmId?: Map<string, DmmStateMod>;
}

/** Recover a GameBanana submission id from a DMM-style on-disk VPK name like
 *  `90548_WarWithoutLastStand.vpk` (DMM prefixes the mod id). Null otherwise. */
export function submissionIdFromVpkName(fileName: string): number | null {
  const m = fileName.match(/^(\d+)_.+\.vpk$/i);
  if (!m) return null;
  const id = Number(m[1]);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/** Recover DMM's mod id from a parked `<dmmId>_<name>.vpk` file name, for
 *  every id shape (`123_`, `snd-123_`, `local-<uuid>_`). Null otherwise. */
export function dmmIdFromVpkName(fileName: string): string | null {
  const underscore = fileName.indexOf('_');
  if (underscore < 1 || !/\.vpk$/i.test(fileName)) return null;
  return parseDmmModId(fileName.slice(0, underscore))?.dmmId ?? null;
}

function stripArchiveExt(name: string): string {
  return name.replace(/\.(zip|7z|rar|tar|gz|vpk)$/i, '');
}

/** Plan adoption from a DMM manifest, enriched by a submission-id -> state mod
 *  index (pass null to skip enrichment and rely on file-tree inference only). */
export function planDmmAdoption(
  manifest: DmmManifest,
  stateIndex: Map<number, DmmStateMod> | null,
  options: DmmAdoptionOptions = {}
): DmmAdoptionPlan {
  const warnings: string[] = [];
  let resolvedFileIdCount = 0;

  const manifestEntries = Object.entries(manifest.mods ?? {});
  const isStr = (v: unknown): v is string => typeof v === 'string' && !!v;

  const stateInfo = (identity: DmmModIdentity): DmmStateMod | undefined =>
    options.stateByDmmId?.get(identity.dmmId) ??
    (identity.kind === 'mod' ? stateIndex?.get(identity.submissionId) : undefined);
  // DMM writes `order: null` into .dmm.json; the load order it shows lives in
  // state.json's installOrder. The manifest's own order is the fallback.
  const orderOf = (key: string, e: DmmManifestEntry | undefined): number | undefined => {
    const identity = parseDmmModId(key);
    const installOrder = identity ? stateInfo(identity)?.installOrder : undefined;
    if (typeof installOrder === 'number' && Number.isFinite(installOrder)) return installOrder;
    return typeof e?.order === 'number' && Number.isFinite(e.order) ? e.order : undefined;
  };

  // Order-less mods trail the ordered ones over kept (valid) keys only, so a
  // skipped mod doesn't reserve an empty slot. Object key order means nothing
  // (numeric ids sort first), so enabled mods follow the pakNN slots DMM laid
  // them out in, then disabled ones.
  let maxOrder = -1;
  const orderless: Array<[string, DmmManifestEntry | undefined]> = [];
  for (const [key, e] of manifestEntries) {
    if (!parseDmmModId(key)) continue;
    const order = orderOf(key, e);
    if (order !== undefined) maxOrder = Math.max(maxOrder, order);
    else orderless.push([key, e]);
  }
  const slotOf = (e: DmmManifestEntry | undefined): number => {
    if (e?.enabled !== true) return Number.MAX_SAFE_INTEGER;
    const pak = (e.currentVpks ?? [])
      .map((name) => /^pak(\d+)_dir\.vpk$/i.exec(name)?.[1])
      .filter((n): n is string => n !== undefined)
      .map(Number);
    const shard = typeof e.shard === 'number' && e.shard >= 1 ? e.shard : 1;
    return pak.length > 0 ? shard * 1000 + Math.min(...pak) : Number.MAX_SAFE_INTEGER - 1;
  };
  const trailingOrder = new Map(
    orderless
      .map(([key, e], index) => ({ key, slot: slotOf(e), index }))
      .sort((a, b) => a.slot - b.slot || a.index - b.index)
      .map(({ key }, index) => [key, maxOrder + 1 + index])
  );

  // First pass: resolve each mod's full set of live on-disk VPK files. A DMM mod
  // can ship several VPKs (its `currentVpks`/`disabledVpks` list has >1 entry),
  // and ALL of them belong to that one mod, so the whole set is carried (not just
  // the first) to be adopted together under one identity.
  interface Draft {
    identity: DmmModIdentity;
    submissionId: number;
    shard: number;
    enabled: boolean;
    priority: number;
    files: string[];
    info?: DmmStateMod;
    sourceFileName?: string;
  }
  const drafts: Draft[] = [];
  for (const [key, rawEntry] of manifestEntries) {
    const identity = parseDmmModId(key);
    if (!identity) {
      warnings.push(`Skipped non-GameBanana mod: ${key}`);
      continue;
    }
    const submissionId = identity.kind === 'local' ? 0 : identity.submissionId;
    const e = rawEntry ?? {};
    const enabled = e.enabled === true;
    const priority = orderOf(key, e) ?? trailingOrder.get(key) ?? maxOrder + 1;
    const shard =
      typeof e.shard === 'number' && Number.isInteger(e.shard) && e.shard >= 1 ? e.shard : 1;

    // The mod's live files: its `currentVpks` live pakNN slots when enabled, its
    // `disabledVpks` parked "<modId>_<orig>.vpk" names when disabled. Fall back to
    // the cross list if DMM left the expected one empty (inconsistent state), then
    // to the disk-scanned `<id>_*.vpk` files for mods DMM recorded no filename for.
    const current = (e.currentVpks ?? []).filter(isStr);
    const disabled = (e.disabledVpks ?? []).filter(isStr);
    let files = enabled ? current : disabled;
    if (files.length === 0) files = enabled ? disabled : current;
    if (files.length === 0) {
      files = (
        options.extraVpkByDmmId?.get(identity.dmmId) ??
        (identity.kind === 'mod' ? options.extraVpkBySubmission?.get(submissionId) : undefined) ??
        []
      ).slice();
    }

    const info = stateInfo(identity);
    // Last resort: DMM's mod store keeps every downloaded VPK under its
    // original name, so a mod whose addon files are gone can still come
    // across. The reader resolves these names against the store folder.
    if (files.length === 0 && info?.selectedVpkNames?.length) {
      files = info.selectedVpkNames.slice();
    }

    if (files.length === 0) {
      warnings.push(`Skipped mod ${key}: no VPK filename recorded on disk`);
      continue;
    }

    const sourceFileNameRaw = info?.downloadFileName ?? (e.originalVpkNames ?? [])[0];
    const sourceFileName = sourceFileNameRaw ? stripArchiveExt(sourceFileNameRaw) : undefined;

    drafts.push({
      identity,
      submissionId,
      shard,
      enabled,
      priority,
      files,
      info,
      sourceFileName: sourceFileName || undefined,
    });
  }

  // Resolve contested files: the same on-disk VPK is sometimes listed by more
  // than one mod when DMM's manifest carries stale bookkeeping (a slot reused
  // after a reorder/reinstall but never cleared off the old owner). Award each
  // file to a single owner so two mods never get tagged onto one VPK. A single-
  // VPK mod almost always reflects the slot's current truth over a multi-VPK
  // pack's stale claim, so rank by fewest files first, then load order, then id
  // for determinism. Enabled files are keyed per shard: every shard has its
  // own pak01.
  const ranked = [...drafts].sort(
    (a, b) =>
      a.files.length - b.files.length ||
      a.priority - b.priority ||
      a.submissionId - b.submissionId ||
      a.identity.dmmId.localeCompare(b.identity.dmmId)
  );
  const slotKey = (d: Draft, f: string) => `${d.enabled ? d.shard : 0}:${f.toLowerCase()}`;
  const owner = new Map<string, string>();
  for (const d of ranked) {
    for (const f of d.files) {
      const k = slotKey(d, f);
      if (!owner.has(k)) owner.set(k, d.identity.dmmId);
    }
  }

  const entries: DmmAdoptionEntry[] = [];
  for (const d of drafts) {
    const vpkFiles = d.files.filter((f) => owner.get(slotKey(d, f)) === d.identity.dmmId);
    if (vpkFiles.length === 0) {
      warnings.push(
        `Skipped mod ${d.identity.dmmId}: its VPK(s) are already claimed by another mod (stale DMM data)`
      );
      continue;
    }
    const isLocal = d.identity.kind === 'local';
    if (!isLocal && d.info?.fileId !== undefined) resolvedFileIdCount++;
    entries.push({
      dmmId: d.identity.dmmId,
      kind: d.identity.kind,
      submissionId: d.submissionId,
      localId: d.identity.kind === 'local' ? d.identity.localId : undefined,
      shard: d.shard,
      fileId: isLocal ? undefined : d.info?.fileId,
      modName: d.info?.name,
      author: d.info?.author,
      description: d.info?.description,
      categoryName: d.info?.category,
      thumbnailUrl: d.info?.thumbnailUrl,
      sourceFileName: d.sourceFileName,
      selectedVpkNames: d.info?.selectedVpkNames,
      enabled: d.enabled,
      priority: d.priority,
      vpkFiles,
    });
  }

  const unresolved = entries.filter((e) => e.kind !== 'local').length - resolvedFileIdCount;
  if (unresolved > 0) {
    warnings.push(
      `${unresolved} mod(s) imported without a pinned GameBanana file id ` +
        `(not recoverable from DMM's data); update detection falls back to the submission.`
    );
  }

  return {
    profileName: options.profileName?.trim() || 'Imported from DMM',
    entries,
    warnings,
    resolvedFileIdCount,
  };
}

/** Synthesize a DmmManifest from a state.json profile, for installs whose
 *  `.dmm.json` is missing (the app rebuilds the on-disk manifest lazily, so a
 *  user mid-session may not have one). Drives the same planner. */
export function manifestFromDmmProfile(profile: DmmStateProfile): DmmManifest {
  const mods: NonNullable<DmmManifest['mods']> = {};
  for (const mod of profile.mods) {
    if (!parseDmmModId(mod.remoteId)) continue;
    const enabled = profile.enabledMods[mod.remoteId] === true;
    mods[mod.remoteId] = {
      enabled,
      order: mod.installOrder ?? null,
      currentVpks: enabled ? mod.installedVpks ?? [] : [],
      disabledVpks: enabled ? [] : mod.installedVpks ?? [],
      originalVpkNames: mod.downloadFileName ? [mod.downloadFileName] : [],
    };
  }
  return { version: 1, mods };
}

/** Convenience: parse raw `.dmm.json` text and plan in one call. */
export function planDmmAdoptionFromManifestJson(
  manifestJson: string,
  stateIndex: Map<number, DmmStateMod> | null,
  options?: DmmAdoptionOptions
): DmmAdoptionPlan {
  return planDmmAdoption(parseDmmManifest(manifestJson), stateIndex, options);
}

export type DmmEnrichment = 'state.json' | 'manifest-only';

/**
 * Full tiered decision logic, end to end, from raw file contents. Pure (no
 * file I/O), so the entire scan/preview path is unit-testable. The Electron
 * reader reads the two files off disk and calls this; everything after is
 * plain mapping.
 *
 * Tiers, in order of preference:
 *  - `.dmm.json` present  -> it is the on-disk authority; state.json (if any)
 *    enriches it (file id, name, category, thumbnail).
 *  - `.dmm.json` absent   -> synthesize a manifest from the chosen state.json
 *    profile so the same planner runs.
 * Throws only when neither source yields anything usable.
 */
export function composeDmmAdoptionPlan(
  manifestJson: string | null,
  stateJson: string | null,
  opts: {
    profileId?: string;
    profileName?: string;
    extraVpkBySubmission?: Map<number, string[]>;
    extraVpkByDmmId?: Map<string, string[]>;
  } = {}
): { plan: DmmAdoptionPlan; enrichment: DmmEnrichment } {
  let stateIndex: Map<number, DmmStateMod> | null = null;
  let stateByDmmId: Map<string, DmmStateMod> | undefined;
  let stateProfile: DmmStateProfile | null = null;
  let stateProfileName: string | undefined;

  if (stateJson) {
    try {
      const state = parseDmmState(stateJson);
      stateProfile = selectDmmProfile(state, opts.profileId);
      stateIndex = indexDmmStateBySubmission(state, stateProfile);
      stateByDmmId = indexDmmStateByRemoteId(state, stateProfile);
      stateProfileName = stateProfile?.name;
    } catch {
      // Unreadable state.json: degrade to manifest-only enrichment.
      stateIndex = null;
      stateByDmmId = undefined;
      stateProfile = null;
    }
  }

  const profileName = opts.profileName ?? stateProfileName;
  const planOpts: DmmAdoptionOptions = {
    profileName,
    extraVpkBySubmission: opts.extraVpkBySubmission,
    extraVpkByDmmId: opts.extraVpkByDmmId,
    stateByDmmId,
  };

  if (manifestJson) {
    const manifest = parseDmmManifest(manifestJson);
    const plan = planDmmAdoption(manifest, stateIndex, planOpts);
    return { plan, enrichment: stateIndex ? 'state.json' : 'manifest-only' };
  }

  if (stateProfile) {
    const manifest = manifestFromDmmProfile(stateProfile);
    const plan = planDmmAdoption(manifest, stateIndex, planOpts);
    return { plan, enrichment: 'state.json' };
  }

  throw new Error('No DMM data: neither a .dmm.json manifest nor a usable state.json profile.');
}

// --- Wire types shared by main and tests (kept pure here) ---

/** Request shape for a DMM migration. `deadlockPath` is resolved in the
 *  main process from settings, so it is not part of the request. */
export interface DmmMigrationRequest {
  /** Folder holding DMM's VPKs (+ optionally `.dmm.json`). Omit for the common
   *  shared-install case: it defaults to Grimoire's own addons folder, where
   *  DMM drops mods by default, and the migration runs in-place. */
  dmmAddonsDir?: string;
  /** Explicit state.json path; auto-located per-OS when omitted. */
  dmmStatePath?: string | null;
  /** Which DMM profile to migrate; defaults to active/default. */
  profileId?: string;
  /** Name for the produced loadout; defaults to the DMM profile name. */
  profileName?: string;
}

/**
 * Reported on the migration result for context. Adoption is always
 * non-destructive (DMM's files are never moved or deleted); the mode just notes
 * the dominant strategy:
 * - `in-place`: DMM shares Grimoire's addons folder (the default install), so
 *   both enabled mods (citadel/addons) and disabled mods (.disabled) are adopted
 *   by writing metadata onto the VPK already on disk, with no file op.
 * - `copy`: DMM's folder is separate (a profile subfolder or a copy). VPKs are
 *   copied into Grimoire's layout, leaving DMM's originals untouched.
 */
export type DmmMigrationMode = 'in-place' | 'copy';

export interface DmmMigrationPreviewEntry {
  /** Interchange key of the entry. */
  key: string;
  /** GameBanana submission id; 0 for local mods. */
  submissionId: number;
  modName?: string;
  enabled: boolean;
  priority: number;
  /** Whether a concrete GameBanana file id was recovered (vs resolve-to-current). */
  hasFileId: boolean;
}

export interface DmmMigrationAdopted {
  key: string;
  /** GameBanana submission id; 0 for local mods. */
  submissionId: number;
  fileId?: number;
  modName?: string;
  /** metaKey of the adopted VPK in Grimoire's layout. */
  installedAs: string;
  enabled: boolean;
  priority: number;
}

export interface DmmMigrationSkip {
  key: string;
  /** GameBanana submission id; 0 for local mods. */
  submissionId: number;
  reason: string;
}

export interface DmmMigrationReport {
  profileName: string;
  enrichment: DmmEnrichment;
  /** Whether the migration adopted files in-place or copied them. */
  mode: DmmMigrationMode;
  /** What the plan would adopt (populated for both scan and migrate). */
  preview: DmmMigrationPreviewEntry[];
  /** What was actually adopted (empty on a scan/dry-run). */
  adopted: DmmMigrationAdopted[];
  skipped: DmmMigrationSkip[];
  warnings: string[];
}

/** Interchange key for a planned entry. */
export function interchangeKeyForEntry(entry: Pick<DmmAdoptionEntry, 'kind' | 'submissionId' | 'localId'>): string {
  if (entry.kind === 'local') return `local:${entry.localId}`;
  return `gamebanana:${entry.kind}:${entry.submissionId}`;
}

/** Project a plan into the preview rows shown before migrating. */
export function planToPreview(plan: DmmAdoptionPlan): DmmMigrationPreviewEntry[] {
  return plan.entries.map((e) => ({
    key: interchangeKeyForEntry(e),
    submissionId: e.submissionId,
    modName: e.modName,
    enabled: e.enabled,
    priority: e.priority,
    hasFileId: e.fileId !== undefined,
  }));
}
