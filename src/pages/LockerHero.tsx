import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Layers, Loader2, Star } from 'lucide-react';
import { Link, useNavigate, useParams } from 'react-router-dom';
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
import {
  MINA_ARCHIVE_DEFAULT,
  buildHeroList,
  buildMinaPresets,
  detectMinaTextures,
  findMinaVariant,
  getHeroNamePath,
  getHeroRenderPath,
  getHeroWikiUrl,
  groupModsByCategory,
  parseMinaVariant,
  type MinaSelection,
  type MinaVariant,
} from '../lib/lockerUtils';

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

  const heroList = useMemo(() => buildHeroList(categories), [categories]);
  const hero = heroList.find((entry) => entry.id === heroId);
  const heroMods = useMemo(() => groupModsByCategory(mods), [mods]);
  const list = hero ? heroMods.map.get(hero.id) ?? [] : [];

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
    const actions: Promise<void>[] = [];
    for (const mod of heroModList) {
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

  const [renderSrc, setRenderSrc] = useState('');
  const [renderFallbackStep, setRenderFallbackStep] = useState(0);
  const [nameFailed, setNameFailed] = useState(false);

  useEffect(() => {
    if (!hero) return;
    setRenderSrc(getHeroRenderPath(hero.name));
    setRenderFallbackStep(0);
    setNameFailed(false);
  }, [hero]);

  const handleRenderError = () => {
    if (!hero) return;
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

  if (!hero || Number.isNaN(heroId)) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-text-secondary">
        <Layers className="w-16 h-16 mb-4 opacity-50" />
        <h2 className="text-xl font-semibold text-text-primary mb-2">Hero Not Found</h2>
        <button
          type="button"
          onClick={() => navigate('/locker')}
          className="mt-3 px-4 py-2 rounded-lg bg-accent text-white"
        >
          Back to Locker
        </button>
      </div>
    );
  }

  return (
    <div className="flex h-full">
      {/* Left Panel - Skin Selection */}
      <div className="w-full lg:w-[400px] xl:w-[450px] flex-shrink-0 overflow-y-auto border-r border-border bg-bg-secondary animate-slide-in-left">
        <div className="p-6 space-y-6">
          {/* Header */}
          <div className="flex items-center justify-between gap-3">
            <Link
              to="/locker"
              className="flex items-center gap-2 text-sm text-text-secondary hover:text-text-primary transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
              Back
            </Link>
            <button
              type="button"
              onClick={() =>
                setFavoriteHeroes((prev) =>
                  prev.includes(hero.id) ? prev.filter((id) => id !== hero.id) : [...prev, hero.id]
                )
              }
              className={`flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-wide transition-colors ${
                favoriteHeroes.includes(hero.id)
                  ? 'border-yellow-400/60 bg-yellow-400/20 text-yellow-300'
                  : 'border-border/70 text-text-secondary hover:text-text-primary'
              }`}
            >
              <Star className="w-4 h-4" />
              {favoriteHeroes.includes(hero.id) ? 'Favorite' : 'Save'}
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
              {list.length > 0 ? `${list.length} skin${list.length !== 1 ? 's' : ''}` : 'No skins'}
            </span>
          </div>

          {/* Skin Selection */}
          <div className="space-y-4">
            <HeroSkinsPanel
              mods={list}
              onSelect={setActiveSkin}
              categoryId={hero.id}
              onRefreshMods={loadMods}
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
          </div>

          {/* Quick Tips */}
          <div className="rounded-xl border border-border bg-bg-tertiary p-4 text-sm text-text-secondary">
            <div className="text-xs uppercase tracking-wider text-text-secondary mb-2">Quick Tips</div>
            <ul className="space-y-1.5 text-xs">
              <li>Pick a skin to set it active for this hero.</li>
              <li>Only one skin can be enabled per hero at a time.</li>
              <li>Use Favorites to keep your go-to heroes at the top.</li>
            </ul>
          </div>
        </div>
      </div>

      {/* Right Panel - Hero Portrait */}
      <div className="hidden lg:block relative flex-1 overflow-hidden bg-bg-primary animate-hero-zoom-in">
        {/* Gradient overlay from left to blend with panel */}
        <div className="absolute inset-y-0 left-0 w-32 bg-gradient-to-r from-bg-secondary to-transparent z-10" />

        {/* Hero Portrait */}
        {renderSrc ? (
          <img
            src={renderSrc}
            alt={hero.name}
            className="absolute inset-0 h-full w-full object-cover object-right"
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
    </div>
  );
}
