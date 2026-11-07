import { HERO_NAMES, canonicalHeroName } from './lockerUtils';
import { nameMentionsHero } from './heroFilter';

/** Browse's cached category roster includes heroes newer than the app's bundle. */
export function heroNamesInText(text: string, heroNames: readonly string[] = HERO_NAMES): string[] {
  const roster = heroNames.length ? heroNames : HERO_NAMES;
  const normalized = text.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');
  return [...new Set(roster.map(canonicalHeroName))]
    .filter(hero => nameMentionsHero(normalized, hero));
}

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
