import { HERO_ALIASES } from '@grimoire/social-types/heroes';
import type { GameBananaCategoryNode } from '../types/gamebanana';

/** GameBanana's list endpoint returns categories as name + profile URL with no
 *  `_idRow`, so the id only exists inside `.../mods/cats/{id}`. */
export function categoryIdFromProfileUrl(profileUrl: string | undefined): number | undefined {
  const match = profileUrl?.match(/\/cats\/(\d+)/);
  return match ? Number(match[1]) : undefined;
}

/** A category's own id plus every descendant. GameBanana's category filter
 *  includes children, and a mod in a nested category (Rat King -> RatKing Flag)
 *  records the deepest one. */
export function categorySubtreeIds(node: GameBananaCategoryNode): number[] {
  return [node.id, ...(node.children ?? []).flatMap(categorySubtreeIds)];
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const heroPatterns = new Map<string, RegExp>();

/** Whole-word, case-insensitive. Letters bound a name but digits do not, so
 *  "Rem" matches "Rem2" and "Rem's" yet not "Remodel", and "Silver" does not
 *  match "Silverhand". Only used where GameBanana has no hero categories
 *  (Sound, Wip); Mod skins are matched by category. */
export function nameMentionsHero(name: string, hero: string): boolean {
  let pattern = heroPatterns.get(hero);
  if (!pattern) {
    const aliases = [hero.toLowerCase(), ...(HERO_ALIASES[hero] ?? [])];
    pattern = new RegExp(`(?<!\\p{L})(?:${aliases.map(escapeRegex).join('|')})(?!\\p{L})`, 'iu');
    heroPatterns.set(hero, pattern);
  }
  return pattern.test(name);
}
