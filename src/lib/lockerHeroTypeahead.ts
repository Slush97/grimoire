export interface HeroTypeaheadHero {
  id: number;
  name: string;
}

export interface HeroTypeaheadState {
  query: string;
  highlightedHeroIds: number[] | null;
}

export function isHeroTypeaheadKey(
  key: string,
  hasActiveQuery: boolean
): boolean {
  return key.length === 1 && (hasActiveQuery || key.trim().length > 0);
}

function sameHeroIds(
  left: readonly number[] | null,
  right: readonly number[] | null
): boolean {
  if (left === right) return true;
  if (!left || !right || left.length !== right.length) return false;
  return left.every((id, index) => id === right[index]);
}

function matchingHeroIds(
  heroes: readonly HeroTypeaheadHero[],
  query: string
): number[] | null {
  if (query.length === 0) return null;

  const normalizedQuery = query.toLowerCase();
  const matches = heroes
    .filter((hero) => {
      const normalizedName = hero.name.toLowerCase();
      return query.length === 1
        ? normalizedName.startsWith(normalizedQuery)
        : normalizedName.includes(normalizedQuery);
    })
    .map((hero) => hero.id);

  return matches.length > 0 ? matches : null;
}

function withQuery(
  state: HeroTypeaheadState,
  query: string,
  heroes: readonly HeroTypeaheadHero[]
): HeroTypeaheadState {
  return {
    ...state,
    query,
    highlightedHeroIds: matchingHeroIds(heroes, query),
  };
}

export function appendHeroTypeaheadCharacter(
  state: HeroTypeaheadState,
  character: string,
  heroes: readonly HeroTypeaheadHero[]
): HeroTypeaheadState {
  return withQuery(state, `${state.query}${character}`, heroes);
}

export function backspaceHeroTypeahead(
  state: HeroTypeaheadState,
  heroes: readonly HeroTypeaheadHero[]
): HeroTypeaheadState {
  return withQuery(state, state.query.slice(0, -1), heroes);
}

export function expireHeroTypeaheadQuery(
  state: HeroTypeaheadState
): HeroTypeaheadState {
  return {
    ...state,
    query: '',
  };
}

export function reconcileHeroTypeaheadHeroes(
  state: HeroTypeaheadState,
  heroes: readonly HeroTypeaheadHero[]
): HeroTypeaheadState {
  const highlightedHeroIds =
    state.query.length > 0
      ? matchingHeroIds(heroes, state.query)
      : state.highlightedHeroIds?.filter((id) =>
          heroes.some((hero) => hero.id === id)
        ) ?? null;
  const normalizedHeroIds =
    highlightedHeroIds && highlightedHeroIds.length > 0
      ? highlightedHeroIds
      : null;

  return sameHeroIds(state.highlightedHeroIds, normalizedHeroIds)
    ? state
    : { ...state, highlightedHeroIds: normalizedHeroIds };
}
