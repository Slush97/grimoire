import type { CSSProperties } from 'react';
import type { GameBananaCategoryNode } from '../types/gamebanana';
import type { GlobalModType, Mod } from '../types/mod';
import { getAssetPath } from './assetPath';
import {
  HERO_NAMES as SHARED_HERO_NAMES,
  HERO_ALIASES as SHARED_HERO_ALIASES,
  inferHeroFromTitle as sharedInferHeroFromTitle,
} from '@grimoire/social-types/heroes';

export type HeroCategory = {
  id: number;
  name: string;
  iconUrl?: string;
};

export const FAVORITE_HEROES_KEY = 'lockerFavorites';

/**
 * Synchronous loader for the persisted favorites list. Used as the lazy
 * initializer for `useState` in both Locker and LockerHero so the value is
 * present on the very first render. Doing the load inside a useEffect would
 * race against the matching save effect under React StrictMode: the save's
 * closure captures the empty initial state, writes "[]" back to localStorage,
 * and StrictMode's replayed load then reads the clobbered empty value and
 * wins, silently dropping the user's saved favorites.
 */
export function readStoredFavorites(): number[] {
  try {
    const stored = localStorage.getItem(FAVORITE_HEROES_KEY);
    if (!stored) return [];
    const parsed = JSON.parse(stored);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((id): id is number => typeof id === 'number');
  } catch {
    return [];
  }
}

/**
 * Per-hero portrait positioning for hero-render backdrops, based on where the
 * face sits in the image.
 *
 * x is the object-position crop percent shared by the gallery-style surfaces
 * (Locker, Browse, Installed), each of which pairs it with its own hardcoded
 * y. y and shiftX are SIDEBAR-ONLY, calibrated against the sidebar active card
 * via tools/hero-position-calibrator.html: the sidebar card is so wide that
 * object-cover leaves no horizontal slack (x does nothing there), so shiftX
 * slides the whole image by a percentage of the card width (negative = left,
 * positive = right) and may deliberately push the art past the edge, leaving
 * blank card background. Default is { x: 55, y: 18 } with no shift.
 */
export type HeroFacePosition = { x: number; y: number; shiftX?: number };

export const HERO_FACE_POSITION: Record<string, HeroFacePosition> = {
  Abrams: { x: 0, y: 12, shiftX: 24 },
  Apollo: { x: 55, y: 12, shiftX: 16 },
  Bebop: { x: 81, y: 1.5, shiftX: 5 },
  Billy: { x: 73, y: 18, shiftX: 6.5 },
  Calico: { x: 80, y: 19, shiftX: 11.5 },
  Celeste: { x: 55, y: 9.5, shiftX: 16.5 },
  Doorman: { x: 40, y: 19, shiftX: 35.5 },
  Drifter: { x: 93, y: 18, shiftX: 20.5 },
  Dynamo: { x: 68, y: 13.5, shiftX: 19.5 },
  Graves: { x: 55, y: 21.5, shiftX: 26 },
  'Grey Talon': { x: 77, y: 12, shiftX: 20 },
  Haze: { x: 50, y: 9, shiftX: 22 },
  Holliday: { x: 26, y: 17, shiftX: 29 },
  Infernus: { x: 100, y: 8.5, shiftX: 5.5 },
  Ivy: { x: 72, y: 24, shiftX: 9.5 },
  Kelvin: { x: 47, y: 16, shiftX: 16.5 },
  'Lady Geist': { x: 87, y: 14.5, shiftX: 15.5 },
  Lash: { x: 54, y: 10.5, shiftX: 21.5 },
  McGinnis: { x: 22, y: 17, shiftX: 35 },
  Mina: { x: 54, y: 16.5, shiftX: 14 },
  Mirage: { x: 65, y: 16.5, shiftX: 23.5 },
  'Mo & Krill': { x: 100, y: 25.5, shiftX: 3.5 },
  Paige: { x: 42, y: 18, shiftX: 31.5 },
  Paradox: { x: 59, y: 18, shiftX: 3.5 },
  Pocket: { x: 61, y: 12.5, shiftX: 10.5 },
  Rem: { x: 55, y: 25, shiftX: 29 },
  Seven: { x: 57, y: 12.5, shiftX: 18.5 },
  Shiv: { x: 68, y: 7.5, shiftX: 0.5 },
  Silver: { x: 55, y: 21, shiftX: 21.5 },
  Sinclair: { x: 61, y: 12, shiftX: 17.5 },
  Venator: { x: 55, y: 10, shiftX: 1 },
  Victor: { x: 45, y: 9.5, shiftX: 28 },
  Vindicta: { x: 83, y: 3.5, shiftX: 8.5 },
  Viscous: { x: 72, y: 9, shiftX: 14.5 },
  Vyper: { x: 48, y: 22.5, shiftX: 22 },
  Warden: { x: 55, y: 15.5, shiftX: 24 },
  Wraith: { x: 56, y: 20, shiftX: 32.5 },
  Yamato: { x: 56, y: 11.5, shiftX: 29.5 },
};

