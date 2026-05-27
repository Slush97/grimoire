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
 * Optional per-ability volume/pitch retune, applied on top of the chosen clips
 * via the soundevents codec. Absent (or all-neutral) means the clips play at
 * their native level. Empty when the bundled vpkmerge lacks the soundevents
 * packer (pre-v0.4.0).
 */
export interface AbilitySoundParams {
  /** Volume offset in dB added to each retuned event's level (0 = unchanged).
   *  Soundevents `volume` is an absolute dB field; this offset is layered onto
   *  the event's current value at synthesis time. */
  volumeDb?: number;
  /** Pitch multiplier written to each retuned event (1 = unchanged). Matches the
   *  soundevents `pitch` field (a multiplier; vanilla values cluster around 1). */
  pitch?: number;
}

/**
 * One per-(hero, ability) sound choice inside the Locker sound VPK. The user
 * picked this ability's sound out of `source`; the rebuild splits just that
 * ability's clip paths out of the source and folds them into the consolidated
 * VPK. (Slot 4 = ultimate; see AbilitySlot.)
 */
export interface LockerSoundSelection {
  heroName: string;
  heroCodename: string;
  slot: AbilitySlot;
  /** Exact `.vsnd_c` paths extracted from the source for this ability. */
  clipPaths: string[];
  /** Optional volume/pitch retune for this ability (see AbilitySoundParams). */
  params?: AbilitySoundParams;
  source: {
    /** Source VPK filename at apply time; `sha256AtApplyTime` relocates it if
     *  reconcile renamed it (same recovery heroCards uses). */
    fileName: string;
    modName?: string;
    gameBananaId?: number;
    sha256AtApplyTime: string;
  };
  addedAt: string;
}

/**
 * Manifest on the single Locker-managed sound VPK that holds every applied
 * per-ability sound. Presence marks the VPK as Locker-managed so other surfaces
 * hide it. Rebuilt on every apply/revert; no user-facing unmerge. Separate from
 * lockerCosmetics (cards): disjoint paths, independent lifecycle.
 */
export interface LockerSoundsInfo {
  /** One entry per (heroCodename, slot). */
  sounds: LockerSoundSelection[];
  rebuiltAt: string;
}

export interface ApplyHeroSoundResult {
  /** Source VPK filename now providing this ability's sound, or null if reverted. */
  activeSourceFileName: string | null;
  /** Selections dropped because their source VPK was gone at rebuild time. */
  missingSourceFileNames: string[];
}

/** One applied hero-card override, summarized for the Locker Overrides popup. */
export interface LockerOverviewCard {
  heroName: string;
  /** Source VPK filename whose card art is applied. Joins to the installed mod
   *  for its thumbnail/name; the revert itself is keyed by heroName. */
  sourceFileName: string;
  modName?: string;
}

/** One applied ability-sound override, summarized for the popup. */
export interface LockerOverviewSound {
  heroName: string;
  slot: AbilitySlot;
  /** Source VPK filename providing this ability's clip. Joins to the installed
   *  mod for its preview audio/name; the revert is keyed by (heroName, slot). */
  sourceFileName: string;
  modName?: string;
  /** True when this slot carries a non-neutral volume/pitch retune. */
  tuned: boolean;
  /** The applied volume/pitch retune, so the popup's sliders reflect it. */
  params?: AbilitySoundParams;
}

/** Everything the Locker is currently overriding, for the Locker Overrides popup. */
export interface LockerOverview {
  cards: LockerOverviewCard[];
  sounds: LockerOverviewSound[];
}

/** Which slice of Locker overrides to clear. */
export type LockerClearScope = 'all' | 'cards' | 'sounds';

/** One applied hero card decoded to a preview thumbnail, for the popup. Decoded
 *  on demand from the managed cosmetics VPK (the real applied art, not the
 *  source mod's GameBanana cover), so it's a separate call from the cheap
 *  overview/count. */
export interface LockerCardThumbnail {
  heroName: string;
  /** PNG data URL of the most representative applied variant (card cover first). */
  dataUrl: string;
}

/** The source (and any volume/pitch retune) applied for one ability slot, read
 *  back so the picker can reflect the active pick + slider positions. */
export interface ActiveHeroSound {
  slot: AbilitySlot;
  sourceFileName: string;
  params?: AbilitySoundParams;
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

/** Deadlock ability slot. 1-3 are the signature abilities; 4 is the ultimate. */
export type AbilitySlot = 1 | 2 | 3 | 4;

/** Reference metadata for one hero ability slot (from deadlock-api). */
export interface AbilitySlotMeta {
  /** Internal ability name used in sound paths (e.g. "storm_cloud"). */
  token: string;
  /** Localized display name (e.g. "Storm Cloud"). */
  display: string;
  /** deadlock-api ability icon URL, or null when unknown. */
  image: string | null;
}

/** One hero ability slot for the picker UI: the slot number plus its metadata. */
export interface HeroAbilitySlot extends AbilitySlotMeta {
  slot: AbilitySlot;
}

/**
 * One hero's ability-sound footprint inside a single mod. A mod can touch more
 * than one hero (usually a dominant hero plus a stray copy-pasted file), so the
 * classifier attributes each sound FILE to its (hero, slot) and reports per-hero
 * contributions rather than collapsing to a single hero.
 */
export interface HeroAbilityContribution {
  /** Canonical hero display name (e.g. "Seven"). */
  hero: string;
  /** Count of ability SFX files resolved to each slot. */
  slots: Partial<Record<AbilitySlot, number>>;
  /** Ability SFX files under this hero that matched no slot. */
  unclassified: number;
  /** Voice-over files under this hero (sounds/vo/<codename>/), not slotted. */
  voFiles: number;
  /** Total sound files attributed to this hero (SFX + VO). */
  total: number;
}

/**
 * Result of classifying a sound mod's VPK file list by hero + ability slot.
 * Drives the per-ability sound picker: which abilities a mod offers a sound for.
 */
export interface AbilitySoundClassification {
  /** Hero with the most attributed files, or null if no hero sound matched. */
  dominantHero: string | null;
  /** Per-hero footprint, sorted by total files descending. */
  perHero: HeroAbilityContribution[];
  /** True when the mod ships its own hero soundevents (.vsndevts_c). Such a
   *  mod can repoint/retune events, so its sounds may not mix losslessly with
   *  another vsndevts mod for the same hero (one file per hero path). */
  shipsHeroVsndevts: boolean;
  /** Total ability SFX files (sounds/abilities/<codename>/) seen. */
  abilitySoundFiles: number;
  /** Total voice-over files (sounds/vo/<codename>/) seen. */
  voSoundFiles: number;
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
  /** Set on the single Locker-managed sound VPK that holds applied per-ability
   *  sounds. Like lockerCosmetics, a truthy value means "hide this artifact"
   *  (it's a Locker output, not a user-installed mod). */
  lockerSounds?: LockerSoundsInfo;
  /** Per-ability sound footprint, classified from the VPK file tree for mods
   *  that ship hero ability sounds (see classifyAbilitySounds). Undefined when
   *  not yet classified or the mod has no recognized hero ability sounds.
   *  Drives the per-ability sound picker. */
  abilitySounds?: AbilitySoundClassification;
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
  /** UI zoom factor (Ctrl +/-/0), persisted across launches. 1 = 100%. */
  zoomFactor?: number;
}
