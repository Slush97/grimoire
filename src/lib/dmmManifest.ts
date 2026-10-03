/**
 * Parser for Deadlock Mod Manager's (DMM) `.dmm.json` addons manifest.
 *
 * DMM (the competing Tauri/Rust manager) writes a per-profile manifest named
 * `.dmm.json` into the addons folder. It is plain local JSON, so reading it
 * needs zero network and never touches DMM's cloud (`api.deadlockmods.app`).
 * Its mods are keyed by the GameBanana SUBMISSION id, which is exactly the
 * `submissionId` Grimoire pins, so the identity layer is near-isomorphic.
 *
 * `.dmm.json` records the submission id (map key) and VPK filename bookkeeping
 * but NEVER the GameBanana file id; that is recovered separately from
 * `state.json` (see dmmState.ts). The migration planner that consumes this
 * (planDmmAdoption in dmmMigration.ts) drives Grimoire's direct on-disk
 * adoption, so this module is just the defensive parser for the manifest.
 *
 * This module is intentionally Electron-free (pure) so it is unit-testable and
 * can be called from either process.
 *
 * On-disk shape (serde `rename_all = "camelCase"`):
 *   {
 *     "version": 3,
 *     "mods": {
 *       "<modId>": {                       // "123", "snd-123" or "local-<uuid>"
 *         "enabled": true,
 *         "order": 0,                      // number | null (load priority)
 *         "shard": 1,                      // v2+: enabled VPKs live in addons<N>
 *         "currentVpks": ["pak01_dir.vpk"],// live slot names (enabled mods)
 *         "disabledVpks": [],              // "<modId>_<orig>.vpk" (disabled)
 *         "originalVpkNames": ["cool.vpk"] // source archive VPK names
 *       }
 *     }
 *   }
 *
 * Versions: v1 has no `shard` (everything lives in the profile folder). v2
 * added `shard` for profiles with more than 99 enabled mods: shard 1 is the
 * profile folder, shard N >= 2 is `citadel/addons<N>/<profile folder>`. v3
 * only changed how DMM repairs crashed writes; the shape is the same as v2.
 */

/** Newest manifest major version this adapter understands. Older versions
 *  are read as-is (a missing shard means shard 1). */
export const SUPPORTED_DMM_MANIFEST_VERSION = 3;

export interface DmmManifestEntry {
  enabled?: boolean;
  order?: number | null;
  /** 1-based shard the enabled VPKs live in (v2+); missing means 1. */
  shard?: number;
  currentVpks?: string[];
  disabledVpks?: string[];
  originalVpkNames?: string[];
}

export interface DmmManifest {
  version?: number;
  mods?: Record<string, DmmManifestEntry>;
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
    throw new Error(
      `Unsupported .dmm.json version: ${o.version} (this build understands up to v${SUPPORTED_DMM_MANIFEST_VERSION})`
    );
  }
  if (
    o.mods !== undefined &&
    (typeof o.mods !== 'object' || o.mods === null || Array.isArray(o.mods))
  ) {
    throw new Error('.dmm.json "mods" must be an object map');
  }
  return parsed as DmmManifest;
}