const DEFAULT_FACE_POSITION: Required<HeroFacePosition> = { x: 55, y: 18, shiftX: 0 };

export function getHeroFacePosition(name: string | null | undefined): Required<HeroFacePosition> {
  const position = name ? HERO_FACE_POSITION[name] : undefined;
  return position ? { shiftX: 0, ...position } : DEFAULT_FACE_POSITION;
}

/**
 * Inline style for the SIDEBAR active-card hero backdrop: the object-position
 * crop plus the shiftX horizontal slide (a margin so it stays a percentage of
 * the card width). It can push the image past the card edge on purpose,
 * leaving blank card background. Other surfaces intentionally do not use this:
 * they pair the x crop percent with their own hardcoded y.
 */
export function getSidebarHeroImageStyle(name: string | null | undefined): CSSProperties {
  const { x, y, shiftX } = getHeroFacePosition(name);
  const style: CSSProperties = { objectPosition: `${x}% ${y}%` };
  if (shiftX) style.marginLeft = `${shiftX}%`;
  return style;
}

/**
 * Known hero names — drives fuzzy matching for sound/voice mods whose titles
 * tend to mention a hero (e.g. "Drifter ult replacement", "Pocket - VO").
 *
 * Sourced from @grimoire/social-types/heroes so the Worker and client share
 * one roster; adding a new Deadlock hero only requires updating that file.
 * Re-exported here so existing callers (`import { HERO_NAMES } from
 * './lockerUtils'`) keep working.
 */
export const HERO_NAMES = SHARED_HERO_NAMES;
export const HERO_ALIASES = SHARED_HERO_ALIASES;

/**
 * Display-name aliases that collapse roster duplicates to one canonical label.
 * The shared roster carries both "Doorman" (GameBanana's category name, the one
 * wired into every client-side map: face position, stats id, sound codename)
 * and "The Doorman" (the deadlock-api roster name, appended later with the
 * "Old Gods, New Blood" batch). They are the same hero, so the tag menu shows a
 * single "Doorman". Kept client-side only: the shared roster and server-side
 * inference are untouched.
 */
const HERO_DISPLAY_ALIASES: Readonly<Record<string, string>> = {
  'The Doorman': 'Doorman',
};

/** Canonical display name for a hero, collapsing roster duplicates (see above). */
export function canonicalHeroName(name: string | undefined | null): string {
  if (!name) return '';
  return HERO_DISPLAY_ALIASES[name] ?? name;
}

/**
 * The hero roster for tag-menu display: canonicalized (duplicates collapsed),
 * de-duplicated, and alphabetized. The Locker tag menu sorts its own roster
 * (built from GameBanana categories), so the Installed menu uses this to match.
 */
export const HERO_NAMES_SORTED: readonly string[] = Array.from(
  new Set(SHARED_HERO_NAMES.map(canonicalHeroName))
).sort((a, b) => a.localeCompare(b));

export const DEFAULT_SIDEBAR_HERO = HERO_NAMES_SORTED[0] ?? 'Abrams';

/**
 * Infer the Deadlock hero associated with a mod title. Re-exported from the
 * shared package; see @grimoire/social-types/heroes for the matcher details.
 */
export const inferHeroFromTitle = sharedInferHeroFromTitle;

export type LockerSkin = {
  key: string;
  primary: Mod;
  variants: Mod[];
  enabledVariants: Mod[];
};

export function heroAssetBaseName(name: string): string {
  return name.trim().replace(/\s+/g, '_');
}

export function heroIconAssetName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

export function getHeroRenderPath(name: string): string {
  return getAssetPath(`/locker/heroes/${heroAssetBaseName(name)}_Render.png`);
}

export function getHeroNamePath(name: string): string {
  return getAssetPath(`/locker/names/${heroAssetBaseName(name)}_name.png`);
}

