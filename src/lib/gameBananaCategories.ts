import type { TFunction } from 'i18next';

/** Keys for GameBanana's Deadlock categories, by lowercased name. */
const CATEGORY_LABEL_KEYS: Record<string, string> = {
  skins: 'gamebanana.categories.skins',
  abilities: 'gamebanana.categories.abilities',
  'other/misc': 'gamebanana.categories.otherMisc',
  'in-game music': 'gamebanana.categories.inGameMusic',
  hud: 'gamebanana.categories.hud',
  'model replacement': 'gamebanana.categories.modelReplacement',
  vos: 'gamebanana.categories.vos',
  'quality of life/fixes': 'gamebanana.categories.qualityOfLifeFixes',
  weapons: 'gamebanana.categories.weapons',
  'item sounds': 'gamebanana.categories.itemSounds',
  'gameplay events': 'gamebanana.categories.gameplayEvents',
  'sound packs': 'gamebanana.categories.soundPacks',
  killsounds: 'gamebanana.categories.killsounds',
  maps: 'gamebanana.categories.maps',
  'gameplay modifications': 'gamebanana.categories.gameplayModifications',
  'killstreak music': 'gamebanana.categories.killstreakMusic',
  animations: 'gamebanana.categories.animations',
  movement: 'gamebanana.categories.movement',
  audio: 'gamebanana.categories.audio',
};

/**
 * A GameBanana category name in the user's language. For display only: matching,
 * filtering and dedupe keep using the raw name. Names we don't know, such as hero
 * subcategories, pass through unchanged.
 */
export function gameBananaCategoryLabel(name: string, t: TFunction | ((key: string) => string)): string {
  const key = CATEGORY_LABEL_KEYS[name.trim().toLowerCase()];
  return key ? (t as (key: string) => string)(key) : name;
}
