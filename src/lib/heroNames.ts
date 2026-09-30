import { HERO_NAMES, canonicalHeroName } from './lockerUtils';

export function heroNameForLabel(label?: string): string | null {
  if (!label) return null;
  const needle = canonicalHeroName(label.trim()).toLowerCase();
  return HERO_NAMES.find((name) => name.toLowerCase() === needle) ?? null;
}
