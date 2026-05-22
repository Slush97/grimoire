import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Layers, Shield, Star } from 'lucide-react';
import { useAppStore } from '../stores/appStore';
import {
  applyMinaVariant,
  getGamebananaCategories,
  listMinaVariants,
  setMinaPreset,
  setModLockerHero,
} from '../lib/api';
import { getActiveDeadlockPath } from '../lib/appSettings';
import HeroSkinsPanel from '../components/locker/HeroSkinsPanel';
import { LockerHeroView } from './LockerHero';
import ModThumbnail from '../components/ModThumbnail';
import type { GameBananaCategoryNode } from '../types/gamebanana';
import type { Mod } from '../types/mod';
import { PageHeader, ViewModeToggle, EmptyState, SectionHeader } from '../components/common/PageComponents';
import { Skeleton } from '../components/common/Skeleton';
import {
  FAVORITE_HEROES_KEY,
  MINA_ARCHIVE_DEFAULT,
  buildHeroList,
  buildMinaPresets,
  countLockerSkins,
  detectMinaTextures,
  findMinaVariant,
  getHeroFacePosition,
  getHeroNamePath,
  getHeroRenderPath,
  getHeroWikiUrl,
  groupLockerSkins,
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

export default function Locker() {
  const { settings, mods, modsLoading, modsError, loadSettings, loadMods, toggleMod } =
    useAppStore();
  const activeDeadlockPath = getActiveDeadlockPath(settings);
  const [categories, setCategories] = useState<GameBananaCategoryNode[]>([]);
  const [categoriesLoading, setCategoriesLoading] = useState(false);
  const [categoriesError, setCategoriesError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'gallery' | 'list'>(() => {
    const stored = localStorage.getItem('lockerViewMode');
    return stored === 'list' ? 'list' : 'gallery';
  });
  // Seed from localStorage synchronously so the value is present on the very
  // first render. A useEffect-driven load would race against the save effect
  // under StrictMode: the save closure captures `[]`, clobbers localStorage,
  // and StrictMode's replayed load reads the empty value and wins.
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

  useEffect(() => {
    localStorage.setItem('lockerViewMode', viewMode);
  }, [viewMode]);

  const navigate = useNavigate();
  const location = useLocation();
  const goToHero = useCallback(
    (hero: HeroCategory) => navigate(`/locker/hero/${hero.id}`),
    [navigate]
  );
  const selectedHeroRouteParam = useMemo(() => {
    const match = location.pathname.match(/^\/locker\/hero\/([^/]+)\/?$/);
    return match ? match[1] : null;
  }, [location.pathname]);
  const selectedHeroId = useMemo(() => {
    if (selectedHeroRouteParam === null || !/^\d+$/.test(selectedHeroRouteParam)) {
      return null;
    }
    return Number(selectedHeroRouteParam);
  }, [selectedHeroRouteParam]);

  // Build basic hero list first (needed for mod categorization)
  const baseHeroList = useMemo(() => buildHeroList(categories), [categories]);

  const lockerMods = useMemo(() => mods.filter(isLockerManagedMod), [mods]);
  const lockerSounds = useMemo(() => mods.filter(isLockerManagedSound), [mods]);

  // Calculate heroMods, passing heroList for name-based category inference
  const heroMods = useMemo(() => {
    return groupModsByCategory(lockerMods, baseHeroList);
  }, [lockerMods, baseHeroList]);
  const heroSounds = useMemo(() => {
    return groupModsByCategory(lockerSounds, baseHeroList);
  }, [lockerSounds, baseHeroList]);
  const installedSkinCount = useMemo(() => countLockerSkins(lockerMods), [lockerMods]);
  const unassignedSkins = useMemo(() => groupLockerSkins(heroMods.unassigned), [heroMods]);
  // Sound mods that couldn't be auto-mapped to a hero (e.g. inferHeroFromTitle
  // didn't catch the hero name in the title). Surfaced in the same Unassigned
  // section so users can tag them from one place.
  const unassignedSounds = useMemo(
    () => groupLockerSkins(heroSounds.unassigned),
    [heroSounds]
  );

  // Sorted hero list for display
  const heroList = useMemo(() => {
    return [...baseHeroList].sort((a, b) => {
      const aFav = favoriteHeroes.includes(a.id);
      const bFav = favoriteHeroes.includes(b.id);
      // Favorites first
      if (aFav !== bFav) return aFav ? -1 : 1;
      // Then heroes with skins
      const aHasSkins = countLockerSkins(heroMods.map.get(a.id) ?? []) > 0;
      const bHasSkins = countLockerSkins(heroMods.map.get(b.id) ?? []) > 0;
      if (aHasSkins !== bHasSkins) return aHasSkins ? -1 : 1;
      // Then alphabetically
      return a.name.localeCompare(b.name);
    });
  }, [baseHeroList, favoriteHeroes, heroMods]);
  const selectedHero = selectedHeroId === null
    ? null
    : heroList.find((hero) => hero.id === selectedHeroId) ?? null;
  const selectedHeroMissing = selectedHeroRouteParam !== null && !selectedHero;
  const selectedHeroMods = useMemo(
    () => (selectedHero ? heroMods.map.get(selectedHero.id) ?? [] : []),
    [heroMods, selectedHero]
  );
  const selectedHeroSoundList = useMemo(
    () => (selectedHero ? heroSounds.map.get(selectedHero.id) ?? [] : []),
    [heroSounds, selectedHero]
  );
  const selectedHeroSkinCount = useMemo(
    () => countLockerSkins(selectedHeroMods),
    [selectedHeroMods]
  );

  const minaPresets = useMemo(() => buildMinaPresets(mods), [mods]);
  const minaTextures = useMemo(() => detectMinaTextures(mods), [mods]);
  const activeMinaPreset = minaPresets.find((preset) => preset.enabled);
  const selectedMinaVariant = useMemo(
    () => findMinaVariant(minaVariants, minaSelection),
    [minaVariants, minaSelection]
  );

  // Both skins and sounds toggle independently. Users layering multiple VPKs
  // on the same hero (textures + weapons + voice) is a valid workflow; the
  // Locker reflects what's enabled rather than enforcing one-at-a-time. Real
  // conflicts surface on the Conflicts page.
  const setActiveSkin = async (heroId: number, modId: string) => {
    const skins = heroMods.map.get(heroId) ?? [];
    const sounds = heroSounds.map.get(heroId) ?? [];
    if (!skins.some((m) => m.id === modId) && !sounds.some((m) => m.id === modId)) return;
    await toggleMod(modId);
  };

  const toggleHeroVariant = async (heroId: number, modId: string) => {
    const skins = heroMods.map.get(heroId) ?? [];
    const sounds = heroSounds.map.get(heroId) ?? [];
    if (!skins.some((m) => m.id === modId) && !sounds.some((m) => m.id === modId)) return;
    await toggleMod(modId);
  };

  // Sorted hero name list for the "tag as hero" dropdown on Unassigned cards.
  // We use only heroes that have a GameBanana category, because that's the
  // pool the locker grouping logic resolves names against; picking a hero
  // outside this set would silently fail to move the mod.
  const tagHeroOptions = useMemo(
    () => [...baseHeroList].sort((a, b) => a.name.localeCompare(b.name)),
    [baseHeroList]
  );

  const tagModHero = async (modId: string, heroName: string | null) => {
    try {
      await setModLockerHero(modId, heroName);
      await loadMods();
    } catch (err) {
      console.error('[Locker] Failed to set lockerHero override:', err);
    }
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
      <EmptyState
        icon={Shield}
        title="No Game Path Set"
        description="Configure your Deadlock installation path or enable dev mode to manage hero skins."
      />
    );
  }

  if (modsLoading || categoriesLoading) {
    return (
      <div className="p-6 space-y-6">
        <PageHeader
          title="Hero Locker"
          description="Pick the active skin per hero. Selecting one disables other skins for that hero."
        />
        <div
          className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3"
          aria-busy="true"
          aria-live="polite"
        >
          {Array.from({ length: 18 }).map((_, i) => (
            <HeroGallerySkeleton key={i} />
          ))}
        </div>
      </div>
    );
  }

  if (modsError || categoriesError) {
    return (
      <EmptyState
        icon={Shield}
        title="Error Loading Locker"
        description={(modsError || categoriesError) ?? undefined}
        variant="error"
      />
    );
  }

  return (
    <>
      <div className="p-6 space-y-6">
      <PageHeader
        title="Hero Locker"
        description="Pick the active skin per hero. Selecting one disables other skins for that hero."
        stats={`${heroList.length} heroes • ${installedSkinCount} installed skins`}
        action={
          <div className="flex items-center gap-3">
            {viewMode === 'gallery' &&
              unassignedSkins.length + unassignedSounds.length > 0 && (
                <button
                  onClick={() => setViewMode('list')}
                  className="flex items-center gap-1.5 px-2 py-1 text-xs rounded-md bg-yellow-500/10 border border-yellow-500/50 text-yellow-400 hover:bg-yellow-500/20 transition-colors"
                  title="Switch to List view to see unassigned mods"
                >
                  <Layers className="w-3 h-3" />
                  {unassignedSkins.length + unassignedSounds.length} unassigned
                </button>
              )}
            <ViewModeToggle
              value={viewMode}
              options={[
                { value: 'gallery', label: 'Gallery' },
                { value: 'list', label: 'List' },
              ]}
              onChange={(mode) => setViewMode(mode as 'gallery' | 'list')}
            />
          </div>
        }
      />

      {heroList.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-64 text-text-secondary">
          <Layers className="w-12 h-12 mb-3 opacity-50" />
          <p>No hero categories found.</p>
        </div>
      ) : viewMode === 'gallery' ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
          {heroList.map((hero) => (
            <HeroGalleryCard
              key={hero.id}
              hero={hero}
              skinCount={countLockerSkins(heroMods.map.get(hero.id) ?? [])}
              isFavorite={favoriteHeroes.includes(hero.id)}
              onNavigate={() => goToHero(hero)}
              onToggleFavorite={() =>
                setFavoriteHeroes((prev) =>
                  prev.includes(hero.id)
                    ? prev.filter((id) => id !== hero.id)
                    : [...prev, hero.id]
                )
              }
            />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {heroList.map((hero) => (
            <HeroCard
              key={hero.id}
              hero={hero}
              mods={heroMods.map.get(hero.id) ?? []}
              onSelect={(modId) => setActiveSkin(hero.id, modId)}
              onToggleVariant={(modId) => toggleHeroVariant(hero.id, modId)}
              isFavorite={favoriteHeroes.includes(hero.id)}
              onToggleFavorite={() =>
                setFavoriteHeroes((prev) =>
                  prev.includes(hero.id)
                    ? prev.filter((id) => id !== hero.id)
                    : [...prev, hero.id]
                )
              }
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
          ))}
        </div>
      )}

      {viewMode === 'list' && (unassignedSkins.length > 0 || unassignedSounds.length > 0) && (
        <div className="space-y-3">
          <SectionHeader>Unassigned</SectionHeader>
          <p className="text-xs text-text-secondary -mt-1">
            These mods couldn't be matched to a hero automatically. Tag one to
            move it into that hero's locker pile.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {[...unassignedSkins, ...unassignedSounds].map((skin) => {
              const mod = skin.primary;
              const subtitle =
                skin.variants.length > 1 ? `${skin.variants.length} files` : mod.fileName;
              const isSound = mod.sourceSection === 'Sound';

              return (
                <div
                  key={skin.key}
                  className="bg-bg-secondary border border-border rounded-lg p-3 flex items-center gap-3 text-left"
                >
                  <div className="w-14 h-14 rounded-md overflow-hidden bg-bg-tertiary flex-shrink-0">
                    <ModThumbnail
                      src={mod.thumbnailUrl}
                      alt={mod.name}
                      nsfw={mod.nsfw}
                      hideNsfw={settings?.hideNsfwPreviews ?? false}
                      className="w-full h-full"
                      fallback={
                        <div className="w-full h-full flex items-center justify-center text-text-secondary text-xs">
                          No preview
                        </div>
                      }
                    />
                  </div>
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <div className="font-medium truncate" title={mod.name}>
                      {mod.name}
                    </div>
                    <div className="text-xs text-text-secondary truncate" title={subtitle}>
                      {isSound ? 'Sound · ' : ''}
                      {subtitle}
                    </div>
                    <select
                      aria-label={`Tag ${mod.name} as a hero`}
                      value={mod.lockerHero ?? ''}
                      onChange={(event) => {
                        const next = event.target.value;
                        void tagModHero(mod.id, next.length > 0 ? next : null);
                      }}
                      className="w-full bg-bg-tertiary border border-border rounded-md px-2 py-1 text-xs text-text-primary hover:border-accent/60 cursor-pointer"
                    >
                      <option value="">Tag as hero…</option>
                      {tagHeroOptions.map((hero) => (
                        <option key={hero.id} value={hero.name}>
                          {hero.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>

      {selectedHero && (
        <div
          className="fixed bottom-0 right-0 top-0 z-30 overflow-hidden bg-bg-primary animate-fade-in transition-[left] duration-200 ease-out"
          style={{ left: 'var(--grimoire-sidebar-width, 14rem)' }}
        >
          <LockerHeroView
            key={selectedHero.id}
            hero={selectedHero}
            skinList={selectedHeroMods}
            soundList={selectedHeroSoundList}
            skinCount={selectedHeroSkinCount}
            isFavorite={favoriteHeroes.includes(selectedHero.id)}
            onBack={() => navigate('/locker')}
            onToggleFavorite={() =>
              setFavoriteHeroes((prev) =>
                prev.includes(selectedHero.id)
                  ? prev.filter((id) => id !== selectedHero.id)
                  : [...prev, selectedHero.id]
              )
            }
            onSelect={(modId) => setActiveSkin(selectedHero.id, modId)}
            onToggleVariant={(modId) => toggleHeroVariant(selectedHero.id, modId)}
            hideNsfwPreviews={settings?.hideNsfwPreviews ?? false}
            minaPresets={selectedHero.name === 'Mina' ? minaPresets : []}
            activeMinaPreset={selectedHero.name === 'Mina' ? activeMinaPreset : undefined}
            minaTextures={selectedHero.name === 'Mina' ? minaTextures : []}
            onApplyMinaPreset={selectedHero.name === 'Mina' ? applyMinaPreset : undefined}
            minaArchivePath={selectedHero.name === 'Mina' ? minaArchivePath : undefined}
            onMinaArchivePathChange={selectedHero.name === 'Mina' ? setMinaArchivePath : undefined}
            minaVariants={selectedHero.name === 'Mina' ? minaVariants : []}
            minaVariantsLoading={selectedHero.name === 'Mina' ? minaVariantsLoading : false}
            minaVariantsError={selectedHero.name === 'Mina' ? minaVariantsError : null}
            onLoadMinaVariants={selectedHero.name === 'Mina' ? loadMinaVariants : undefined}
            minaSelection={selectedHero.name === 'Mina' ? minaSelection : undefined}
            onMinaSelectionChange={selectedHero.name === 'Mina' ? setMinaSelection : undefined}
            selectedMinaVariant={selectedHero.name === 'Mina' ? selectedMinaVariant : undefined}
            onApplyMinaVariant={selectedHero.name === 'Mina' ? applyMinaVariantSelection : undefined}
          />
        </div>
      )}

      {selectedHeroMissing && (
        <div
          className="fixed bottom-0 right-0 top-0 z-30 overflow-hidden bg-bg-primary animate-fade-in transition-[left] duration-200 ease-out"
          style={{ left: 'var(--grimoire-sidebar-width, 14rem)' }}
        >
          <div className="flex h-full flex-col items-center justify-center p-6 text-text-secondary">
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
        </div>
      )}
    </>
  );
}


interface HeroCardProps {
  hero: HeroCategory;
  mods: Mod[];
  onSelect: (modId: string) => void;
  onToggleVariant: (modId: string) => void;
  isFavorite: boolean;
  onToggleFavorite: () => void;
  hideNsfwPreviews: boolean;
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

interface HeroGalleryCardProps {
  hero: HeroCategory;
  skinCount: number;
  isFavorite: boolean;
  onNavigate: () => void;
  onToggleFavorite: () => void;
}

function HeroGallerySkeleton() {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-border bg-bg-secondary">
      <Skeleton className="relative aspect-[3/4]" rounded="none" />
      <div className="absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-black/70 to-transparent" />
      <div className="absolute bottom-0 left-0 right-0 p-3 space-y-1.5">
        <Skeleton className="h-3 w-2/3" rounded="sm" />
        <Skeleton className="h-2 w-1/3" rounded="sm" />
      </div>
    </div>
  );
}

function HeroGalleryCard({
  hero,
  skinCount,
  isFavorite,
  onNavigate,
  onToggleFavorite,
}: HeroGalleryCardProps) {
  const renderLocal = getHeroRenderPath(hero.name);
  const wikiUrl = getHeroWikiUrl(hero.name);
  const namePath = getHeroNamePath(hero.name);
  const facePositionX = getHeroFacePosition(hero.name);
  const [fallbackStep, setFallbackStep] = useState(0);
  const [nameFailed, setNameFailed] = useState(false);
  const [hasIntersected, setHasIntersected] = useState(false);
  const [renderLoaded, setRenderLoaded] = useState(false);
  const [nameLoaded, setNameLoaded] = useState(false);
  const cardRef = useRef<HTMLDivElement | null>(null);

  // Card art loads once IntersectionObserver sees it scroll into view, or
  // immediately on platforms without IntersectionObserver. Derived rather
  // than chained setState-in-effects.
  const supportsIntersectionObserver =
    typeof window !== 'undefined' && 'IntersectionObserver' in window;
  const isVisible = hasIntersected || !supportsIntersectionObserver;

  const renderSrc = !isVisible
    ? ''
    : fallbackStep === 0
      ? renderLocal
      : fallbackStep === 1
        ? wikiUrl
        : fallbackStep === 2
          ? (hero.iconUrl ?? '')
          : '';

  useEffect(() => {
    if (isVisible) return;
    const node = cardRef.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setHasIntersected(true);
          observer.disconnect();
        }
      },
      { rootMargin: '200px' }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [isVisible]);

  const handleRenderError = () => {
    setRenderLoaded(false);
    if (fallbackStep === 0) {
      setFallbackStep(1);
      return;
    }
    if (fallbackStep === 1 && hero.iconUrl) {
      setFallbackStep(2);
      return;
    }
    setFallbackStep(3);
  };

  return (
    <div
      onClick={onNavigate}
      ref={cardRef}
      className="group relative w-full overflow-hidden rounded-2xl border border-border bg-bg-secondary text-left shadow-sm transition-transform duration-300 hover:-translate-y-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70 cursor-pointer"
      style={{ contentVisibility: 'auto', containIntrinsicSize: '0 200px' }}
    >
      <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-transparent opacity-80" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(255,255,255,0.06),_transparent_55%)] opacity-60 transition-opacity duration-300 group-hover:opacity-100" />
      <div className="relative aspect-[3/4]">
        {/* Shimmer shows whenever the image hasn't decoded yet or we're
            still waiting for the IntersectionObserver to reveal the card.
            Always painted at least once because we don't short-circuit
            onLoad based on img.complete — locally-bundled images would
            otherwise skip the skeleton entirely. */}
        {!renderLoaded && fallbackStep < 3 && (
          <div className="absolute inset-0 skeleton-shimmer bg-bg-tertiary" aria-hidden />
        )}
        {renderSrc && fallbackStep < 3 && (
          <img
            ref={(el) => {
              if (el && el.complete && el.naturalWidth > 0) setRenderLoaded(true);
            }}
            src={renderSrc}
            alt={hero.name}
            className={`absolute inset-0 h-full w-full object-cover will-change-transform backface-visibility-hidden group-hover:scale-[1.06] scale-100 ${renderLoaded ? 'opacity-100' : 'opacity-0'} transition-[opacity,transform] duration-500`}
            style={{
              objectPosition: `${facePositionX}% 20%`,
              imageRendering: 'auto',
              transform: 'translateZ(0)',
            }}
            decoding="async"
            onLoad={() => setRenderLoaded(true)}
            onError={handleRenderError}
          />
        )}
        {fallbackStep === 3 && (
          <div className="absolute inset-0 flex items-center justify-center text-text-secondary">
            {hero.name}
          </div>
        )}
      </div>
      {/* Favorite toggle. Favorited cards keep a pinned filled star so the
          state reads at a glance in the sorted grid. Un-favorited cards keep
          the same slot but reveal a softer outline-star on hover, restoring
          the hover-to-favorite affordance. */}
      <button
        type="button"
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onToggleFavorite();
        }}
        aria-label={isFavorite ? 'Unfavorite' : 'Favorite'}
        title={isFavorite ? 'Unfavorite' : 'Favorite'}
        className={`absolute right-2 top-2 z-20 flex items-center justify-center rounded-full border p-1 transition-opacity ${
          isFavorite
            ? 'border-yellow-400/60 bg-yellow-400/20 text-yellow-300 opacity-100'
            : 'border-white/30 bg-black/40 text-white/85 backdrop-blur-sm opacity-0 group-hover:opacity-100 focus-visible:opacity-100 hover:bg-black/60'
        }`}
      >
        <Star className={`w-3 h-3 ${isFavorite ? 'fill-current' : ''}`} />
      </button>
      <div className="absolute bottom-0 left-0 right-0 p-2 sm:p-3 flex flex-col items-end text-right">
        {nameFailed ? (
          <div className="text-sm font-semibold text-white drop-shadow-[0_2px_12px_rgba(0,0,0,0.6)]">{hero.name}</div>
        ) : (
          <div className="relative w-[70%] h-6 sm:h-7 ml-auto">
            {!nameLoaded && (
              <div className="absolute inset-0 skeleton-shimmer bg-white/10 rounded-sm" aria-hidden />
            )}
            <img
              ref={(el) => {
                // Sub-100KB PNGs over file:// can finish loading before React
                // attaches onLoad, leaving the image cached but stuck at
                // opacity-0. Sync the state from img.complete on every mount.
                if (el && el.complete && el.naturalWidth > 0) setNameLoaded(true);
              }}
              src={namePath}
              alt={hero.name}
              className={`absolute inset-0 w-full h-full object-contain object-right drop-shadow-[0_2px_12px_rgba(0,0,0,0.6)] will-change-transform backface-visibility-hidden group-hover:scale-105 scale-100 ${nameLoaded ? 'opacity-100' : 'opacity-0'} transition-[opacity,transform] duration-500`}
              style={{ transform: 'translateZ(0)' }}
              decoding="async"
              onLoad={() => setNameLoaded(true)}
              onError={() => setNameFailed(true)}
            />
          </div>
        )}
        {skinCount > 0 && (
          <div className="mt-1 text-[10px] text-white/70">
            {skinCount} skin{skinCount !== 1 ? 's' : ''}
          </div>
        )}
      </div>
    </div>
  );
}

function HeroCard({
  hero,
  mods,
  onSelect,
  onToggleVariant,
  isFavorite,
  onToggleFavorite,
  hideNsfwPreviews,
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
  const localUrl = getHeroRenderPath(hero.name);
  const wikiUrl = getHeroWikiUrl(hero.name);
  const [iconSrc, setIconSrc] = useState(() => localUrl);
  const [fallbackStep, setFallbackStep] = useState(0);
  const skinCount = useMemo(() => countLockerSkins(mods), [mods]);

  const handleError = () => {
    if (fallbackStep === 0) {
      setIconSrc(wikiUrl);
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
            {skinCount > 0 ? `${skinCount} skin${skinCount !== 1 ? 's' : ''}` : 'No skins installed'}
          </div>
        </div>
        <button
          type="button"
          onClick={onToggleFavorite}
          className={`ml-auto p-2 rounded-md transition-colors ${isFavorite ? 'text-yellow-400' : 'text-text-secondary hover:text-text-primary'
            }`}
          title={isFavorite ? 'Unfavorite' : 'Favorite'}
        >
          <Star className="w-4 h-4" />
        </button>
      </div>

      <div className="p-3">
        <HeroSkinsPanel
          mods={mods}
          onSelect={onSelect}
          onToggleVariant={onToggleVariant}
          hideNsfwPreviews={hideNsfwPreviews}
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
  );
}
