import i18next from 'i18next';
import { describe, expect, it } from 'vitest';
import en from '../locales/en/translation.json';
import { heroCardVariantLabel, heroCardVariantRank } from './heroCardVariants';

const i18n = i18next.createInstance();
void i18n.init({ lng: 'en', resources: { en: { translation: en } }, initAsync: false });

describe('hero card variants', () => {
  it.each([
    ['card', 'Card'],
    ['card_critical', 'Low HP'],
    ['card_gloat', 'Gloat'],
    ['wolf_card', 'Wolf Card'],
    ['wolf_card_critical', 'Wolf Low HP'],
    ['wolf_card_gloat', 'Wolf Gloat'],
    ['bear_card', 'Bear Card'],
    ['something_else', 'something_else'],
  ])('labels %s', (variant, label) => {
    expect(heroCardVariantLabel(variant, i18n.t)).toBe(label);
  });

  it('sorts form art after the hero art, in the same order', () => {
    const shuffled = ['wolf_card_gloat', 'small', 'wolf_card', 'card_gloat', 'wolf_card_critical', 'card'];
    expect([...shuffled].sort((a, b) => heroCardVariantRank(a) - heroCardVariantRank(b))).toEqual([
      'card',
      'card_gloat',
      'small',
      'wolf_card',
      'wolf_card_critical',
      'wolf_card_gloat',
    ]);
  });
});
