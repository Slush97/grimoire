import { useEffect, useState } from 'react';
import type { GameBananaMod } from '../../types/gamebanana';

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

function normalizeReadableChipLabel(label: string | undefined): string | null {
  const cleaned = label?.replace(/\s+/g, ' ').trim();
  if (!cleaned) return null;

  const lower = cleaned.toLowerCase();
  if (lower === 'skins') return 'Skin';
  if (lower === 'sounds') return 'Sound';
  if (lower === 'mods') return 'Mod';
  if (lower === 'hud' || lower === 'huds') return 'HUD';
  if (lower === 'ui') return 'UI';
  return cleaned;
}

function addReadableChip(chips: BrowseReadableChip[], label: string | undefined, tone?: BrowseReadableChipTone) {
  const normalized = normalizeReadableChipLabel(label);
  if (!normalized) return;

  const exists = chips.some((chip) => chip.label.toLowerCase() === normalized.toLowerCase());
  if (!exists) chips.push({ label: normalized, tone });
}

export function getReadableCardChips(mod: GameBananaMod, section: string): BrowseReadableChip[] {
  const chips: BrowseReadableChip[] = [];
  const isSoundSection = section === 'Sound';
  const categoryLabel = mod.rootCategory?.name ?? section;

  addReadableChip(chips, categoryLabel, isSoundSection ? 'accent' : 'neutral');
  if (mod.nsfw) addReadableChip(chips, '18+', 'danger');

  // Keep the NSFW flag ahead of category labels.
  const rank = (chip: BrowseReadableChip) => (chip.label === '18+' ? 0 : 1);
  chips.sort((a, b) => rank(a) - rank(b));

  return chips;
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
