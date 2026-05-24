import { useEffect, useState } from 'react';
import { Images, Loader2, AlertCircle, Check } from 'lucide-react';
import { applyHeroCard, getActiveHeroCard, getHeroPortraits, revertHeroCard } from '../../lib/api';
import { useAppStore } from '../../stores/appStore';
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
 * EXPERIMENTAL: surfaces the hero card/portrait art the user's installed mods
 * ship (decoded on demand via `vpkmerge portrait`) and applies the chosen one.
 * Applying splits that hero's `panorama/images/heroes/<codename>_` art out of
 * its source mod and folds it into a single Locker-managed cosmetics VPK that
 * wins by load order. Clicking the active card again reverts to default.
 */
export default function HeroCardPicker({ heroName }: HeroCardPickerProps) {
  const loadMods = useAppStore((s) => s.loadMods);
  // This component is remounted per hero (the parent LockerHeroView is keyed
  // by hero.id), so initial state stands in for the per-hero reset.
  const [portraits, setPortraits] = useState<HeroPortrait[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // The source VPK filename whose card is currently applied for this hero.
  const [activeSource, setActiveSource] = useState<string | null>(null);
  // The source filename mid-apply/revert (drives the per-tile spinner).
  const [busySource, setBusySource] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    Promise.all([getHeroPortraits(heroName), getActiveHeroCard(heroName)])
      .then(([list, activeCard]) => {
        if (!active) return;
        setPortraits(list);
        setActiveSource(activeCard?.sourceFileName ?? null);
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

  const handlePick = async (modFileName: string) => {
    if (busySource) return;
    setBusySource(modFileName);
    setActionError(null);
    try {
      if (activeSource === modFileName) {
        await revertHeroCard(heroName);
        setActiveSource(null);
      } else {
        const result = await applyHeroCard(heroName, modFileName);
        setActiveSource(result.activeSourceFileName);
      }
      // Rebuild changed the cosmetics VPK and possibly the load order; refresh
      // the shared mod list so Installed/Locker stay in sync.
      await loadMods({ silent: true });
    } catch (err) {
      setActionError(String(err));
    } finally {
      setBusySource(null);
    }
  };

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
        Card art found in your installed mods. Click one to apply it for {heroName};
        click the applied card again to revert to default.
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

      {actionError && (
        <div className="flex items-start gap-2 py-2 text-xs text-red-400">
          <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <span className="break-words">{actionError}</span>
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
            const isApplied = activeSource === p.modFileName;
            const isBusy = busySource === p.modFileName;
            return (
              <button
                type="button"
                key={key}
                disabled={busySource !== null}
                onClick={() => handlePick(p.modFileName)}
                title={`${p.modFileName} · ${VARIANT_LABEL[p.variant] ?? p.variant} · ${p.width}x${p.height} · ${p.formatName}`}
                className={`group relative overflow-hidden rounded-lg border bg-bg-tertiary transition-colors disabled:cursor-not-allowed ${
                  isApplied
                    ? 'border-accent ring-2 ring-accent/50'
                    : 'border-border hover:border-accent/50'
                } ${busySource !== null && !isBusy ? 'opacity-60' : 'cursor-pointer'}`}
              >
                <img
                  src={p.dataUrl}
                  alt={`${heroName} card from ${p.modFileName}`}
                  className="w-full aspect-[3/4] object-contain"
                />
                {isApplied && !isBusy && (
                  <span className="absolute top-1 right-1 flex items-center gap-0.5 rounded-full bg-accent px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-white">
                    <Check className="w-2.5 h-2.5" /> Applied
                  </span>
                )}
                {isBusy && (
                  <span className="absolute inset-0 flex items-center justify-center bg-black/50">
                    <Loader2 className="w-5 h-5 animate-spin text-white" />
                  </span>
                )}
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