export function getHeroChipIconPath(name: string): string {
  return getAssetPath(`/heroes/chip-icons/${heroIconAssetName(name)}.png`);
}

export function getHeroWikiUrl(name: string): string {
  return `https://deadlock.wiki/File:${heroAssetBaseName(name)}_Render.png`;
}

export function findCategoryByName(
  nodes: GameBananaCategoryNode[],
  name: string
): GameBananaCategoryNode | null {
  for (const node of nodes) {
    if (node.name.toLowerCase() === name.toLowerCase()) {
      return node;
    }
    if (node.children) {
      const match = findCategoryByName(node.children, name);
      if (match) return match;
    }
  }
  return null;
}

export function buildHeroList(categories: GameBananaCategoryNode[]): HeroCategory[] {
  const skins = findCategoryByName(categories, 'Skins');
  if (!skins?.children) return [];
  return skins.children.map((child) => ({
    id: child.id,
    name: child.name,
    iconUrl: child.iconUrl,
  }));
}

export function isLockerManagedMod(mod: Mod): boolean {
  // The Locker cosmetics VPK (applied hero cards) and the Locker sound VPK
  // (applied per-ability sounds) are managed artifacts, never hero skin cards
  // in their own right.
  if (mod.lockerCosmetics) return false;
  if (mod.lockerSounds) return false;

  // Sound-section mods are the Sounds tab's domain (see isLockerManagedSound),
  // never hero skins. They get an auto hero-tag at download time, so guard on
  // the section explicitly before the lockerHero escape hatch below — otherwise
  // a hero-tagged sound (e.g. a "Seven Ult Sound Replacer") falls through that
  // hatch and surfaces in the Skins pile.
  if (mod.sourceSection === 'Sound') return false;

  // A manual Locker hero tag is an explicit user intent to manage this VPK as
  // a hero skin, including custom local imports that do not have GameBanana
  // section metadata.
  if (mod.sourceSection !== 'Mod' && !mod.lockerHero) return false;

  const lower = mod.fileName.toLowerCase();
  // Leftover preset VPKs from the removed Midnight Mina variants feature
  // (pre-rework sts_midnight_mina). Not hero skin cards.
  if (lower.startsWith('clothing_preset_')) return false;
  if (lower.includes('sts_midnight_mina_') && !lower.includes('textures')) return false;

  return true;
}

/**
 * GameBanana Sound subcategories that aren't per-hero. Killsounds and music
 * stingers play across the whole match, announcer/UI sounds are global UX.
 * These belong on Installed but would just sit in the Locker's "Unassigned"
 * bucket forever (no hero to tag), so we drop them at the eligibility check
 * instead. Lowercased for case-insensitive compare.
 */
const GLOBAL_SOUND_CATEGORIES: ReadonlySet<string> = new Set([
  'killsounds',
  'in-game music',
  'music',
  'announcer',
  'ui',
  'ui sounds',
  'misc',
]);

/**
 * Sound-section equivalent of isLockerManagedMod. Drops Sound mods whose
 * GameBanana category is one of the global (non-hero) buckets — see
 * GLOBAL_SOUND_CATEGORIES. Hero-specific subcategories (Abilities, VOs,
 * etc.) flow through.
 */
export function isLockerManagedSound(mod: Mod): boolean {
  if (mod.sourceSection !== 'Sound') return false;
  // An explicit hero tag (auto-set from the title at download, or set by hand)
  // means this sound is hero-specific and belongs in that hero's Sounds tab,
  // even when GameBanana filed it under a global music/UI category. The
  // GLOBAL_SOUND_CATEGORIES drop exists only for sounds with no hero to tag;
  // without this short-circuit, a "Seven Ult Sound Replacer" categorized as
  // "In-Game Music" gets dropped here and then mis-surfaces under Skins.
  if (mod.lockerHero) return true;
  const category = mod.categoryName?.trim().toLowerCase();
  if (category && GLOBAL_SOUND_CATEGORIES.has(category)) return false;
  return true;
}

/**
 * Lowercased GameBanana category name for the Killstreak Music sound category
 * (cat 5895 — see docs/gamebanana_categories_reference.md).
 */
const KILLSTREAK_MUSIC_CATEGORY = 'killstreak music';

/**
 * True for Sound mods filed under GameBanana's "Killstreak Music" category.
 * This music plays match-wide (no hero), so the Locker treats it as a global
 * type on the Global card rather than per-hero sounds. Used by
 * getEffectiveGlobalType; kept narrow (category only) on purpose.
 */
