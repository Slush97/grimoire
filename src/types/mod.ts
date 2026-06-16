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
    /** Where this card came from. Absent or `"mod"` = an installed mod VPK
     *  (the original behavior). `"custom"` = a user-uploaded PNG set, built into
     *  a persistent staging VPK the rebuild resolves by `heroCodename` rather
     *  than by addon lookup. */
    kind?: 'mod' | 'custom';
    /** Folder-relative metaKey of the source VPK (bare filename for a base
     *  citadel/addons mod, "addonsN/<file>" for an overflow mod). Named
     *  `fileName` for back-compat: pre-overflow selections stored the bare
     *  filename, which IS the base mod's metaKey, so they still resolve. May
     *  drift if reconcile renames or overflow moves it; `sha256AtApplyTime` is
     *  the content-identity fallback for relocation. For a custom source this is
     *  the synthetic id `custom:<heroCodename>`. */
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
  /** Source identity (folder-relative metaKey; == filename for base mods) now
   *  providing this hero's card, or null if reverted. */
  activeSourceFileName: string | null;
  /** Source identities (metaKeys) dropped because their VPK was gone at rebuild. */
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
    /** Folder-relative metaKey of the source VPK (bare filename for base
     *  citadel/addons, "addonsN/<file>" for overflow). Named `fileName` for
     *  back-compat (see LockerCardSelection.source.fileName). `sha256AtApplyTime`
     *  relocates it if reconcile renamed or overflow moved it. */
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
  /** Source identity (folder-relative metaKey; == filename for base mods) now
   *  providing this ability's sound, or null if reverted. */
  activeSourceFileName: string | null;
  /** Source identities (metaKeys) dropped because their VPK was gone at rebuild. */
  missingSourceFileNames: string[];
}

/** One applied hero-card override, summarized for the Locker Overrides popup. */
export interface LockerOverviewCard {
  heroName: string;
  /** Source identity (folder-relative metaKey; == filename for base mods) whose
   *  card art is applied. Joins to the installed mod by metaKey for its
   *  thumbnail/name; the revert itself is keyed by heroName. */
  sourceFileName: string;
  modName?: string;
}

/** One applied ability-sound override, summarized for the popup. */
export interface LockerOverviewSound {
  heroName: string;
  slot: AbilitySlot;
  /** Source identity (folder-relative metaKey; == filename for base mods)
   *  providing this ability's clip. Joins to the installed mod by metaKey for its
   *  preview audio/name; the revert is keyed by (heroName, slot). */
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
  /** Applied ability-color recolors, one per hero (see LockerColorSelection). */
  colors: LockerColorSelection[];
  /** Applied trippy skin paints, one per hero (see LockerTrippySkinSelection). */
  trippySkins: LockerTrippySkinSelection[];
}

/** Which slice of Locker overrides to clear. */
export type LockerClearScope = 'all' | 'cards' | 'sounds' | 'colors' | 'trippy';

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
  /** Source identity (folder-relative metaKey; == filename for base mods). The
   *  sound picker compares this against each mod's metaKey to mark the active row. */
  sourceFileName: string;
  params?: AbilitySoundParams;
}

/**
 * One per-hero ability-color choice inside the Locker colors VPK. The user
 * recolored this hero's ability VFX (particles + color textures + baked vertex
 * colors) to a single absolute `hue`; the rebuild bakes that hero's VFX (cached
 * by codename+hue) and folds it into the consolidated colors VPK. At most one
 * selection per hero.
 */
export interface LockerColorSelection {
  heroName: string;
  /** Model/particle codename the recolor targets (Paige = `bookworm`). */
  heroCodename: string;
  /** Absolute hue (0-359 degrees) every ability color is set to. */
  hue: number;
  /** Saturation scale applied on top of each source color (1 = keep source, >1
   *  lifts pale washed-out areas toward the picked color, <1 mutes to a pastel).
   *  Hue alone can't make e.g. a light blue: saturation + brightness do. */
  saturation: number;
  /** Brightness (HSV value) scale (1 = keep source, >1 lighter, <1 darker). */
  brightness: number;
  /** Recolor mode. 'hue' (or absent, for older persisted entries) = one absolute
   *  color via `recolor-hero`. 'prism' = a rainbow spectrum via `vpkmerge prism`.
   *  'gradient' = a prism spread over a custom gradient (see `gradient`). In
   *  prism/gradient modes hue is a spectrum rotation, not an absolute color.
   *  'trippy' = a procedural trippy VFX paint via `vpkmerge trippy-vfx` (see
   *  `trippy`); hue/saturation/brightness are unused in that mode. */
  mode?: 'hue' | 'prism' | 'gradient' | 'trippy';
  /** Prism/gradient only: animate the spectrum so it sweeps over each particle's
   *  lifetime (`prism --animated`). Ignored in hue mode. */
  animated?: boolean;
  /** Gradient mode only: the `--gradient` spec, either a preset name
   *  (fire/ice/toxic/sunset/ocean/neon/gold/void) or a stop list
   *  `pos:hue:sat,...`. */
  gradient?: string;
  /** Trippy mode only: the procedural style/params for the VFX paint. */
  trippy?: TrippyVfxChoice;
  addedAt: string;
}

