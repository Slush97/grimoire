/**
 * Adapter: Deadlock Mod Manager (DMM) `.dmm.json` -> Grimoire PortableProfile.
 *
 * DMM (the competing Tauri/Rust manager) writes a per-profile manifest named
 * `.dmm.json` into the addons folder. It is plain local JSON, so reading it
 * needs zero network and never touches DMM's cloud (`api.deadlockmods.app`).
 * Its mods are keyed by the GameBanana SUBMISSION id, which is exactly the
 * `submissionId` Grimoire's portable format pins, so the formats are
 * near-isomorphic at the identity layer.
 *
 * The one gap: `.dmm.json` records the submission id (map key) and VPK
 * filename bookkeeping, but NEVER the GameBanana file id. We therefore emit a
 * sentinel `fileId` (see DMM_UNKNOWN_FILE_ID); Grimoire's existing resolver
 * (resolvePortableProfile) treats a pin it can't find as missing and upgrades
 * to the submission's current non-archived file. So a DMM import lands as a
 * set of "upgraded" rows rather than byte-pinned "exact" rows, which is the
 * correct degradation given DMM simply doesn't persist the file version.
 *
 * This module is intentionally Electron-free (imports only pure types/consts)
 * so it is unit-testable and can be called from either process. Wiring it to
 * an IPC handler + import UI is a separate step; the output here is designed to
 * feed straight into resolvePortableProfile().
 *
 * On-disk shape (serde `rename_all = "camelCase"`, manifest version 1):
 *   {
 *     "version": 1,
 *     "mods": {
 *       "<gameBananaSubmissionId>": {
 *         "enabled": true,
 *         "order": 0,                      // number | null (load priority)
 *         "currentVpks": ["pak01_dir.vpk"],// live slot names (enabled mods)
 *         "disabledVpks": [],              // "<modId>_<orig>.vpk" (disabled)
 *         "originalVpkNames": ["cool.vpk"] // source archive VPK names
 *       }
 *     }
 *   }
 */

import {
  PORTABLE_PROFILE_FORMAT,
  PORTABLE_PROFILE_SCHEMA_VERSION,
} from '../types/portableProfile';
import type { PortableProfile, PortableModEntry } from '../types/portableProfile';

const DEADLOCK_STEAM_APP_ID = 1422450;
const DEADLOCK_GAMEBANANA_GAME_ID = 20948;

/** DMM's manifest never records the GameBanana file id. We emit this sentinel
 *  so resolvePortableProfile fails the exact-pin lookup and upgrades to the
 *  submission's current file. 0 is never a real GameBanana _idRow. */
export const DMM_UNKNOWN_FILE_ID = 0;

/** Manifest major version this adapter understands. DMM normalizes a missing
 *  or 0 version to 1; anything higher is a format we don't model. */
const SUPPORTED_DMM_MANIFEST_VERSION = 1;

export interface DmmManifestEntry {
  enabled?: boolean;
  order?: number | null;
  currentVpks?: string[];
  disabledVpks?: string[];
  originalVpkNames?: string[];
}

export interface DmmManifest {
  version?: number;
  mods?: Record<string, DmmManifestEntry>;
}

export interface DmmConversionOptions {
  /** Profile name to stamp; `.dmm.json` itself carries no name (DMM keeps it
   *  in state.json / the folder name). Defaults to "Imported from DMM". */
  profileName?: string;
  /** Stamped into exportedBy.version. Defaults to "0". */
  toolVersion?: string;
  /** Injectable ISO timestamp for deterministic output (tests). */
  exportedAt?: string;
}

export interface DmmConversionResult {
  profile: PortableProfile;
  warnings: string[];
  /** Mods imported without a pinned file id (i.e. all GameBanana mods, since
   *  DMM never records the file version). They resolve to current on import. */
  unknownFileIdCount: number;
}

/** Strip `pakNN_` and `.vpk`/`_dir.vpk` to recover the variant stem, matching
 *  portableProfile.ts. Only DMM's `currentVpks` (enabled mods) use the
 *  `pakNN_<body>.vpk` shape; disabled entries carry `<modId>_<orig>.vpk`, which
 *  this correctly declines to interpret. Returns null for the uninformative
 *  `dir` fallback. */
function vpkStemOf(fileName: string): string | null {
  const m = fileName.match(/^pak\d{2}_(.+?)\.vpk$/i);
  if (!m) return null;
  const body = m[1].replace(/_dir$/i, '');
  if (!body || body.toLowerCase() === 'dir') return null;
  return body.toLowerCase();
}

/** Parse + validate raw `.dmm.json` text. Untrusted input: throws with a
 *  human-readable message the import UI can show verbatim. */
