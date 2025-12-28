import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Layers, Loader2, Star, X } from 'lucide-react';
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
  MINA_ARCHIVE_DEFAULT,
  buildHeroList,
  buildMinaPresets,
  detectMinaTextures,
  findMinaVariant,
  getHeroFacePosition,
  getHeroNamePath,
  getHeroRenderPath,
  getHeroWikiUrl,
  groupModsByCategory,
  parseMinaVariant,
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
  const [activeHeroId, setActiveHeroId] = useState<number | null>(null);
  const [selectedHero, setSelectedHero] = useState<HeroCategory | null>(null);
  const [overlayVisible, setOverlayVisible] = useState(false);
  const [cardRect, setCardRect] = useState<DOMRect | null>(null);
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

  useEffect(() => {
    localStorage.setItem('lockerViewMode', viewMode);
  }, [viewMode]);

  // Open hero overlay
  const openHeroOverlay = useCallback((hero: HeroCategory, rect: DOMRect) => {
    setSelectedHero(hero);
    setActiveHeroId(hero.id);
    setCardRect(rect);
    // Small delay to trigger animation
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        setOverlayVisible(true);
      });
    });
  }, []);

  // Close hero overlay
  const closeHeroOverlay = useCallback(() => {
    setOverlayVisible(false);
    // Unmount after fade completes (500ms)
    setTimeout(() => {
      setSelectedHero(null);
      setActiveHeroId(null);
      setCardRect(null);
    }, 550);
  }, []);

  // Escape key to close overlay
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && selectedHero) {
        closeHeroOverlay();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedHero, closeHeroOverlay]);

  // Calculate heroMods first so we can use it for sorting
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

  const heroList = useMemo(() => {
    const list = buildHeroList(categories);
    return list.sort((a, b) => {
      const aFav = favoriteHeroes.includes(a.id);
      const bFav = favoriteHeroes.includes(b.id);
      // Favorites first
      if (aFav !== bFav) return aFav ? -1 : 1;
      // Then heroes with skins
      const aHasSkins = (heroMods.map.get(a.id)?.length ?? 0) > 0;
      const bHasSkins = (heroMods.map.get(b.id)?.length ?? 0) > 0;
      if (aHasSkins !== bHasSkins) return aHasSkins ? -1 : 1;
      // Then alphabetically
      return a.name.localeCompare(b.name);
    });
  }, [categories, favoriteHeroes, heroMods]);

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
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Hero Locker</h1>
          <p className="text-sm text-text-secondary">
            Pick the active skin per hero. Selecting one disables other skins for that hero.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-sm text-text-secondary">
            {heroList.length} heroes • {mods.length} installed
          </div>
          <div className="flex items-center rounded-full border border-border bg-bg-secondary p-1 text-xs">
            <button
              type="button"
              onClick={() => setViewMode('gallery')}
              className={`px-3 rounded-full transition-colors ${
                viewMode === 'gallery'
                  ? 'bg-accent text-white'
                  : 'text-text-secondary hover:text-text-primary'
              }`}
            >
              Gallery
            </button>
            <button
              type="button"
              onClick={() => setViewMode('list')}
              className={`px-3 rounded-full transition-colors ${
                viewMode === 'list'
                  ? 'bg-accent text-white'
                  : 'text-text-secondary hover:text-text-primary'
              }`}
            >
              List
            </button>
          </div>
        </div>
      </div>

      {heroList.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-64 text-text-secondary">
          <Layers className="w-12 h-12 mb-3 opacity-50" />
          <p>No hero categories found.</p>
        </div>
      ) : viewMode === 'gallery' ? (
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4">
          {heroList.map((hero) => (
            <HeroGalleryCard
              key={hero.id}
              hero={hero}
              skinCount={heroMods.map.get(hero.id)?.length ?? 0}
              isFavorite={favoriteHeroes.includes(hero.id)}
              isActive={activeHeroId === hero.id}
              onNavigate={(rect) => openHeroOverlay(hero, rect)}
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

      {viewMode === 'list' && heroMods.unassigned.length > 0 && (
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

      {/* Hero Detail Overlay */}
      {selectedHero && (
        <HeroOverlay
          hero={selectedHero}
          visible={overlayVisible}
          onClose={closeHeroOverlay}
          cardRect={cardRect}
          mods={heroMods.map.get(selectedHero.id) ?? []}
          onSelectSkin={(modId) => setActiveSkin(selectedHero.id, modId)}
          isFavorite={favoriteHeroes.includes(selectedHero.id)}
          onToggleFavorite={() =>
            setFavoriteHeroes((prev) =>
              prev.includes(selectedHero.id)
                ? prev.filter((id) => id !== selectedHero.id)
                : [...prev, selectedHero.id]
            )
          }
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
      )}
    </div>
  );
}

interface HeroOverlayProps {
  hero: HeroCategory;
  visible: boolean;
  onClose: () => void;
  cardRect: DOMRect | null;
  mods: Mod[];
  onSelectSkin: (modId: string) => void;
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

function HeroOverlay({
  hero,
  visible,
  onClose,
  cardRect,
  mods,
  onSelectSkin,
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
}: HeroOverlayProps) {
  const [renderSrc, setRenderSrc] = useState('');
  const [renderFallbackStep, setRenderFallbackStep] = useState(0);
  const [nameFailed, setNameFailed] = useState(false);

  useEffect(() => {
    setRenderSrc(getHeroRenderPath(hero.name));
    setRenderFallbackStep(0);
    setNameFailed(false);
  }, [hero]);

  const handleRenderError = () => {
    if (renderFallbackStep === 0) {
      setRenderSrc(getHeroWikiUrl(hero.name));
      setRenderFallbackStep(1);
      return;
    }
    if (renderFallbackStep === 1 && hero.iconUrl) {
      setRenderSrc(hero.iconUrl);
      setRenderFallbackStep(2);
      return;
    }
    setRenderSrc('');
    setRenderFallbackStep(3);
  };

  // Opening: expand from card. Closing: just fade out.
  const getImageStyle = (): React.CSSProperties => {
    if (visible) {
      // Expanded state
      return {
        opacity: 1,
        transform: 'translate(0, 0) scale(1)',
        transition: 'transform 500ms cubic-bezier(0.32, 0.72, 0, 1), opacity 400ms ease',
      };
    }

    // Closing: just fade, no transform back
    if (cardRect) {
      // Starting position (for opening animation)
      const scaleX = cardRect.width / window.innerWidth;
      const scaleY = cardRect.height / window.innerHeight;
      const scale = Math.min(scaleX, scaleY);
      const cardCenterX = cardRect.left + cardRect.width / 2;
      const cardCenterY = cardRect.top + cardRect.height / 2;
      const translateX = cardCenterX - window.innerWidth / 2;
      const translateY = cardCenterY - window.innerHeight / 2;

      return {
        opacity: 0,
        transform: `translate(${translateX}px, ${translateY}px) scale(${scale})`,
        transition: 'opacity 500ms ease', // Smooth fade on close
      };
    }

    return { opacity: 0, transition: 'opacity 500ms ease' };
  };

  return (
    <div
      className={`fixed inset-0 z-50 ${
        visible ? 'pointer-events-auto' : 'pointer-events-none'
      }`}
    >
      {/* Background */}
      <div
        className={`absolute inset-0 bg-bg-primary will-change-opacity ${
          visible ? 'opacity-100' : 'opacity-0'
        }`}
        style={{ transition: 'opacity 400ms cubic-bezier(0.32, 0.72, 0, 1)' }}
      />

      {/* Hero Portrait - Expand on open, fade on close */}
      <div
        className="fixed inset-0 z-10 overflow-hidden"
        style={getImageStyle()}
      >
        {renderSrc ? (
          <img
            src={renderSrc}
            alt={hero.name}
            className="h-full w-full object-contain object-right"
            onError={handleRenderError}
          />
        ) : (
          <div className="h-full w-full flex items-center justify-center text-text-secondary text-4xl">
            {hero.name}
          </div>
        )}
      </div>

      {/* Hero Name - Fade in/out */}
      <div
        className="fixed top-8 left-8 z-20"
        style={{
          opacity: visible ? 1 : 0,
          transition: visible ? 'opacity 400ms ease 200ms' : 'opacity 500ms ease',
        }}
      >
        {nameFailed ? (
          <h1 className="text-4xl font-bold text-white drop-shadow-[0_4px_24px_rgba(0,0,0,0.8)]">
            {hero.name}
          </h1>
        ) : (
          <img
            src={getHeroNamePath(hero.name)}
            alt={hero.name}
            className="h-12 w-auto object-contain drop-shadow-[0_4px_24px_rgba(0,0,0,0.8)]"
            onError={() => setNameFailed(true)}
          />
        )}
        <div
          className={`mt-2 text-sm text-white/70 drop-shadow-[0_2px_8px_rgba(0,0,0,0.8)] transition-opacity duration-300 ${
            visible ? 'opacity-100' : 'opacity-0'
          }`}
          style={{ transitionDelay: visible ? '300ms' : '0ms' }}
        >
          {mods.length > 0 ? `${mods.length} skin${mods.length !== 1 ? 's' : ''}` : 'No skins installed'}
        </div>
      </div>

      {/* Close button */}
      <button
        type="button"
        onClick={onClose}
        className="fixed top-8 right-8 z-20 p-3 rounded-full bg-black/40 text-white/80 hover:text-white hover:bg-black/60"
        style={{
          opacity: visible ? 1 : 0,
          transition: visible ? 'opacity 400ms ease 250ms' : 'opacity 500ms ease',
        }}
      >
        <X className="w-6 h-6" />
      </button>

      {/* Favorite button */}
      <button
        type="button"
        onClick={onToggleFavorite}
        className={`fixed top-8 right-24 z-20 flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-semibold ${
          isFavorite
            ? 'border-yellow-400/60 bg-yellow-400/20 text-yellow-300'
            : 'border-white/30 bg-black/40 text-white/80 hover:text-white hover:bg-black/60'
        }`}
        style={{
          opacity: visible ? 1 : 0,
          transition: visible ? 'opacity 400ms ease 250ms' : 'opacity 500ms ease',
        }}
      >
        <Star className="w-4 h-4" />
        {isFavorite ? 'Favorited' : 'Favorite'}
      </button>

      {/* Floating Skin Selection Card - Center left */}
      <div
        className="fixed top-1/2 left-8 z-20 w-[380px] max-h-[70vh] -translate-y-1/2 overflow-y-auto rounded-2xl border border-white/10 bg-black/60 backdrop-blur-xl shadow-2xl"
        style={{
          opacity: visible ? 1 : 0,
          transition: visible ? 'opacity 400ms ease 150ms' : 'opacity 500ms ease',
        }}
      >
        <div className="p-5 space-y-4">
          <div className="text-xs uppercase tracking-wider text-white/50">Skins</div>
          <HeroSkinsPanel
            mods={mods}
            onSelect={onSelectSkin}
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

      {/* Click anywhere to close (but not on the card) */}
      <div
        className={`absolute inset-0 z-10 ${visible ? '' : 'pointer-events-none'}`}
        onClick={onClose}
      />
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

interface HeroGalleryCardProps {
  hero: HeroCategory;
  skinCount: number;
  isFavorite: boolean;
  isActive: boolean;
  onNavigate: (rect: DOMRect) => void;
  onToggleFavorite: () => void;
}

function HeroGalleryCard({
  hero,
  skinCount,
  isFavorite,
  isActive,
  onNavigate,
  onToggleFavorite,
}: HeroGalleryCardProps) {
  const renderLocal = getHeroRenderPath(hero.name);
  const wikiUrl = getHeroWikiUrl(hero.name);
  const namePath = getHeroNamePath(hero.name);
  const facePositionX = getHeroFacePosition(hero.name);
  const [renderSrc, setRenderSrc] = useState('');
  const [fallbackStep, setFallbackStep] = useState(0);
  const [nameFailed, setNameFailed] = useState(false);
  const [isVisible, setIsVisible] = useState(false);
  const cardRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (isActive && !isVisible) {
      setIsVisible(true);
    }
  }, [isActive, isVisible]);

  useEffect(() => {
    if (isVisible) {
      setRenderSrc(renderLocal);
      return;
    }
    if (typeof window === 'undefined' || !('IntersectionObserver' in window)) {
      setIsVisible(true);
      return;
    }
    const node = cardRef.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setIsVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: '200px' }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [isVisible, renderLocal]);

  const handleRenderError = () => {
    if (fallbackStep === 0) {
      setRenderSrc(wikiUrl);
      setFallbackStep(1);
      return;
    }
    if (fallbackStep === 1 && hero.iconUrl) {
      setRenderSrc(hero.iconUrl);
      setFallbackStep(2);
      return;
    }
    setRenderSrc('');
    setFallbackStep(3);
  };

  const handleClick = () => {
    if (cardRef.current) {
      onNavigate(cardRef.current.getBoundingClientRect());
    }
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      ref={cardRef}
      className={`group relative w-full overflow-hidden rounded-2xl border border-border bg-bg-secondary text-left shadow-sm transition-transform duration-300 hover:-translate-y-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70 ${
        isActive ? 'z-10 scale-[1.04] shadow-2xl' : ''
      }`}
    >
      <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-transparent opacity-80" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(255,255,255,0.06),_transparent_55%)] opacity-60 transition-opacity duration-300 group-hover:opacity-100" />
      <div className="relative aspect-[3/4] min-h-[18rem] sm:min-h-[20rem] lg:min-h-[24rem]">
        {renderSrc ? (
          <img
            src={renderSrc}
            alt={hero.name}
            className={`absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.06] ${
              isActive ? 'scale-[1.12]' : ''
            }`}
            style={{ objectPosition: `${facePositionX}% 20%` }}
            loading="lazy"
            decoding="async"
            onError={handleRenderError}
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-text-secondary">
            {hero.name}
          </div>
        )}
      </div>
      {isFavorite && (
        <button
          type="button"
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onToggleFavorite();
          }}
          className="absolute right-3 top-3 flex items-center justify-center rounded-full border border-yellow-400/60 bg-yellow-400/20 p-1.5 text-yellow-300 transition-colors"
          title="Unfavorite"
        >
          <Star className="w-3.5 h-3.5 fill-current" />
        </button>
      )}
      <div className="absolute bottom-0 left-0 right-0 p-4 flex flex-col items-end text-right">
        {nameFailed ? (
          <div className="text-base font-semibold text-white drop-shadow-[0_2px_12px_rgba(0,0,0,0.6)]">{hero.name}</div>
        ) : (
          <img
            src={namePath}
            alt={hero.name}
            className={`w-[65%] h-auto max-h-9 object-contain object-right drop-shadow-[0_2px_12px_rgba(0,0,0,0.6)] transition-transform duration-500 group-hover:scale-105 ${
              isActive ? 'scale-110' : ''
            }`}
            loading="lazy"
            decoding="async"
            onError={() => setNameFailed(true)}
          />
        )}
        {skinCount > 0 && (
          <div className="mt-1.5 text-[11px] text-white/70">
            {skinCount} skin{skinCount !== 1 ? 's' : ''}
          </div>
        )}
      </div>
    </button>
  );
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
  const localUrl = getHeroRenderPath(hero.name);
  const wikiUrl = getHeroWikiUrl(hero.name);
  const [iconSrc, setIconSrc] = useState(() => localUrl);
  const [fallbackStep, setFallbackStep] = useState(0);

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
            {mods.length > 0 ? `${mods.length} skin${mods.length !== 1 ? 's' : ''}` : 'No skins installed'}
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

      <div className="p-3">
        <HeroSkinsPanel
          mods={mods}
          onSelect={onSelect}
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
