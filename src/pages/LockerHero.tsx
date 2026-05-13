import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Layers, Star } from 'lucide-react';
import { Skeleton } from '../components/common/Skeleton';
import { useNavigate, useParams } from 'react-router-dom';
import { useAppStore } from '../stores/appStore';
import {
  applyMinaVariant,
  getGamebananaCategories,
  listMinaVariants,
  setMinaPreset,
} from '../lib/api';
import { getActiveDeadlockPath } from '../lib/appSettings';
import HeroSkinsPanel from '../components/locker/HeroSkinsPanel';
import type { GameBananaCategoryNode } from '../types/gamebanana';
import type { Mod } from '../types/mod';
import {
  FAVORITE_HEROES_KEY,
  MINA_ARCHIVE_DEFAULT,
  buildHeroList,
  buildMinaPresets,
  countLockerSkins,
  detectMinaTextures,
  findMinaVariant,
  getLockerSkinKey,
  getHeroNamePath,
  getHeroRenderPath,
  getHeroWikiUrl,
  groupModsByCategory,
  isLockerManagedMod,
  parseMinaVariant,
  readStoredFavorites,
  type HeroCategory,
  type MinaPreset,
  type MinaSelection,
  type MinaVariant,
} from '../lib/lockerUtils';

interface LockerHeroViewProps {
  hero: HeroCategory;
  list: Mod[];
  skinCount: number;
  isFavorite: boolean;
  onBack: () => void;
  onToggleFavorite: () => void;
  onSelect: (modId: string) => void | Promise<void>;
  onToggleVariant: (modId: string) => void | Promise<void>;
  hideNsfwPreviews?: boolean;
  minaPresets?: MinaPreset[];
  activeMinaPreset?: MinaPreset;
  minaTextures?: Mod[];
  onApplyMinaPreset?: (presetFileName: string) => void;
  minaArchivePath?: string;
  onMinaArchivePathChange?: (path: string) => void;
  minaVariants?: MinaVariant[];
  minaVariantsLoading?: boolean;
  minaVariantsError?: string | null;
  onLoadMinaVariants?: () => void;
  minaSelection?: MinaSelection;
  onMinaSelectionChange?: (selection: MinaSelection) => void;
  selectedMinaVariant?: MinaVariant;
  onApplyMinaVariant?: () => void;
}

