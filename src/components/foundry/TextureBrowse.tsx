import { useCallback, useEffect, useMemo, useState } from 'react';
import { ImageIcon, Search, Loader2, AlertTriangle, Users, Box, Sparkles } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { EmptyState } from '../common/PageComponents';
import Tx from '../translation/Tx';
import { foundryTextures } from '../../lib/api';
import type { HeroInfo, TextureCategory, TextureEntry, TextureGridItem } from '../../types/foundry';
import TextureLightbox from './TextureLightbox';

interface TextureBrowseProps {
  /** Full roster, used to populate the hero filter the list is scoped by. */
  heroes: HeroInfo[];
  /** codename -> display name, resolved once by the Foundry shell. */
  heroNames: Map<string, string>;
}

// The two large, hero-scoped texture families the reskin/VFX work targets. These
// carry no pre-baked thumbnail batch (too many entries), so this view lists them
// and decodes a single texture full-size on click instead of a thumbnail grid.
const CATEGORIES: { value: TextureCategory; icon: typeof Box; labelKey: string; fallback: string }[] = [
  { value: 'hero-model', icon: Box, labelKey: 'foundry.texture.categories.heroModel', fallback: 'Hero models' },
  { value: 'ability-vfx', icon: Sparkles, labelKey: 'foundry.texture.categories.abilityVfx', fallback: 'Ability VFX' },
];

// Cap the list so a hero with hundreds of model textures stays responsive; the
// engine logs a truncation note, we surface the same to the user.
const LIMIT = 400;

/**
 * The Texture sub-tool: browse the large hero-model / ability-vfx texture
 * families (the skin/reskin/recolor targets). Unlike the Library grid these are
 * not pre-thumbnailed, so the list is always scoped by hero (or a search) to
 * stay bounded, and each row decodes its texture full-size on click. One IPC
 * call per (category, hero, search); the lightbox does the on-demand decode.
 */
export default function TextureBrowse({ heroes, heroNames }: TextureBrowseProps) {
  const { t } = useTranslation();
  const [category, setCategory] = useState<TextureCategory>('hero-model');
  const [heroFilter, setHeroFilter] = useState('');
  const [search, setSearch] = useState('');
  const [items, setItems] = useState<TextureEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [lightbox, setLightbox] = useState<TextureGridItem | null>(null);

  // Hero dropdown: every roster hero, by display name. Texture entries key on the
  // codename, which is what we send as the filter.
  const heroOptions = useMemo(
    () =>
      heroes
        .map((h) => ({ code: h.codename, name: h.name }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [heroes],
  );

  // Unbounded hero-model is thousands of entries, so refuse to fetch until the
  // list is narrowed by a hero or a search term.
  const ready = heroFilter !== '' || search.trim().length > 0;

  const load = useCallback(
    async (cat: TextureCategory, hero: string, term: string) => {
      setLoading(true);
      setError(null);
      try {
        const rows = await foundryTextures({
          category: cat,
          hero: hero || undefined,
          search: term.trim() || undefined,
          limit: LIMIT,
        });
        setItems(rows);
        setTruncated(rows.length >= LIMIT);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        setItems([]);
        setTruncated(false);
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  // Debounce so typing in the search box doesn't fire an IPC call per keystroke.
  useEffect(() => {
    if (!ready) {
      setItems([]);
      setTruncated(false);
      setError(null);
      return;
    }
    const handle = setTimeout(() => void load(category, heroFilter, search), 250);
    return () => clearTimeout(handle);
  }, [category, heroFilter, search, ready, load]);

  return (
    <>
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1.5 rounded-sm border border-border bg-bg-tertiary px-2 py-1.5">
          <ImageIcon size={14} className="text-text-secondary" />
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

        <div className="flex items-center gap-1.5 rounded-sm border border-border bg-bg-tertiary px-2 py-1.5">
          <Users size={14} className="text-text-secondary" />
          <select
            value={heroFilter}
            onChange={(e) => setHeroFilter(e.target.value)}
            className="bg-transparent text-sm text-text-primary focus:outline-none"
          >
            <option value="" className="bg-bg-secondary">
              {t('foundry.texture.pickHero', 'Select a hero')}
            </option>
            {heroOptions.map((h) => (
              <option key={h.code} value={h.code} className="bg-bg-secondary">
                {h.name}
              </option>
            ))}
          </select>
        </div>

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

      {/* List / states */}
      {!ready ? (
        <EmptyState
          icon={ImageIcon}
          title={<Tx k="foundry.texture.scope.title" fallback="Pick a hero to browse textures" />}
          description={
            <Tx
              k="foundry.texture.scope.description"
              fallback="Hero model and VFX textures are a large set, so choose a hero (or type a search) to narrow the list."
            />
          }
        />
      ) : loading ? (
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
      ) : items.length === 0 ? (
        <EmptyState
          icon={ImageIcon}
          title={<Tx k="foundry.texture.empty.title" fallback="No textures match" />}
          description={
            <Tx
              k="foundry.texture.empty.description"
              fallback="No textures in this category for that hero or search. Try another category or hero."
            />
          }
        />
      ) : (
        <div className="space-y-2">
          <p className="text-[11px] text-text-secondary">
            {truncated
              ? t('foundry.texture.countCapped', 'Showing the first {{count}}. Refine your search to see more.', {
                  count: items.length,
                })
              : t('foundry.texture.count', '{{count}} textures', { count: items.length })}
          </p>
          <ul className="divide-y divide-border/60 overflow-hidden rounded-sm border border-border">
            {items.map((entry) => (
              <li key={entry.path}>
                <button
                  type="button"
                  onClick={() => setLightbox({ ...entry, thumbUrl: null })}
                  className="flex w-full items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-bg-tertiary"
                >
                  <ImageIcon size={15} className="shrink-0 text-text-secondary/70" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm capitalize text-text-primary" title={entry.label}>
                      {entry.label || t('foundry.lightbox.unnamed', '(unnamed)')}
                    </span>
                    <span className="block truncate text-[11px] text-text-secondary" title={entry.path}>
                      {entry.path}
                    </span>
                  </span>
                  {entry.hero && (
                    <span className="shrink-0 text-[11px] text-text-secondary/70">
                      {heroNames.get(entry.hero) ?? entry.hero}
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <TextureLightbox
        item={lightbox}
        heroName={lightbox?.hero ? heroNames.get(lightbox.hero) : undefined}
        onClose={() => setLightbox(null)}
      />
    </>
  );
}
