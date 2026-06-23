/**
 * DMM -> Grimoire migration planner (pure). Combines DMM's two local sources
 * into an ordered list of "adopt this VPK with this metadata" instructions that
 * the Electron orchestration (electron/main/services/dmmMigration.ts) executes
 * by copying the file into Grimoire's addons layout and writing the metadata
 * sidecar. No re-download, no DMM cloud.
 *
 * Authority split:
 *  - `.dmm.json` (DmmManifest) is the authority for WHICH VPK files are on disk,
 *    their enabled state, and load order. It is the addons-folder manifest.
 *  - `state.json` (DmmState, indexed by submission id) enriches each mod with
 *    the GameBanana file id, name, source filename, and thumbnail.
 *
 * When `.dmm.json` is absent we synthesize an equivalent manifest from a
 * state.json profile (manifestFromDmmProfile) so the same planner drives both.
 *
 * Hero is deliberately NOT carried into the plan: DMM stores a lowercase
 * codename ("vyper") that does not map 1:1 to Grimoire's canonical hero names,
 * and Grimoire's enrichMod infers the hero from the adopted VPK's file tree
 * anyway. That inference is the "auto recognize" behavior we want.
 */

import { parseDmmManifest, type DmmManifest } from './dmmManifest';
import {
  parseDmmState,
  selectDmmProfile,
  indexDmmStateBySubmission,
  type DmmStateMod,
  type DmmStateProfile,
} from './dmmState';

export interface DmmAdoptionEntry {
  /** GameBanana submission id. */
  submissionId: number;
  /** GameBanana file id when recoverable from state.json; else undefined
   *  (Grimoire treats undefined as "unknown version" for update detection). */
  fileId?: number;
  modName?: string;
  categoryName?: string;
  thumbnailUrl?: string;
  /** Label fallback: stem of the source archive/download filename. */
  sourceFileName?: string;
  enabled: boolean;
  /** Grimoire load-order priority (lower loads first). */
  priority: number;
  /** On-disk VPK basenames in DMM's addons folder to locate + copy. The first
   *  that exists is adopted; the rest are alternates (enable/disable variants). */
  vpkCandidates: string[];
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
}

/** Recover a GameBanana submission id from a DMM-style on-disk VPK name like
 *  `90548_WarWithoutLastStand.vpk` (DMM prefixes the mod id). Null otherwise. */