/**
 * Manifest on the single Locker-managed colors VPK that holds every applied
 * ability recolor. Presence marks the VPK as Locker-managed so other surfaces
 * hide it. Rebuilt on every apply/revert. Separate from lockerCosmetics (cards)
 * and lockerSounds (disjoint paths, independent lifecycle).
 */
export interface LockerColorsInfo {
  /** One entry per hero (heroCodename). */
  colors: LockerColorSelection[];
  rebuiltAt: string;
}

/** The color applied for a hero's ability VFX, read back so the color picker can
 *  reflect the active selection. */
export interface ActiveHeroColor {
  /** Applied absolute hue (0-359 degrees). Meaningless in prism mode. */
  hue: number;
  /** Applied saturation scale (1 = source). */
  saturation: number;
  /** Applied brightness scale (1 = source). */
  brightness: number;
  /** Which recolor is applied: a single hue, the rainbow prism, a custom
   *  gradient, or a trippy VFX paint. Absent on older persisted entries
   *  (treat as 'hue'). */
  mode?: 'hue' | 'prism' | 'gradient' | 'trippy';
  /** Prism/gradient only: whether the applied spectrum is animated. */
  animated?: boolean;
  /** Gradient mode only: the applied gradient spec (preset name or stop list). */
  gradient?: string;
  /** Trippy mode only: the applied procedural style/params. */
  trippy?: TrippyVfxChoice;
}

export interface ApplyHeroColorResult {
  /** The applied hue (0-359), or null after a revert. */
  hue: number | null;
  /** The applied saturation scale, or null after a revert. */
  saturation: number | null;
  /** The applied brightness scale, or null after a revert. */
  brightness: number | null;
}

/** Result of applying the rainbow prism (or a custom gradient) to a hero's VFX. */
export interface ApplyHeroPrismResult {
  /** Applied spectrum rotation in degrees (prism reuses the hue field as a rotation). */
  hue: number;
  /** Applied saturation scale on the spectrum. */
  saturation: number;
  /** Applied brightness scale on the spectrum. */
  brightness: number;
  /** Whether the applied spectrum animates over each particle's lifetime. */
  animated: boolean;
  /** The applied gradient spec, or null for the full rainbow. */
  gradient: string | null;
}

/** Procedural trippy pattern styles (vpkmerge trippy-skin / trippy-vfx /
 *  trippy-preview). Shared by the main-process bake services and the Locker
 *  Effects panel so the two never drift. */
export const TRIPPY_STYLES = [
  'confetti',
  'liquid',
  'moire',
  'kaleido',
  'holo',
  'glitch',
  'thermal',
  'gradient',
  'camo',
  'carbon',
  'galaxy',
  'halftone',
  'lava',
  'vaporwave',
] as const;
export type TrippyStyleName = (typeof TRIPPY_STYLES)[number];

/** Particle animation depth for trippy VFX (vpkmerge `--animation-style`).
 *  sweep retimes texture scroll, loop also loops color gradients, cycle also
 *  inserts runtime color-cycle operators where safe. */
export const TRIPPY_ANIMATION_STYLES = ['off', 'sweep', 'loop', 'cycle'] as const;
export type TrippyAnimationStyle = (typeof TRIPPY_ANIMATION_STYLES)[number];

/** Which materials a trippy SKIN paint touches. */
export type TrippySkinTargets = 'all' | 'body' | 'weapons';
/** Which effect sets a trippy VFX paint touches. */
export type TrippyVfxTargets = 'all' | 'abilities' | 'weapons';

/** Request for one animated trippy preview sprite (vpkmerge trippy-preview).
 *  Pure pattern generation: hero-independent and cheap (no VPK read). */
export interface TrippySpriteOptions {
  style: TrippyStyleName;
  /** Pattern phase / hue offset, normalized 0..1. */
  phase: number;
  /** UV-scroll speed scale; advances the phase across the frame loop so the
   *  swatch loop speed mirrors the runtime scroll the bake would apply. */
  scroll: number;
  /** Pattern blend strength over the checkerboard base, 0..1. */
  intensity: number;
  /** Frames in the loop (clamped to 1..48 by the binary). */
  frames: number;
  /** Square tile size per frame in px (clamped to 16..512 by the binary). */
  size: number;
}

