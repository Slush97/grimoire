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

/**
 * One hero-card choice inside the Locker cosmetics VPK. The user picked this
 * hero's card art out of `source` (a mod they may or may not otherwise run);
 * the rebuild splits just this hero's `panorama/images/heroes/<codename>_`
 * files out of the source and folds them into the consolidated VPK.
 */
export interface LockerCardSelection {
  heroCodename: string;
  heroName: string;
  /** Variant tokens captured from the source (e.g. ["card","vertical","mm"]).
   *  Informational: the split takes the whole per-hero panorama prefix. */
  variants: string[];
  source: {
    /** Source VPK filename at apply time. May drift if reconcile renames it;
     *  `sha256AtApplyTime` is the content-identity fallback for relocation. */
    fileName: string;
    modName?: string;
    gameBananaId?: number;
    sha256AtApplyTime: string;
  };
  addedAt: string;
}

/**
 * Manifest stamped on the single Locker-managed cosmetics VPK that holds every
 * applied hero card. Its presence marks the VPK as Locker-managed so the rest
 * of the UI (Installed, Locker piles, Conflicts, profile export) hides it.
 * Rebuilt automatically on every apply/revert; unlike `merged`, there is no
 * user-facing unmerge.
 */
export interface LockerCosmeticsInfo {
  /** One entry per hero, keyed by heroCodename. */
  cards: LockerCardSelection[];
  rebuiltAt: string;
}

export interface ApplyHeroCardResult {
  /** Source VPK filename now providing this hero's card, or null if reverted. */
  activeSourceFileName: string | null;
  /** Selections dropped because their source VPK was gone at rebuild time. */
  missingSourceFileNames: string[];
}

/**
 * Global (non-hero) cosmetic mod types the Locker groups on a second axis,
 * alongside the per-hero piles. Most are derived from the VPK file tree by
 * `classifyGlobalModType` (electron/main/services/vpk.ts), since GameBanana's
 * category labels are unreliable for them. 'announcer' is path-classified from
 * `sounds/mods/` (global SFX / announcer frameworks like QOL Lock) but is ALSO
 * derived from the GameBanana "Announcer" category for sound packs whose VPK is
 * just `sounds/`. The other exception is 'killstreak-music': a Sound mod's VPK
 * is just `sounds/`, so it can't be path-classified, and is instead derived
 * from the GameBanana "Killstreak Music" category (cat 5895) by
 * `getEffectiveGlobalType` in the renderer (src/lib/lockerUtils.ts). Shared
 * here so the classifier (main) and the Locker grouping/UI (renderer) agree on
 * the union.
 */
export type GlobalModType = 'soul-container' | 'hideout' | 'icons' | 'hud' | 'announcer' | 'killstreak-music';
export type LockerHeroSource = 'manual' | 'title' | 'vpk' | 'download-title' | 'download-vpk';

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
  /** Where lockerHero came from. Missing means legacy/inferred metadata. */
  lockerHeroSource?: LockerHeroSource;
  /** Global (non-hero) cosmetic category this mod belongs to in the Locker,
   *  classified from its VPK file tree (see GlobalModType). Mutually exclusive
   *  with hero content: the classifier returns null for hero skins/abilities,
   *  so a mod with a globalType set is never also a hero cosmetic. Undefined
   *  for hero mods and for anything that matched no global signal. */
  globalType?: GlobalModType;
  /** Set when this mod was produced by mergeMods. Carries the unroll payload
   *  (share code + source list). */
  merged?: MergedModInfo;
  /** Set on the single Locker-managed cosmetics VPK that holds applied hero
   *  cards. Other surfaces treat a truthy value as "hide this artifact". */
  lockerCosmetics?: LockerCosmeticsInfo;
  /** User opted out of the "update available" flag for this mod. Persisted
   *  in metadata; toggled from the mod details modal. */
  ignoreUpdates?: boolean;
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

export interface ExtractMergeSourceResult {
  /** True when extracting the source left fewer than 2 behind, so the whole
   *  merge was dissolved (the merged VPK is gone) rather than rebuilt. */
  collapsed: boolean;
  /** The rebuilt merged mod (same load-order slot as before). Null when the
   *  merge collapsed. */
  merged: Mod | null;
  /** Mods that are now standalone again: the extracted source plus any source
   *  restored when the merge collapsed. */
  restored: Mod[];
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

export interface EditLocalModArgs {
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
  hasCompletedSetup: boolean;
  ignoredConflicts: string[];
  ignoreConflictsByDefault: boolean;
  /** UI accent color (hex, e.g. "#f97316"). Falls back to default orange when unset. */
  accentColor: string;
  /** Order used to render absolute dates (mod/file upload + update dates). */
  dateFormat: 'MM/DD/YYYY' | 'DD/MM/YYYY';
}
