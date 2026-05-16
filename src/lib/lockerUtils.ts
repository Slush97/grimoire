import type { GameBananaCategoryNode } from '../types/gamebanana';
import type { Mod } from '../types/mod';
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
 * Per-hero portrait X positioning (percentage) for gallery cards based on face location.
 * The value represents where the face is located horizontally in the image.
 * Default is 55% which works for most heroes.
 */
export const HERO_FACE_POSITION: Record<string, number> = {
  Abrams: 0,
  Bebop: 81,
  Billy: 73,
  Calico: 80,
  Doorman: 40,
  Drifter: 93,
  Dynamo: 68,
  'Grey Talon': 77,
  Haze: 78,
  Holliday: 26,
  Infernus: 100,
  Ivy: 72,
  Kelvin: 47,
  'Lady Geist': 87,
  Lash: 54,
  McGinnis: 22,
  Mina: 54,
  Mirage: 65,
  'Mo & Krill': 100,
  Paige: 42,
  Paradox: 59,
  Pocket: 61,
  Seven: 57,
  Shiv: 68,
  Sinclair: 61,
  Victor: 45,
  Vindicta: 83,
  Viscous: 72,
  Vyper: 48,
  Warden: 55,
  Wraith: 56,
  Yamato: 56,
};

export function getHeroFacePosition(name: string): number {
  return HERO_FACE_POSITION[name] ?? 55;
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
 * Infer the Deadlock hero associated with a mod title. Re-exported from the
 * shared package; see @grimoire/social-types/heroes for the matcher details.
 */
export const inferHeroFromTitle = sharedInferHeroFromTitle;

export type MinaPreset = {
  fileName: string;
  label: string;
  enabled: boolean;
};

export type MinaVariant = {
  archiveEntry: string;
  label: string;
  futa: 'No' | 'Yes';
  top: 'None' | 'Sleeveless' | 'Default';
  skirt: 'None' | 'Default';
  stockings: 'None' | 'Default';
  beltSash: 'None' | 'Default';
  gloves: 'None' | 'Default';
  garter: 'None' | 'Default';
  dress: 'None' | 'Default';
};

export type MinaSelection = Omit<MinaVariant, 'archiveEntry' | 'label'>;

export const MINA_ARCHIVE_DEFAULT = '';

export type LockerSkin = {
  key: string;
  primary: Mod;
  variants: Mod[];
  enabledVariants: Mod[];
};

export function heroAssetBaseName(name: string): string {
  return name.trim().replace(/\s+/g, '_');
}

export function getHeroRenderPath(name: string): string {
  return getAssetPath(`/locker/heroes/${heroAssetBaseName(name)}_Render.png`);
}

export function getHeroNamePath(name: string): string {
  return getAssetPath(`/locker/names/${heroAssetBaseName(name)}_name.png`);
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

export function buildMinaPresets(mods: Mod[]): MinaPreset[] {
  return mods
    .filter((mod) => {
      const lower = mod.fileName.toLowerCase();
      const nameLower = mod.name?.toLowerCase() || '';
      // Check metadata name for Midnight Mina (handles '"Midnight" Mina' format)
      const isMetadataMina = nameLower.includes('midnight') && nameLower.includes('mina');
      if (!lower.endsWith('.vpk')) return false;
      // Exclude textures VPKs from presets list
      if (lower.includes('textures') || nameLower.includes('textures')) return false;
      return (
        lower.startsWith('clothing_preset_') ||
        lower.includes('sts_midnight_mina_') ||
        isMetadataMina
      );
    })
    .map((mod) => {
      const rawName = mod.name?.trim();
      const cleanedName = (rawName?.toLowerCase().includes('midnight') && rawName?.toLowerCase().includes('mina'))
        ? rawName.replace(/midnight mina[^a-z]*/i, '').trim()
        : rawName;
      const raw =
        cleanedName ||
        mod.fileName
          .replace(/^CLOTHING_PRESET_/i, '')
          .replace(/-pak\\d+_dir\\.vpk$/i, '')
          .replace(/_/g, ' ');
      return {
        fileName: mod.fileName,
        label: raw.trim() || 'Default Preset',
        enabled: mod.enabled,
      };
    })
    .sort((a, b) => a.label.localeCompare(b.label));
}

export function detectMinaTextures(mods: Mod[]) {
  return mods.filter((mod) => {
    const lower = mod.fileName.toLowerCase();
    const nameLower = mod.name?.toLowerCase() || '';
    if (!lower.endsWith('.vpk')) return false;
    // Check if it's a textures file via filename or has Midnight Mina in metadata
    const hasTexturesInName = lower.includes('textures');
    // Check for Midnight Mina in name (handles variations like '"Midnight" Mina')
    const isMidnightMina = nameLower.includes('midnight') && nameLower.includes('mina');
    // If it's Midnight Mina and NOT a preset (no clothing_preset), it's the textures
    if (isMidnightMina && !lower.startsWith('clothing_preset_')) {
      return true;
    }
    if (hasTexturesInName && (lower.includes('mina') || lower.includes('midnight'))) {
      return true;
    }
    return lower === 'textures-pak21_dir.vpk';
  });
}

export function isLockerManagedMod(mod: Mod): boolean {
  if (mod.sourceSection !== 'Mod') return false;

  const lower = mod.fileName.toLowerCase();
  // Internal Midnight Mina preset files are managed by the custom variants UI,
  // not counted as normal hero skins in the Locker.
  if (lower.startsWith('clothing_preset_')) return false;
  if (lower.includes('sts_midnight_mina_') && !lower.includes('textures')) return false;

  return true;
}

export function getLockerSkinKey(mod: Mod): string {
  return typeof mod.gameBananaId === 'number' && mod.gameBananaId > 0
    ? `gamebanana:${mod.gameBananaId}`
    : `mod:${mod.id}`;
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
 * Check if any Midnight Mina mod is currently enabled
 */
export function hasActiveMinaMod(mods: Mod[]): boolean {
  return mods.some((mod) => {
    if (!mod.enabled) return false;
    const lower = mod.fileName.toLowerCase();
    const nameLower = mod.name?.toLowerCase() || '';
    return (
      nameLower.includes('midnight mina') ||
      lower.includes('midnight_mina') ||
      lower.startsWith('clothing_preset_') ||
      lower.includes('sts_midnight_mina')
    );
  });
}

export function parseMinaVariant(entry: string): MinaVariant | null {
  if (!entry.toLowerCase().endsWith('.vpk')) return null;
  const fileName = entry.split('/').pop() || entry;
  const lowerEntry = entry.toLowerCase();
  if (!fileName.toLowerCase().includes('sts_midnight_mina')) return null;

  const futa: MinaVariant['futa'] = lowerEntry.includes('non-futa')
    ? 'No'
    : lowerEntry.includes('_futa_') || lowerEntry.includes('/futa_') || lowerEntry.includes('/futa/')
      ? 'Yes'
      : 'No';

  const topMatch = lowerEntry.match(/_top_(with_sleeves|sleeveless|no)(?:_|-)/);
  const top: MinaVariant['top'] =
    topMatch?.[1] === 'with_sleeves'
      ? 'Default'
      : topMatch?.[1] === 'sleeveless'
        ? 'Sleeveless'
        : 'None';

  const skirtMatch = lowerEntry.match(/_skirt_(yes|no)(?:_|-)/);
  const skirt: MinaVariant['skirt'] = skirtMatch?.[1] === 'yes' ? 'Default' : 'None';

  const stockings: MinaVariant['stockings'] = lowerEntry.includes('stockings_and_boots')
    ? 'Default'
    : 'None';

  const beltMatch = lowerEntry.match(/_belt_sash_(yes|no)(?:_|-)/);
  const beltSash: MinaVariant['beltSash'] = beltMatch?.[1] === 'yes' ? 'Default' : 'None';

  const dressMatch = lowerEntry.match(/_dress_(yes|no)(?:_|-)/);
  const dress: MinaVariant['dress'] = dressMatch?.[1] === 'yes' ? 'Default' : 'None';

  const garterMatch = lowerEntry.match(/_garter_(yes|no)(?:_|-)/);
  const garter: MinaVariant['garter'] = garterMatch?.[1] === 'yes' ? 'Default' : 'None';

  const gloves: MinaVariant['gloves'] = lowerEntry.includes('hands_bare')
    ? 'None'
    : lowerEntry.includes('gloves')
      ? 'Default'
      : 'None';

  const label = [
    futa === 'Yes' ? 'Futa' : 'Non-Futa',
    `Top: ${top}`,
    `Skirt: ${skirt}`,
    `Stockings: ${stockings}`,
    `Belt: ${beltSash}`,
    `Gloves: ${gloves}`,
    `Garter: ${garter}`,
    `Dress: ${dress}`,
  ].join(' • ');

  return {
    archiveEntry: entry,
    label,
    futa,
    top,
    skirt,
    stockings,
    beltSash,
    gloves,
    garter,
    dress,
  };
}

export function findMinaVariant(
  variants: MinaVariant[],
  selection: MinaSelection
): MinaVariant | undefined {
  return variants.find(
    (variant) =>
      variant.futa === selection.futa &&
      variant.top === selection.top &&
      variant.skirt === selection.skirt &&
      variant.stockings === selection.stockings &&
      variant.beltSash === selection.beltSash &&
      variant.gloves === selection.gloves &&
      variant.garter === selection.garter &&
      variant.dress === selection.dress
  );
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
    let categoryId = mod.categoryId;

    // If mod has a generic category (like "Skins" parent), try to infer from mod name
    if (!categoryId || mod.categoryName?.toLowerCase() === 'skins') {
      const nameLower = mod.name?.toLowerCase() || '';
      // Check for hero names in the mod name
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
