import type { GameBananaCategoryNode } from '../types/gamebanana';
import type { Mod } from '../types/mod';

export type HeroCategory = {
  id: number;
  name: string;
  iconUrl?: string;
};

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
  'The Doorman': 40,
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

export const MINA_ARCHIVE_DEFAULT =
  '/home/esoc/Downloads/sts_midnight_mina_v1_1(1)/extra clothing presets.7z';

export function heroAssetBaseName(name: string): string {
  return name.trim().replace(/\s+/g, '_');
}

export function getHeroRenderPath(name: string): string {
  return `/locker/heroes/${heroAssetBaseName(name)}_Render.png`;
}

export function getHeroNamePath(name: string): string {
  return `/locker/names/${heroAssetBaseName(name)}_name.png`;
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
      const isMetadataMina = mod.name?.startsWith('Midnight Mina —');
      if (!lower.endsWith('.vpk')) return false;
      if (lower.includes('textures')) return false;
      return (
        lower.startsWith('clothing_preset_') ||
        lower.includes('sts_midnight_mina_') ||
        isMetadataMina
      );
    })
    .map((mod) => {
      const rawName = mod.name?.trim();
      const cleanedName = rawName?.startsWith('Midnight Mina — ')
        ? rawName.replace('Midnight Mina — ', '')
        : rawName;
      const raw =
        cleanedName ||
        mod.fileName
          .replace(/^CLOTHING_PRESET_/i, '')
          .replace(/-pak\\d+_dir\\.vpk$/i, '')
          .replace(/_/g, ' ');
      return {
        fileName: mod.fileName,
        label: raw.trim(),
        enabled: mod.enabled,
      };
    })
    .sort((a, b) => a.label.localeCompare(b.label));
}

export function detectMinaTextures(mods: Mod[]) {
  return mods.filter((mod) => {
    const lower = mod.fileName.toLowerCase();
    if (!lower.endsWith('.vpk')) return false;
    if (!lower.includes('textures')) return false;
    if (lower.includes('mina') || lower.includes('midnight')) return true;
    return lower === 'textures-pak21_dir.vpk';
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

export function groupModsByCategory(mods: Mod[]) {
  const map = new Map<number, Mod[]>();
  const unassigned: Mod[] = [];

  for (const mod of mods) {
    if (!mod.categoryId) {
      unassigned.push(mod);
      continue;
    }
    if (!map.has(mod.categoryId)) {
      map.set(mod.categoryId, []);
    }
    map.get(mod.categoryId)?.push(mod);
  }

  return { map, unassigned };
}