export default function LockerHero() {
  const navigate = useNavigate();
  const params = useParams<{ heroId: string }>();
  const heroId = Number(params.heroId);
  const { settings, mods, modsLoading, modsError, loadSettings, loadMods, toggleMod } =
    useAppStore();
  const activeDeadlockPath = getActiveDeadlockPath(settings);
  const [categories, setCategories] = useState<GameBananaCategoryNode[]>([]);
  const [categoriesLoading, setCategoriesLoading] = useState(false);
  const [categoriesError, setCategoriesError] = useState<string | null>(null);
  // Seed from localStorage synchronously so the value is present on the very
  // first render. Doing this in a useEffect instead would race against the
  // save effect under StrictMode: the save closure captures `[]`, writes that
  // back to localStorage, and the second load (which StrictMode replays) then
  // reads the clobbered empty value and wins — silently dropping the user's
  // saved favorites.
  const [favoriteHeroes, setFavoriteHeroes] = useState<number[]>(() =>
    readStoredFavorites()
  );
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
    localStorage.setItem(FAVORITE_HEROES_KEY, JSON.stringify(favoriteHeroes));
  }, [favoriteHeroes]);

  useEffect(() => {
    localStorage.setItem('minaArchivePath', minaArchivePath);
  }, [minaArchivePath]);

  const heroList = useMemo(() => buildHeroList(categories), [categories]);
  const hero = heroList.find((entry) => entry.id === heroId);
  const lockerMods = useMemo(() => mods.filter(isLockerManagedMod), [mods]);
  const heroMods = useMemo(() => groupModsByCategory(lockerMods, heroList), [lockerMods, heroList]);
  const list = useMemo(() => (hero ? heroMods.map.get(hero.id) ?? [] : []), [hero, heroMods]);
  const skinCount = useMemo(() => countLockerSkins(list), [list]);

  const minaPresets = useMemo(() => buildMinaPresets(mods), [mods]);
  const minaTextures = useMemo(() => detectMinaTextures(mods), [mods]);
  const activeMinaPreset = minaPresets.find((preset) => preset.enabled);
  const selectedMinaVariant = useMemo(
    () => findMinaVariant(minaVariants, minaSelection),
    [minaVariants, minaSelection]
  );

  const setActiveSkin = async (modId: string) => {
    if (!hero) return;
    const heroModList = heroMods.map.get(hero.id) ?? [];
    const clicked = heroModList.find((m) => m.id === modId);
    if (!clicked) return;
    const actions: Promise<void>[] = [];
    if (clicked.enabled) {
      // Click again on the active skin disables it (and any sibling variants
      // currently enabled), returning the hero to the default in-game skin.
      for (const mod of heroModList) {
        if (mod.enabled) actions.push(toggleMod(mod.id));
      }
    } else {
      for (const mod of heroModList) {
        if (mod.id === modId) {
          if (!mod.enabled) actions.push(toggleMod(mod.id));
        } else if (mod.enabled) {
          actions.push(toggleMod(mod.id));
        }
      }
    }
    await Promise.all(actions);
  };

  // Toggle one variant within a group. Disables enabled mods from other groups
  // for the hero, but leaves sibling variants in the same group alone so a
  // model + voice-lines pair can stay co-enabled.
  const toggleHeroVariant = async (modId: string) => {
    if (!hero) return;
    const heroModList = heroMods.map.get(hero.id) ?? [];
    const target = heroModList.find((m) => m.id === modId);
    if (!target) return;
    const groupKey = getLockerSkinKey(target);
    const actions: Promise<void>[] = [];
    for (const mod of heroModList) {
      if (mod.id === modId) continue;
      if (!mod.enabled) continue;
      const otherKey = getLockerSkinKey(mod);
      if (otherKey !== groupKey) actions.push(toggleMod(mod.id));
    }
    actions.push(toggleMod(modId));
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
    if (!selectedMinaVariant || !hero) return;
    try {
      await applyMinaVariant(
        minaArchivePath.trim(),
        selectedMinaVariant.archiveEntry,
        selectedMinaVariant.label,
        hero.name === 'Mina' ? hero.id : undefined
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
    return <LockerHeroSkeleton />;
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

  if (!hero || Number.isNaN(heroId)) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-text-secondary">
        <Layers className="w-16 h-16 mb-4 opacity-50" />
        <h2 className="text-xl font-semibold text-text-primary mb-2">Hero Not Found</h2>
        <button
          type="button"
          onClick={() => navigate('/locker')}
          className="mt-3 px-4 py-2 rounded-lg border border-accent/40 bg-accent/10 hover:bg-accent/20 hover:border-accent/60 text-text-primary transition-colors cursor-pointer"
        >
          Back to Locker
        </button>
      </div>
    );
  }

  return (
    <LockerHeroView
      key={hero.id}
      hero={hero}
      list={list}
      skinCount={skinCount}
      isFavorite={favoriteHeroes.includes(hero.id)}
      onBack={() => navigate('/locker')}
      onToggleFavorite={() =>
        setFavoriteHeroes((prev) =>
          prev.includes(hero.id) ? prev.filter((id) => id !== hero.id) : [...prev, hero.id]
        )
      }
      onSelect={setActiveSkin}
      onToggleVariant={toggleHeroVariant}
      hideNsfwPreviews={settings?.hideNsfwPreviews ?? false}
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
  );
}

