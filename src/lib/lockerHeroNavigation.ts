import type { HeroCategory } from './lockerUtils';

export function getLockerHeroNeighbors(
  heroes: readonly HeroCategory[],
  visibleHeroes: readonly HeroCategory[],
  currentId: number,
) {
  const visibleIds = new Set(visibleHeroes.map((hero) => hero.id));
  // Keep the current hero as an anchor if a favorite or mod change hides it.
  const ordered = heroes.filter((hero) => hero.id === currentId || visibleIds.has(hero.id));
  const index = ordered.findIndex((hero) => hero.id === currentId);
  if (index < 0 || ordered.length < 2) return { previous: undefined, next: undefined };
  return {
    previous: ordered[(index - 1 + ordered.length) % ordered.length],
    next: ordered[(index + 1) % ordered.length],
  };
}
