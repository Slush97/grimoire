import { HERO_NAMES, canonicalHeroName } from './lockerUtils';

export function heroNameForLabel(label?: string, heroNames: readonly string[] = HERO_NAMES): string | null {
  if (!label) return null;
  const cleaned = label.replace(/\s+/g, ' ').trim();
  const canonical = canonicalHeroName(cleaned);
  const needle = canonical.toLowerCase();
  const roster = heroNames.length ? heroNames : HERO_NAMES;
  const match = roster.find((name) => canonicalHeroName(name).toLowerCase() === needle);
  // Explicit aliases remain recognizable offline even if the bundled roster
  // predates their hero. Arbitrary category labels never take this fallback.
  return match ? canonicalHeroName(match) : canonical !== cleaned ? canonical : null;
}
