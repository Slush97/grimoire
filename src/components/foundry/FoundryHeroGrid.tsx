import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { HeroInfo } from '../../types/foundry';
import { getHeroRenderPath, getHeroChipIconPath } from '../../lib/lockerUtils';

interface FoundryHeroGridProps {
  /** Full roster from `catalog heroes`. */
  heroes: HeroInfo[];
  /** Open the per-hero workshop for the picked hero. */
  onPick: (hero: HeroInfo) => void;
}

/**
 * The Foundry landing: an aesthetic roster grid. Pick a hero to open their
 * workshop (the per-hero "edit everything" view). Mirrors the Locker's
 * hero-first entry, but lands in the creation workflow rather than installed
 * mods. Selectable heroes lead; in-development heroes follow, dimmed.
 */
export default function FoundryHeroGrid({ heroes, onPick }: FoundryHeroGridProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');

  const ordered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return heroes
      .filter((h) => !h.disabled)
      .filter((h) => (q ? h.name.toLowerCase().includes(q) || h.codename.includes(q) : true))
      // Selectable first, then in-development; alphabetical within each group.
      .sort((a, b) => {
        if (a.selectable !== b.selectable) return a.selectable ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
  }, [heroes, query]);

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2 rounded-sm border border-border bg-bg-tertiary px-3 py-2 w-full max-w-xs">
        <Search size={15} className="text-text-secondary" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('foundry.heroes.search', 'Search heroes')}
          className="w-full bg-transparent text-sm text-text-primary placeholder:text-text-secondary/60 focus:outline-none"
        />
      </div>

      <div className="grid grid-cols-[repeat(auto-fill,minmax(132px,1fr))] gap-3">
        {ordered.map((hero) => (
          <HeroCard key={hero.codename} hero={hero} onPick={() => onPick(hero)} />
        ))}
      </div>

      {ordered.length === 0 && (
        <p className="text-sm text-text-secondary">
          {t('foundry.heroes.noMatch', 'No heroes match that search.')}
        </p>
      )}
    </div>
  );
}

function HeroCard({ hero, onPick }: { hero: HeroInfo; onPick: () => void }) {
  // Render image -> chip icon -> name text, the same graceful fallback chain the
  // Locker uses (in-development heroes often lack a render asset).
  const [step, setStep] = useState(0);
  const src = step === 0 ? getHeroRenderPath(hero.name) : step === 1 ? getHeroChipIconPath(hero.name) : '';

  return (
    <button
      type="button"
      onClick={onPick}
      title={hero.name}
      className={`group relative flex aspect-[3/4] flex-col justify-end overflow-hidden rounded-md border border-border bg-bg-secondary text-left transition-all hover:-translate-y-0.5 hover:border-accent/60 hover:shadow-lg hover:shadow-black/30 cursor-pointer ${
        hero.selectable ? '' : 'opacity-70'
      }`}
    >
      {src ? (
        <img
          src={src}
          alt={hero.name}
          loading="lazy"
          onError={() => setStep((s) => s + 1)}
          className={
            step === 0
              ? 'absolute inset-0 h-full w-full object-cover object-top transition-transform duration-300 group-hover:scale-105'
              : 'absolute left-1/2 top-1/2 h-16 w-16 -translate-x-1/2 -translate-y-1/2 object-contain opacity-80'
          }
        />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center px-2 text-center text-sm font-medium text-text-secondary">
          {hero.name}
        </div>
      )}

      {/* Bottom gradient + name plate. */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-black/85 via-black/30 to-transparent" />
      <div className="relative z-10 p-2">
        <span className="block truncate text-sm font-semibold text-white drop-shadow-[0_1px_6px_rgba(0,0,0,0.8)]">
          {hero.name}
        </span>
        {!hero.selectable && (
          <span className="text-[10px] uppercase tracking-wide text-accent/90">
            in development
          </span>
        )}
      </div>
    </button>
  );
}
