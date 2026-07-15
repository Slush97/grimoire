import { useCallback, useEffect, useMemo, useState } from 'react';
import { Library, Search, Loader2, AlertTriangle, Users } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { EmptyState } from '../common/PageComponents';
import Tx from '../translation/Tx';
import { foundryThumbnails } from '../../lib/api';
import type { TextureCategory, TextureGridItem } from '../../types/foundry';
import TextureGrid from './TextureGrid';
import TextureLightbox from './TextureLightbox';

interface LibraryBrowseProps {
  /** codename -> display name, resolved once by the Foundry shell. */
  heroNames: Map<string, string>;
  /** Category the grid opens on (the Items sub-tool lands on item icons). */
  initialCategory?: TextureCategory;
}

// The bounded, thumbnailable categories the browse grid surfaces this pass.
const CATEGORIES: { value: TextureCategory; labelKey: string; fallback: string }[] = [
  { value: 'ability-icon', labelKey: 'foundry.categories.abilityIcon', fallback: 'Ability icons' },
  { value: 'item-icon', labelKey: 'foundry.categories.itemIcon', fallback: 'Item icons' },
  { value: 'hero-image', labelKey: 'foundry.categories.heroImage', fallback: 'Hero images' },
];

/**
 * The Library sub-tool: browse the texture/icon catalog by category, with a
 * client-side hero/search narrowing and an enlarge-on-click lightbox. One IPC
 * call per category (thumbnails decoded once and cached); filtering is local.
 */
export default function LibraryBrowse({ heroNames, initialCategory = 'ability-icon' }: LibraryBrowseProps) {
  const { t } = useTranslation();
  const [category, setCategory] = useState<TextureCategory>(initialCategory);
  const [items, setItems] = useState<TextureGridItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [heroFilter, setHeroFilter] = useState('all');
  const [lightbox, setLightbox] = useState<TextureGridItem | null>(null);

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
    setHeroFilter('all');
    void loadCategory(category);
  }, [category, loadCategory]);

  // Hero dropdown is scoped to the codenames actually present in this category.
  const presentHeroes = useMemo(() => {
    const codes = new Set<string>();
    for (const it of items) if (it.hero) codes.add(it.hero);
    return [...codes]
      .map((code) => ({ code, name: heroNames.get(code) ?? code }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [items, heroNames]);

  return (
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
          onOpen={setLightbox}
        />
      )}

      <TextureLightbox
        item={lightbox}
        heroName={lightbox?.hero ? heroNames.get(lightbox.hero) : undefined}
        onClose={() => setLightbox(null)}
      />
    </>
  );
}
