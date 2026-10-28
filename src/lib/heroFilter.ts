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

/** A category's own id plus every descendant, for a category below the roots of
 *  `tree`. Undefined for a root (the catalog scopes those by name) and for an id
 *  the tree does not hold. */
export function subcategorySubtreeIds(
  tree: GameBananaCategoryNode[],
  categoryId: number,
): number[] | undefined {
  const find = (nodes: GameBananaCategoryNode[], isRoot: boolean): number[] | undefined => {
    for (const node of nodes) {
      if (node.id === categoryId) return isRoot ? undefined : categorySubtreeIds(node);
      const inChild = find(node.children ?? [], false);
      if (inChild) return inChild;
    }
    return undefined;
  };
  return find(tree, true);
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const heroPatterns = new Map<string, RegExp>();

/** Whole-word, case-insensitive. Cased letters bound a name but digits do not,
 *  so "Rem" matches "Rem2" and "Rem's" yet not "Remodel", and "Silver" does not
 *  match "Silverhand". A trailing "s" is a possessive titles often write without
 *  the apostrophe ("Billys Blasted"). Uncased scripts (CJK) put no space after a
 *  name, so "Mina兔女郎" still names Mina. Used where a category names no hero:
 *  Sound, Wip, and skins filed under a root. */
export function nameMentionsHero(name: string, hero: string): boolean {
  let pattern = heroPatterns.get(hero);
  if (!pattern) {
    const aliases = [hero.toLowerCase(), ...(HERO_ALIASES[hero] ?? [])];
    const cased = '[\\p{Lu}\\p{Ll}\\p{Lt}]';
    pattern = new RegExp(`(?<!${cased})(?:${aliases.map(escapeRegex).join('|')})(?:['’]?s)?(?!${cased})`, 'iu');
    heroPatterns.set(hero, pattern);
  }
  return pattern.test(name);
}