/** One rendered trippy preview sprite: a PNG strip of `frames` tiles, each
 *  `size` x `size`, laid out left to right. The renderer plays it as a flipbook. */
export interface TrippySpriteResult {
  dataUrl: string;
  frames: number;
  size: number;
}

/** The procedural style/params for a trippy ability-VFX paint. Lives inside a
 *  LockerColorSelection (mode 'trippy'): trippy VFX patches the same particles
 *  as recolor/prism, so it shares the one-selection-per-hero colors VPK and can
 *  never stack with another recolor for the same hero. */
export interface TrippyVfxChoice {
  style: TrippyStyleName;
  /** Texture blend / particle emphasis strength, 0..1. */
  intensity: number;
  /** Pattern phase / hue offset, normalized 0..1. */
  phase: number;
  animationStyle: TrippyAnimationStyle;
  /** Particle animation strength (0..3; 0 behaves like animationStyle 'off'). */
  animationIntensity: number;
  targets: TrippyVfxTargets;
}

/** Result of applying a trippy VFX paint: the normalized choice as baked. */
export type ApplyTrippyVfxResult = TrippyVfxChoice;

/**
 * One per-hero trippy SKIN paint inside the Locker trippy-skins VPK (pak04).
 * Disjoint from ability colors: this repaints the hero's body/weapon material
 * textures (models/heroes*), not particles, so it composes with an applied
 * ability color or trippy VFX. At most one selection per hero.
 */
export interface LockerTrippySkinSelection {
  heroName: string;
  /** Model/material codename the paint targets (same table as ability colors). */
  heroCodename: string;
  style: TrippyStyleName;
  /** Texture blend strength, 0..1 (0 = original texture). */
  intensity: number;
  /** Runtime VMAT UV-scroll speed scale (1 = reference speed). */
  scroll: number;
  /** Pattern phase / hue offset, normalized 0..1. */
  phase: number;
  targets: TrippySkinTargets;
  addedAt: string;
}

/** Manifest on the Locker-managed trippy-skins VPK (mirrors LockerColorsInfo). */
export interface LockerTrippySkinsInfo {
  /** One entry per hero (heroCodename). */
  skins: LockerTrippySkinSelection[];
  rebuiltAt: string;
}

/** The trippy skin currently applied for a hero, read back so the Effects panel
 *  can reflect the active selection. */
export interface ActiveTrippySkin {
  style: TrippyStyleName;
  intensity: number;
  scroll: number;
  phase: number;
  targets: TrippySkinTargets;
}

