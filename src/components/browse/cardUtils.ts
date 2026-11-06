import { useEffect, useState } from 'react';
import type { GameBananaCategory, GameBananaMod } from '../../types/gamebanana';
import { resolveCategoryPath } from '../../lib/categoryPaths';
import { heroNameForLabel, heroNamesInText } from '../../lib/heroNames';

// Abbreviate counts (1234 -> 1.2k, 98765 -> 99k). Falsy/non-finite inputs
// render as "0" — without this, undefined slips past every `<` check
// (NaN comparisons are always false) and falls through to the millions
// branch, producing "NaNm" on mods with no recorded likes/views/downloads.
export function formatCount(n: number | null | undefined): string {
  if (!Number.isFinite(n) || (n as number) <= 0) return '0';
  const value = n as number;
  if (value < 1000) return String(value);
  if (value < 10_000) return `${(value / 1000).toFixed(1)}k`;
  if (value < 1_000_000) return `${Math.round(value / 1000)}k`;
  return `${(value / 1_000_000).toFixed(1)}m`;
}

export type BrowseReadableChipTone = 'neutral' | 'accent' | 'danger';

export type BrowseReadableChip = {
  label: string;
  tone?: BrowseReadableChipTone;
};

function addReadableChip(chips: BrowseReadableChip[], label: string | undefined, tone?: BrowseReadableChipTone) {
  const normalized = label?.replace(/\s+/g, ' ').trim();
  if (!normalized) return;

  const exists = chips.some((chip) => chip.label.toLowerCase() === normalized.toLowerCase());
  if (!exists) chips.push({ label: normalized, tone });
}

export function getBrowseCardTaxonomy(
  mod: GameBananaMod,
  section: string,
  paths?: ReadonlyMap<number, readonly GameBananaCategory[]>,
  heroNames?: readonly string[],
): { heroNames: string[]; chips: BrowseReadableChip[] } {
  const categories = resolveCategoryPath(paths, mod.subCategory, mod.rootCategory);
  const chips: BrowseReadableChip[] = [];
  const isSoundSection = section === 'Sound';
  let categoryHero: string | null = null;

  for (const category of categories) {
    const hero = heroNameForLabel(category.name, heroNames);
    if (hero) categoryHero ??= hero;
    else addReadableChip(chips, category.name, isSoundSection ? 'accent' : 'neutral');
  }
  if (categories.length === 0) addReadableChip(chips, section, isSoundSection ? 'accent' : 'neutral');
  if (mod.nsfw) addReadableChip(chips, '18+', 'danger');

  // Keep the NSFW flag ahead of category labels.
  const rank = (chip: BrowseReadableChip) => (chip.label === '18+' ? 0 : 1);
  chips.sort((a, b) => rank(a) - rank(b));

  return { heroNames: categoryHero ? [categoryHero] : heroNamesInText(mod.name, heroNames), chips };
}

export function usePrefersReducedMotion() {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(() => (
    typeof window !== 'undefined'
      ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
      : false
  ));

  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');

    const handleChange = (event: MediaQueryListEvent) => {
      setPrefersReducedMotion(event.matches);
    };

    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, []);

  return prefersReducedMotion;
}
