import { describe, expect, it } from 'vitest';
import en from '../locales/en/translation.json';
import { ACCENT_PRESETS } from './accentColor';
import { BACKGROUND_GRADIENT_PRESETS } from './backgroundGradient';
import { CATEGORY_LABEL_KEYS } from './gameBananaCategories';
import { TRIPPY_ANIMATION_LABEL_KEYS, TRIPPY_STYLE_LABEL_KEYS } from './trippy';

function inCatalog(key: string): boolean {
  let node: unknown = en;
  for (const part of key.split('.')) {
    node = (node as Record<string, unknown> | undefined)?.[part];
  }
  return typeof node === 'string';
}

// check-i18n only sees literal t('...') calls, so a typo in a key table reaches
// users as a raw key unless something looks the values up.
describe('label key tables', () => {
  it.each([
    ['accent presets', ACCENT_PRESETS.map((p) => p.nameKey)],
    ['background presets', BACKGROUND_GRADIENT_PRESETS.map((p) => p.nameKey)],
    ['GameBanana categories', Object.values(CATEGORY_LABEL_KEYS)],
    ['trippy styles', Object.values(TRIPPY_STYLE_LABEL_KEYS)],
    ['trippy animations', Object.values(TRIPPY_ANIMATION_LABEL_KEYS)],
  ])('%s resolve in the en catalog', (_name, keys) => {
    expect(keys.filter((key) => !inCatalog(key))).toEqual([]);
  });
});
