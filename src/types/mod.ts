export interface MergedModSource {
  /** Filename of the source VPK after the merge: typically in `.disabled/`
   *  because mergeMods disables sources to free their priority slots. May
   *  drift if reconcile renames the file between merge and unmerge, which
   *  is why `sha256AtMergeTime` exists as a content-identity fallback. */
  fileName: string;
  modName: string;
  /** Source mod thumbnail at merge time. Captured here so the merged-mod
   *  thumbnail collage survives the source being deleted. */
  thumbnailUrl?: string;
  gameBananaId?: number;
  gameBananaFileId?: number;
  /** GameBanana section ("Mod" / "Sound" / etc.) for the source. Captured
   *  so the contents modal can build the right gamebanana.com URL (mods
   *  live under /mods/, sound mods under /sounds/). */
  section?: string;
  enabledAtMergeTime: boolean;
  priorityAtMergeTime: number;
  /** sha256 of the source VPK captured before disable. Used as a content-
   *  identity fallback when the fileName lookup misses (e.g. reconcile
   *  renamed the file after merge). Optional because legacy merges before
   *  this field existed don't have it. */
  sha256AtMergeTime?: string;
}

export interface MergedModInfo {
  /** Random ID generated at merge time. Surfaced for UI keys and logging;
   *  the mod's normal `id` (md5 of filename) is what callers use to operate
   *  on the merged mod itself. */
  id: string;
  createdAt: string;
  /** Portable-profile share code (mp1:...) capturing the source list. This is
   *  both the unroll fallback when source VPKs are missing AND the shareable
   *  representation of this merged mod (paste into someone else's Grimoire). */
  shareCode: string;
  sources: MergedModSource[];
}

export interface Mod {
  id: string;
  name: string;
  fileName: string;
  path: string;
  enabled: boolean;
  priority: number;
  size: number;
  installedAt: string;
  description?: string;
  thumbnailUrl?: string;
  audioUrl?: string;
  gameBananaId?: number;
  gameBananaFileId?: number;
  categoryId?: number;
  categoryName?: string;
  sourceSection?: string;
  nsfw?: boolean;
  isArchived?: boolean;
  sha256?: string;
  isUnknown?: boolean;
  variantLabel?: string;
  fileDescription?: string;
  sourceFileName?: string;
  /** Hero this mod belongs to in the Locker, by canonical hero name. Set
   *  automatically at download time for Sound mods (inferHeroFromTitle) or
   *  manually via the Locker's "Tag hero" affordance. Takes precedence over
   *  categoryId when grouping mods into hero piles. */
  lockerHero?: string;
  /** Set when this mod was produced by mergeMods. Carries the unroll payload
   *  (share code + source list). */
  merged?: MergedModInfo;
}

export interface MergeModsArgs {
  modIds: string[];
  name: string;
  thumbnailDataUrl?: string;
  strict?: boolean;
}

export interface UnmergeModResult {
  recovered: Mod[];
  /** Source filenames that were no longer on disk at unmerge time. The
   *  renderer can offer the share code via the portable-profile import flow
   *  to recover them. */
  missingSourceFileNames: string[];
  shareCode: string;
}

export interface UnknownModFilterGuess {
  modId: string;
  fileName: string;
  fileCount: number;
  section: 'Mod' | 'Sound';
  search: string | null;
  heroName?: string;
  heroFileName?: string;
  categoryName?: string;
  confidence: 'high' | 'medium' | 'low';
  contentHints: string[];
  reasons: string[];
  detectedHeroes: Array<{
    name: string;
    fileName: string;
    score: number;
    strongestSignal: 'strong' | 'medium' | 'weak';
    clues: string[];
  }>;
  samplePaths: string[];
  crcMatch: UnknownModCrcMatchResult;
}

export interface UnknownModCrcMatchResult {
  status: 'found' | 'not-found' | 'error';
  modId?: number;
  modName?: string;
  thumbnailUrl?: string;
  nsfw?: boolean;
  fileId?: number;
  fileName?: string;
  section?: 'Mod' | 'Sound';
  categoryName?: string;
  confidence?: 'exact';
  reason?: string;
  searchedBuckets: string[];
  checkedMods: number;
  checkedFiles: number;
  bytesFetched: number;
  skipped7z: number;
  errors: string[];
}

export interface ApplyUnknownModMatchArgs {
  gameBananaId: number;
  modName: string;
  gameBananaFileId?: number;
  sourceFileName?: string;
  sourceSection?: 'Mod' | 'Sound';
  categoryName?: string;
  thumbnailUrl?: string;
  nsfw?: boolean;
}

export interface ApplyUnknownCustomModArgs {
  name: string;
  thumbnailDataUrl?: string;
  nsfw?: boolean;
}

export interface Profile {
  id: string;
  name: string;
  mods: {
    modId: string;
    enabled: boolean;
    priority: number;
  }[];
  createdAt: string;
  updatedAt: string;
}

export interface ModConflict {
  modA: string;
  modAName: string;
  modB: string;
  modBName: string;
  modAIdentity: string;
  modBIdentity: string;
  ignoreKey: string;
  conflictType: 'priority' | 'file';
  details: string;
}

export interface AppSettings {
  deadlockPath: string | null;
  devMode: boolean;
  devDeadlockPath: string | null;
  hideNsfwPreviews: boolean;
  hideOutdatedMods: boolean;
  autoDisableSiblingVariants: boolean;
  steamLaunchOptions: string;
  activeProfileId: string | null;
  autoSaveProfile: boolean;
  experimentalStats: boolean;
  experimentalCrosshair: boolean;
  experimentalSocial: boolean;
  experimentalUnknownModMatching: boolean;
  experimentalVpkMerger: boolean;
  hasCompletedSetup: boolean;
  ignoredConflicts: string[];
  ignoreConflictsByDefault: boolean;
  /** UI accent color (hex, e.g. "#f97316"). Falls back to default orange when unset. */
  accentColor: string;
}
