import { useMemo, useState } from 'react';
import { Palette, Users } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { EmptyState } from '../common/PageComponents';
import Tx from '../translation/Tx';
import HeroEffectsPanel from '../locker/HeroEffectsPanel';
import type { HeroInfo } from '../../types/foundry';

interface RecolorToolProps {
  /** Full roster; the recolor surface is keyed by hero display name. */
  heroes: HeroInfo[];
}

/**
 * The Recolor sub-tool: pick a hero, then recolor their ability VFX (single
 * color / rainbow prism / gradient / trippy) and body/gun materials. This reuses
 * the exact recolor surface from the Locker (HeroEffectsPanel), which keys by
 * the hero display name and self-gates on the pinned-recipe support check, so a
 * hero without a recipe shows its own "unavailable" note. The bake lands in the
 * same one-recolor-per-hero Locker slot, so a pick made here shows up there too.
 */
export default function RecolorTool({ heroes }: RecolorToolProps) {
  const { t } = useTranslation();
  const [heroName, setHeroName] = useState('');

  // Selectable heroes first (the ones with a real recipe live here); de-dup by
  // display name since the panel keys on it.
  const heroOptions = useMemo(
    () =>
      Array.from(new Set(heroes.map((h) => h.name)))
        .sort((a, b) => a.localeCompare(b)),
    [heroes],
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-1.5 rounded-sm border border-border bg-bg-tertiary px-2 py-1.5 w-fit">
        <Users size={14} className="text-text-secondary" />
        <select
          value={heroName}
          onChange={(e) => setHeroName(e.target.value)}
          className="bg-transparent text-sm text-text-primary focus:outline-none"
        >
          <option value="" className="bg-bg-secondary">
            {t('foundry.recolor.pickHero', 'Select a hero')}
          </option>
          {heroOptions.map((name) => (
            <option key={name} value={name} className="bg-bg-secondary">
              {name}
            </option>
          ))}
        </select>
      </div>

      {heroName === '' ? (
        <EmptyState
          icon={Palette}
          title={<Tx k="foundry.recolor.scope.title" fallback="Pick a hero to recolor" />}
          description={
            <Tx
              k="foundry.recolor.scope.description"
              fallback="Choose a hero to repaint their ability VFX (single color, rainbow, gradient, or trippy) and body/gun materials. The result is saved as a managed mod you can remove anytime."
            />
          }
        />
      ) : (
        // Keyed by hero so a hero switch remounts the panel with fresh state.
        <HeroEffectsPanel key={heroName} heroName={heroName} />
      )}
    </div>
  );
}