export function LockerHeroView({
  hero,
  list,
  skinCount,
  isFavorite,
  onBack,
  onToggleFavorite,
  onSelect,
  onToggleVariant,
  hideNsfwPreviews = false,
  minaPresets = [],
  activeMinaPreset,
  minaTextures = [],
  onApplyMinaPreset,
  minaArchivePath,
  onMinaArchivePathChange,
  minaVariants = [],
  minaVariantsLoading = false,
  minaVariantsError = null,
  onLoadMinaVariants,
  minaSelection,
  onMinaSelectionChange,
  selectedMinaVariant,
  onApplyMinaVariant,
}: LockerHeroViewProps) {
  const [renderFallbackStep, setRenderFallbackStep] = useState(0);
  const [nameFailed, setNameFailed] = useState(false);

  const renderSrc =
    renderFallbackStep === 0
      ? getHeroRenderPath(hero.name)
      : renderFallbackStep === 1
        ? getHeroWikiUrl(hero.name)
        : renderFallbackStep === 2
          ? (hero.iconUrl ?? '')
          : '';

  const handleRenderError = () => {
    if (renderFallbackStep === 0) {
      setRenderFallbackStep(1);
      return;
    }
    if (renderFallbackStep === 1 && hero.iconUrl) {
      setRenderFallbackStep(2);
      return;
    }
    setRenderFallbackStep(3);
  };

  return (
    <div className="relative flex h-full overflow-hidden">
      {/* Hero portrait — sits behind both panels so it can bleed through the
          frosted-glass sidebar on the right side of the panel. The image is
          sized to the window height with natural aspect ratio (h-full w-auto)
          so wider viewports don't force object-cover to scale it up and chop
          the head/feet off. Anchored to the right edge; whatever space is left
          to the left of the image shows the solid bg-primary, which the
          frosted overlay reads as a dark frosted panel — same look as if the
          portrait extended that far. */}
      <div className="hidden lg:block absolute inset-0 bg-bg-primary animate-hero-zoom-in overflow-hidden">
        {renderSrc ? (
          <img
            src={renderSrc}
            alt={hero.name}
            className="absolute top-0 right-0 h-full w-auto max-w-none"
            onError={handleRenderError}
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-text-secondary text-2xl">
            {hero.name}
          </div>
        )}
        {/* Bottom gradient for depth */}
        <div className="absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t from-black/50 to-transparent" />
      </div>

      {/* Progressive frosted-glass background — every layer (including the
          base heavy blur) is masked with a long, smooth taper so nothing has
          a hard right edge. Stacking blurs compounds: a region under all
          three layers is much more blurred than one under only the lightest.
          So as the lighter layers fade out first, the effective blur softens
          from "very heavy" through "medium" to "nothing" without ever
          dropping off a cliff. The container is intentionally much wider
          than the sidebar (sidebar is 400/450px; container is ~720/800px)
          so the gradient has runway to feather all the way to clear. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-y-0 left-0 z-[5] hidden lg:block lg:w-[720px] xl:w-[800px]"
      >
        <div
          className="absolute inset-0"
          style={{
            backdropFilter: 'blur(48px) saturate(135%)',
            WebkitBackdropFilter: 'blur(48px) saturate(135%)',
            WebkitMaskImage: 'linear-gradient(to right, black 0%, black 18%, transparent 92%)',
            maskImage: 'linear-gradient(to right, black 0%, black 18%, transparent 92%)',
          }}
        />
        <div
          className="absolute inset-0"
          style={{
            backdropFilter: 'blur(24px)',
            WebkitBackdropFilter: 'blur(24px)',
            WebkitMaskImage: 'linear-gradient(to right, black 0%, black 12%, transparent 72%)',
            maskImage: 'linear-gradient(to right, black 0%, black 12%, transparent 72%)',
          }}
        />
        <div
          className="absolute inset-0"
          style={{
            backdropFilter: 'blur(10px)',
            WebkitBackdropFilter: 'blur(10px)',
            WebkitMaskImage: 'linear-gradient(to right, black 0%, black 8%, transparent 52%)',
            maskImage: 'linear-gradient(to right, black 0%, black 8%, transparent 52%)',
          }}
        />
        <div
          className="absolute inset-0"
          style={{
            background:
              'linear-gradient(to right, var(--color-bg-secondary) 0%, rgba(26,26,26,0.95) 28%, rgba(26,26,26,0.75) 50%, rgba(26,26,26,0.4) 70%, rgba(26,26,26,0.15) 85%, transparent 96%)',
          }}
        />
      </div>

      {/* Left Panel - Skin Selection */}
      <div className="relative z-10 w-full lg:w-[400px] xl:w-[450px] flex-shrink-0 overflow-y-auto bg-bg-secondary lg:bg-transparent animate-slide-in-left">
        <div className="relative z-10 p-6 space-y-6">
          {/* Header */}
          <div className="flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={onBack}
              className="flex items-center gap-2 text-sm text-text-secondary hover:text-text-primary transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
              Back
            </button>
            <button
              type="button"
              onClick={onToggleFavorite}
              className={`flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-wide transition-colors ${
                isFavorite
                  ? 'border-yellow-400/60 bg-yellow-400/20 text-yellow-300'
                  : 'border-border/70 text-text-secondary hover:text-text-primary'
              }`}
            >
              <Star className="w-4 h-4" />
              {isFavorite ? 'Favorite' : 'Save'}
            </button>
          </div>

          {/* Hero Name */}
          <div className="flex items-center gap-3">
            {nameFailed ? (
              <h1 className="text-2xl font-bold text-text-primary">{hero.name}</h1>
            ) : (
              <img
                src={getHeroNamePath(hero.name)}
                alt={hero.name}
                className="h-8 w-auto object-contain"
                onError={() => setNameFailed(true)}
              />
            )}
            <span className="text-sm text-text-secondary">
              {skinCount > 0 ? `${skinCount} skin${skinCount !== 1 ? 's' : ''}` : 'No skins'}
            </span>
          </div>

          {/* Skin Selection */}
          <div className="space-y-4">
            <HeroSkinsPanel
              mods={list}
              onSelect={onSelect}
              onToggleVariant={onToggleVariant}
              hideNsfwPreviews={hideNsfwPreviews}
              categoryId={hero.id}
              minaPresets={minaPresets}
              activeMinaPreset={activeMinaPreset}
              minaTextures={minaTextures}
              onApplyMinaPreset={onApplyMinaPreset}
              minaArchivePath={minaArchivePath}
              onMinaArchivePathChange={onMinaArchivePathChange}
              minaVariants={minaVariants}
              minaVariantsLoading={minaVariantsLoading}
              minaVariantsError={minaVariantsError}
              onLoadMinaVariants={onLoadMinaVariants}
              minaSelection={minaSelection}
              onMinaSelectionChange={onMinaSelectionChange}
              selectedMinaVariant={selectedMinaVariant}
              onApplyMinaVariant={onApplyMinaVariant}
            />
          </div>

        </div>
      </div>
    </div>
  );
}