export function submissionIdFromVpkName(fileName: string): number | null {
  const m = fileName.match(/^(\d+)_.+\.vpk$/i);
  if (!m) return null;
  const id = Number(m[1]);
  return Number.isInteger(id) && id > 0 ? id : null;
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
  const entries: DmmAdoptionEntry[] = [];
  let resolvedFileIdCount = 0;

  const manifestEntries = Object.entries(manifest.mods ?? {});

  // Compute the trailing priority for order-less mods over kept (numeric) keys
  // only, so a skipped local mod doesn't reserve an empty slot.
  let maxOrder = -1;
  for (const [key, e] of manifestEntries) {
    const id = Number(key);
    if (Number.isInteger(id) && id > 0 && e && typeof e.order === 'number') {
      maxOrder = Math.max(maxOrder, e.order);
    }
  }
  let trailing = maxOrder + 1;

  for (const [key, rawEntry] of manifestEntries) {
    const submissionId = Number(key);
    if (!Number.isInteger(submissionId) || submissionId <= 0) {
      warnings.push(`Skipped non-GameBanana mod: ${key}`);
      continue;
    }
    const e = rawEntry ?? {};
    const enabled = e.enabled === true;
    const priority = typeof e.order === 'number' ? e.order : trailing++;

    // Enabled mods carry live pakNN_dir.vpk names; disabled mods carry the
    // "<modId>_<orig>.vpk" parked names. Either is a basename to locate on disk.
    const vpkCandidates = [
      ...(e.currentVpks ?? []),
      ...(e.disabledVpks ?? []),
    ].filter((v): v is string => typeof v === 'string' && !!v);

    // Fallback: DMM sometimes records no filename for actively-loaded mods. If
    // the addons folder has a `<submissionId>_*.vpk` for this mod, adopt that.
    if (vpkCandidates.length === 0) {
      vpkCandidates.push(...(options.extraVpkBySubmission?.get(submissionId) ?? []));
    }

    if (vpkCandidates.length === 0) {
      warnings.push(`Skipped mod ${submissionId}: no VPK filename recorded on disk`);
      continue;
    }

    const info = stateIndex?.get(submissionId);
    const sourceFileNameRaw = info?.downloadFileName ?? (e.originalVpkNames ?? [])[0];
    const sourceFileName = sourceFileNameRaw ? stripArchiveExt(sourceFileNameRaw) : undefined;

    if (info?.fileId !== undefined) resolvedFileIdCount++;

    entries.push({
      submissionId,
      fileId: info?.fileId,
      modName: info?.name,
      categoryName: info?.category,
      thumbnailUrl: info?.thumbnailUrl,
      sourceFileName: sourceFileName || undefined,
      enabled,
      priority,
      vpkCandidates,
    });
  }

  const unresolved = entries.length - resolvedFileIdCount;
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
    if (!Number.isInteger(mod.submissionId) || mod.submissionId <= 0) continue;
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
 * orchestration reads the two files off disk and calls this; everything after
 * is plain mapping.
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
  } = {}
): { plan: DmmAdoptionPlan; enrichment: DmmEnrichment } {
  let stateIndex: Map<number, DmmStateMod> | null = null;
  let stateProfile: DmmStateProfile | null = null;
  let stateProfileName: string | undefined;

  if (stateJson) {
    try {
      const state = parseDmmState(stateJson);
      stateProfile = selectDmmProfile(state, opts.profileId);
      stateIndex = indexDmmStateBySubmission(state, stateProfile);
      stateProfileName = stateProfile?.name;
    } catch {
      // Unreadable state.json: degrade to manifest-only enrichment.
      stateIndex = null;
      stateProfile = null;
    }
  }

  const profileName = opts.profileName ?? stateProfileName;
  const planOpts: DmmAdoptionOptions = {
    profileName,
    extraVpkBySubmission: opts.extraVpkBySubmission,
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

// --- Wire types shared by main, preload, and renderer (kept pure here) ---

/** Request shape for the scan/migrate IPC. `deadlockPath` is resolved in the
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
 * - `in-place`: DMM shares Grimoire's addons folder (the default install).
 *   Enabled mods are adopted by writing metadata onto the VPK already on disk
 *   (no copy); disabled mods are relocated into Grimoire's .disabled.
 * - `copy`: DMM's folder is separate (a profile subfolder or a copy). Every
 *   VPK is copied into Grimoire's layout, leaving DMM's files untouched.
 */
export type DmmMigrationMode = 'in-place' | 'copy';

export interface DmmMigrationPreviewEntry {
  submissionId: number;
  modName?: string;
  enabled: boolean;
  priority: number;
  /** Whether a concrete GameBanana file id was recovered (vs resolve-to-current). */
  hasFileId: boolean;
}

export interface DmmMigrationAdopted {
  submissionId: number;
  fileId?: number;
  modName?: string;
  /** metaKey of the adopted VPK in Grimoire's layout. */
  installedAs: string;
  enabled: boolean;
  priority: number;
}

export interface DmmMigrationSkip {
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

/** Project a plan into the preview rows shown before migrating. */
export function planToPreview(plan: DmmAdoptionPlan): DmmMigrationPreviewEntry[] {
  return plan.entries.map((e) => ({
    submissionId: e.submissionId,
    modName: e.modName,
    enabled: e.enabled,
    priority: e.priority,
    hasFileId: e.fileId !== undefined,
  }));
}
