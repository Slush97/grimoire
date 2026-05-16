/**
 * Portable mod profile format (v1.0). See docs/profile-spec.md for the
 * normative spec. These types are shared between main and renderer.
 */

export const PORTABLE_PROFILE_FORMAT = 'mod-profile';
export const PORTABLE_PROFILE_SCHEMA_VERSION = '1.1';
export const PORTABLE_PROFILE_SHARE_PREFIX = 'mp1:';
export const PORTABLE_PROFILE_FILE_EXTENSION = '.modprofile.json';

export type ModSource = 'gamebanana' | (string & { _open?: never });

export interface PortableGameId {
  steamAppId?: number;
  gameBananaGameId?: number;
  name?: string;
}

export interface PortableProfileMeta {
  name: string;
  description?: string;
  author?: string;
}

export interface PortableExportedBy {
  tool: string;
  version: string;
}

export interface PortableGameBananaRef {
  submissionId: number;
  fileId: number;
  section?: string;
  /** Variant discriminator when one GameBanana file expands into multiple
   *  VPKs. Derived from the local VPK filename body (the `<body>` in
   *  `pakNN_<body>.vpk`). Stable across users because it comes from inside
   *  the archive. Omit when the archive yields a single VPK or when the
   *  installer fell back to `pakNN_dir.vpk` (uninformative). */
  vpkStem?: string;
}

export type PortableModRef = PortableGameBananaRef | Record<string, unknown>;

export interface PortableModHint {
  name?: string;
  category?: string;
  fileLabel?: string;
  originalFileName?: string;
  thumbnailUrl?: string;
  nsfw?: boolean;
  isArchived?: boolean;
}

export interface PortableModEntry {
  source: ModSource;
  ref: PortableModRef;
  enabled: boolean;
  priority: number;
  hint?: PortableModHint;
}

export interface PortableCrosshairSettings {
  pipGap: number;
  pipHeight: number;
  pipWidth: number;
  pipOpacity: number;
  pipBorder: boolean;
  dotOpacity: number;
  dotOutlineOpacity: number;
  colorR: number;
  colorG: number;
  colorB: number;
}

export interface GrimoireExtension {
  crosshair?: PortableCrosshairSettings;
  autoexecCommands?: string[];
}

export interface PortableExtensions {
  grimoire?: GrimoireExtension;
  [namespace: string]: unknown;
}

export interface PortableProfile {
  format: typeof PORTABLE_PROFILE_FORMAT;
  schemaVersion: string;
  game: PortableGameId;
  exportedAt: string;
  exportedBy: PortableExportedBy;
  profile: PortableProfileMeta;
  mods: PortableModEntry[];
  extensions?: PortableExtensions;
}

/** Result of building an export. The exporter reports skipped local mods so
 *  the UI can surface a one-line warning without re-scanning. */
export interface PortableExportResult {
  profile: PortableProfile;
  json: string;
  shareCode: string;
  warnings: string[];
}

/** Per-mod resolution outcome during import. */
export type PortableResolutionStatus = 'exact' | 'upgraded' | 'unresolvable';

export interface PortableResolvedMod {
  entry: PortableModEntry;
  status: PortableResolutionStatus;
  /** Resolved fileId after fallback. For "exact" matches this equals the
   *  pinned fileId; for "upgraded" it's the newest non-archived file. */
  resolvedFileId?: number;
  /** Filename of the resolved file, used by the download pipeline. */
  resolvedFileName?: string;
  /** Human-readable reason for unresolvable status (e.g. "submission 404"). */
  reason?: string;
  /** True when the resolved (submissionId, resolvedFileId) pair is already
   *  installed locally. The dialog skips the download for these rows and
   *  wires the on-disk VPK into the new profile as-is. Only populated when
   *  resolution had a Deadlock path to scan against. */
  alreadyInstalled?: boolean;
}

export interface PortableResolutionReport {
  profile: PortableProfile;
  resolved: PortableResolvedMod[];
  exactCount: number;
  upgradedCount: number;
  unresolvableCount: number;
  alreadyInstalledCount: number;
}
