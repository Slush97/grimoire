import type { HeroInfo } from '../types/foundry';

export function orderFoundryHeroes(heroes: readonly HeroInfo[], query = '') {
  const search = query.trim().toLowerCase();
  return heroes
    .filter((hero) => !hero.disabled && (!search || hero.name.toLowerCase().includes(search) || hero.codename.toLowerCase().includes(search)))
    .sort((a, b) => Number(b.selectable) - Number(a.selectable) || a.name.localeCompare(b.name));
}

export function getFoundryHeroNeighbors(heroes: readonly HeroInfo[], codename: string) {
  const index = heroes.findIndex((hero) => hero.codename === codename);
  if (index < 0 || heroes.length < 2) return { previous: undefined, next: undefined };
  return {
    previous: heroes[(index - 1 + heroes.length) % heroes.length],
    next: heroes[(index + 1) % heroes.length],
  };
}
