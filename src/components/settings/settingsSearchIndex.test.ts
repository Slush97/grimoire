import { createInstance } from 'i18next';
import { describe, expect, it } from 'vitest';
import en from '../../locales/en/translation.json';
import { searchSettings, settingsSearchEntries } from './settingsSearchIndex';

async function englishEntries() {
  const i18n = createInstance();
  await i18n.init({ lng: 'en', resources: { en: { translation: en } } });
  return settingsSearchEntries(i18n.t.bind(i18n));
}

describe('Settings search', () => {
  it('finds controls by label, category, and description across sections', async () => {
    const entries = await englishEntries();
    expect(searchSettings(entries, 'language')[0]).toMatchObject({ section: 'appearance', label: 'Language & region' });
    expect(searchSettings(entries, 'backups')[0]).toMatchObject({ section: 'preferences', label: 'Keep removed mod files for 24 hours' });
    expect(searchSettings(entries, 'FRAME RATE')[0]).toMatchObject({ section: 'performance' });
    expect(searchSettings(entries, 'preferences download').length).toBeGreaterThan(0);
    expect(searchSettings(entries, '  \n  ')).toEqual([]);
    expect(searchSettings(entries, 'no-such-setting-987')).toEqual([]);
  });

  it('requires every word and ranks matching labels before descriptions', () => {
    const entry = { section: 'appearance', category: 'Appearance', target: 'setting' };
    const entries = [
      { ...entry, label: 'Colors', description: 'Choose the accent' },
      { ...entry, label: 'Accent color', description: 'Choose a theme' },
    ];
    expect(searchSettings(entries, 'accent')[0].label).toBe('Accent color');
    expect(searchSettings(entries, 'accent missing')).toEqual([]);
    expect(searchSettings(entries, 'accent appearance')).toHaveLength(2);
  });

  it('uses current translated text and handles accents', async () => {
    const i18n = createInstance();
    await i18n.init({ lng: 'fr', fallbackLng: 'en', resources: {
      en: { translation: en },
      fr: { translation: { settings: { nav: { language: 'Langue et région' } } } },
    } });
    expect(searchSettings(settingsSearchEntries(i18n.t.bind(i18n)), 'REGION')[0].label).toBe('Langue et région');
    await i18n.changeLanguage('en');
    expect(searchSettings(settingsSearchEntries(i18n.t.bind(i18n)), 'language')[0].label).toBe('Language & region');
  });

  it('has translated labels and descriptions for every indexed destination', async () => {
    const entries = await englishEntries();
    expect(new Set(entries.map((entry) => `${entry.section}:${entry.label}`)).size).toBe(entries.length);
    for (const entry of entries) {
      expect(entry.label).not.toMatch(/^(settings|performance|forge|modSafety|hiddenMods)\./);
      expect(entry.description).not.toMatch(/^(settings|performance|forge|modSafety|hiddenMods)\./);
      expect(entry.category).not.toMatch(/^settings\./);
    }
  });

  it('only links to Social and Mod safety panes when they are enabled', async () => {
    const i18n = createInstance();
    await i18n.init({ lng: 'en', resources: { en: { translation: en } } });
    const t = i18n.t.bind(i18n);
    const disabled = settingsSearchEntries(t);
    expect(disabled.some((entry) => entry.section === 'social' || entry.section === 'mod-safety')).toBe(false);
    expect(disabled.some((entry) => entry.section === 'experimental' && entry.label === 'Mod safety')).toBe(true);
    const enabled = settingsSearchEntries(t, { socialEnabled: true, modSafetyEnabled: true });
    expect(enabled.some((entry) => entry.section === 'social')).toBe(true);
    expect(enabled.some((entry) => entry.section === 'mod-safety')).toBe(true);
  });
});
