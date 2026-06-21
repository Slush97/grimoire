import { lazy, Suspense, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router-dom';
import { ArrowLeft, Box, Check, ChevronDown, ChevronsDownUp, ChevronsUpDown, ExternalLink, Filter, Ghost, Layers, MoreVertical, Music, Palette, PowerOff, Shield, Shirt, Star, Trash2 } from 'lucide-react';
import { useAppStore } from '../stores/appStore';
import {
  getGamebananaCategories,
  getHeroColorSupport,
  setModGlobalType,
  setModLockerHero,
} from '../lib/api';
import { getActiveDeadlockPath } from '../lib/appSettings';
import { getAssetPath } from '../lib/assetPath';
import HeroSkinsPanel from '../components/locker/HeroSkinsPanel';
import { LockerHeroView } from './LockerHero';
import ModThumbnail from '../components/ModThumbnail';

// Heavy (three.js): only pulled in when the soul-container type is viewed.
import { SoulRegistryProvider } from '../components/locker/SoulRegistryProvider';
const SoulContainerTile = lazy(() => import('../components/locker/SoulContainerTile'));
const SoulContainerCanvas = lazy(() => import('../components/locker/SoulContainerCanvas'));
// Heavy (three.js): only pulled in when the user opens the soul-container GLB
// import from the global Locker tab, mirroring the Installed-page trigger.
const SoulContainerImportModal = lazy(() => import('../components/locker/SoulContainerImportModal'));
const SpiritUrnImportModal = lazy(() => import('../components/locker/SpiritUrnImportModal'));
// Idol/urn model entry a Spirit Urn mod overrides; the 3D tile exports this entry
// for an urn (vs the soul-container entry, the tile's default). Mirrors
// URN_CONTAINER_ENTRY in the main-process soulContainerModels service.
const URN_MODEL_ENTRY = 'models/props_gameplay/idol_urn/idol_urn.vmdl_c';
import AudioPreviewPlayer from '../components/AudioPreviewPlayer';
import type { GameBananaCategoryNode } from '../types/gamebanana';
import type { GlobalModType, Mod } from '../types/mod';
import { ViewModeToggle, EmptyState, SectionHeader, ConfirmModal } from '../components/common/PageComponents';
import { Tag } from '../components/common/ui';
import { Skeleton } from '../components/common/Skeleton';
import { HeroSelect } from '../components/common/HeroSelect';
import {
  FAVORITE_HEROES_KEY,
  GLOBAL_MOD_TYPE_LABELS,
  GLOBAL_MOD_TYPE_ORDER,
  activeLockerSkin,
  buildHeroList,
  countGlobalMods,
  countLockerSkins,
  getLockerSkinKey,
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
  isPropContainerType,
  modLoadOrder,
  readStoredFavorites,
  type GlobalModGroups,
  type HeroCategory,
} from '../lib/lockerUtils';

// Route changes flip the overlay state instantly, which unmounts the hero or
// global panel on the next frame with no exit transition. Retain the last
// value for the fade-out duration so the panel can animate away first.
const OVERLAY_EXIT_MS = 200;

function useOverlayExit<T>(value: T | null): { item: T | null; closing: boolean } {
  const [retained, setRetained] = useState<T | null>(null);
  // Render-time adjustment (not an effect) so the retained value tracks the
  // live one without an extra commit.
  if (value !== null && value !== retained) {
    setRetained(value);
  }
  useEffect(() => {
    if (value !== null) return;
    const timer = window.setTimeout(() => setRetained(null), OVERLAY_EXIT_MS);
    return () => window.clearTimeout(timer);
  }, [value]);
  return {
    item: value ?? retained,
    closing: value === null && retained !== null,
  };
}

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

function RainbowPaletteIcon({ className = '', title }: { className?: string; title?: string }) {
  const gradientId = `rainbow-palette-${useId().replace(/:/g, '')}`;

  return (
    <Palette
      className={className}
      stroke={`url(#${gradientId})`}
      aria-label={title}
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : true}
    >
      <defs>
        <linearGradient id={gradientId} x1="3" y1="3" x2="21" y2="21" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#ff4d6d" />
          <stop offset="22%" stopColor="#ffb703" />
          <stop offset="44%" stopColor="#3ddc97" />
          <stop offset="66%" stopColor="#38bdf8" />
          <stop offset="84%" stopColor="#818cf8" />
          <stop offset="100%" stopColor="#f472b6" />
        </linearGradient>
      </defs>
    </Palette>
  );
}