export function parseDmmManifest(input: string): DmmManifest {
  let parsed: unknown;
  try {
    parsed = JSON.parse(input);
  } catch (err) {
    throw new Error(
      `Not valid .dmm.json (JSON parse failed): ${err instanceof Error ? err.message : String(err)}`
    );
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('.dmm.json must be a JSON object');
  }
  const o = parsed as Record<string, unknown>;

  if (o.version !== undefined && typeof o.version !== 'number') {
    throw new Error('.dmm.json "version" must be a number');
  }
  // DMM normalizes missing/0 -> 1, so only a higher major is unknown to us.
  if (typeof o.version === 'number' && o.version > SUPPORTED_DMM_MANIFEST_VERSION) {
    throw new Error(`Unsupported .dmm.json version: ${o.version} (this build understands v1)`);
  }
  if (
    o.mods !== undefined &&
    (typeof o.mods !== 'object' || o.mods === null || Array.isArray(o.mods))
  ) {
    throw new Error('.dmm.json "mods" must be an object map');
  }
  return parsed as DmmManifest;
}

/** Convert a parsed DMM manifest into a Grimoire PortableProfile. The result
 *  is shaped to pass validatePortable() and flow into resolvePortableProfile()
 *  unchanged. */
export function dmmManifestToPortable(
  manifest: DmmManifest,
  options: DmmConversionOptions = {}
): DmmConversionResult {
  const warnings: string[] = [];
  const mods: PortableModEntry[] = [];
  let unknownFileIdCount = 0;

  const entries = Object.entries(manifest.mods ?? {});

  // Mods carry an explicit `order` slot or none. Place ordered mods at their
  // stated priority and trail the order-less ones after the highest used slot,
  // in map (sorted-key) order, so relative intent is preserved. Only count
  // mods we will actually keep (numeric GameBanana keys); a skipped local mod
  // must not reserve a slot the output never fills.
  let maxOrder = -1;
  for (const [key, e] of entries) {
    const id = Number(key);
    if (!Number.isInteger(id) || id <= 0) continue;
    if (e && typeof e.order === 'number') maxOrder = Math.max(maxOrder, e.order);
  }
  let trailing = maxOrder + 1;

  for (const [key, rawEntry] of entries) {
    const submissionId = Number(key);
    if (!Number.isInteger(submissionId) || submissionId <= 0) {
      // DMM stores local (non-GameBanana) mods under non-numeric ids. They
      // can't be resolved against GameBanana, so skip and report, mirroring
      // how Grimoire's own export drops local mods.
      warnings.push(`Skipped non-GameBanana mod: ${key}`);
      continue;
    }
    const e = rawEntry ?? {};
    const priority = typeof e.order === 'number' ? e.order : trailing++;

    // Best-effort variant stem from the live VPK name (enabled mods only).
    let vpkStem: string | null = null;
    for (const v of e.currentVpks ?? []) {
      const stem = vpkStemOf(v);
      if (stem) {
        vpkStem = stem;
        break;
      }
    }

    const originalFileName = (e.originalVpkNames ?? []).find((n) => typeof n === 'string' && n);

    mods.push({
      source: 'gamebanana',
      ref: {
        submissionId,
        fileId: DMM_UNKNOWN_FILE_ID,
        section: 'Mod',
        ...(vpkStem ? { vpkStem } : {}),
      },
      enabled: e.enabled === true,
      priority,
      ...(originalFileName ? { hint: { originalFileName } } : {}),
    });
    unknownFileIdCount++;
  }

  if (unknownFileIdCount > 0) {
    warnings.push(
      `${unknownFileIdCount} mod(s) imported without a pinned file version ` +
        `(DMM does not record it); each resolves to its current GameBanana file.`
    );
  }

  const profile: PortableProfile = {
    format: PORTABLE_PROFILE_FORMAT,
    schemaVersion: PORTABLE_PROFILE_SCHEMA_VERSION,
    game: {
      steamAppId: DEADLOCK_STEAM_APP_ID,
      gameBananaGameId: DEADLOCK_GAMEBANANA_GAME_ID,
      name: 'Deadlock',
    },
    exportedAt: options.exportedAt ?? new Date().toISOString(),
    exportedBy: { tool: 'grimoire-dmm-import', version: options.toolVersion ?? '0' },
    profile: { name: options.profileName?.trim() || 'Imported from DMM' },
    mods,
  };

  return { profile, warnings, unknownFileIdCount };
}

/** Convenience: parse raw `.dmm.json` text and convert in one call. */
export function convertDmmManifestJson(
  input: string,
  options?: DmmConversionOptions
): DmmConversionResult {
  return dmmManifestToPortable(parseDmmManifest(input), options);
}