function LockerHeroSkeleton() {
  return (
    <div className="flex h-full" aria-busy="true" aria-live="polite">
      {/* Left panel — mirrors HeroSkinsPanel layout */}
      <div className="w-full lg:w-[400px] xl:w-[450px] flex-shrink-0 overflow-hidden border-r border-border bg-bg-secondary animate-slide-in-left">
        <div className="p-6 space-y-6">
          <div className="flex items-center justify-between gap-3">
            <Skeleton className="h-4 w-16" />
            <Skeleton className="h-4 w-4" rounded="full" />
          </div>
          <div className="space-y-3">
            <Skeleton className="h-7 w-2/3" />
            <Skeleton className="h-3 w-1/3" />
          </div>
          <div className="space-y-3 pt-2">
            <Skeleton className="h-3 w-24" />
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3">
                <Skeleton className="h-20 w-20" rounded="md" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-3 w-3/4" />
                  <Skeleton className="h-2 w-1/3" />
                </div>
                <Skeleton className="h-5 w-10" rounded="full" />
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Right panel — hero portrait placeholder */}
      <div className="flex-1 relative overflow-hidden bg-bg-primary animate-hero-zoom-in">
        <Skeleton className="absolute inset-0" rounded="none" />
        <div className="absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t from-black/50 to-transparent" />
        <div className="absolute bottom-8 left-8 space-y-3">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-4 w-40" />
        </div>
      </div>
    </div>
  );
}