/** Minimal mod shape the global-type helpers read. Lets card components pass a
 *  structural subset of Mod (e.g. ModCardProps['mod']) without the full type. */
type GlobalTypeModFields = Pick<Mod, 'globalType' | 'lockerHero' | 'sourceSection' | 'categoryName'>;

export function isKillstreakMusicSound(mod: GlobalTypeModFields): boolean {
  return (
    mod.sourceSection === 'Sound' &&
    mod.categoryName?.trim().toLowerCase() === KILLSTREAK_MUSIC_CATEGORY
  );
}

/** Lowercased GameBanana "Announcer" sound category name. */
const ANNOUNCER_CATEGORY = 'announcer';

/**
 * True for Sound mods filed under GameBanana's "Announcer" category. These play
 * match-wide with no hero, so the Locker surfaces them on the Global card's
 * Announcer / SFX slide rather than dropping them (GLOBAL_SOUND_CATEGORIES) or
 * mis-filing them under a hero. Path-classifiable announcer frameworks (QOL
 * Lock, `sounds/mods/`) already carry a 'announcer' globalType from the
 * main-process classifier; this rescues the sound-only packs that don't.
 */
export function isAnnouncerSound(mod: GlobalTypeModFields): boolean {
  return (
    mod.sourceSection === 'Sound' &&
    mod.categoryName?.trim().toLowerCase() === ANNOUNCER_CATEGORY
  );
}

/**
 * A mod's effective Locker global type. Prefers the persisted globalType (the
 * VPK-path classification, or a manual override set via the Global card's
 * retag menu), then derives 'killstreak-music' from the GameBanana category.
 *
 * Killstreak music can't be path-classified (a Sound VPK is just `sounds/`),
 * so it's derived here instead of in the main-process classifier. Deriving it
 * live also means it lights up for mods that were already installed before the
 * category existed, with no metadata migration. A manual override still wins,
 * since `mod.globalType` is checked first.
 */
export function getEffectiveGlobalType(mod: GlobalTypeModFields): GlobalModType | undefined {
  if (mod.globalType) return mod.globalType;
  if (isKillstreakMusicSound(mod)) return 'killstreak-music';
  // A hero tag wins: hero-tied SFX belong on that hero's Sounds tab, not here.
  if (!mod.lockerHero && isAnnouncerSound(mod)) return 'announcer';
  return undefined;
}

export function getLockerSkinKey(mod: Mod): string {
  return typeof mod.gameBananaId === 'number' && mod.gameBananaId > 0
    ? `gamebanana:${mod.gameBananaId}`
    : `mod:${mod.id}`;
}

/**
 * Global load-order rank of a mod: lower = higher priority (loads as pak01,
 * wins file conflicts). With overflow folders the pakNN (mod.priority) repeats
 * per folder, so we fold in the folder index from metaKey (addons{N}/...) to
 * get a single monotonic order. Base citadel/addons (and disabled) is folder 0,
 * addons1 is 1, etc. Mirrors the formula used by the Installed page so reorder
 * math stays consistent across both surfaces.
 */
