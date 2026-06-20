import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Hammer,
  Library,
  Volume2,
  Image as ImageIcon,
  ShoppingBag,
  Palette,
  Search,
  Loader2,
  AlertTriangle,
  Users,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { EmptyState, PageHeader } from '../components/common/PageComponents';
import Tx from '../components/translation/Tx';
import { useAppStore } from '../stores/appStore';
import { foundryHeroes, foundryThumbnails, foundryWarmCache } from '../lib/api';
import type { HeroInfo, TextureCategory, TextureGridItem } from '../types/foundry';
import TextureGrid from '../components/foundry/TextureGrid';

// Sub-tools shown in the left rail. Only Library is active in this first slice;
// the rest are placeholders that telegraph the planned Foundry surface.
const SUBTOOLS = [
  { id: 'library', icon: Library, labelKey: 'foundry.subtools.library', enabled: true },
  { id: 'sound', icon: Volume2, labelKey: 'foundry.subtools.sound', enabled: false },
  { id: 'texture', icon: ImageIcon, labelKey: 'foundry.subtools.texture', enabled: false },
  { id: 'items', icon: ShoppingBag, labelKey: 'foundry.subtools.items', enabled: false },
  { id: 'recolor', icon: Palette, labelKey: 'foundry.subtools.recolor', enabled: false },
] as const;

// The bounded, thumbnailable categories the browse grid surfaces this pass.
const CATEGORIES: { value: TextureCategory; labelKey: string; fallback: string }[] = [
  { value: 'ability-icon', labelKey: 'foundry.categories.abilityIcon', fallback: 'Ability icons' },
  { value: 'item-icon', labelKey: 'foundry.categories.itemIcon', fallback: 'Item icons' },
  { value: 'hero-image', labelKey: 'foundry.categories.heroImage', fallback: 'Hero images' },
];