/** Result of applying/reverting a trippy skin: nulls after a revert. */
export interface ApplyTrippySkinResult {
  style: TrippyStyleName | null;
  intensity: number | null;
  scroll: number | null;
  phase: number | null;
  targets: TrippySkinTargets | null;
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
  /** Metadata/identity key derived from the VPK's addon folder. Bare filename
   *  for the base addons folder + .disabled; `addons{N}/<file>` for overflow
   *  folders. Mirrors the backend field so the IPC Mod stays in sync. */
  metaKey: string;
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

export interface UnknownModDetectionProgress {
  modId: string;
  requestId?: string;
  phase: 'fingerprinting' | 'cache-hit' | 'searching' | 'fetching-files' | 'indexing' | 'found' | 'caching-remaining' | 'complete' | 'cancelled' | 'error';
  message: string;
  checkedFiles?: number;
  totalFiles?: number;
  indexedEntries?: number;
  bytesFetched?: number;
  currentFileName?: string;
  bucket?: {
    section: string;
    categoryId?: number;
    categoryName?: string;
    search?: string;
    label?: string;
  };
  result?: UnknownModFilterGuess;
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

// Manually link an unknown local VPK to a GameBanana mod the user found via
// search. Unlike ApplyUnknownModMatchArgs, this tags the existing file in place
// (no re-download, no delete), so it costs zero GameBanana archive fetches.
export interface AssociateUnknownModArgs {
  gameBananaId: number;
  modName: string;
  gameBananaFileId?: number;
  thumbnailUrl?: string;
  nsfw?: boolean;
  categoryName?: string;
  sourceSection?: 'Mod' | 'Sound';
}

// Raw contents of an unknown VPK, surfaced so the user can eyeball what the mod
// touches before linking it. Pure local read: no network, no rate limiting.
export interface UnknownModFileList {
  paths: string[];
  fileCount: number;
}

export interface EditLocalModArgs {
  name: string;
  thumbnailDataUrl?: string;
  nsfw?: boolean;
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
  /** Hide GameBanana mods flagged as outdated in Browse. */
  hideOutdatedMods: boolean;
  /** Open Locker list-view hero cards expanded on first load. */
  lockerCardsExpandedByDefault: boolean;
  /** Installing a different file of an already-enabled mod disables the
   *  prior variant (not about updates). */
  autoDisableSiblingVariants: boolean;
  /** After a successful GameBanana download, immediately enable the installed
   *  VPKs instead of leaving them in the disabled library. Off by default. */
  autoEnableDownloads: boolean;
  /** Args written to Steam's localconfig.vdf for Deadlock just before launch. */
  steamLaunchOptions: string;
  /** Currently active profile. */
  activeProfileId: string | null;
  /** Ask for confirmation before "Update" overwrites a profile with the current
   *  mod set. On by default: Update sits next to Apply and overwriting is easy to
   *  trigger by accident, with no undo. Turn off to overwrite immediately. */
  confirmProfileUpdate: boolean;
  experimentalStats: boolean;
  experimentalCrosshair: boolean;
  /** Grimoire Social: Discover page + publish/account UI. */
  experimentalSocial: boolean;
  /** Auto-match unknown local VPKs against GameBanana (CRC-32 + filter
   *  search). Off by default while the matching path is reworked: the
   *  current implementation hits GameBanana rate limits hard on libraries
   *  with many unknown files. When off, the "Fix unknown" UI still opens
   *  but the search/find buttons and bulk auto-find are hidden, leaving
   *  only the manual "Make Custom Mod" path. */
  experimentalUnknownModMatching: boolean;
  /** First-run setup completed. */
  hasCompletedSetup: boolean;
  /** Mod pairs the user has dismissed in the Conflicts page. New entries use
   *  stable per-mod identities (GameBanana mod/file ids when available)
   *  joined sorted with `::`; older local-id pairs are still recognized. */
  ignoredConflicts: string[];
  /** When true, the conflict detector returns an empty list: every detected
   *  pair is hidden without persisting it to ignoredConflicts, so toggling
   *  back off restores the original conflict view. */
  ignoreConflictsByDefault: boolean;
  /** UI accent color (hex, e.g. "#f97316"). Used to theme buttons, links, and
   *  focus rings throughout the app. */
  accentColor: string;
  /** Hero render used as the active sidebar highlight background. */
  sidebarHeroHighlight?: string | null;
  /** Order used to render absolute dates (mod/file upload + update dates). */
  dateFormat: 'MM/DD/YYYY' | 'DD/MM/YYYY';
  /** Preferred UI language. Null uses the OS/browser language when available. */
  language?: string | null;
  /** UI zoom factor (webContents.setZoomFactor). Driven by Ctrl +/-/0 and
   *  persisted so hi-DPI laptops keep their preferred scale across launches.
   *  1 = 100%. */
  zoomFactor?: number;
  /** Opt-in Discord Rich Presence. When on, the main process shows what the
   *  user is doing in Grimoire on their Discord profile by talking to their
   *  local Discord client over an IPC socket. Off by default: it broadcasts
   *  activity outward (through Discord), so it stays a deliberate choice and
   *  never sends anything to a Grimoire server. */
  discordRpcEnabled: boolean;
  /** Contribute match salts to the community-run deadlock-api.com. Reads
   *  replay-server URLs from Steam's local HTTP cache and submits only the
   *  match id, cluster id, and download salts: no account id, no username,
   *  nothing identifying. Off by default (it sends data outward, so it stays
   *  a deliberate choice). */
  contributeMatchSalts: boolean;
  /** Deadworks custom-server browser: list + join community dedicated servers. */
  experimentalDeadworksServers?: boolean;
  /** Advanced override for the relay the server browser queries. No UI: defaults
   *  to the official Deadworks registry (api.deadworks.net) and can be repointed
   *  via settings.json at any deadworks-shaped relay (e.g. a future grimoire-relay). */
  deadworksRelayUrl?: string;
  /** OptimizationLock performance config: apply Sqooky's community fps preset
   *  onto gameinfo.gi from a Settings card. Applied-state lives in a sidecar
   *  file next to gameinfo.gi (main-process owned), not in settings, so a
   *  renderer settings save can never clobber it. */
  experimentalPerformanceConfig?: boolean;
  /** Editor binary used to open gameinfo.gi for hand edits. null = the OS
   *  default app; undefined = never chosen, so the picker is shown first.
   *  (.gi maps to text/plain, which often resolves to a word processor, so
   *  "default" alone makes a bad Edit File experience.) */
  externalEditorPath?: string | null;
}
