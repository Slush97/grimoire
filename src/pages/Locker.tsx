import { useEffect, useMemo, useState } from 'react';
import { Layers, Loader2, Star } from 'lucide-react';
import { useAppStore } from '../stores/appStore';
import {
  applyMinaVariant,
  getGamebananaCategories,
  listMinaVariants,
  setMinaPreset,
} from '../lib/api';
import { getActiveDeadlockPath } from '../lib/appSettings';
import type { GameBananaCategoryNode } from '../types/gamebanana';
import type { Mod } from '../types/mod';

type HeroCategory = {
  id: number;
  name: string;
  iconUrl?: string;
};

type MinaPreset = {
  fileName: string;
  label: string;
  enabled: boolean;
};

type MinaVariant = {
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

type MinaSelection = Omit<MinaVariant, 'archiveEntry' | 'label'>;

const MINA_ARCHIVE_DEFAULT =
  '/home/esoc/Downloads/sts_midnight_mina_v1_1(1)/extra clothing presets.7z';

function slugifyHeroName(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function getHeroWikiUrl(name: string): string {
  const fileName = name.trim().replace(/\s+/g, '_');
  return `https://deadlock.wiki/File:${fileName}_Render.png`;
}

function findCategoryByName(
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

function buildHeroList(categories: GameBananaCategoryNode[]): HeroCategory[] {
  const skins = findCategoryByName(categories, 'Skins');
  if (!skins?.children) return [];
  return skins.children.map((child) => ({
    id: child.id,
    name: child.name,
    iconUrl: child.iconUrl,
  }));
}

function buildMinaPresets(mods: Mod[]): MinaPreset[] {
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

function detectMinaTextures(mods: Mod[]) {
  return mods.filter((mod) => {
    const lower = mod.fileName.toLowerCase();
    if (!lower.endsWith('.vpk')) return false;
    if (!lower.includes('textures')) return false;
    if (lower.includes('mina') || lower.includes('midnight')) return true;
    return lower === 'textures-pak21_dir.vpk';
  });
}

function parseMinaVariant(entry: string): MinaVariant | null {
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

function findMinaVariant(variants: MinaVariant[], selection: MinaSelection): MinaVariant | undefined {
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

function groupModsByCategory(mods: Mod[]) {
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

export default function Locker() {
  const { settings, mods, modsLoading, modsError, loadSettings, loadMods, toggleMod } =
    useAppStore();
  const activeDeadlockPath = getActiveDeadlockPath(settings);
  const [categories, setCategories] = useState<GameBananaCategoryNode[]>([]);
  const [categoriesLoading, setCategoriesLoading] = useState(false);
  const [categoriesError, setCategoriesError] = useState<string | null>(null);
  const [favoriteHeroes, setFavoriteHeroes] = useState<number[]>([]);
  const [minaArchivePath, setMinaArchivePath] = useState(() => {
    return localStorage.getItem('minaArchivePath') || MINA_ARCHIVE_DEFAULT;
  });
  const [minaVariants, setMinaVariants] = useState<MinaVariant[]>([]);
  const [minaVariantsLoading, setMinaVariantsLoading] = useState(false);
  const [minaVariantsError, setMinaVariantsError] = useState<string | null>(null);
  const [minaSelection, setMinaSelection] = useState<MinaSelection>({
    futa: 'No',
    top: 'Default',
    skirt: 'Default',
    stockings: 'Default',
    beltSash: 'Default',
    gloves: 'Default',
    garter: 'Default',
    dress: 'Default',
  });

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  useEffect(() => {
    if (activeDeadlockPath) {
      loadMods();
    }
  }, [activeDeadlockPath, loadMods]);

  useEffect(() => {
    let active = true;
    const loadCategories = async () => {
      setCategoriesLoading(true);
      setCategoriesError(null);
      try {
        const data = await getGamebananaCategories('ModCategory');
        if (!active) return;
        setCategories(data);
      } catch (err) {
        if (active) {
          setCategoriesError(String(err));
        }
      } finally {
        if (active) {
          setCategoriesLoading(false);
        }
      }
    };

    loadCategories();

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const stored = localStorage.getItem('lockerFavorites');
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) {
          setFavoriteHeroes(parsed.filter((id) => typeof id === 'number'));
        }
      } catch {
        setFavoriteHeroes([]);
      }
    }
  }, []);

  useEffect(() => {
    localStorage.setItem('lockerFavorites', JSON.stringify(favoriteHeroes));
  }, [favoriteHeroes]);

  useEffect(() => {
    localStorage.setItem('minaArchivePath', minaArchivePath);
  }, [minaArchivePath]);

  const heroList = useMemo(() => {
    const list = buildHeroList(categories);
    return list.sort((a, b) => {
      const aFav = favoriteHeroes.includes(a.id);
      const bFav = favoriteHeroes.includes(b.id);
      if (aFav !== bFav) return aFav ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  }, [categories, favoriteHeroes]);
  const heroMods = useMemo(() => {
    const modSkins = mods.filter((mod) => {
      if (mod.sourceSection !== 'Mod') return false;
      const lower = mod.fileName.toLowerCase();
      if (lower.startsWith('clothing_preset_')) return false;
      if (
        lower.includes('textures') &&
        (lower.includes('mina') || lower.includes('midnight') || lower === 'textures-pak21_dir.vpk')
      ) {
        return false;
      }
      return true;
    });
    return groupModsByCategory(modSkins);
  }, [mods]);

  const minaPresets = useMemo(() => buildMinaPresets(mods), [mods]);
  const minaTextures = useMemo(() => detectMinaTextures(mods), [mods]);
  const activeMinaPreset = minaPresets.find((preset) => preset.enabled);
  const selectedMinaVariant = useMemo(
    () => findMinaVariant(minaVariants, minaSelection),
    [minaVariants, minaSelection]
  );

  const setActiveSkin = async (heroId: number, modId: string) => {
    const list = heroMods.map.get(heroId) ?? [];
    const actions: Promise<void>[] = [];
    for (const mod of list) {
      if (mod.id === modId) {
        if (!mod.enabled) actions.push(toggleMod(mod.id));
      } else if (mod.enabled) {
        actions.push(toggleMod(mod.id));
      }
    }
    await Promise.all(actions);
  };

  const applyMinaPreset = async (presetFileName: string) => {
    try {
      await setMinaPreset(presetFileName);
      await loadMods();
    } catch (err) {
      setCategoriesError(String(err));
    }
  };

  const loadMinaVariants = async () => {
    if (!minaArchivePath.trim()) return;
    setMinaVariantsLoading(true);
    setMinaVariantsError(null);
    try {
      const entries = await listMinaVariants(minaArchivePath.trim());
      const variants = entries
        .map((entry) => parseMinaVariant(entry))
        .filter((variant): variant is MinaVariant => Boolean(variant));
      setMinaVariants(variants);
    } catch (err) {
      setMinaVariantsError(String(err));
    } finally {
      setMinaVariantsLoading(false);
    }
  };

  const applyMinaVariantSelection = async () => {
    if (!selectedMinaVariant) return;
    try {
      await applyMinaVariant(
        minaArchivePath.trim(),
        selectedMinaVariant.archiveEntry,
        selectedMinaVariant.label,
        heroList.find((hero) => hero.name === 'Mina')?.id
      );
      await loadMods();
    } catch (err) {
      setMinaVariantsError(String(err));
    }
  };

  if (!activeDeadlockPath) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-text-secondary">
        <Layers className="w-16 h-16 mb-4 opacity-50" />
        <h2 className="text-xl font-semibold text-text-primary mb-2">No Game Path Set</h2>
        <p className="text-center max-w-md">
          Configure your Deadlock installation path or enable dev mode to manage hero skins.
        </p>
      </div>
    );
  }

  if (modsLoading || categoriesLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-8 h-8 animate-spin text-accent" />
      </div>
    );
  }

  if (modsError || categoriesError) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-text-secondary">
        <Layers className="w-16 h-16 mb-4 opacity-50 text-red-500" />
        <h2 className="text-xl font-semibold text-text-primary mb-2">Error Loading Locker</h2>
        <p className="text-center max-w-md text-red-400">{modsError || categoriesError}</p>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Hero Locker</h1>
          <p className="text-sm text-text-secondary">
            Pick the active skin per hero. Selecting one disables other skins for that hero.
          </p>
        </div>
        <div className="text-sm text-text-secondary">
          {heroList.length} heroes • {mods.length} installed
        </div>
      </div>

      {heroList.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-64 text-text-secondary">
          <Layers className="w-12 h-12 mb-3 opacity-50" />
          <p>No hero categories found.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {heroList.map((hero) => (
            <HeroCard
              key={hero.id}
              hero={hero}
              mods={heroMods.map.get(hero.id) ?? []}
              onSelect={(modId) => setActiveSkin(hero.id, modId)}
              isFavorite={favoriteHeroes.includes(hero.id)}
              onToggleFavorite={() =>
                setFavoriteHeroes((prev) =>
                  prev.includes(hero.id)
                    ? prev.filter((id) => id !== hero.id)
                    : [...prev, hero.id]
                )
              }
              minaPresets={hero.name === 'Mina' ? minaPresets : []}
              activeMinaPreset={hero.name === 'Mina' ? activeMinaPreset : undefined}
              minaTextures={hero.name === 'Mina' ? minaTextures : []}
              onApplyMinaPreset={hero.name === 'Mina' ? applyMinaPreset : undefined}
              minaArchivePath={hero.name === 'Mina' ? minaArchivePath : undefined}
              onMinaArchivePathChange={hero.name === 'Mina' ? setMinaArchivePath : undefined}
              minaVariants={hero.name === 'Mina' ? minaVariants : []}
              minaVariantsLoading={hero.name === 'Mina' ? minaVariantsLoading : false}
              minaVariantsError={hero.name === 'Mina' ? minaVariantsError : null}
              onLoadMinaVariants={hero.name === 'Mina' ? loadMinaVariants : undefined}
              minaSelection={hero.name === 'Mina' ? minaSelection : undefined}
              onMinaSelectionChange={hero.name === 'Mina' ? setMinaSelection : undefined}
              selectedMinaVariant={hero.name === 'Mina' ? selectedMinaVariant : undefined}
              onApplyMinaVariant={hero.name === 'Mina' ? applyMinaVariantSelection : undefined}
            />
          ))}
        </div>
      )}

      {heroMods.unassigned.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-sm font-medium text-text-secondary uppercase tracking-wider">
            Unassigned Skins
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {heroMods.unassigned.map((mod) => (
              <div
                key={mod.id}
                className="bg-bg-secondary border border-border rounded-lg p-3 flex items-center gap-3"
              >
                <div className="w-14 h-14 rounded-md overflow-hidden bg-bg-tertiary">
                  {mod.thumbnailUrl ? (
                    <img src={mod.thumbnailUrl} alt={mod.name} className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-text-secondary text-xs">
                      No preview
                    </div>
                  )}
                </div>
                <div className="min-w-0">
                  <div className="font-medium truncate">{mod.name}</div>
                  <div className="text-xs text-text-secondary truncate">{mod.fileName}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

interface HeroCardProps {
  hero: HeroCategory;
  mods: Mod[];
  onSelect: (modId: string) => void;
  isFavorite: boolean;
  onToggleFavorite: () => void;
  minaPresets: MinaPreset[];
  activeMinaPreset?: MinaPreset;
  minaTextures: Mod[];
  onApplyMinaPreset?: (presetFileName: string) => void;
  minaArchivePath?: string;
  onMinaArchivePathChange?: (path: string) => void;
  minaVariants: MinaVariant[];
  minaVariantsLoading: boolean;
  minaVariantsError: string | null;
  onLoadMinaVariants?: () => void;
  minaSelection?: MinaSelection;
  onMinaSelectionChange?: (selection: MinaSelection) => void;
  selectedMinaVariant?: MinaVariant;
  onApplyMinaVariant?: () => void;
}

function HeroCard({
  hero,
  mods,
  onSelect,
  isFavorite,
  onToggleFavorite,
  minaPresets,
  activeMinaPreset,
  minaTextures,
  onApplyMinaPreset,
  minaArchivePath,
  onMinaArchivePathChange,
  minaVariants,
  minaVariantsLoading,
  minaVariantsError,
  onLoadMinaVariants,
  minaSelection,
  onMinaSelectionChange,
  selectedMinaVariant,
  onApplyMinaVariant,
}: HeroCardProps) {
  const wikiUrl = getHeroWikiUrl(hero.name);
  const localUrl = `/heroes/${slugifyHeroName(hero.name)}.png`;
  const [iconSrc, setIconSrc] = useState(() => wikiUrl);
  const [fallbackStep, setFallbackStep] = useState(0);

  const hasMods = mods.length > 0;
  const activeMod = mods.find((mod) => mod.enabled);
  const showMinaVariants =
    Boolean(onLoadMinaVariants) &&
    Boolean(onMinaArchivePathChange) &&
    Boolean(minaSelection) &&
    Boolean(onMinaSelectionChange) &&
    Boolean(onApplyMinaVariant);

  const handleError = () => {
    if (fallbackStep === 0) {
      setIconSrc(localUrl);
      setFallbackStep(1);
      return;
    }
    if (fallbackStep === 1 && hero.iconUrl) {
      setIconSrc(hero.iconUrl);
      setFallbackStep(2);
      return;
    }
    setIconSrc('');
    setFallbackStep(3);
  };

  return (
    <div className="bg-bg-secondary border border-border rounded-lg overflow-hidden">
      <div className="flex items-center gap-3 p-3 border-b border-border">
        <div className="w-12 h-12 rounded-md overflow-hidden bg-bg-tertiary flex items-center justify-center">
          {iconSrc ? (
            <img src={iconSrc} alt={hero.name} className="w-full h-full object-cover" onError={handleError} />
          ) : (
            <span className="text-xs text-text-secondary">{hero.name.slice(0, 2).toUpperCase()}</span>
          )}
        </div>
        <div className="min-w-0">
          <div className="font-semibold truncate">{hero.name}</div>
          <div className="text-xs text-text-secondary">
            {hasMods ? `${mods.length} skin${mods.length !== 1 ? 's' : ''}` : 'No skins installed'}
          </div>
        </div>
        <button
          type="button"
          onClick={onToggleFavorite}
          className={`ml-auto p-2 rounded-md transition-colors ${
            isFavorite ? 'text-yellow-400' : 'text-text-secondary hover:text-text-primary'
          }`}
          title={isFavorite ? 'Unfavorite' : 'Favorite'}
        >
          <Star className="w-4 h-4" />
        </button>
      </div>

      <div className="p-3 space-y-2">
        {minaPresets.length > 0 && onApplyMinaPreset && (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs text-text-secondary">
              <span>Midnight Mina Preset</span>
              {activeMinaPreset ? (
                <span className="text-accent font-semibold">Active: {activeMinaPreset.label}</span>
              ) : (
                <span>No preset enabled</span>
              )}
            </div>
            <div className="grid grid-cols-1 gap-2">
              {minaPresets.map((preset) => (
                <button
                  key={preset.fileName}
                  onClick={() => onApplyMinaPreset(preset.fileName)}
                  className={`w-full rounded-md border px-3 py-2 text-left text-sm transition-colors ${
                    preset.enabled
                      ? 'border-accent bg-bg-tertiary'
                      : 'border-border hover:border-accent/60'
                  }`}
                >
                  {preset.label}
                </button>
              ))}
            </div>
            {minaTextures.length === 0 && (
              <div className="text-xs text-red-400">
                Missing textures VPK. Install the textures file to enable this preset.
              </div>
            )}
          </div>
        )}

        {showMinaVariants && minaArchivePath !== undefined && minaSelection && onMinaSelectionChange && (
          <div className="space-y-2 border-t border-border pt-3">
            <div className="text-xs text-text-secondary uppercase tracking-wider">Custom Variants</div>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={minaArchivePath}
                onChange={(event) => onMinaArchivePathChange?.(event.target.value)}
                placeholder="Path to extra clothing presets.7z"
                className="flex-1 bg-bg-tertiary border border-border rounded-md px-2 py-1 text-xs text-text-primary"
              />
              <button
                type="button"
                onClick={onLoadMinaVariants}
                disabled={minaVariantsLoading || !minaArchivePath.trim()}
                className="px-3 py-1 text-xs rounded-md border border-border hover:border-accent/60 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {minaVariantsLoading ? 'Loading…' : 'Load'}
              </button>
            </div>
            <div className="text-xs text-text-secondary">
              {minaVariantsLoading
                ? 'Scanning presets…'
                : minaVariants.length > 0
                  ? `${minaVariants.length} presets found`
                  : 'Load presets to enable variant selection.'}
            </div>
            {minaVariantsError && <div className="text-xs text-red-400">{minaVariantsError}</div>}
            <div className="grid grid-cols-2 gap-2">
              <label className="text-[11px] text-text-secondary space-y-1">
                <span>Futa</span>
                <select
                  value={minaSelection.futa}
                  onChange={(event) =>
                    onMinaSelectionChange({
                      ...minaSelection,
                      futa: event.target.value as MinaSelection['futa'],
                    })
                  }
                  className="w-full bg-bg-tertiary border border-border rounded-md px-2 py-1 text-xs"
                >
                  <option value="No">No</option>
                  <option value="Yes">Yes</option>
                </select>
              </label>
              <label className="text-[11px] text-text-secondary space-y-1">
                <span>Top</span>
                <select
                  value={minaSelection.top}
                  onChange={(event) =>
                    onMinaSelectionChange({
                      ...minaSelection,
                      top: event.target.value as MinaSelection['top'],
                    })
                  }
                  className="w-full bg-bg-tertiary border border-border rounded-md px-2 py-1 text-xs"
                >
                  <option value="None">None</option>
                  <option value="Sleeveless">Sleeveless</option>
                  <option value="Default">Default</option>
                </select>
              </label>
              <label className="text-[11px] text-text-secondary space-y-1">
                <span>Skirt</span>
                <select
                  value={minaSelection.skirt}
                  onChange={(event) =>
                    onMinaSelectionChange({
                      ...minaSelection,
                      skirt: event.target.value as MinaSelection['skirt'],
                    })
                  }
                  className="w-full bg-bg-tertiary border border-border rounded-md px-2 py-1 text-xs"
                >
                  <option value="None">None</option>
                  <option value="Default">Default</option>
                </select>
              </label>
              <label className="text-[11px] text-text-secondary space-y-1">
                <span>Stockings</span>
                <select
                  value={minaSelection.stockings}
                  onChange={(event) =>
                    onMinaSelectionChange({
                      ...minaSelection,
                      stockings: event.target.value as MinaSelection['stockings'],
                    })
                  }
                  className="w-full bg-bg-tertiary border border-border rounded-md px-2 py-1 text-xs"
                >
                  <option value="None">None</option>
                  <option value="Default">Default</option>
                </select>
              </label>
              <label className="text-[11px] text-text-secondary space-y-1">
                <span>Belt Sash</span>
                <select
                  value={minaSelection.beltSash}
                  onChange={(event) =>
                    onMinaSelectionChange({
                      ...minaSelection,
                      beltSash: event.target.value as MinaSelection['beltSash'],
                    })
                  }
                  className="w-full bg-bg-tertiary border border-border rounded-md px-2 py-1 text-xs"
                >
                  <option value="None">None</option>
                  <option value="Default">Default</option>
                </select>
              </label>
              <label className="text-[11px] text-text-secondary space-y-1">
                <span>Gloves</span>
                <select
                  value={minaSelection.gloves}
                  onChange={(event) =>
                    onMinaSelectionChange({
                      ...minaSelection,
                      gloves: event.target.value as MinaSelection['gloves'],
                    })
                  }
                  className="w-full bg-bg-tertiary border border-border rounded-md px-2 py-1 text-xs"
                >
                  <option value="None">None</option>
                  <option value="Default">Default</option>
                </select>
              </label>
              <label className="text-[11px] text-text-secondary space-y-1">
                <span>Garter</span>
                <select
                  value={minaSelection.garter}
                  onChange={(event) =>
                    onMinaSelectionChange({
                      ...minaSelection,
                      garter: event.target.value as MinaSelection['garter'],
                    })
                  }
                  className="w-full bg-bg-tertiary border border-border rounded-md px-2 py-1 text-xs"
                >
                  <option value="None">None</option>
                  <option value="Default">Default</option>
                </select>
              </label>
              <label className="text-[11px] text-text-secondary space-y-1">
                <span>Dress</span>
                <select
                  value={minaSelection.dress}
                  onChange={(event) =>
                    onMinaSelectionChange({
                      ...minaSelection,
                      dress: event.target.value as MinaSelection['dress'],
                    })
                  }
                  className="w-full bg-bg-tertiary border border-border rounded-md px-2 py-1 text-xs"
                >
                  <option value="None">None</option>
                  <option value="Default">Default</option>
                </select>
              </label>
            </div>
            <div className="flex items-center justify-between text-xs">
              {selectedMinaVariant ? (
                <span className="text-text-secondary truncate">
                  {selectedMinaVariant.label}
                </span>
              ) : (
                <span className="text-red-400">No preset matches this selection.</span>
              )}
              <button
                type="button"
                onClick={onApplyMinaVariant}
                disabled={!selectedMinaVariant}
                className="ml-2 px-3 py-1 rounded-md border border-border text-xs hover:border-accent/60 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Apply
              </button>
            </div>
            {minaTextures.length === 0 && (
              <div className="text-xs text-red-400">
                Missing textures VPK. Install the textures file to enable this preset.
              </div>
            )}
          </div>
        )}

        {hasMods ? (
          mods.map((mod) => (
            <button
              key={mod.id}
              onClick={() => onSelect(mod.id)}
              className={`w-full flex items-center gap-2 rounded-md border px-2 py-2 text-left transition-colors ${
                mod.enabled
                  ? 'border-accent bg-bg-tertiary'
                  : 'border-border hover:border-accent/60'
              }`}
              title={mod.enabled ? 'Active skin' : 'Set active'}
            >
              <div className="w-10 h-10 rounded-md overflow-hidden bg-bg-tertiary flex-shrink-0">
                {mod.thumbnailUrl ? (
                  <img src={mod.thumbnailUrl} alt={mod.name} className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-text-secondary text-[10px]">
                    No preview
                  </div>
                )}
              </div>
              <div className="min-w-0">
                <div className="font-medium truncate">{mod.name}</div>
                <div className="text-xs text-text-secondary truncate">{mod.fileName}</div>
              </div>
              {activeMod?.id === mod.id && (
                <span className="ml-auto text-xs text-accent font-semibold">Active</span>
              )}
            </button>
          ))
        ) : (
          <div className="text-xs text-text-secondary">
            Download a skin for this hero to manage it here.
          </div>
        )}
      </div>
    </div>
  );
}
