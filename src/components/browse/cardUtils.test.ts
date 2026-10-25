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
      heroName: 'Violet',
      chips: [{ label: 'Skins', tone: 'neutral' }, { label: 'Faithful/Vanilla+', tone: 'neutral' }],
    });
  });

  it('prefers the assigned hero over an unrelated hero in the title', () => {
    expect(getBrowseCardTaxonomy({ ...mod, name: 'Abrams cosplay' }, 'Mod', paths, ['Violet']).heroName).toBe('Violet');
  });

  it('keeps supplied root and leaf labels when offline without a tree', () => {
    const taxonomy = getBrowseCardTaxonomy({ ...mod, subCategory: { name: 'New category' }, nsfw: true }, 'Mod');
    expect(taxonomy.chips.map(chip => chip.label)).toEqual(['18+', 'Skins', 'New category']);
  });

  it('only converts exact category names, retaining other category tags', () => {
    const taxonomy = getBrowseCardTaxonomy({
      ...mod, rootCategory: { name: 'Violet effects' }, subCategory: undefined,
    }, 'Sound', undefined, ['Violet']);
    expect(taxonomy.heroName).toBeNull();
    expect(taxonomy.chips).toEqual([{ label: 'Violet effects', tone: 'accent' }]);
  });
});
