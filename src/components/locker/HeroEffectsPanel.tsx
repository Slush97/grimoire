import { useEffect, useState } from 'react';
import { Sparkles, Loader2, AlertCircle, Zap, Shirt } from 'lucide-react';
import { getHeroColorSupport } from '../../lib/api';
import HeroColorPicker from './HeroColorPicker';
import TrippySkinPanel from './TrippySkinPanel';

interface HeroEffectsPanelProps {
  heroName: string;
}

/**
 * The merged Effects tab. The first split is WHAT gets painted, mirroring the
 * two independent per-hero slots in the main process:
 *  - Abilities: the particle recolor slot (color / rainbow / gradient / trippy,
 *    one pick at a time; heroColors.ts, pak03)
 *  - Body + Gun: the material-texture trippy paint slot (trippyEffects.ts,
 *    pak04), which composes with whatever Abilities has applied
 * Both surfaces share the same per-hero support gate (pinned vpkmerge recipes),
 * checked once here so the children can assume support.
 */
export default function HeroEffectsPanel({ heroName }: HeroEffectsPanelProps) {
  const [supported, setSupported] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [surface, setSurface] = useState<'abilities' | 'skin'>('abilities');
  // Applied dots on the surface toggle, reported up by each child panel.
  const [abilitiesApplied, setAbilitiesApplied] = useState(false);
  const [skinApplied, setSkinApplied] = useState(false);

  // No reset-on-hero effect: the caller keys this panel by hero name, so a
  // hero change remounts it (and both child panels) with fresh state.
  useEffect(() => {
    let cancelled = false;
    getHeroColorSupport(heroName)
      .then((isSupported) => {
        if (!cancelled) setSupported(isSupported);
      })
      .catch((err) => {
        if (!cancelled) setError(String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [heroName]);

  const surfaceBtn = (selected: boolean) =>
    `flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium transition-colors ${
      selected
        ? 'border border-accent/40 bg-accent/10 text-text-primary'
        : 'border border-transparent text-text-secondary hover:bg-bg-tertiary hover:text-text-primary'
    }`;

  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-accent" />
        <h3 className="text-sm font-semibold text-text-primary">Effects</h3>
        <span className="rounded-full border border-accent/40 bg-accent/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-accent">
          Experimental
        </span>
      </div>

      {error && (
        <div className="flex items-start gap-2 py-2 text-xs text-red-400">
          <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
          <span className="break-words">{error}</span>
        </div>
      )}

      {!error && supported === null && (
        <div className="flex items-center gap-2 py-4 text-xs text-text-secondary">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading...
        </div>
      )}

      {!error && supported === false && (
        <p className="text-xs text-text-secondary">
          Effects aren&apos;t available for {heroName} yet (no pinned recipe in the bundled
          vpkmerge). More heroes are coming.
        </p>
      )}

      {!error && supported && (
        <>
          {/* Surface toggle: ability particles vs body/gun materials. These are
              independent slots; each keeps its own applied dot. */}
          <div className="inline-flex rounded-md border border-border p-0.5 text-xs">
            <button
              type="button"
              onClick={() => setSurface('abilities')}
              className={surfaceBtn(surface === 'abilities')}
            >
              <Zap className="h-3.5 w-3.5" /> Abilities
              {abilitiesApplied && <span className="h-1.5 w-1.5 rounded-full bg-accent" />}
            </button>
            <button
              type="button"
              onClick={() => setSurface('skin')}
              className={surfaceBtn(surface === 'skin')}
            >
              <Shirt className="h-3.5 w-3.5" /> Body + Gun
              {skinApplied && <span className="h-1.5 w-1.5 rounded-full bg-accent" />}
            </button>
          </div>

          {/* Both stay mounted so applied dots track without refetch churn and
              in-flight slider state survives flipping between surfaces. */}
          <div className={surface === 'abilities' ? 'space-y-3' : 'hidden'}>
            <HeroColorPicker heroName={heroName} onAppliedChange={setAbilitiesApplied} />
          </div>
          <div className={surface === 'skin' ? 'space-y-3' : 'hidden'}>
            <TrippySkinPanel
              heroName={heroName}
              active={surface === 'skin'}
              onAppliedChange={setSkinApplied}
            />
          </div>
        </>
      )}
    </section>
  );
}
