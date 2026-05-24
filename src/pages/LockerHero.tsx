import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Layers, Star, Music, Shirt } from 'lucide-react';
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
  getHeroNamePath,
  getHeroRenderPath,
  getHeroWikiUrl,
  groupModsByCategory,
  isLockerManagedMod,
  isLockerManagedSound,
  parseMinaVariant,
  readStoredFavorites,
  type HeroCategory,
  type MinaPreset,
  type MinaSelection,
  type MinaVariant,
} from '../lib/lockerUtils';

interface LockerHeroViewProps {
  hero: HeroCategory;
  skinList: Mod[];
  /** Sound-section mods mapped to this hero. Optional because the gallery
   *  view in `Locker.tsx` keeps the same prop surface and may not split sounds
   *  out yet. Empty/undefined hides the Sounds toggle entirely. */
  soundList?: Mod[];
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
  const lockerSkins = useMemo(() => mods.filter(isLockerManagedMod), [mods]);
  const lockerSounds = useMemo(() => mods.filter(isLockerManagedSound), [mods]);
  const heroSkinsByHero = useMemo(
    () => groupModsByCategory(lockerSkins, heroList),
    [lockerSkins, heroList]
  );
  const heroSoundsByHero = useMemo(
    () => groupModsByCategory(lockerSounds, heroList),
    [lockerSounds, heroList]
  );
  const skinList = useMemo(
    () => (hero ? heroSkinsByHero.map.get(hero.id) ?? [] : []),
    [hero, heroSkinsByHero]
  );
  const soundList = useMemo(
    () => (hero ? heroSoundsByHero.map.get(hero.id) ?? [] : []),
    [hero, heroSoundsByHero]
  );
  const skinCount = useMemo(() => countLockerSkins(skinList), [skinList]);

  const minaPresets = useMemo(() => buildMinaPresets(mods), [mods]);
  const minaTextures = useMemo(() => detectMinaTextures(mods), [mods]);
  const activeMinaPreset = minaPresets.find((preset) => preset.enabled);
  const selectedMinaVariant = useMemo(
    () => findMinaVariant(minaVariants, minaSelection),
    [minaVariants, minaSelection]
  );

  // Resolve which section list the clicked mod belongs to. Section exclusivity
  // is per-section: picking a Geist skin doesn't disable Geist voice lines and
  // vice versa.
  const listForMod = (modId: string): Mod[] | null => {
    if (skinList.some((m) => m.id === modId)) return skinList;
    if (soundList.some((m) => m.id === modId)) return soundList;
    return null;
  };

  // Both skins and sounds toggle independently in the Locker now. Users have
  // valid reasons to layer multiple VPKs on the same hero (e.g. one mod
  // touches textures, another touches weapons, another the voice). The Locker
  // surfaces what's enabled; it doesn't enforce exclusivity. If two enabled
  // mods truly conflict, that's the Conflicts page's job to flag.
  const setActiveSkin = async (modId: string) => {
    if (!hero) return;
    const heroModList = listForMod(modId);
    if (!heroModList?.some((m) => m.id === modId)) return;
    await toggleMod(modId);
  };

  const toggleHeroVariant = async (modId: string) => {
    if (!hero) return;
    const heroModList = listForMod(modId);
    if (!heroModList?.some((m) => m.id === modId)) return;
    await toggleMod(modId);
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
      skinList={skinList}
      soundList={soundList}
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
  skinList,
  soundList = [],
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
  const [section, setSection] = useState<'skins' | 'sounds'>('skins');
  const hasSounds = soundList.length > 0;
  // If the active section runs out of mods (e.g. user deleted their last
  // sound for this hero) drop back to skins so the panel isn't stuck empty.
  const activeSection = section === 'sounds' && !hasSounds ? 'skins' : section;
  const activeList = activeSection === 'sounds' ? soundList : skinList;
  // Group sound variants the same way skins are counted so the count matches
  // the gallery/list cards and the grouped rows rendered below.
  const soundCount = countLockerSkins(soundList);

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
              {activeSection === 'sounds'
                ? soundCount > 0
                  ? `${soundCount} sound${soundCount !== 1 ? 's' : ''}`
                  : 'No sounds'
                : skinCount > 0
                  ? `${skinCount} skin${skinCount !== 1 ? 's' : ''}`
                  : 'No skins'}
            </span>
          </div>

          {/* Section toggle: only when this hero has at least one Sound mod;
              the toggle would be empty noise for heroes with skins-only piles. */}
          {hasSounds && (
            <div
              role="tablist"
              aria-label="Section"
              className="inline-flex items-center rounded-full border border-border bg-bg-tertiary p-0.5 text-xs"
            >
              <button
                type="button"
                role="tab"
                aria-selected={activeSection === 'skins'}
                onClick={() => setSection('skins')}
                className={`flex items-center gap-1.5 rounded-full px-3 py-1 transition-colors cursor-pointer ${
                  activeSection === 'skins'
                    ? 'bg-accent/15 text-text-primary border border-accent/40'
                    : 'text-text-secondary hover:text-text-primary border border-transparent'
                }`}
              >
                <Shirt className="w-3.5 h-3.5" />
                Skins
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={activeSection === 'sounds'}
                onClick={() => setSection('sounds')}
                className={`flex items-center gap-1.5 rounded-full px-3 py-1 transition-colors cursor-pointer ${
                  activeSection === 'sounds'
                    ? 'bg-accent/15 text-text-primary border border-accent/40'
                    : 'text-text-secondary hover:text-text-primary border border-transparent'
                }`}
              >
                <Music className="w-3.5 h-3.5" />
                Sounds
              </button>
            </div>
          )}

          {/* Skin / Sound Selection */}
          <div className="space-y-4">
            <HeroSkinsPanel
              mods={activeList}
              onSelect={onSelect}
              onToggleVariant={onToggleVariant}
              hideNsfwPreviews={hideNsfwPreviews}
              categoryId={hero.id}
              showDownloadable={activeSection === 'skins'}
              useHeroPortraitThumbnails={activeSection === 'sounds'}
              heroName={hero.name}
              emptyMessage={
                activeSection === 'sounds'
                  ? 'No sound mods tagged for this hero yet. Tag one from Installed (multi-select → Tag).'
                  : 'Download a skin for this hero to manage it here.'
              }
              minaPresets={activeSection === 'skins' ? minaPresets : []}
              activeMinaPreset={activeSection === 'skins' ? activeMinaPreset : undefined}
              minaTextures={activeSection === 'skins' ? minaTextures : []}
              onApplyMinaPreset={activeSection === 'skins' ? onApplyMinaPreset : undefined}
              minaArchivePath={activeSection === 'skins' ? minaArchivePath : undefined}
              onMinaArchivePathChange={
                activeSection === 'skins' ? onMinaArchivePathChange : undefined
              }
              minaVariants={activeSection === 'skins' ? minaVariants : []}
              minaVariantsLoading={
                activeSection === 'skins' ? minaVariantsLoading : false
              }
              minaVariantsError={activeSection === 'skins' ? minaVariantsError : null}
              onLoadMinaVariants={activeSection === 'skins' ? onLoadMinaVariants : undefined}
              minaSelection={activeSection === 'skins' ? minaSelection : undefined}
              onMinaSelectionChange={
                activeSection === 'skins' ? onMinaSelectionChange : undefined
              }
              selectedMinaVariant={
                activeSection === 'skins' ? selectedMinaVariant : undefined
              }
              onApplyMinaVariant={activeSection === 'skins' ? onApplyMinaVariant : undefined}
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
