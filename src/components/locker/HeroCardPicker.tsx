import { useEffect, useState } from 'react';
import { Images, Loader2, AlertCircle } from 'lucide-react';
import { getHeroPortraits } from '../../lib/api';
import type { HeroPortrait } from '../../types/portrait';

interface HeroCardPickerProps {
  heroName: string;
}

const VARIANT_LABEL: Record<string, string> = {
  card: 'Card',
  vertical: 'Vertical',
  card_critical: 'Low HP',
  card_gloat: 'Gloat',
  minimap: 'Minimap',
  small: 'Small',
  other: 'Other',
};

/**
 * EXPERIMENTAL prototype: surfaces the hero card/portrait art that the user's
 * installed mods ship, decoded on demand via `vpkmerge portrait`. Selecting a
 * card only highlights it for now: actually applying it to the game (splitting
 * the panorama art out of its source mod and rolling it into the load order)
 * is a separate, not-yet-built step.
 */
export default function HeroCardPicker({ heroName }: HeroCardPickerProps) {
  // This component is remounted per hero (the parent LockerHeroView is keyed
  // by hero.id), so initial state stands in for the per-hero reset and the
  // effect only needs to set state from its async callbacks.
  const [portraits, setPortraits] = useState<HeroPortrait[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    getHeroPortraits(heroName)
      .then((list) => {
        if (active) setPortraits(list);
      })
      .catch((err) => {
        if (active) setError(String(err));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [heroName]);

  // Prefer the full "card" cover for the grid; fall back to whatever exists.
  const covers = portraits.filter((p) => p.variant === 'card');
  const display = covers.length > 0 ? covers : portraits;

  return (
    <section className="space-y-3 border-t border-border/60 pt-5">
      <div className="flex items-center gap-2">
        <Images className="w-4 h-4 text-accent" />
        <h3 className="text-sm font-semibold text-text-primary">Hero Card</h3>
        <span className="rounded-full border border-accent/40 bg-accent/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-accent">
          Experimental
        </span>
      </div>
      <p className="text-xs text-text-secondary">
        Card art found in your installed mods. Preview only for now: selecting one
        does not change the game yet.
      </p>

      {loading && (
        <div className="flex items-center gap-2 py-4 text-xs text-text-secondary">
          <Loader2 className="w-4 h-4 animate-spin" /> Decoding portraits...
        </div>
      )}

      {error && (
        <div className="flex items-start gap-2 py-2 text-xs text-red-400">
          <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <span className="break-words">{error}</span>
        </div>
      )}

      {!loading && !error && display.length === 0 && (
        <p className="py-2 text-xs text-text-secondary">
          No card art found in your installed mods for {heroName}.
        </p>
      )}

      {display.length > 0 && (
        <div className="grid grid-cols-3 gap-2">
          {display.map((p, i) => {
            const key = `${p.modFileName}:${p.variant}:${i}`;
            const isSelected = selected === key;
            return (
              <button
                type="button"
                key={key}
                onClick={() => setSelected(isSelected ? null : key)}
                title={`${p.modFileName} · ${VARIANT_LABEL[p.variant] ?? p.variant} · ${p.width}x${p.height} · ${p.formatName}`}
                className={`group relative overflow-hidden rounded-lg border bg-bg-tertiary transition-colors cursor-pointer ${
                  isSelected
                    ? 'border-accent ring-2 ring-accent/50'
                    : 'border-border hover:border-accent/50'
                }`}
              >
                <img
                  src={p.dataUrl}
                  alt={`${heroName} card from ${p.modFileName}`}
                  className="w-full aspect-[3/4] object-contain"
                />
                <span className="block truncate px-1.5 py-1 text-left text-[10px] text-text-secondary">
                  {p.modFileName.replace(/_dir\.vpk$/, '')}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}