export default function Foundry() {
  const { t } = useTranslation();
  const settings = useAppStore((s) => s.settings);
  const hasGamePath = Boolean(settings?.deadlockPath || (settings?.devMode && settings?.devDeadlockPath));

  const [heroes, setHeroes] = useState<HeroInfo[]>([]);
  const [category, setCategory] = useState<TextureCategory>('ability-icon');
  const [items, setItems] = useState<TextureGridItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [heroFilter, setHeroFilter] = useState('all');

  // Roster (codename -> name) loads once; warm the catalog cache opportunistically
  // so a future Sound tool opens without the cold voice-line rescan.
  useEffect(() => {
    if (!hasGamePath) return;
    let cancelled = false;
    foundryHeroes()
      .then((roster) => {
        if (!cancelled) setHeroes(roster);
      })
      .catch(() => {
        /* roster failure is non-fatal: cards just fall back to the codename */
      });
    void foundryWarmCache();
    return () => {
      cancelled = true;
    };
  }, [hasGamePath]);

  const loadCategory = useCallback(async (cat: TextureCategory) => {
    setLoading(true);
    setError(null);
    try {
      const grid = await foundryThumbnails(cat);
      setItems(grid);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!hasGamePath) {
      setLoading(false);
      return;
    }
    setHeroFilter('all');
    void loadCategory(category);
  }, [hasGamePath, category, loadCategory]);

  const heroNames = useMemo(() => {
    const map = new Map<string, string>();
    for (const h of heroes) map.set(h.codename, h.name);
    return map;
  }, [heroes]);

  // Hero dropdown is scoped to the codenames actually present in this category.
  const presentHeroes = useMemo(() => {
    const codes = new Set<string>();
    for (const it of items) if (it.hero) codes.add(it.hero);
    return [...codes]
      .map((code) => ({ code, name: heroNames.get(code) ?? code }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [items, heroNames]);

  return (
    <div className="flex h-full">
      {/* Left rail: sub-tools */}
      <aside className="flex w-44 shrink-0 flex-col gap-1 border-r border-border bg-bg-secondary/40 p-3">
        <span className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-text-secondary/70">
          <Tx k="foundry.subtools.heading" fallback="Workshop" />
        </span>
        {SUBTOOLS.map((tool) => {
          const Icon = tool.icon;
          return (
            <button
              key={tool.id}
              type="button"
              disabled={!tool.enabled}
              className={`flex items-center gap-2.5 rounded-sm px-2.5 py-2 text-sm transition-colors ${
                tool.enabled
                  ? 'bg-accent/10 font-medium text-accent'
                  : 'cursor-default text-text-secondary/50'
              }`}
            >
              <Icon size={16} />
              <span className="flex-1 text-left"><Tx k={tool.labelKey} fallback={tool.id} /></span>
              {!tool.enabled && (
                <span className="text-[9px] uppercase tracking-wide text-text-secondary/40">
                  <Tx k="foundry.subtools.soon" fallback="soon" />
                </span>
              )}
            </button>
          );
        })}
      </aside>

      {/* Center: catalog browse */}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="space-y-4 p-6">
          <PageHeader
            title={<Tx k="nav.foundry" fallback="Foundry" />}
            description={
              <Tx
                k="foundry.header.description"
                fallback="Browse the game's own asset catalog, built offline from your installed files."
              />
            }
          />

          {!hasGamePath ? (
            <EmptyState
              icon={Hammer}
              title={<Tx k="foundry.empty.noPath.title" fallback="Set your Deadlock path" />}
              description={
                <Tx
                  k="foundry.empty.noPath.description"
                  fallback="Foundry reads the asset catalog from your installed game. Set the Deadlock path in Settings to get started."
                />
              }
            />
          ) : (
            <>
              {/* Filters */}
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-1.5 rounded-sm border border-border bg-bg-tertiary px-2 py-1.5">
                  <Library size={14} className="text-text-secondary" />
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value as TextureCategory)}
                    className="bg-transparent text-sm text-text-primary focus:outline-none"
                  >
                    {CATEGORIES.map((c) => (
                      <option key={c.value} value={c.value} className="bg-bg-secondary">
                        {t(c.labelKey, c.fallback)}
                      </option>
                    ))}
                  </select>
                </div>

                {presentHeroes.length > 0 && (
                  <div className="flex items-center gap-1.5 rounded-sm border border-border bg-bg-tertiary px-2 py-1.5">
                    <Users size={14} className="text-text-secondary" />
                    <select
                      value={heroFilter}
                      onChange={(e) => setHeroFilter(e.target.value)}
                      className="bg-transparent text-sm text-text-primary focus:outline-none"
                    >
                      <option value="all" className="bg-bg-secondary">
                        {t('foundry.filters.allHeroes', 'All heroes')}
                      </option>
                      {presentHeroes.map((h) => (
                        <option key={h.code} value={h.code} className="bg-bg-secondary">
                          {h.name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                <div className="relative min-w-[200px] flex-1">
                  <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary" />
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder={t('foundry.filters.searchPlaceholder', 'Search assets...')}
                    className="w-full rounded-sm border border-border bg-bg-tertiary py-2 pl-9 pr-3 text-sm text-text-primary placeholder:text-text-secondary/60 focus:border-accent/50 focus:outline-none"
                  />
                </div>
              </div>

              {/* Grid / states */}
              {loading ? (
                <div className="flex items-center justify-center gap-2 py-20 text-text-secondary">
                  <Loader2 size={18} className="animate-spin" />
                  <Tx k="foundry.loading" fallback="Building catalog from your game files..." />
                </div>
              ) : error ? (
                <EmptyState
                  icon={AlertTriangle}
                  variant="error"
                  title={<Tx k="foundry.error.title" fallback="Couldn't read the catalog" />}
                  description={error}
                />
              ) : (
                <TextureGrid
                  items={items}
                  heroNames={heroNames}
                  search={search}
                  heroFilter={heroFilter}
                />
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
