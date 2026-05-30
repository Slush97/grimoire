import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ArrowLeft, Check, ChevronDown, ChevronsDownUp, ChevronsUpDown, Layers, MoreVertical, Music, PowerOff, Shield, Shirt, Star } from 'lucide-react';
import { useAppStore } from '../stores/appStore';
import {
  applyMinaVariant,
  getGamebananaCategories,
  listMinaVariants,
  setMinaPreset,
  setModGlobalType,
  setModLockerHero,
} from '../lib/api';
import { getActiveDeadlockPath } from '../lib/appSettings';
import { getAssetPath } from '../lib/assetPath';
import HeroSkinsPanel from '../components/locker/HeroSkinsPanel';
import { LockerHeroView } from './LockerHero';
import ModThumbnail from '../components/ModThumbnail';

// Heavy (three.js): only pulled in when the soul-container type is viewed.
const SoulContainerViewer = lazy(() => import('../components/locker/SoulContainerViewer'));
import AudioPreviewPlayer from '../components/AudioPreviewPlayer';
import type { GameBananaCategoryNode } from '../types/gamebanana';
import type { GlobalModType, Mod } from '../types/mod';
import { ViewModeToggle, EmptyState, SectionHeader } from '../components/common/PageComponents';
import { Tag } from '../components/common/ui';
import { Skeleton } from '../components/common/Skeleton';
import { HeroSelect } from '../components/common/HeroSelect';
import {
  FAVORITE_HEROES_KEY,
  GLOBAL_MOD_TYPE_LABELS,
  GLOBAL_MOD_TYPE_ORDER,
  MINA_ARCHIVE_DEFAULT,
  buildHeroList,
  buildMinaPresets,
  countGlobalMods,
  countLockerSkins,
  detectMinaTextures,
  findMinaVariant,
  getEffectiveGlobalType,
  getHeroFacePosition,
  getHeroNamePath,
  getHeroRenderPath,
  getHeroWikiUrl,
  groupGlobalMods,
  groupLockerSkins,
  groupModsByCategory,
  isLockerManagedMod,
  isLockerManagedSound,
  parseMinaVariant,
  readStoredFavorites,
  type GlobalModGroups,
  type HeroCategory,
  type MinaPreset,
  type MinaSelection,
  type MinaVariant,
} from '../lib/lockerUtils';

let lockerPageScrollTop = 0;
let lockerCategoriesCache: GameBananaCategoryNode[] | null = null;
const lockerLoadedImageUrls = new Set<string>();
const lockerLoadingImageUrls = new Set<string>();
const lockerImageListeners = new Set<() => void>();

function rememberLockerImageLoaded(src: string | undefined) {
  if (!src || lockerLoadedImageUrls.has(src)) return;
  lockerLoadedImageUrls.add(src);
  for (const listener of lockerImageListeners) listener();
}

function prewarmLockerImage(src: string | undefined) {
  if (!src || typeof window === 'undefined') return;
  if (lockerLoadedImageUrls.has(src) || lockerLoadingImageUrls.has(src)) return;
  lockerLoadingImageUrls.add(src);
  const image = new Image();
  image.decoding = 'async';
  image.onload = () => {
    lockerLoadingImageUrls.delete(src);
    rememberLockerImageLoaded(src);
  };
  image.onerror = () => {
    lockerLoadingImageUrls.delete(src);
  };
  image.src = src;
}

