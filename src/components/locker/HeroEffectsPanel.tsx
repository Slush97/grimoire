import { useEffect, useState } from 'react';
import { z } from 'zod';
import { useFoundryDraft } from '../../lib/useFoundryDraft';
import { useTranslation } from 'react-i18next';
import { Loader2, AlertCircle } from 'lucide-react';
import { SegmentedControl } from '../common/ui';
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
  const { t } = useTranslation();
  const [supported, setSupported] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [surface, setSurface] = useFoundryDraft(`effects:${heroName}:surface`, z.enum(['abilities', 'skin']), 'abilities');
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

  return (
    <section className="space-y-3">
      {error && (
        <div className="flex items-start gap-2 py-2 text-xs text-state-danger">
          <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
          <span className="break-words">{error}</span>
        </div>
      )}

      {!error && supported === null && (
        <div className="flex items-center gap-2 py-4 text-xs text-text-secondary">
          <Loader2 className="h-4 w-4 animate-spin" /> {t('locker.effects.loading')}
        </div>
      )}

      {!error && supported === false && (
        <p className="text-xs text-text-secondary">
          {t('locker.effects.unavailable', { hero: heroName })}
        </p>
      )}

      {!error && supported && (
        <>
          {/* Surface toggle: ability particles vs body/gun materials. These are
              independent slots; each keeps its own applied dot. */}
          <SegmentedControl value={surface} onChange={setSurface} options={[
            { value: 'abilities', label: <span className="flex items-center gap-2">{t('locker.effects.abilities')}{abilitiesApplied && <span className="h-1.5 w-1.5 rounded-full bg-accent" />}</span> },
            { value: 'skin', label: <span className="flex items-center gap-2">{t('locker.effects.bodyGun')}{skinApplied && <span className="h-1.5 w-1.5 rounded-full bg-accent" />}</span> },
          ]} />

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