export function modLoadOrder(mod: Mod): number {
  const match = mod.metaKey.match(/^addons(\d+)\//);
  const folderIndex = match ? parseInt(match[1], 10) : 0;
  return folderIndex * 100 + mod.priority;
}

/**
 * The "active" skin for a hero: the highest-priority enabled mod (lowest load
 * order, i.e. the one that wins file conflicts). Used to decide which skin's
 * chosen Locker image represents the hero on its card / detail backdrop
 * (issue #208). Returns undefined when nothing is enabled.
 */
export function activeLockerSkin(mods: Mod[]): Mod | undefined {
  return mods
    .filter((m) => m.enabled)
    .sort((a, b) => modLoadOrder(a) - modLoadOrder(b))[0];
}

export function groupLockerSkins(mods: Mod[]): LockerSkin[] {
  const bySkin = new Map<string, Mod[]>();
  for (const mod of mods) {
    const key = getLockerSkinKey(mod);
    const variants = bySkin.get(key) ?? [];
    variants.push(mod);
    bySkin.set(key, variants);
  }

  return Array.from(bySkin.entries())
    .map(([key, variants]) => {
      const sortedVariants = [...variants].sort((a, b) => a.priority - b.priority);
      const enabledVariants = sortedVariants.filter((variant) => variant.enabled);
      return {
        key,
        primary: enabledVariants[0] ?? sortedVariants[0],
        variants: sortedVariants,
        enabledVariants,
      };
    })
    .sort((a, b) => a.primary.priority - b.primary.priority);
}

export function countLockerSkins(mods: Mod[]): number {
  return groupLockerSkins(mods).length;
}

/**
 * Display labels for the global (non-hero) cosmetic types. The "Icons &
 * Portraits" merge is deliberate: icon packs and "portrait" packs write the
 * same panorama/images/heroes files, so they're one category (see
 * classifyGlobalModType).
 */
export const GLOBAL_MOD_TYPE_LABELS: Record<GlobalModType, string> = {
  'soul-container': 'Soul Containers',
  hideout: 'Hideout',
  icons: 'Icon Packs',
  hud: 'HUD',
  announcer: 'Announcer / SFX',
  'killstreak-music': 'Killstreak Music',
};

/** Carousel/section order for the global types. */
export const GLOBAL_MOD_TYPE_ORDER: readonly GlobalModType[] = [
  'soul-container',
  'hideout',
  'icons',
  'hud',
  'announcer',
  'killstreak-music',
];

export type GlobalModGroups = Record<GlobalModType, Mod[]>;

/**
 * Bucket mods by their classified global type. Mods with no globalType (hero
 * cosmetics and anything that matched no signal) are simply omitted.
 *
 * Soul containers are single-select and shown with a live 3D preview, so their
 * bucket is sorted by name (stable, enabled-independent): toggling never
 * reshuffles the grid, and the active one is marked in place rather than jumped
 * to the top. Every other type keeps the enabled-first ordering (active mods
 * grouped at the top), since they allow multiple enabled at once.
 */
export function groupGlobalMods(mods: Mod[]): GlobalModGroups {
  const groups: GlobalModGroups = {
    'soul-container': [],
    hideout: [],
    icons: [],
    hud: [],
    announcer: [],
    'killstreak-music': [],
  };
  for (const mod of mods) {
    const type = getEffectiveGlobalType(mod);
    if (type && groups[type]) {
      groups[type].push(mod);
    }
  }
  for (const type of GLOBAL_MOD_TYPE_ORDER) {
    if (type === 'soul-container') {
      groups[type].sort((a, b) => a.name.localeCompare(b.name) || a.priority - b.priority);
    } else {
      groups[type].sort((a, b) => {
        if (a.enabled !== b.enabled) return a.enabled ? -1 : 1;
        return a.priority - b.priority;
      });
    }
  }
  return groups;
}

/** Total number of mods classified into any global type. */
export function countGlobalMods(mods: Mod[]): number {
  return mods.reduce((n, mod) => (getEffectiveGlobalType(mod) ? n + 1 : n), 0);
}

export function groupModsByCategory(mods: Mod[], heroList?: { id: number; name: string }[]) {
  const map = new Map<number, Mod[]>();
  const unassigned: Mod[] = [];

  // Build a lookup for hero names to IDs
  const heroNameToId = new Map<string, number>();
  if (heroList) {
    for (const hero of heroList) {
      heroNameToId.set(hero.name.toLowerCase(), hero.id);
    }
  }

  for (const mod of mods) {
    let categoryId: number | undefined;

    // 1. Manual override wins. Users tag a mod when GameBanana left it under
    //    the generic "Skins" parent or when the title doesn't mention the hero.
    if (mod.lockerHero) {
      categoryId = heroNameToId.get(mod.lockerHero.toLowerCase());
    }

    // 2. Author-supplied categoryId is the next best signal, but skip it when
    //    the category is "Skins" itself (the generic parent), since that
    //    points at a virtual node, not a hero.
    if (!categoryId && mod.categoryId && mod.categoryName?.toLowerCase() !== 'skins') {
      categoryId = mod.categoryId;
    }

    // 3. Fall back to fuzzy match on the mod's display name. Same logic the
    //    "Skins"-parent branch used to do; broadened to also fire when there's
    //    no categoryId at all (sound mods, custom imports).
    if (!categoryId) {
      const nameLower = mod.name?.toLowerCase() || '';
      for (const [heroName, heroId] of heroNameToId) {
        if (nameLower.includes(heroName)) {
          categoryId = heroId;
          break;
        }
      }
    }

    if (!categoryId) {
      unassigned.push(mod);
      continue;
    }
    if (!map.has(categoryId)) {
      map.set(categoryId, []);
    }
    map.get(categoryId)?.push(mod);
  }

  return { map, unassigned };
}
