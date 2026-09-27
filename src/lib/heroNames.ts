import { HERO_NAMES } from './lockerUtils';

export function heroNameForLabel(label?: string): string | null {
  if (!label) return null;
  const needle = label.trim().toLowerCase();
  return HERO_NAMES.find((name) => name.toLowerCase() === needle) ?? null;
}
