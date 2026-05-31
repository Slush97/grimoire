import { useEffect, useMemo, useState } from 'react';
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

/** Display order for the variant strip. The full "card" cover reads first,
 *  then the rest roughly by prominence; unknown variants sort last. */
const VARIANT_ORDER = ['card', 'vertical', 'card_critical', 'card_gloat', 'minimap', 'small', 'other'];

function variantRank(variant: string): number {
  const i = VARIANT_ORDER.indexOf(variant);
  return i === -1 ? VARIANT_ORDER.length : i;
}

interface PortraitFileGroup {
  modFileName: string;
  variants: HeroPortrait[];
}

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

  // Group every decoded portrait under the mod file it came from. A single
  // file usually ships several variants (card, vertical, low-HP, gloat...), and
  // apply works on the whole per-hero prefix, so the file is the selectable
  // unit and its variants are shown side by side for preview.
  const fileGroups = useMemo<PortraitFileGroup[]>(() => {
    const byFile = new Map<string, HeroPortrait[]>();
    for (const p of portraits) {
      const arr = byFile.get(p.modFileName) ?? [];
      arr.push(p);
      byFile.set(p.modFileName, arr);
    }
    return Array.from(byFile.entries()).map(([modFileName, variants]) => ({
      modFileName,
      variants: [...variants].sort((a, b) => variantRank(a.variant) - variantRank(b.variant)),
    }));
  }, [portraits]);

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
        Card art found in your installed mods. Each mod may ship several portrait
        variants; click a card to apply that mod's full set for {heroName}, and click
        the applied card again to revert to default.
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

      {!loading && !error && fileGroups.length === 0 && (
        <p className="py-2 text-xs text-text-secondary">
          No card art found in your installed mods for {heroName}.
        </p>
      )}

      {fileGroups.length > 0 && (
        <div className="space-y-2.5">
          {fileGroups.map((group) => {
            const isApplied = activeSource === group.modFileName;
            const isBusy = busySource === group.modFileName;
            return (
              <button
                type="button"
                key={group.modFileName}
                disabled={busySource !== null}
                onClick={() => handlePick(group.modFileName)}
                title={`${group.modFileName} · ${group.variants.length} portrait(s)`}
                // Frosted-glass surface matching HeroSkinsPanel's card tokens so
                // the Cards tab reads as a sibling of Skins. backdrop-blur on the
                // resting state too (not just active) since these sit directly
                // over the hero portrait.
                className={`group relative block w-full overflow-hidden rounded-md border text-left backdrop-blur-sm transition-colors disabled:cursor-not-allowed ${
                  isApplied
                    ? 'border-accent/60 bg-white/[0.05] ring-1 ring-accent/30'
                    : 'border-border bg-bg-secondary/70 hover:border-accent/60 hover:bg-bg-secondary/85'
                } ${busySource !== null && !isBusy ? 'opacity-60' : 'cursor-pointer'}`}
              >
                <div className="flex items-center justify-between gap-2 border-b border-border/50 px-3 py-2">
                  <span className="truncate text-xs font-semibold text-text-primary">
                    {group.modFileName.replace(/_dir\.vpk$/, '')}
                  </span>
                  {isApplied ? (
                    <span className="flex flex-shrink-0 items-center gap-1 rounded-full bg-accent px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-accent-foreground">
                      <Check className="h-2.5 w-2.5" /> Applied
                    </span>
                  ) : (
                    <span className="flex-shrink-0 text-[10px] uppercase tracking-wide text-text-secondary">
                      {group.variants.length} portrait{group.variants.length !== 1 ? 's' : ''}
                    </span>
                  )}
                </div>
                {/* Uniform aspect-3/4 tiles in a fixed grid keep the strip tidy
                    regardless of each variant's native aspect. max-w/h-full
                    contains the art without ever upscaling it, so tiny minimap
                    art stays crisp instead of blurring up to a forced height. */}
                <div className="grid grid-cols-4 gap-2 p-3">
                  {group.variants.map((p, i) => (
                    <figure key={`${p.variant}:${i}`} className="min-w-0">
                      <div className="flex aspect-[3/4] items-center justify-center overflow-hidden rounded-md border border-border/50 bg-bg-primary/40">
                        <img
                          src={p.dataUrl}
                          alt={`${heroName} ${VARIANT_LABEL[p.variant] ?? p.variant}`}
                          title={`${VARIANT_LABEL[p.variant] ?? p.variant} · ${p.width}x${p.height} · ${p.formatName}`}
                          className="max-h-full max-w-full object-contain"
                        />
                      </div>
                      <figcaption className="mt-1 truncate text-center text-[9px] uppercase tracking-wide text-text-secondary">
                        {VARIANT_LABEL[p.variant] ?? p.variant}
                      </figcaption>
                    </figure>
                  ))}
                </div>
                {isBusy && (
                  <span className="absolute inset-0 flex items-center justify-center bg-black/50 backdrop-blur-sm">
                    <Loader2 className="h-5 w-5 animate-spin text-white" />
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}