export default function Locker() {
  const { t } = useTranslation();
  const { settings, mods, modsLoading, modsError, loadSettings, loadMods, toggleMod, reorderMods, deleteMod, setBrowseUi, setLockerHeroName, lockerModImages, lockerHideHeroName, lockerModThumbnails, lockerThumbHideHeroName, loadLockerModImages } =
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
  // When on, heroes without any assigned skins/sounds are hidden so the grid
  // only shows the heroes you've actually customized. Favorited heroes stay
  // visible regardless. Persisted alongside viewMode.
  const [hideEmptyHeroes, setHideEmptyHeroes] = useState(
    () => localStorage.getItem('lockerHideEmpty') === 'true'
  );
  const [abilityRecolorSupport, setAbilityRecolorSupport] = useState<Record<string, boolean>>({});
  // Soul-container GLB import (lazy three.js modal), openable from the global
  // Locker tab. Mirrors the Installed-page trigger.
  const [soulImportOpen, setSoulImportOpen] = useState(false);
  // Spirit Urn GLB import (lazy three.js modal), openable from the global Locker
  // tab. Mirrors the soul-container trigger.
  const [urnImportOpen, setUrnImportOpen] = useState(false);
  // Enabled soul-container imports (they override the same model), so the modal
  // can warn + offer to replace rather than silently stack two.
  const existingSoulImports = useMemo(
    () => mods.filter((m) => m.enabled && m.globalType === 'soul-container'),
    [mods]
  );
  // Enabled spirit-urn imports (single in-game slot), same warn-or-replace flow.
  const existingUrnImports = useMemo(
    () => mods.filter((m) => m.enabled && m.globalType === 'spirit-urn'),
    [mods]
  );
  // List-view accordion state. The Settings preference decides the initial
  // state; after that, manual expand/collapse stays under the user's control.
  const [expandedHeroes, setExpandedHeroes] = useState<Set<number>>(() => new Set());
  const appliedExpansionDefaultRef = useRef<boolean | null>(null);
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
  const lockerScrollRef = useRef<HTMLDivElement | null>(null);
  const latestLockerScrollTopRef = useRef(lockerPageScrollTop);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  // Issue #208: per-mod (per-skin) Locker view images (display only).
  useEffect(() => {
    loadLockerModImages();
  }, [loadLockerModImages]);

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
    localStorage.setItem('lockerViewMode', viewMode);
  }, [viewMode]);

  useEffect(() => {
    localStorage.setItem('lockerHideEmpty', String(hideEmptyHeroes));
  }, [hideEmptyHeroes]);

  const navigate = useNavigate();
  const location = useLocation();
  const goToHero = useCallback(
    (hero: HeroCategory) => navigate(`/locker/hero/${hero.id}`),
    [navigate]
  );
  const openHeroInBrowse = useCallback(
    (hero: HeroCategory) => {
      setBrowseUi({
        section: 'Mod',
        heroCategoryId: hero.id,
        categoryId: 'all',
        search: '',
        // Leave artist mode: it persists in the session store and would
        // otherwise override the hero filter this entry point asks for.
        submitter: undefined,
      });
      navigate('/browse');
    },
    [navigate, setBrowseUi]
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
  const heroNamesForColorSupport = useMemo(
    () => Array.from(new Set(baseHeroList.map((hero) => hero.name))).sort((a, b) => a.localeCompare(b)),
    [baseHeroList]
  );

  useEffect(() => {
    let active = true;
    if (heroNamesForColorSupport.length === 0) {
      setAbilityRecolorSupport({});
      return () => {
        active = false;
      };
    }

    Promise.all(
      heroNamesForColorSupport.map(async (heroName) => ({
        heroName,
        supported: await getHeroColorSupport(heroName),
      }))
    )
      .then((entries) => {
        if (!active) return;
        const next: Record<string, boolean> = {};
        for (const entry of entries) next[entry.heroName] = entry.supported;
        setAbilityRecolorSupport(next);
      })
      .catch((err) => {
        if (active) console.warn('[Locker] Failed to load ability color support:', err);
      });

    return () => {
      active = false;
    };
  }, [heroNamesForColorSupport]);

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
  // Issue #208: the image shown on a hero's card/backdrop is the active
  // (highest-priority enabled) skin's chosen Locker image, if the user picked
  // one. Otherwise undefined and the card falls back to the hero render.
  const heroCardImage = useCallback(
    (heroId: number): string | undefined => {
      const active = activeLockerSkin(heroMods.map.get(heroId) ?? []);
      if (!active) return undefined;
      // The grid thumbnail is an independent override; fall back to the card
      // image when a skin has no thumbnail of its own (issue #208).
      const key = getLockerSkinKey(active);
      return lockerModThumbnails[key] ?? lockerModImages[key];
    },
    [heroMods, lockerModThumbnails, lockerModImages]
  );
  // Whether the active skin's image already shows the hero name, so the card's
  // own name label should be hidden (issue #208). Keyed to the active skin, and
  // to whichever surface is actually showing (thumbnail wins over card).
  const heroHideName = useCallback(
    (heroId: number): boolean => {
      const active = activeLockerSkin(heroMods.map.get(heroId) ?? []);
      if (!active) return false;
      const key = getLockerSkinKey(active);
      return Boolean(
        lockerModThumbnails[key] ? lockerThumbHideHeroName[key] : lockerHideHeroName[key]
      );
    },
    [heroMods, lockerModThumbnails, lockerThumbHideHeroName, lockerHideHeroName]
  );
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

  // When "hide empty" is on, drop heroes with no assigned skins/sounds. Favorites
  // are kept so an intentional pin never disappears. Uses the same content test
  // as the sort above so what's hidden matches what sorts to the bottom.
  const displayedHeroList = useMemo(() => {
    if (!hideEmptyHeroes) return heroList;
    return heroList.filter((hero) => {
      if (favoriteHeroes.includes(hero.id)) return true;
      return (
        countLockerSkins(heroMods.map.get(hero.id) ?? []) > 0 ||
        countLockerSkins(heroSounds.map.get(hero.id) ?? []) > 0
      );
    });
  }, [heroList, hideEmptyHeroes, favoriteHeroes, heroMods, heroSounds]);

  const lockerCardsExpandedByDefault = settings?.lockerCardsExpandedByDefault ?? false;

  useEffect(() => {
    if (heroList.length === 0) return;
    if (appliedExpansionDefaultRef.current === lockerCardsExpandedByDefault) return;

    setExpandedHeroes(
      lockerCardsExpandedByDefault
        ? new Set(heroList.map((hero) => hero.id))
        : new Set()
    );
    appliedExpansionDefaultRef.current = lockerCardsExpandedByDefault;
  }, [heroList, lockerCardsExpandedByDefault]);

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
  const heroOverlay = useOverlayExit(selectedHero);
  const overlayHero = heroOverlay.item;
  const missingOverlay = useOverlayExit(selectedHeroMissing ? true : null);
  const globalOverlay = useOverlayExit(globalSelected ? true : null);

  // Publish the open hero's name for Discord Rich Presence (read by
  // DiscordPresence). Clear it on unmount so leaving the Locker drops the hero.
  useEffect(() => {
    setLockerHeroName(selectedHero?.name ?? null);
    return () => setLockerHeroName(null);
  }, [selectedHero, setLockerHeroName]);
  // Keyed off the retained overlay hero (not the live route value) so the
  // panel keeps its content while it fades out.
  const selectedHeroMods = useMemo(
    () => (overlayHero ? heroMods.map.get(overlayHero.id) ?? [] : []),
    [heroMods, overlayHero]
  );
  const selectedHeroSoundList = useMemo(
    () => (overlayHero ? heroSounds.map.get(overlayHero.id) ?? [] : []),
    [heroSounds, overlayHero]
  );
  const selectedHeroSkinCount = useMemo(
    () => countLockerSkins(selectedHeroMods),
    [selectedHeroMods]
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

  // Reorder the load order of a hero's enabled skins. `orderedModIds` is the
  // new desired order of THIS hero's enabled skin VPK ids (lower index = loads
  // first = wins file conflicts). We splice that order into the full global
  // enabled list in place (every other mod keeps its relative slot) and hand
  // the whole list to reorderMods, which renames pak## prefixes to match. We
  // must pass the FULL list, not just the subset: reorderMods packs the ids it
  // receives into the lowest free slots, so a subset would yank these skins to
  // the front of the global load order.
  const reorderHeroSkins = async (heroId: number, orderedModIds: string[]) => {
    const skins = heroMods.map.get(heroId) ?? [];
    const heroSkinIds = new Set(skins.map((m) => m.id));
    // Keep only ids that really belong to this hero and are enabled, in the
    // requested order; ignore anything stale.
    const desired = orderedModIds.filter(
      (id) => heroSkinIds.has(id) && mods.find((m) => m.id === id)?.enabled
    );
    if (desired.length < 2) return;

    const globalEnabled = mods
      .filter((m) => m.enabled)
      .sort((a, b) => modLoadOrder(a) - modLoadOrder(b));

    const desiredSet = new Set(desired);
    let cursor = 0;
    const nextOrder = globalEnabled.map((m) =>
      desiredSet.has(m.id) ? desired[cursor++] : m.id
    );

    const prevOrder = globalEnabled.map((m) => m.id);
    if (nextOrder.every((id, i) => id === prevOrder[i])) return;

    await reorderMods(nextOrder);
  };

  // Delete a skin (all its variant VPKs) straight from the Locker. We confirm
  // first, then delete sequentially to keep priority bookkeeping coherent (the
  // store removes each id locally as it goes).
  // Shared delete confirmation for the Locker (hero skins + global cosmetics).
  // Holds the mod ids to remove and a display name for the prompt copy.
  const [deletePrompt, setDeletePrompt] = useState<{ ids: string[]; name: string } | null>(null);
  const confirmDeleteMods = async () => {
    if (!deletePrompt) return;
    const { ids } = deletePrompt;
    setDeletePrompt(null);
    for (const id of ids) {
      await deleteMod(id);
    }
  };

  // Prop containers (soul containers + spirit urns) are single-select: each kind
  // has one in-game slot, so enabling one disables any other active mod of the
  // SAME kind, and clicking the already-active card turns it back off (vanilla).
  // A soul container and an urn can both be enabled (different slots). Other
  // global types keep normal multi-toggle.
  const selectGlobalMod = async (modId: string) => {
    const target = mods.find((m) => m.id === modId);
    if (!target) return;
    const targetType = getEffectiveGlobalType(target);
    if (!isPropContainerType(targetType)) {
      await toggleMod(modId);
      return;
    }
    if (target.enabled) {
      await toggleMod(modId);
      return;
    }
    const active = mods.filter(
      (m) =>
        m.id !== modId && m.enabled && getEffectiveGlobalType(m) === targetType
    );
    for (const m of active) await toggleMod(m.id);
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

  if (!activeDeadlockPath) {
    return (
      <EmptyState
        icon={Shield}
        title={t('locker.page.noGamePathSet')}
        description={t('locker.empty.noGamePath')}
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
        title={t('locker.page.errorLoadingLocker')}
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
            t('locker.page.heroCount', { count: displayedHeroList.length }),
            t('locker.page.skinCount', { count: installedSkinCount }),
            installedSoundCount > 0
              ? t('locker.page.soundCount', { count: installedSoundCount })
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
                title={t('locker.page.switchToListViewToSeeUnassigned')}
              >
                <Layers className="w-3 h-3" />
                {t('locker.page.unassignedCount', {
                  count: unassignedSkins.length + unassignedSounds.length,
                })}
              </button>
            )}
          {viewMode === 'list' && heroList.length > 0 && (
            <button
              onClick={toggleExpandAll}
              className="flex items-center gap-1.5 self-stretch rounded-sm border border-border bg-bg-secondary px-3 text-sm text-text-secondary hover:text-text-primary hover:bg-bg-tertiary transition-colors cursor-pointer"
              title={allExpanded ? t('locker.page.collapseAllHeroes') : t('locker.page.expandAllHeroes')}
            >
              {allExpanded ? (
                <ChevronsDownUp className="w-4 h-4" />
              ) : (
                <ChevronsUpDown className="w-4 h-4" />
              )}
              {allExpanded ? t('locker.page.collapseAll') : t('locker.page.expandAll')}
            </button>
          )}
          <button
            onClick={() => setHideEmptyHeroes((v) => !v)}
            aria-pressed={hideEmptyHeroes}
            className={`flex items-center gap-1.5 self-stretch rounded-sm border px-3 text-sm transition-colors cursor-pointer ${
              hideEmptyHeroes
                ? 'border-accent/50 bg-accent/15 text-accent hover:bg-accent/25'
                : 'border-border bg-bg-secondary text-text-secondary hover:text-text-primary hover:bg-bg-tertiary'
            }`}
            title={hideEmptyHeroes ? t('locker.page.showEmptyHeroes') : t('locker.page.hideEmptyHeroes')}
          >
            <Filter className="w-4 h-4" />
            {hideEmptyHeroes ? t('locker.page.showEmpty') : t('locker.page.hideEmpty')}
          </button>
          <ViewModeToggle
            value={viewMode}
            options={[
              { value: 'gallery', label: t('locker.page.gallery') },
              { value: 'list', label: t('locker.page.list') },
            ]}
            onChange={(mode) => setViewMode(mode as 'gallery' | 'list')}
          />
        </div>
      </div>

      {heroList.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-64 text-text-secondary">
          <Layers className="w-12 h-12 mb-3 opacity-50" />
          <p>{t('locker.page.noHeroCategoriesFound')}</p>
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
          {displayedHeroList.map((hero) => (
            <HeroGalleryCard
              key={hero.id}
              hero={hero}
              skinCount={countLockerSkins(heroMods.map.get(hero.id) ?? [])}
              soundCount={countLockerSkins(heroSounds.map.get(hero.id) ?? [])}
              hasAbilityRecolor={Boolean(abilityRecolorSupport[hero.name])}
              cardImage={heroCardImage(hero.id)}
              hideHeroName={heroHideName(hero.id)}
              isFavorite={favoriteHeroes.includes(hero.id)}
              onNavigate={() => goToHero(hero)}
              onBrowse={() => openHeroInBrowse(hero)}
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
        <div className="grid grid-cols-1 items-start gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
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
                  {t('locker.page.global')}
                </div>
                <div className="text-xs text-text-secondary drop-shadow-[0_1px_3px_rgba(0,0,0,0.7)]">
                  {t('locker.page.modCount', { count: globalCount })} ·{' '}
                  {t('locker.page.categoryCount', { count: globalTypeCount })}
                </div>
              </div>
              <ChevronDown className="relative z-10 h-4 w-4 -rotate-90 text-text-secondary" />
            </button>
          )}
          {displayedHeroList.map((hero) => (
            <HeroCard
              key={hero.id}
              hero={hero}
              mods={heroMods.map.get(hero.id) ?? []}
              sounds={heroSounds.map.get(hero.id) ?? []}
              hasAbilityRecolor={Boolean(abilityRecolorSupport[hero.name])}
              cardImage={heroCardImage(hero.id)}
              expanded={expandedHeroes.has(hero.id)}
              onToggleExpanded={() => toggleHeroExpanded(hero.id)}
              onBrowseSkins={() => openHeroInBrowse(hero)}
              onSelect={(modId) => setActiveSkin(hero.id, modId)}
              onToggleVariant={(modId) => toggleHeroVariant(hero.id, modId)}
              onRequestDelete={(ids, name) => setDeletePrompt({ ids, name })}
              isFavorite={favoriteHeroes.includes(hero.id)}
              onToggleFavorite={() =>
                setFavoriteHeroes((prev) =>
                  prev.includes(hero.id)
                    ? prev.filter((id) => id !== hero.id)
                    : [...prev, hero.id]
                )
              }
              hideNsfwPreviews={settings?.hideNsfwPreviews ?? true}
            />
          ))}
        </div>
      )}

      {viewMode === 'list' && (unassignedSkins.length > 0 || unassignedSounds.length > 0) && (
        <div className="space-y-3">
          <SectionHeader>{t('locker.page.unassigned')}</SectionHeader>
          <p className="text-xs text-text-secondary -mt-1">
            {t('locker.page.unassignedDescription')}
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {[...unassignedSkins, ...unassignedSounds].map((skin) => {
              const mod = skin.primary;
              const subtitle =
                skin.variants.length > 1
                  ? t('locker.page.fileCount', { count: skin.variants.length })
                  : mod.fileName;
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
                          {t('locker.page.noPreview')}
                        </div>
                      }
                    />
                  </div>
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <div className="font-medium truncate" title={mod.name}>
                      {mod.name}
                    </div>
                    <div className="text-xs text-text-secondary truncate" title={subtitle}>
                      {isSound ? t('locker.page.sound') : ''}
                      {subtitle}
                    </div>
                    <HeroSelect
                      ariaLabel={t('locker.page.tagAsHeroNamed', { name: mod.name })}
                      value={mod.lockerHero ?? ''}
                      onChange={(next) => {
                        void tagModHero(mod.id, next.length > 0 ? next : null);
                      }}
                      size="sm"
                      options={[
                        { value: '', label: t('locker.page.tagAsHero'), muted: true },
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

      {overlayHero && (
        <div
          className={`fixed bottom-0 right-0 top-0 z-30 overflow-hidden bg-bg-primary sidebar-offset-transition ${
            heroOverlay.closing ? 'animate-fade-out pointer-events-none' : 'animate-fade-in'
          }`}
          style={{ left: 'var(--grimoire-sidebar-width, 14rem)' }}
        >
          <LockerHeroView
            key={overlayHero.id}
            hero={overlayHero}
            skinList={selectedHeroMods}
            soundList={selectedHeroSoundList}
            skinCount={selectedHeroSkinCount}
            isFavorite={favoriteHeroes.includes(overlayHero.id)}
            onBack={() => navigate('/locker')}
            onToggleFavorite={() =>
              setFavoriteHeroes((prev) =>
                prev.includes(overlayHero.id)
                  ? prev.filter((id) => id !== overlayHero.id)
                  : [...prev, overlayHero.id]
              )
            }
            onSelect={(modId) => setActiveSkin(overlayHero.id, modId)}
            onToggleVariant={(modId) => toggleHeroVariant(overlayHero.id, modId)}
            onReorderSkins={(orderedModIds) => reorderHeroSkins(overlayHero.id, orderedModIds)}
            onRequestDeleteSkin={(ids, name) => setDeletePrompt({ ids, name })}
            hideNsfwPreviews={settings?.hideNsfwPreviews ?? true}
          />
        </div>
      )}

      {missingOverlay.item && (
        <div
          className={`fixed bottom-0 right-0 top-0 z-30 overflow-hidden bg-bg-primary sidebar-offset-transition ${
            missingOverlay.closing ? 'animate-fade-out pointer-events-none' : 'animate-fade-in'
          }`}
          style={{ left: 'var(--grimoire-sidebar-width, 14rem)' }}
        >
          <div className="flex h-full flex-col items-center justify-center p-6 text-text-secondary">
            <Layers className="w-16 h-16 mb-4 opacity-50" />
            <h2 className="text-xl font-semibold text-text-primary mb-2">{t('locker.page.heroNotFound')}</h2>
            <button
              type="button"
              onClick={() => navigate('/locker')}
              className="mt-3 px-4 py-2 rounded-lg border border-accent/40 bg-accent/10 hover:bg-accent/20 hover:border-accent/60 text-text-primary transition-colors cursor-pointer"
            >
              {t('locker.page.backToLocker')}
            </button>
          </div>
        </div>
      )}
      {globalOverlay.item && (
        <div
          className={`fixed bottom-0 right-0 top-0 z-30 overflow-hidden bg-bg-primary sidebar-offset-transition ${
            globalOverlay.closing ? 'animate-fade-out pointer-events-none' : 'animate-fade-in'
          }`}
          style={{ left: 'var(--grimoire-sidebar-width, 14rem)' }}
        >
          <LockerGlobalView
            groups={globalGroups}
            hideNsfw={settings?.hideNsfwPreviews ?? true}
            onBack={() => navigate('/locker')}
            onToggle={selectGlobalMod}
            onSetGlobalType={tagModGlobalType}
            onRequestDelete={(ids, name) => setDeletePrompt({ ids, name })}
            onImportSoul={() => setSoulImportOpen(true)}
            onImportUrn={() => setUrnImportOpen(true)}
          />
        </div>
      )}

      {soulImportOpen && (
        <Suspense fallback={null}>
          <SoulContainerImportModal
            onClose={() => setSoulImportOpen(false)}
            existingSoulImports={existingSoulImports}
            onImported={() => {
              void loadMods();
            }}
          />
        </Suspense>
      )}

      {urnImportOpen && (
        <Suspense fallback={null}>
          <SpiritUrnImportModal
            onClose={() => setUrnImportOpen(false)}
            existingUrnImports={existingUrnImports}
            onImported={() => {
              void loadMods();
            }}
          />
        </Suspense>
      )}

      <ConfirmModal
        isOpen={deletePrompt !== null}
        variant="danger"
        title={t('locker.deleteConfirm.title')}
        message={t('locker.deleteConfirm.body', { name: deletePrompt?.name ?? '' })}
        confirmLabel={t('common.actions.delete')}
        onConfirm={confirmDeleteMods}
        onCancel={() => setDeletePrompt(null)}
      />
    </div>
  );
}


interface HeroCardProps {
  hero: HeroCategory;
  mods: Mod[];
  sounds: Mod[];
  hasAbilityRecolor: boolean;
  /** Issue #208: the active skin's chosen Locker image (data URL), shown as the
   *  card backdrop in place of the hero render. Undefined = use the render. */
  cardImage?: string;
  expanded: boolean;
  onToggleExpanded: () => void;
  onBrowseSkins: () => void;
  onSelect: (modId: string) => void;
  onToggleVariant: (modId: string) => void;
  onRequestDelete: (modIds: string[], name: string) => void;
  isFavorite: boolean;
  onToggleFavorite: () => void;
  hideNsfwPreviews: boolean;
}

interface HeroGalleryCardProps {
  hero: HeroCategory;
  skinCount: number;
  soundCount: number;
  hasAbilityRecolor: boolean;
  /** Issue #208: the active skin's chosen Locker image (data URL), shown as the
   *  card backdrop in place of the hero render. Undefined = use the render. */
  cardImage?: string;
  /** Issue #208: hide the hero name label because the active skin's image
   *  already shows the hero name. Only meaningful when cardImage is set. */
  hideHeroName?: boolean;
  isFavorite: boolean;
  onNavigate: () => void;
  onBrowse: () => void;
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
  const { t } = useTranslation();
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
          {t('locker.page.modCount', { count })}
        </div>
      </div>
      <div className="absolute inset-x-0 bottom-0 flex flex-col items-end bg-gradient-to-t from-black/70 to-transparent p-2 text-right sm:p-3">
        <div className="font-reaver text-lg leading-tight tracking-wide text-white drop-shadow-[0_2px_12px_rgba(0,0,0,0.6)]">
          {t('locker.page.global')}
        </div>
        <div className="text-[11px] text-white/70 drop-shadow-[0_2px_12px_rgba(0,0,0,0.6)]">
          {t('locker.page.categoryCount', { count: typeCount })}
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
  /** Request deletion of a global mod (its VPK). The page owns the confirm. */
  onRequestDelete: (modIds: string[], name: string) => void;
  /** Open the soul-container GLB import modal (shown on the soul-container tab). */
  onImportSoul: () => void;
  /** Open the Spirit Urn GLB import modal (shown on the spirit-urn tab). */
  onImportUrn: () => void;
}

/**
 * Drill-in panel for the Global card: a Deadlock environment backdrop under a
 * frosted-glass carousel of cosmetic types (echoing the LockerHeroView shell's
 * art + blur language). Selecting a tile reveals that type's toggleable mods.
 */
function LockerGlobalView({ groups, hideNsfw, onBack, onToggle, onSetGlobalType, onRequestDelete, onImportSoul, onImportUrn }: LockerGlobalViewProps) {
  const { t } = useTranslation();
  const soundVolume = useAppStore((s) => s.soundVolume);
  // Prop-container types (soul container, spirit urn) are always selectable even
  // when empty: their tab is the only entry point to the GLB importer, so
  // disabling an empty one would make it impossible to import the first of its
  // kind (the chicken-and-egg that blocked testing the urn import path). Every
  // other type only appears once it has at least one mod.
  const available = GLOBAL_MOD_TYPE_ORDER.filter(
    (type) => groups[type].length > 0 || isPropContainerType(type)
  );
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
  // falling back to the first available type at render time. Prop-container
  // types stay selected even while empty so the importer remains reachable.
  const activeType =
    groups[selectedType]?.length || isPropContainerType(selectedType)
      ? selectedType
      : available[0];
  const activeMods = activeType ? groups[activeType] : [];
  // Soul containers and spirit urns share the single-select + live-3D-tile
  // treatment (frosted glass, content-stable key, active badge, import button).
  const isPropContainer = isPropContainerType(activeType);
  const total = GLOBAL_MOD_TYPE_ORDER.reduce((sum, type) => sum + groups[type].length, 0);
  // The scrollable card pane: the shared soul-container canvas clamps each
  // card's render rect to this element so models never bleed past the pane.
  const paneRef = useRef<HTMLDivElement>(null);

  return (
    <SoulRegistryProvider>
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
          {t('locker.page.back')}
        </button>

        <div className="flex items-baseline gap-2">
          <h2 className="text-lg font-semibold text-white drop-shadow-[0_2px_12px_rgba(0,0,0,0.6)]">
            {t('locker.page.global')}
          </h2>
          <span className="text-xs text-white/60">
            {t('locker.page.modCount', { count: total })}
          </span>
        </div>

        <nav className="flex flex-col gap-1.5">
          {GLOBAL_MOD_TYPE_ORDER.map((type) => {
            const items = groups[type];
            const isActive = type === activeType;
            const isEmpty = items.length === 0;
            // An empty prop-container tab is still clickable (it opens the
            // importer); only non-importable types are disabled when empty.
            const isDisabled = isEmpty && !isPropContainerType(type);
            return (
              <button
                key={type}
                type="button"
                disabled={isDisabled}
                onClick={() => setSelectedType(type)}
                className={`flex items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors ${
                  isDisabled
                    ? 'cursor-default border-transparent opacity-40'
                    : isActive
                      ? 'border-accent/60 bg-accent/15'
                      : 'cursor-pointer border-transparent hover:bg-white/10'
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
      <div ref={paneRef} className="relative z-10 flex-1 overflow-y-auto scrollbar-glass">
        <div className="space-y-4 p-6">
          {activeType ? (
            <>
              <div className="flex items-baseline gap-2">
                <h3 className="text-base font-semibold text-white drop-shadow-[0_2px_12px_rgba(0,0,0,0.6)]">
                  {GLOBAL_MOD_TYPE_LABELS[activeType]}
                </h3>
                <span className="text-xs text-white/60">
                  {t('locker.page.modCount', { count: activeMods.length })}
                </span>
                {isPropContainer && (
                  <button
                    type="button"
                    onClick={activeType === 'spirit-urn' ? onImportUrn : onImportSoul}
                    className="ml-auto inline-flex items-center gap-1.5 self-center rounded-lg border border-accent/40 bg-accent/10 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:border-accent/60 hover:bg-accent/20"
                    title={activeType === 'spirit-urn' ? t('locker.urnImport.trigger.title') : t('locker.soulImport.trigger.title')}
                  >
                    {activeType === 'spirit-urn' ? <Box className="h-3.5 w-3.5" /> : <Ghost className="h-3.5 w-3.5" />}
                    {activeType === 'spirit-urn' ? t('locker.urnImport.trigger.label') : t('locker.soulImport.trigger.label')}
                  </button>
                )}
              </div>
              {activeMods.length === 0 && isPropContainer ? (
                <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-white/15 bg-bg-sunken/30 px-6 py-12 text-center">
                  {activeType === 'spirit-urn' ? (
                    <Box className="h-8 w-8 text-white/40" />
                  ) : (
                    <Ghost className="h-8 w-8 text-white/40" />
                  )}
                  <p className="max-w-sm text-sm text-white/70">
                    {t('locker.global.propEmpty', {
                      type: GLOBAL_MOD_TYPE_LABELS[activeType],
                    })}
                  </p>
                  <button
                    type="button"
                    onClick={activeType === 'spirit-urn' ? onImportUrn : onImportSoul}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-accent/40 bg-accent/10 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:border-accent/60 hover:bg-accent/20"
                  >
                    {activeType === 'spirit-urn' ? <Box className="h-3.5 w-3.5" /> : <Ghost className="h-3.5 w-3.5" />}
                    {activeType === 'spirit-urn' ? t('locker.urnImport.trigger.label') : t('locker.soulImport.trigger.label')}
                  </button>
                </div>
              ) : (
              <div className="grid grid-cols-2 gap-4 lg:grid-cols-3 2xl:grid-cols-4">
                {activeMods.map((mod) => {
                  // Skipped when NSFW previews are hidden so we never bleed
                  // hidden imagery into the glass tint, even blurred.
                  const glassBackdropUrl =
                    mod.thumbnailUrl && !(mod.nsfw && hideNsfw) ? mod.thumbnailUrl : null;
                  return (
                    <div
                      // Prop containers key on the content-stable sha256: their
                      // id/metaKey change when toggled, which would otherwise
                      // remount the card and reload its 3D model on every select.
                      // Other types keep the plain id key (original behavior).
                      key={
                        isPropContainer ? mod.sha256 ?? mod.id : mod.id
                      }
                      className={`group/card relative flex flex-col rounded-[10px] border p-2.5 transition-[border-color,background-color,box-shadow] duration-200 ${
                        mod.enabled
                          ? 'border-accent bg-accent/[0.06] shadow-[0_0_0_1px_var(--color-accent)] hover:bg-accent/[0.10]'
                          : 'border-white/[0.08] bg-bg-sunken/55 text-text-primary/75 hover:border-white/[0.16] hover:text-text-primary'
                      }`}
                    >
                      {/* Glass backdrop: a blurred copy of the cover art bleeds
                          behind the card so it's tinted by its own thumbnail,
                          matching the Installed grid cards. Soul containers show
                          a 3D model on a clear window, so they skip it. */}
                      {glassBackdropUrl && !isPropContainer && (
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
                          <div className="absolute inset-0 scrim-bottom" />
                        </div>
                      )}

                      {/* Media: aspect-video cover. Soul containers float their
                          3D model over a frosted-glass panel so the environment
                          background shows through; other types keep a solid bg. */}
                      <div
                        className={`relative mb-2 aspect-video w-full overflow-hidden rounded-lg border border-white/[0.08] ${
                          isPropContainer ? '' : 'bg-bg-tertiary'
                        }`}
                      >
                        {/* Frosted-glass panel for soul containers, kept as a
                            separate inner layer rather than on the media container
                            itself: a backdrop-filter turns its element into a
                            stacking context, which would sink this subtree (and
                            the retag kebab below) under the z-10 full-card toggle
                            and swallow the kebab's clicks. */}
                        {isPropContainer && (
                          <div className="pointer-events-none absolute inset-0 bg-white/[0.04] backdrop-blur-md" />
                        )}
                        {/* Prop containers show a live 3D model on a clear window
                            (no 2D thumbnail behind it); other types show their
                            GameBanana thumbnail. The urn exports its own model
                            entry; the soul container is the tile's default. */}
                        {isPropContainer ? (
                          <Suspense fallback={null}>
                            <SoulContainerTile
                              tileId={mod.sha256 ?? mod.id}
                              modKey={mod.metaKey}
                              entry={activeType === 'spirit-urn' ? URN_MODEL_ENTRY : undefined}
                            />
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
                                  {t('locker.page.noPreview')}
                                </div>
                              }
                            />
                          </div>
                        )}
                        <div className="pointer-events-none absolute inset-0 bg-bg-primary/0 transition-colors duration-200 group-hover/card:bg-bg-primary/20" />
                        {/* Prop containers are single-select, so mark the one
                            active pick with a positive "Active" badge (a disabled
                            card is simply unmarked) and fade it in so selecting
                            animates rather than snapping. Other global types
                            allow multiple enabled, so they keep tagging the
                            disabled ones. */}
                        {isPropContainer
                          ? mod.enabled && (
                              <div className="pointer-events-none absolute left-2 top-2 z-10 flex h-5 items-start animate-fade-in">
                                <Tag
                                  tone="accent"
                                  variant="overlay"
                                  icon={Check}
                                  title={t('locker.global.activeBadgeTitle')}
                                >
                                  {t('common.status.active')}
                                </Tag>
                              </div>
                            )
                          : !mod.enabled && (
                              <div className="pointer-events-none absolute left-2 top-2 z-10 flex h-5 items-start">
                                <Tag
                                  tone="neutral"
                                  variant="overlay"
                                  icon={PowerOff}
                                  title={t('locker.global.disabledBadgeTitle')}
                                >
                                  {t('locker.global.disabledBadge')}
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
                            aria-label={t('locker.page.changeCategoryForNamed', { name: mod.name })}
                            title={t('locker.page.changeCategory')}
                            className="absolute right-11 top-2 z-20 flex h-7 w-7 items-center justify-center rounded-md border border-white/15 bg-black/45 text-white/85 opacity-0 backdrop-blur-sm transition-opacity hover:bg-black/65 focus:opacity-100 focus-visible:opacity-100 group-hover/card:opacity-100"
                          >
                            <MoreVertical className="h-4 w-4" />
                          </button>
                        )}
                        {/* Delete: removes this global mod's VPK. Sits above the
                            full-card toggle (z-20 > z-10), to the right of the
                            retag kebab; red on hover. */}
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onRequestDelete([mod.id], mod.name);
                          }}
                          aria-label={t('locker.global.deleteMod', { name: mod.name })}
                          title={t('locker.global.deleteMod', { name: mod.name })}
                          className="absolute right-2 top-2 z-20 flex h-7 w-7 items-center justify-center rounded-md border border-white/15 bg-black/45 text-white/85 opacity-0 backdrop-blur-sm transition-[opacity,background-color,color] hover:bg-red-500/80 hover:text-white focus:opacity-100 focus-visible:opacity-100 group-hover/card:opacity-100"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
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
                          <AudioPreviewPlayer src={mod.audioUrl} compact volume={soundVolume} />
                        </div>
                      )}

                      {/* Full-card click target: clicking anywhere enables/disables
                          the mod. Kept as a transparent overlay (not a wrapping
                          button) so the heading/markup stays valid. */}
                      <button
                        type="button"
                        onClick={() => onToggle(mod.id)}
                        aria-pressed={mod.enabled}
                        aria-label={
                          mod.enabled
                            ? t('locker.page.disableNamed', { name: mod.name })
                            : t('locker.page.enableNamed', { name: mod.name })
                        }
                        title={mod.enabled ? t('locker.page.clickToDisable') : t('locker.page.clickToEnable')}
                        className="absolute inset-0 z-10 cursor-pointer rounded-[10px] focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/70"
                      />
                    </div>
                  );
                })}
              </div>
              )}
            </>
          ) : (
            <p className="text-sm text-white/70">{t('locker.page.noGlobalNonHeroCosmeticsInstalledYet')}</p>
          )}
        </div>

        {/* Shared 3D canvas for the Global prop-container grid (soul containers
            and spirit urns): one WebGL context renders every card (scissored into
            its on-screen rect), so the grid can't exhaust the browser's
            live-context cap. Mounted INSIDE the pane (not at the view root) so its
            z-[5] sits below each card's tags/kebab but above the card background,
            keeping chrome on top of the model. Only mounted while a prop-container
            type is selected. */}
        {isPropContainer && (
          <Suspense fallback={null}>
            <SoulContainerCanvas paneRef={paneRef} />
          </Suspense>
        )}
      </div>

      {/* Retag menu (fixed-positioned, anchored at the kebab's viewport coords so
          it never clips against the scrolling pane). */}
      {retagMenu && (
        <>
          <div
            className="fixed inset-0 z-[79]"
            aria-hidden
            onClick={() => setRetagMenu(null)}
          />
          <div
            role="menu"
            aria-label={t('locker.page.changeGlobalCategory')}
            className="fixed z-[80] w-52 rounded-lg border border-border bg-bg-secondary p-1 shadow-xl animate-fade-in"
            style={{ top: retagMenu.y, left: retagMenu.x }}
          >
            <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-text-secondary">
              {t('locker.page.moveToCategory')}
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
              {t('locker.page.removeFromGlobal')}
            </button>
          </div>
        </>
      )}

    </div>
    </SoulRegistryProvider>
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
  hasAbilityRecolor,
  cardImage,
  hideHeroName,
  isFavorite,
  onNavigate,
  onBrowse,
  onToggleFavorite,
}: HeroGalleryCardProps) {
  const { t } = useTranslation();
  const renderLocal = getHeroRenderPath(hero.name);
  const wikiUrl = getHeroWikiUrl(hero.name);
  const namePath = getHeroNamePath(hero.name);
  const facePositionX = getHeroFacePosition(hero.name).x;
  const [fallbackStep, setFallbackStep] = useState(0);
  const [nameFailed, setNameFailed] = useState(false);
  const [, setImageCacheVersion] = useState(0);

  // A user-provided card image (issue #208) wins over the render chain. Data
  // URLs paint immediately, so they skip the loaded-image gate / skeleton.
  const renderSrc = cardImage ?? (fallbackStep === 0
    ? renderLocal
    : fallbackStep === 1
      ? wikiUrl
      : fallbackStep === 2
        ? (hero.iconUrl ?? '')
        : '');
  const isRenderReady = !!cardImage || (!!renderSrc && lockerLoadedImageUrls.has(renderSrc));

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
                backgroundPosition: cardImage ? 'center' : `${facePositionX}% 20%`,
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
              onLoad={() => {
                if (!cardImage) rememberLockerImageLoaded(renderSrc);
              }}
              onError={cardImage ? undefined : handleRenderError}
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
          onBrowse();
        }}
        aria-label={t('locker.page.browseHeroSkins', { hero: hero.name })}
        title={t('locker.page.browseHeroSkins', { hero: hero.name })}
        className="absolute right-9 top-2 z-20 flex items-center justify-center rounded-full border border-white/30 bg-black/40 p-1 text-white/85 opacity-0 backdrop-blur-sm transition-opacity hover:bg-black/60 focus-visible:opacity-100 group-hover:opacity-100"
      >
        <ExternalLink className="h-3 w-3" />
      </button>
      <button
        type="button"
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onToggleFavorite();
        }}
        aria-label={isFavorite ? t('locker.page.unfavorite') : t('locker.page.favorite')}
        title={isFavorite ? t('locker.page.unfavorite') : t('locker.page.favorite')}
        className={`absolute right-2 top-2 z-20 flex items-center justify-center rounded-full border p-1 transition-opacity ${
          isFavorite
            ? 'border-yellow-400/60 bg-yellow-400/20 text-yellow-300 opacity-100'
            : 'border-white/30 bg-black/40 text-white/85 backdrop-blur-sm opacity-0 group-hover:opacity-100 focus-visible:opacity-100 hover:bg-black/60'
        }`}
      >
        <Star className={`w-3 h-3 ${isFavorite ? 'fill-current' : ''}`} />
      </button>
      {(skinCount > 0 || soundCount > 0 || hasAbilityRecolor) && (
        <div className="absolute left-2 top-2 z-20 flex items-center gap-2 rounded-full bg-black/45 px-2 py-0.5 text-[10px] font-medium text-white/85 backdrop-blur-sm">
          {hasAbilityRecolor && (
            <span
              className="flex items-center gap-1"
              title={t('locker.page.abilityColorRecoloringAvailable')}
              aria-label={t('locker.page.abilityColorRecoloringAvailable')}
            >
              <RainbowPaletteIcon className="h-3 w-3" />
            </span>
          )}
          {skinCount > 0 && (
            <span
              className="flex items-center gap-1"
              title={t('locker.page.skinCount', { count: skinCount })}
              aria-label={t('locker.page.skinCount', { count: skinCount })}
            >
              <Shirt className="w-3 h-3" />
              {skinCount}
            </span>
          )}
          {soundCount > 0 && (
            <span
              className="flex items-center gap-1"
              title={t('locker.page.soundCount', { count: soundCount })}
              aria-label={t('locker.page.soundCount', { count: soundCount })}
            >
              <Music className="w-3 h-3" />
              {soundCount}
            </span>
          )}
        </div>
      )}
      {/* Issue #208: hide the name label when the active skin's image already
          shows the hero name. Without an override image the label always shows. */}
      {!(hideHeroName && cardImage) && (
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
      )}
    </div>
  );
}

function HeroCard({
  hero,
  mods,
  sounds,
  hasAbilityRecolor,
  cardImage,
  expanded,
  onToggleExpanded,
  onBrowseSkins,
  onSelect,
  onToggleVariant,
  onRequestDelete,
  isFavorite,
  onToggleFavorite,
  hideNsfwPreviews,
}: HeroCardProps) {
  const { t } = useTranslation();
  const localUrl = getHeroRenderPath(hero.name);
  const wikiUrl = getHeroWikiUrl(hero.name);
  const facePositionX = getHeroFacePosition(hero.name).x;
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

  // A user-provided card image (issue #208) wins outright; otherwise fall back
  // through the render chain: local render -> wiki render -> GameBanana icon.
  const bgSrc =
    cardImage ??
    (bgFallbackStep === 0
      ? localUrl
      : bgFallbackStep === 1
        ? wikiUrl
        : bgFallbackStep === 2
          ? (hero.iconUrl ?? '')
          : '');

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
      ? t('locker.page.noSkinsInstalled')
      : [
          skinCount > 0 ? t('locker.page.skinCount', { count: skinCount }) : null,
          soundCount > 0 ? t('locker.page.soundCount', { count: soundCount }) : null,
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
          onError={cardImage ? undefined : handleBgError}
          className="pointer-events-none absolute inset-0 h-full w-full object-cover"
          style={{ objectPosition: cardImage ? 'center' : `${facePositionX}% 18%` }}
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
            <div className="flex min-w-0 items-center gap-2">
              <div className="truncate font-semibold drop-shadow-[0_1px_4px_rgba(0,0,0,0.7)]">
                {hero.name}
              </div>
              {hasAbilityRecolor && (
                <RainbowPaletteIcon
                  className="h-3.5 w-3.5 flex-shrink-0 text-accent drop-shadow-[0_1px_4px_rgba(0,0,0,0.7)]"
                  title={t('locker.page.abilityColorRecoloringAvailable')}
                />
              )}
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
          title={isFavorite ? t('locker.page.unfavorite') : t('locker.page.favorite')}
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
            aria-label={t('locker.page.section')}
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
              {t('locker.page.skins')}
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
              {t('locker.page.sounds')}
            </button>
          </div>
        )}
        <HeroSkinsPanel
          mods={activeList}
          onSelect={onSelect}
          onToggleVariant={onToggleVariant}
          onRequestDelete={onRequestDelete}
          hideNsfwPreviews={hideNsfwPreviews}
          showDownloadable={activeSection === 'skins'}
          browseAction={
            activeSection === 'skins'
              ? { label: t('common.actions.browse'), onClick: onBrowseSkins }
              : undefined
          }
          useHeroPortraitThumbnails={activeSection === 'sounds'}
          heroName={hero.name}
          emptyMessage={
            activeSection === 'sounds'
              ? t('locker.page.noSoundModsTagged')
              : t('locker.page.downloadASkinForThisHero')
          }
        />
      </div>
      )}
    </div>
  );
}