export default function Locker() {
  const { settings, mods, modsLoading, modsError, loadSettings, loadMods, toggleMod } =
    useAppStore();
  const activeDeadlockPath = getActiveDeadlockPath(settings);
  const [categories, setCategories] = useState<GameBananaCategoryNode[]>(
    () => lockerCategoriesCache ?? []
  );
  const [categoriesLoading, setCategoriesLoading] = useState(false);
  const [categoriesError, setCategoriesError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'gallery' | 'list'>(() => {
    const stored = localStorage.getItem('lockerViewMode');
    return stored === 'list' ? 'list' : 'gallery';
  });
  // List-view accordion state. Empty set = every hero collapsed (the default),
  // so the list reads as a compact set of rows until the user opens one.
  const [expandedHeroes, setExpandedHeroes] = useState<Set<number>>(() => new Set());
  const toggleHeroExpanded = useCallback((heroId: number) => {
    setExpandedHeroes((prev) => {
      const next = new Set(prev);
      if (next.has(heroId)) {
        next.delete(heroId);
      } else {
        next.add(heroId);
      }
      return next;
    });
  }, []);
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
  const lockerScrollRef = useRef<HTMLDivElement | null>(null);
  const latestLockerScrollTopRef = useRef(lockerPageScrollTop);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  useEffect(() => {
    if (activeDeadlockPath) {
      loadMods({ silent: useAppStore.getState().modsLoaded });
    }
  }, [activeDeadlockPath, loadMods]);

  // Refresh on any completed download so a newly-installed mod (and its
  // freshly-classified globalType) surfaces here without leaving the page,
  // matching the Installed page's behavior.
  useEffect(() => {
    if (!activeDeadlockPath) return;
    const unsubscribe = window.electronAPI.onDownloadComplete(() => {
      loadMods();
    });
    return unsubscribe;
  }, [activeDeadlockPath, loadMods]);

  useEffect(() => {
    let active = true;
    const loadCategories = async () => {
      const hasCache = lockerCategoriesCache !== null;
      if (!hasCache) setCategoriesLoading(true);
      setCategoriesError(null);
      try {
        const data = await getGamebananaCategories('ModCategory');
        lockerCategoriesCache = data;
        if (!active) return;
        setCategories(data);
      } catch (err) {
        if (active) {
          setCategoriesError(String(err));
        }
      } finally {
        if (active && !hasCache) {
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
  const globalSelected = useMemo(
    () => /^\/locker\/global\/?$/.test(location.pathname),
    [location.pathname]
  );

  // Build basic hero list first (needed for mod categorization)
  const baseHeroList = useMemo(() => buildHeroList(categories), [categories]);

  // Global-typed mods live on their own axis (the Global card / drill-in), so
  // keep them out of the hero grouping entirely. Without this a fuzzy name
  // match would file e.g. "Lowpoly Holliday Soul Container" into Holliday's
  // pile instead of Soul Containers.
  const lockerMods = useMemo(
    () => mods.filter((m) => isLockerManagedMod(m) && !getEffectiveGlobalType(m)),
    [mods]
  );
  // Killstreak Music sounds are global (match-wide, no hero), so keep them off
  // the per-hero Sounds axis even when GameBanana filed them under a hero or
  // inferHeroFromTitle tagged one. getEffectiveGlobalType reflects that routing.
  const lockerSounds = useMemo(
    () => mods.filter((m) => isLockerManagedSound(m) && !getEffectiveGlobalType(m)),
    [mods]
  );
  const globalGroups = useMemo(() => groupGlobalMods(mods), [mods]);
  const globalCount = useMemo(() => countGlobalMods(mods), [mods]);
  const globalTypeCount = useMemo(
    () => GLOBAL_MOD_TYPE_ORDER.filter((type) => globalGroups[type].length > 0).length,
    [globalGroups]
  );

  // Calculate heroMods, passing heroList for name-based category inference
  const heroMods = useMemo(() => {
    return groupModsByCategory(lockerMods, baseHeroList);
  }, [lockerMods, baseHeroList]);
  const heroSounds = useMemo(() => {
    return groupModsByCategory(lockerSounds, baseHeroList);
  }, [lockerSounds, baseHeroList]);
  const installedSkinCount = useMemo(() => countLockerSkins(lockerMods), [lockerMods]);
  const installedSoundCount = useMemo(() => countLockerSkins(lockerSounds), [lockerSounds]);
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
      // Then heroes with any locker content (skins or sounds)
      const aHasContent =
        countLockerSkins(heroMods.map.get(a.id) ?? []) > 0 ||
        countLockerSkins(heroSounds.map.get(a.id) ?? []) > 0;
      const bHasContent =
        countLockerSkins(heroMods.map.get(b.id) ?? []) > 0 ||
        countLockerSkins(heroSounds.map.get(b.id) ?? []) > 0;
      if (aHasContent !== bHasContent) return aHasContent ? -1 : 1;
      // Then alphabetically
      return a.name.localeCompare(b.name);
    });
  }, [baseHeroList, favoriteHeroes, heroMods, heroSounds]);
  const allExpanded =
    heroList.length > 0 && heroList.every((hero) => expandedHeroes.has(hero.id));
  const toggleExpandAll = useCallback(() => {
    setExpandedHeroes((prev) => {
      const everyOpen =
        heroList.length > 0 && heroList.every((hero) => prev.has(hero.id));
      return everyOpen ? new Set() : new Set(heroList.map((hero) => hero.id));
    });
  }, [heroList]);
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

  useEffect(() => {
    for (const hero of heroList) {
      prewarmLockerImage(getHeroRenderPath(hero.name));
      prewarmLockerImage(getHeroNamePath(hero.name));
    }
  }, [heroList]);

  useLayoutEffect(() => {
    let frame: number | null = null;
    let attempts = 0;
    const restoreScroll = () => {
      const container = lockerScrollRef.current;
      if (!container || lockerPageScrollTop <= 0) return;
      const maxScrollTop = Math.max(0, container.scrollHeight - container.clientHeight);
      if (maxScrollTop <= 0 && attempts < 8) {
        attempts += 1;
        frame = window.requestAnimationFrame(restoreScroll);
        return;
      }
      const target = Math.min(lockerPageScrollTop, maxScrollTop);
      container.scrollTop = target;
      latestLockerScrollTopRef.current = lockerPageScrollTop;
    };
    restoreScroll();
    frame = window.requestAnimationFrame(restoreScroll);
    return () => {
      if (frame !== null) window.cancelAnimationFrame(frame);
    };
  }, [modsLoading, categoriesLoading, heroList.length, viewMode]);

  useEffect(() => {
    const container = lockerScrollRef.current;
    if (!container) return;
    const onScroll = () => {
      latestLockerScrollTopRef.current = container.scrollTop;
      lockerPageScrollTop = container.scrollTop;
    };
    container.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      container.removeEventListener('scroll', onScroll);
    };
  }, [modsLoading, categoriesLoading]);

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
      await loadMods({ silent: true });
    } catch (err) {
      console.error('[Locker] Failed to set lockerHero override:', err);
    }
  };

  // Manual override for the Global axis: reassign a mod to another global type,
  // or pass null to drop it off the Global axis entirely (see set-mod-global-type).
  const tagModGlobalType = async (modId: string, globalType: GlobalModType | null) => {
    try {
      await setModGlobalType(modId, globalType);
      await loadMods();
    } catch (err) {
      console.error('[Locker] Failed to set globalType override:', err);
    }
  };

  const applyMinaPreset = async (presetFileName: string) => {
    try {
      await setMinaPreset(presetFileName);
      await loadMods({ silent: true });
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
      await loadMods({ silent: true });
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
    <div ref={lockerScrollRef} className="h-full overflow-y-auto">
      <div className="p-6 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm text-text-secondary">
          {[
            `${heroList.length} heroes`,
            `${installedSkinCount} skin${installedSkinCount !== 1 ? 's' : ''}`,
            installedSoundCount > 0
              ? `${installedSoundCount} sound${installedSoundCount !== 1 ? 's' : ''}`
              : null,
          ]
            .filter(Boolean)
            .join(' • ')}
        </div>
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
          {viewMode === 'list' && heroList.length > 0 && (
            <button
              onClick={toggleExpandAll}
              className="flex items-center gap-1.5 self-stretch rounded-sm border border-border bg-bg-secondary px-3 text-sm text-text-secondary hover:text-text-primary hover:bg-bg-tertiary transition-colors cursor-pointer"
              title={allExpanded ? 'Collapse all heroes' : 'Expand all heroes'}
            >
              {allExpanded ? (
                <ChevronsDownUp className="w-4 h-4" />
              ) : (
                <ChevronsUpDown className="w-4 h-4" />
              )}
              {allExpanded ? 'Collapse all' : 'Expand all'}
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
      </div>

      {heroList.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-64 text-text-secondary">
          <Layers className="w-12 h-12 mb-3 opacity-50" />
          <p>No hero categories found.</p>
        </div>
      ) : viewMode === 'gallery' ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
          {globalCount > 0 && (
            <GlobalGalleryCard
              count={globalCount}
              typeCount={globalTypeCount}
              onNavigate={() => navigate('/locker/global')}
            />
          )}
          {heroList.map((hero) => (
            <HeroGalleryCard
              key={hero.id}
              hero={hero}
              skinCount={countLockerSkins(heroMods.map.get(hero.id) ?? [])}
              soundCount={countLockerSkins(heroSounds.map.get(hero.id) ?? [])}
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
          {globalCount > 0 && (
            <button
              type="button"
              onClick={() => navigate('/locker/global')}
              className="group relative flex items-center gap-3 overflow-hidden rounded-lg border border-accent/40 bg-bg-secondary p-4 text-left transition-colors hover:border-accent/70"
            >
              {/* Environment art bleeds behind the card; the left-to-right
                  gradient keeps the text side dark, mirroring the list-view
                  hero cards. */}
              <img
                src={GLOBAL_BG}
                alt=""
                aria-hidden
                className="pointer-events-none absolute inset-0 h-full w-full object-cover object-center"
              />
              <div
                aria-hidden
                className="pointer-events-none absolute inset-0 bg-gradient-to-r from-bg-secondary via-bg-secondary/80 to-bg-secondary/30"
              />
              <div className="relative z-10 min-w-0 flex-1">
                <div className="font-semibold text-text-primary drop-shadow-[0_1px_4px_rgba(0,0,0,0.7)]">
                  Global
                </div>
                <div className="text-xs text-text-secondary drop-shadow-[0_1px_3px_rgba(0,0,0,0.7)]">
                  {globalCount} mod{globalCount !== 1 ? 's' : ''} · {globalTypeCount} categor
                  {globalTypeCount !== 1 ? 'ies' : 'y'}
                </div>
              </div>
              <ChevronDown className="relative z-10 h-4 w-4 -rotate-90 text-text-secondary" />
            </button>
          )}
          {heroList.map((hero) => (
            <HeroCard
              key={hero.id}
              hero={hero}
              mods={heroMods.map.get(hero.id) ?? []}
              sounds={heroSounds.map.get(hero.id) ?? []}
              expanded={expandedHeroes.has(hero.id)}
              onToggleExpanded={() => toggleHeroExpanded(hero.id)}
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
              hideNsfwPreviews={settings?.hideNsfwPreviews ?? true}
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
                      hideNsfw={settings?.hideNsfwPreviews ?? true}
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
                    <HeroSelect
                      ariaLabel={`Tag ${mod.name} as a hero`}
                      value={mod.lockerHero ?? ''}
                      onChange={(next) => {
                        void tagModHero(mod.id, next.length > 0 ? next : null);
                      }}
                      size="sm"
                      options={[
                        { value: '', label: 'Tag as hero...', muted: true },
                        ...tagHeroOptions.map((hero) => ({
                          value: hero.name,
                          label: hero.name,
                          heroName: hero.name,
                        })),
                      ]}
                    />
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
            hideNsfwPreviews={settings?.hideNsfwPreviews ?? true}
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
      {globalSelected && (
        <div
          className="fixed bottom-0 right-0 top-0 z-30 overflow-hidden bg-bg-primary animate-fade-in transition-[left] duration-200 ease-out"
          style={{ left: 'var(--grimoire-sidebar-width, 14rem)' }}
        >
          <LockerGlobalView
            groups={globalGroups}
            hideNsfw={settings?.hideNsfwPreviews ?? true}
            onBack={() => navigate('/locker')}
            onToggle={toggleMod}
            onSetGlobalType={tagModGlobalType}
          />
        </div>
      )}
    </div>
  );
}


interface HeroCardProps {
  hero: HeroCategory;
  mods: Mod[];
  sounds: Mod[];
  expanded: boolean;
  onToggleExpanded: () => void;
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
  soundCount: number;
  isFavorite: boolean;
  onNavigate: () => void;
  onToggleFavorite: () => void;
}

const GLOBAL_BG = getAssetPath('/locker/global-bg.webp');

interface GlobalGalleryCardProps {
  count: number;
  typeCount: number;
  onNavigate: () => void;
}

/**
 * Gallery tile for the global (non-hero) cosmetics, sized to match the hero
 * cards. Heroes have render art; Global leans on the environment backdrop +
 * an icon for its own identity. Clicking drills into LockerGlobalView.
 */
function GlobalGalleryCard({ count, typeCount, onNavigate }: GlobalGalleryCardProps) {
  return (
    <div
      onClick={onNavigate}
      className="group relative w-full cursor-pointer overflow-hidden rounded-2xl border border-border bg-bg-secondary text-left shadow-sm transition-transform duration-300 hover:-translate-y-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70"
    >
      <div className="relative aspect-[3/4]">
        <img
          src={GLOBAL_BG}
          alt=""
          aria-hidden
          className="absolute inset-0 h-full w-full object-cover object-center transition-transform duration-500 group-hover:scale-[1.06]"
        />
        {/* Subtle top highlight for depth, matching the hero cards. */}
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(255,255,255,0.06),_transparent_55%)] opacity-60 transition-opacity duration-300 group-hover:opacity-100" />
        <div className="absolute left-2 top-2 z-20 rounded-full bg-black/45 px-2 py-0.5 text-[10px] font-medium text-white/85 backdrop-blur-sm">
          {count} mod{count !== 1 ? 's' : ''}
        </div>
      </div>
      <div className="absolute inset-x-0 bottom-0 flex flex-col items-end bg-gradient-to-t from-black/70 to-transparent p-2 text-right sm:p-3">
        <div className="font-reaver text-lg leading-tight tracking-wide text-white drop-shadow-[0_2px_12px_rgba(0,0,0,0.6)]">
          Global
        </div>
        <div className="text-[11px] text-white/70 drop-shadow-[0_2px_12px_rgba(0,0,0,0.6)]">
          {typeCount} categor{typeCount !== 1 ? 'ies' : 'y'}
        </div>
      </div>
    </div>
  );
}

interface LockerGlobalViewProps {
  groups: GlobalModGroups;
  hideNsfw: boolean;
  onBack: () => void;
  onToggle: (modId: string) => void | Promise<unknown>;
  /** Reassign a mod to another global type, or null to drop it off the axis. */
  onSetGlobalType: (modId: string, globalType: GlobalModType | null) => void | Promise<unknown>;
}

/**
 * Drill-in panel for the Global card: a Deadlock environment backdrop under a
 * frosted-glass carousel of cosmetic types (echoing the LockerHeroView shell's
 * art + blur language). Selecting a tile reveals that type's toggleable mods.
 */
function LockerGlobalView({ groups, hideNsfw, onBack, onToggle, onSetGlobalType }: LockerGlobalViewProps) {
  const available = GLOBAL_MOD_TYPE_ORDER.filter((type) => groups[type].length > 0);
  const [selectedType, setSelectedType] = useState<GlobalModType>(
    () => available[0] ?? 'soul-container'
  );
  // Open retag menu, anchored in viewport coords (fixed-positioned) so it never
  // clips against the scrolling card pane. Null when closed.
  const [retagMenu, setRetagMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  // Close the menu on any scroll / resize / Escape — a fixed menu would
  // otherwise float away from its anchor once the pane scrolls.
  useEffect(() => {
    if (!retagMenu) return;
    const close = () => setRetagMenu(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setRetagMenu(null);
    };
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
      window.removeEventListener('keydown', onKey);
    };
  }, [retagMenu]);
  // Guard against the selected type emptying out (e.g. last mod deleted) by
  // falling back to the first non-empty type at render time.
  const activeType = groups[selectedType]?.length ? selectedType : available[0];
  const activeMods = activeType ? groups[activeType] : [];
  const total = GLOBAL_MOD_TYPE_ORDER.reduce((sum, type) => sum + groups[type].length, 0);

  return (
    <div className="relative flex h-full overflow-hidden">
      {/* Background art (Deadlock environment), full-bleed behind both panels.
          A moderate overlay keeps the right-pane cards legible; the bottom
          gradient adds depth, matching the LockerHeroView shell. */}
      <div className="absolute inset-0 overflow-hidden bg-bg-primary">
        <img
          src={GLOBAL_BG}
          alt=""
          aria-hidden
          className="absolute inset-0 h-full w-full object-cover object-center animate-hero-zoom-in"
        />
        <div className="absolute inset-0 bg-bg-primary/55" />
        <div className="absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t from-black/50 to-transparent" />
      </div>

      {/* Progressive frosted-glass background — the same feathered, hard-edge-free
          treatment as LockerHeroView. Three stacked blur layers, each masked with
          a longer taper so the effective blur softens from heavy to clear instead
          of stopping on a border. The container is far wider than the sidebar so
          the gradient has runway to feather all the way out. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-y-0 left-0 z-[5] hidden lg:block lg:w-[560px] xl:w-[620px]"
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

      {/* Left sidebar: type selector. Transparent on lg so the feathered glass
          above shows through; slides in like the hero panel. */}
      <div className="relative z-10 flex w-[260px] flex-shrink-0 flex-col gap-6 overflow-y-auto scrollbar-glass bg-bg-secondary p-6 animate-slide-in-left lg:w-[300px] lg:bg-transparent xl:w-[340px]">
        <button
          type="button"
          onClick={onBack}
          className="flex w-fit items-center gap-2 text-sm text-text-secondary transition-colors hover:text-text-primary"
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </button>

        <div className="flex items-baseline gap-2">
          <h2 className="text-lg font-semibold text-white drop-shadow-[0_2px_12px_rgba(0,0,0,0.6)]">
            Global
          </h2>
          <span className="text-xs text-white/60">
            {total} mod{total !== 1 ? 's' : ''}
          </span>
        </div>

        <nav className="flex flex-col gap-1.5">
          {GLOBAL_MOD_TYPE_ORDER.map((type) => {
            const items = groups[type];
            const isActive = type === activeType;
            const isEmpty = items.length === 0;
            return (
              <button
                key={type}
                type="button"
                disabled={isEmpty}
                onClick={() => setSelectedType(type)}
                className={`flex items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors ${
                  isEmpty
                    ? 'cursor-default border-transparent opacity-40'
                    : isActive
                      ? 'border-accent/60 bg-accent/15'
                      : 'border-transparent hover:bg-white/10'
                }`}
              >
                <span className="flex-1 truncate text-sm font-medium text-white">
                  {GLOBAL_MOD_TYPE_LABELS[type]}
                </span>
                <span className="text-xs text-white/50">{items.length}</span>
              </button>
            );
          })}
        </nav>
      </div>

      {/* Right pane: the selected type's mods as cards */}
      <div className="relative z-10 flex-1 overflow-y-auto scrollbar-glass">
        <div className="space-y-4 p-6">
          {activeType ? (
            <>
              <div className="flex items-baseline gap-2">
                <h3 className="text-base font-semibold text-white drop-shadow-[0_2px_12px_rgba(0,0,0,0.6)]">
                  {GLOBAL_MOD_TYPE_LABELS[activeType]}
                </h3>
                <span className="text-xs text-white/60">
                  {activeMods.length} mod{activeMods.length !== 1 ? 's' : ''}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-4 lg:grid-cols-3 2xl:grid-cols-4">
                {activeMods.map((mod) => {
                  // Skipped when NSFW previews are hidden so we never bleed
                  // hidden imagery into the glass tint, even blurred.
                  const glassBackdropUrl =
                    mod.thumbnailUrl && !(mod.nsfw && hideNsfw) ? mod.thumbnailUrl : null;
                  return (
                    <div
                      key={mod.id}
                      className={`group/card relative flex flex-col rounded-[10px] border p-2.5 transition-[border-color,background-color,box-shadow] duration-200 ${
                        mod.enabled
                          ? 'border-accent bg-accent/[0.08] shadow-[0_0_0_1px_var(--color-accent),0_0_18px_-6px_var(--color-accent)] hover:bg-accent/[0.12]'
                          : 'border-white/[0.08] bg-[#141414]/55 text-text-primary/75 hover:border-white/[0.16] hover:text-text-primary'
                      }`}
                    >
                      {/* Glass backdrop: a blurred copy of the cover art bleeds
                          behind the card so it's tinted by its own thumbnail,
                          matching the Installed grid cards. Soul containers show
                          a 3D model on a clear window, so they skip it. */}
                      {glassBackdropUrl && activeType !== 'soul-container' && (
                        <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden rounded-[10px]">
                          <img
                            src={glassBackdropUrl}
                            alt=""
                            aria-hidden
                            draggable={false}
                            className={`h-full w-full scale-[1.35] object-cover blur-2xl saturate-[1.4] transition-opacity duration-200 ${
                              mod.enabled ? 'opacity-55' : 'opacity-30 grayscale-[0.4]'
                            }`}
                          />
                          <div className="absolute inset-0 bg-gradient-to-b from-[#0f0f0f]/45 via-[#0f0f0f]/65 to-[#0f0f0f]/[0.88]" />
                        </div>
                      )}

                      {/* Media: aspect-video cover. Soul containers float their
                          3D model over a frosted-glass panel so the environment
                          background shows through; other types keep a solid bg. */}
                      <div
                        className={`relative mb-2 aspect-video w-full overflow-hidden rounded-lg border border-white/[0.08] ${
                          activeType === 'soul-container' ? '' : 'bg-bg-tertiary'
                        }`}
                      >
                        {/* Frosted-glass panel for soul containers, kept as a
                            separate inner layer rather than on the media container
                            itself: a backdrop-filter turns its element into a
                            stacking context, which would sink this subtree (and
                            the retag kebab below) under the z-10 full-card toggle
                            and swallow the kebab's clicks. */}
                        {activeType === 'soul-container' && (
                          <div className="pointer-events-none absolute inset-0 bg-white/[0.04] backdrop-blur-md" />
                        )}
                        {/* Soul containers show a live 3D model on a clear window
                            (no 2D thumbnail behind it); other types show their
                            GameBanana thumbnail. */}
                        {activeType === 'soul-container' ? (
                          <Suspense fallback={null}>
                            <SoulContainerViewer modKey={mod.metaKey} />
                          </Suspense>
                        ) : (
                          <div
                            className={`h-full w-full transition-[filter,opacity] duration-200 ${
                              mod.enabled ? '' : 'grayscale-[0.6] opacity-[0.7]'
                            }`}
                          >
                            <ModThumbnail
                              src={mod.thumbnailUrl}
                              alt={mod.name}
                              nsfw={mod.nsfw}
                              hideNsfw={hideNsfw}
                              className="h-full w-full"
                              imageClassName="origin-center transform-gpu will-change-transform transition-transform duration-200 group-hover/card:scale-[1.03]"
                              fallback={
                                <div className="flex h-full w-full items-center justify-center text-xs text-text-secondary">
                                  No preview
                                </div>
                              }
                            />
                          </div>
                        )}
                        <div className="pointer-events-none absolute inset-0 bg-bg-primary/0 transition-colors duration-200 group-hover/card:bg-bg-primary/20" />
                        {!mod.enabled && (
                          <div className="pointer-events-none absolute left-2 top-2 z-10 flex h-5 items-start">
                            <Tag
                              tone="neutral"
                              variant="overlay"
                              icon={PowerOff}
                              title="This mod is disabled and not loaded in-game"
                            >
                              Disabled
                            </Tag>
                          </div>
                        )}
                        {/* Retag control: sits above the full-card toggle overlay
                            (z-20 > z-10) and stops propagation so opening it never
                            also toggles the mod. Hidden for Killstreak Music: that
                            type is derived from the GameBanana category, not a
                            manual assignment, and the sound belongs to no hero, so
                            there's nowhere meaningful to retag it. */}
                        {activeType !== 'killstreak-music' && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              const r = e.currentTarget.getBoundingClientRect();
                              const MENU_W = 208;
                              const MENU_H = 220;
                              const x = Math.max(
                                8,
                                Math.min(r.right - MENU_W, window.innerWidth - MENU_W - 8)
                              );
                              const y =
                                r.bottom + MENU_H > window.innerHeight
                                  ? Math.max(8, r.top - MENU_H - 4)
                                  : r.bottom + 4;
                              setRetagMenu({ id: mod.id, x, y });
                            }}
                            aria-label={`Change category for ${mod.name}`}
                            title="Change category"
                            className="absolute right-2 top-2 z-20 flex h-7 w-7 items-center justify-center rounded-md border border-white/15 bg-black/45 text-white/85 opacity-0 backdrop-blur-sm transition-opacity hover:bg-black/65 focus:opacity-100 focus-visible:opacity-100 group-hover/card:opacity-100"
                          >
                            <MoreVertical className="h-4 w-4" />
                          </button>
                        )}
                      </div>

                      {/* Title only — the whole card is the enable/disable control. */}
                      <div className="mt-auto px-0.5">
                        <h3
                          className="min-w-0 truncate text-[15px] font-semibold leading-[19px] text-text-primary"
                          title={mod.name}
                        >
                          {mod.name}
                        </h3>
                      </div>

                      {/* Audio preview for sound-backed global mods (Killstreak
                          Music). Sits above the full-card toggle overlay (z-20 >
                          z-10) and stops propagation so play/seek never also
                          toggles the mod, mirroring the hero Sounds tab. */}
                      {mod.audioUrl && (
                        <div
                          className="relative z-20 mt-2 px-0.5"
                          onClick={(e) => e.stopPropagation()}
                          onMouseDown={(e) => e.stopPropagation()}
                        >
                          <AudioPreviewPlayer src={mod.audioUrl} compact />
                        </div>
                      )}

                      {/* Full-card click target: clicking anywhere enables/disables
                          the mod. Kept as a transparent overlay (not a wrapping
                          button) so the heading/markup stays valid. */}
                      <button
                        type="button"
                        onClick={() => onToggle(mod.id)}
                        aria-pressed={mod.enabled}
                        aria-label={mod.enabled ? `Disable ${mod.name}` : `Enable ${mod.name}`}
                        title={mod.enabled ? 'Click to disable' : 'Click to enable'}
                        className="absolute inset-0 z-10 cursor-pointer rounded-[10px] focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/70"
                      />
                    </div>
                  );
                })}
              </div>
            </>
          ) : (
            <p className="text-sm text-white/70">No global (non-hero) cosmetics installed yet.</p>
          )}
        </div>
      </div>

      {/* Retag menu (fixed-positioned, anchored at the kebab's viewport coords so
          it never clips against the scrolling pane). */}
      {retagMenu && (
        <>
          <div
            className="fixed inset-0 z-[59]"
            aria-hidden
            onClick={() => setRetagMenu(null)}
          />
          <div
            role="menu"
            aria-label="Change global category"
            className="fixed z-[60] w-52 rounded-lg border border-border bg-bg-secondary p-1 shadow-xl animate-fade-in"
            style={{ top: retagMenu.y, left: retagMenu.x }}
          >
            <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-text-secondary">
              Move to category
            </div>
            {/* Killstreak Music is derived from the GameBanana category, not a
                manual destination, so it's not offered as a move target. */}
            {GLOBAL_MOD_TYPE_ORDER.filter((type) => type !== 'killstreak-music').map((type) => {
              const isCurrent = type === activeType;
              return (
                <button
                  key={type}
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    if (!isCurrent) void onSetGlobalType(retagMenu.id, type);
                    setRetagMenu(null);
                  }}
                  className={`flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-xs cursor-pointer hover:bg-bg-tertiary ${
                    isCurrent ? 'text-accent' : 'text-text-primary'
                  }`}
                >
                  {GLOBAL_MOD_TYPE_LABELS[type]}
                  {isCurrent && <Check className="h-3.5 w-3.5" />}
                </button>
              );
            })}
            <div className="my-1 h-px bg-border" />
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                void onSetGlobalType(retagMenu.id, null);
                setRetagMenu(null);
              }}
              className="w-full rounded px-2 py-1.5 text-left text-xs text-text-secondary hover:bg-bg-tertiary hover:text-text-primary cursor-pointer"
            >
              Remove from Global
            </button>
          </div>
        </>
      )}
    </div>
  );
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
  soundCount,
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
  const [, setImageCacheVersion] = useState(0);

  const renderSrc = fallbackStep === 0
    ? renderLocal
    : fallbackStep === 1
      ? wikiUrl
      : fallbackStep === 2
        ? (hero.iconUrl ?? '')
        : '';
  const isRenderReady = !!renderSrc && lockerLoadedImageUrls.has(renderSrc);

  useEffect(() => {
    const tick = () => setImageCacheVersion((version) => version + 1);
    lockerImageListeners.add(tick);
    return () => {
      lockerImageListeners.delete(tick);
    };
  }, []);

  useEffect(() => {
    prewarmLockerImage(renderSrc);
    prewarmLockerImage(namePath);
  }, [namePath, renderSrc]);

  const handleRenderError = () => {
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
      className="group relative w-full overflow-hidden rounded-2xl border border-border bg-bg-secondary text-left shadow-sm transition-transform duration-300 hover:-translate-y-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70 cursor-pointer"
    >
      <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-transparent opacity-80" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(255,255,255,0.06),_transparent_55%)] opacity-60 transition-opacity duration-300 group-hover:opacity-100" />
      <div className="relative aspect-[3/4]">
        {!isRenderReady && fallbackStep < 3 && (
          <div className="absolute inset-0 skeleton-shimmer bg-bg-tertiary" aria-hidden />
        )}
        {renderSrc && fallbackStep < 3 && (
          <>
            <div
              className="absolute inset-0 h-full w-full bg-cover will-change-transform backface-visibility-hidden group-hover:scale-[1.06] scale-100 transition-transform duration-500"
              style={{
                backgroundImage: `url(${JSON.stringify(renderSrc)})`,
                backgroundPosition: `${facePositionX}% 20%`,
                imageRendering: 'auto',
                transform: 'translateZ(0)',
              }}
              aria-label={hero.name}
              role="img"
            />
            <img
              src={renderSrc}
              alt=""
              aria-hidden
              className="pointer-events-none absolute h-px w-px opacity-0"
              decoding="async"
              onLoad={() => rememberLockerImageLoaded(renderSrc)}
              onError={handleRenderError}
            />
          </>
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
      {(skinCount > 0 || soundCount > 0) && (
        <div className="absolute left-2 top-2 z-20 flex items-center gap-2 rounded-full bg-black/45 px-2 py-0.5 text-[10px] font-medium text-white/85 backdrop-blur-sm">
          {skinCount > 0 && (
            <span
              className="flex items-center gap-1"
              title={`${skinCount} skin${skinCount !== 1 ? 's' : ''}`}
              aria-label={`${skinCount} skin${skinCount !== 1 ? 's' : ''}`}
            >
              <Shirt className="w-3 h-3" />
              {skinCount}
            </span>
          )}
          {soundCount > 0 && (
            <span
              className="flex items-center gap-1"
              title={`${soundCount} sound${soundCount !== 1 ? 's' : ''}`}
              aria-label={`${soundCount} sound${soundCount !== 1 ? 's' : ''}`}
            >
              <Music className="w-3 h-3" />
              {soundCount}
            </span>
          )}
        </div>
      )}
      <div className="absolute bottom-0 left-0 right-0 p-2 sm:p-3 flex flex-col items-end text-right">
        {nameFailed ? (
          <div className="text-sm font-semibold text-white drop-shadow-[0_2px_12px_rgba(0,0,0,0.6)]">{hero.name}</div>
        ) : (
          <div className="relative w-[70%] h-6 sm:h-7 ml-auto">
            <img
              src={namePath}
              alt={hero.name}
              className="absolute inset-0 w-full h-full object-contain object-right drop-shadow-[0_2px_12px_rgba(0,0,0,0.6)] will-change-transform backface-visibility-hidden group-hover:scale-105 scale-100 transition-transform duration-300"
              style={{ transform: 'translateZ(0)' }}
              decoding="sync"
              loading="eager"
              onLoad={() => rememberLockerImageLoaded(namePath)}
              onError={() => setNameFailed(true)}
            />
          </div>
        )}
      </div>
    </div>
  );
}

function HeroCard({
  hero,
  mods,
  sounds,
  expanded,
  onToggleExpanded,
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
  const facePositionX = getHeroFacePosition(hero.name);
  // Background art fallback chain mirrors the gallery card: local render ->
  // wiki render -> GameBanana icon -> none (solid panel).
  const [bgFallbackStep, setBgFallbackStep] = useState(0);
  const [section, setSection] = useState<'skins' | 'sounds'>('skins');
  const skinCount = useMemo(() => countLockerSkins(mods), [mods]);
  const soundCount = useMemo(() => countLockerSkins(sounds), [sounds]);
  const hasSounds = sounds.length > 0;
  // Drop back to skins if the active section empties out (e.g. last sound for
  // this hero got deleted/untagged) so the panel never sticks on empty.
  const activeSection = section === 'sounds' && !hasSounds ? 'skins' : section;
  const activeList = activeSection === 'sounds' ? sounds : mods;

  const bgSrc =
    bgFallbackStep === 0
      ? localUrl
      : bgFallbackStep === 1
        ? wikiUrl
        : bgFallbackStep === 2
          ? (hero.iconUrl ?? '')
          : '';

  const handleBgError = () => {
    if (bgFallbackStep === 0) {
      setBgFallbackStep(1);
      return;
    }
    if (bgFallbackStep === 1 && hero.iconUrl) {
      setBgFallbackStep(2);
      return;
    }
    setBgFallbackStep(3);
  };

  const countLabel =
    skinCount === 0 && soundCount === 0
      ? 'No skins installed'
      : [
          skinCount > 0 ? `${skinCount} skin${skinCount !== 1 ? 's' : ''}` : null,
          soundCount > 0 ? `${soundCount} sound${soundCount !== 1 ? 's' : ''}` : null,
        ]
          .filter(Boolean)
          .join(' · ');

  return (
    <div className="group relative overflow-hidden rounded-lg border border-border bg-bg-secondary">
      {/* Hero art bleeds behind the whole card; a gradient keeps the left side
          (where the text sits) dark enough to read, fading toward the portrait
          on the right. The expanded body lays a frosted-glass panel over it. */}
      {bgSrc && (
        <img
          src={bgSrc}
          alt=""
          aria-hidden
          decoding="async"
          onLoad={() => rememberLockerImageLoaded(bgSrc)}
          onError={handleBgError}
          className="pointer-events-none absolute inset-0 h-full w-full object-cover"
          style={{ objectPosition: `${facePositionX}% 18%` }}
        />
      )}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-gradient-to-r from-bg-secondary via-bg-secondary/80 to-bg-secondary/30"
      />

      {/* Clickable header row toggles the dropdown. The favorite star is a
          separate sibling button so we don't nest interactive controls. */}
      <div className="relative z-10 flex items-stretch">
        <button
          type="button"
          onClick={onToggleExpanded}
          aria-expanded={expanded}
          className="flex min-w-0 flex-1 items-center gap-3 p-3 text-left cursor-pointer"
        >
          <div className="min-w-0 flex-1">
            <div className="font-semibold truncate drop-shadow-[0_1px_4px_rgba(0,0,0,0.7)]">
              {hero.name}
            </div>
            <div className="text-xs text-text-secondary drop-shadow-[0_1px_3px_rgba(0,0,0,0.7)]">
              {countLabel}
            </div>
          </div>
          <ChevronDown
            className={`w-4 h-4 flex-shrink-0 text-text-secondary transition-transform duration-200 ${
              expanded ? 'rotate-180' : ''
            }`}
          />
        </button>
        <button
          type="button"
          onClick={onToggleFavorite}
          className={`px-3 flex items-center transition-colors cursor-pointer ${
            isFavorite ? 'text-yellow-400' : 'text-text-secondary hover:text-text-primary'
          }`}
          title={isFavorite ? 'Unfavorite' : 'Favorite'}
        >
          <Star className={`w-4 h-4 ${isFavorite ? 'fill-current' : ''}`} />
        </button>
      </div>

      {expanded && (
      <div className="relative z-10 p-3 space-y-3 border-t border-border/70">
        {/* Section toggle: only when this hero has at least one Sound mod, so
            skins-only heroes don't get an empty Sounds tab. Mirrors the detail
            view (LockerHeroView). */}
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
        <HeroSkinsPanel
          mods={activeList}
          onSelect={onSelect}
          onToggleVariant={onToggleVariant}
          hideNsfwPreviews={hideNsfwPreviews}
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
          onMinaArchivePathChange={activeSection === 'skins' ? onMinaArchivePathChange : undefined}
          minaVariants={activeSection === 'skins' ? minaVariants : []}
          minaVariantsLoading={activeSection === 'skins' ? minaVariantsLoading : false}
          minaVariantsError={activeSection === 'skins' ? minaVariantsError : null}
          onLoadMinaVariants={activeSection === 'skins' ? onLoadMinaVariants : undefined}
          minaSelection={activeSection === 'skins' ? minaSelection : undefined}
          onMinaSelectionChange={activeSection === 'skins' ? onMinaSelectionChange : undefined}
          selectedMinaVariant={activeSection === 'skins' ? selectedMinaVariant : undefined}
          onApplyMinaVariant={activeSection === 'skins' ? onApplyMinaVariant : undefined}
        />
      </div>
      )}
    </div>
  );
}
