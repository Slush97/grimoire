import { describe, expect, it } from 'vitest';
import { buildCategoryPaths } from '../../lib/categoryPaths';
import type { GameBananaMod } from '../../types/gamebanana';
import { getBrowseCardTaxonomy } from './cardUtils';

const mod: GameBananaMod = {
  id: 1, name: 'A mod without a hero in its title', profileUrl: '',
  dateAdded: 0, dateModified: 0, likeCount: 0, viewCount: 0, hasFiles: true, nsfw: false,
  rootCategory: { name: 'Skins' }, subCategory: { id: 3, name: '' },
};
const paths = buildCategoryPaths([{
  id: 1, name: 'Skins', itemCount: 1, children: [{
    id: 2, name: 'Violet', itemCount: 1, children: [{
      id: 3, name: 'Faithful/Vanilla+', itemCount: 1,
    }],
  }],
}]);

describe('Browse category tags', () => {
  it('resolves cached leaf IDs and uses the dynamic hero roster', () => {
    expect(getBrowseCardTaxonomy(mod, 'Mod', paths, ['Violet'])).toEqual({
      heroNames: ['Violet'],
      chips: [{ label: 'Skins', tone: 'neutral' }, { label: 'Faithful/Vanilla+', tone: 'neutral' }],
    });
  });

  it('prefers the assigned hero over an unrelated hero in the title', () => {
    expect(getBrowseCardTaxonomy({ ...mod, name: 'Abrams cosplay' }, 'Mod', paths, ['Violet']).heroNames).toEqual(['Violet']);
  });

  it('keeps supplied root and leaf labels when offline without a tree', () => {
    const taxonomy = getBrowseCardTaxonomy({ ...mod, subCategory: { name: 'New category' }, nsfw: true }, 'Mod');
    expect(taxonomy.chips.map(chip => chip.label)).toEqual(['18+', 'Skins', 'New category']);
  });

  it('only converts exact category names, retaining other category tags', () => {
    const taxonomy = getBrowseCardTaxonomy({
      ...mod, rootCategory: { name: 'Violet effects' }, subCategory: undefined,
    }, 'Sound', undefined, ['Violet']);
    expect(taxonomy.heroNames).toEqual([]);
    expect(taxonomy.chips).toEqual([{ label: 'Violet effects', tone: 'accent' }]);
  });

  it.each(['Sound', 'Wip', 'Mod'])('uses the cached hero roster for %s titles without a hero category', (section) => {
    const taxonomy = getBrowseCardTaxonomy({
      ...mod, name: 'Solomon and Violet voices', rootCategory: { name: 'HUD' }, subCategory: undefined,
    }, section, undefined, ['Solomon', 'Violet']);
    expect(taxonomy.heroNames).toEqual(['Solomon', 'Violet']);
  });

  it('keeps known aliases and ignores names inside unrelated words', () => {
    const taxonomy = getBrowseCardTaxonomy({
      ...mod, name: 'Geist, RatKing and Rem2: a Silverhand remake', subCategory: undefined,
    }, 'Sound', undefined, ['Lady Geist', 'Rat King', 'Rem', 'Silver']);
    expect(taxonomy.heroNames).toEqual(['Lady Geist', 'Rat King', 'Rem']);
  });

  it('deduplicates Browse shorthand and complete names into the dynamic roster identities', () => {
    const taxonomy = getBrowseCardTaxonomy({
      ...mod, name: 'DEADMAN and dAnNy: Deadman Danny, HARROW Nurse Harrow, RATKING Rat King voices',
      rootCategory: { name: 'VOs' }, subCategory: undefined,
    }, 'Sound', undefined, ['Deadman Danny', 'Nurse Harrow', 'Rat King']);
    expect(taxonomy.heroNames).toEqual(['Deadman Danny', 'Nurse Harrow', 'Rat King']);
  });

  it.each(['Sound', 'Wip', 'Mod'])('rejects partial shorthand and nurse alone in %s titles', section => {
    const taxonomy = getBrowseCardTaxonomy({
      ...mod, name: 'Deadmanning, dannyish, harrowing and nurse costumes for a ratkingdom',
      rootCategory: { name: 'Other/Misc' }, subCategory: undefined,
    }, section, undefined, ['Deadman Danny', 'Nurse Harrow', 'Rat King']);
    expect(taxonomy.heroNames).toEqual([]);
  });
});
