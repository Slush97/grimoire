import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppStore, type BrowseArtistRef } from './appStore';

vi.mock('../i18n', () => ({
  default: { changeLanguage: vi.fn() },
  applyLanguagePreference: vi.fn(),
}));

const sqooky: BrowseArtistRef = { id: 3826762, name: 'Sqooky!' };

describe('appStore Browse section filters', () => {
  beforeEach(() => useAppStore.getState().resetBrowseUi());

  it('keeps the selected hero and shared filters through all sections', () => {
    const { setBrowseUi } = useAppStore.getState();
    setBrowseUi({ heroCategoryId: 42, search: 'blue', sort: 'popular', addedWithin: 'custom', addedFrom: '2026-10-01', addedTo: '2026-10-08' });
    for (const section of ['Sound', 'Wip', 'Mod']) {
      setBrowseUi({ section });
      expect(useAppStore.getState().browseUi).toMatchObject({
        section, heroCategoryId: 42, search: 'blue', sort: 'popular',
        addedWithin: 'custom', addedFrom: '2026-10-01', addedTo: '2026-10-08',
      });
    }
  });

  it('restores each section category without carrying ids to another section', () => {
    const { setBrowseUi } = useAppStore.getState();
    setBrowseUi({ categoryId: 100 });
    setBrowseUi({ section: 'Sound' });
    expect(useAppStore.getState().browseUi.categoryId).toBe('all');
    setBrowseUi({ categoryId: 200 });
    setBrowseUi({ section: 'Wip', categoryId: 300 });
    for (const { section, categoryId } of [
      { section: 'Mod', categoryId: 100 },
      { section: 'Sound', categoryId: 200 },
      { section: 'Wip', categoryId: 300 },
    ]) {
      setBrowseUi({ section });
      expect(useAppStore.getState().browseUi.categoryId).toBe(categoryId);
    }
  });

  it('keeps No hero specific to Sounds and restores it when returning', () => {
    const { setBrowseUi } = useAppStore.getState();
    setBrowseUi({ section: 'Sound', heroCategoryId: 'none' });
    for (const section of ['Mod', 'Wip']) {
      setBrowseUi({ section });
      expect(useAppStore.getState().browseUi.heroCategoryId).toBe('all');
    }
    setBrowseUi({ section: 'Sound' });
    expect(useAppStore.getState().browseUi.heroCategoryId).toBe('none');
    setBrowseUi({ section: 'Mod', heroCategoryId: 42 });
    setBrowseUi({ section: 'Sound' });
    expect(useAppStore.getState().browseUi.heroCategoryId).toBe(42);
  });

  it('honors explicit navigation filters and clearing a restored category', () => {
    const { setBrowseUi } = useAppStore.getState();
    setBrowseUi({ categoryId: 100 });
    setBrowseUi({ section: 'Sound', categoryId: 200 });
    setBrowseUi({ section: 'Mod', heroCategoryId: 42, categoryId: 'all' });
    expect(useAppStore.getState().browseUi).toMatchObject({ heroCategoryId: 42, categoryId: 'all' });
    setBrowseUi({ section: 'Sound' });
    setBrowseUi({ categoryId: 'all', heroCategoryId: 'all' });
    setBrowseUi({ section: 'Mod' });
    setBrowseUi({ section: 'Sound' });
    expect(useAppStore.getState().browseUi).toMatchObject({ heroCategoryId: 'all', categoryId: 'all' });
  });

  it('resets section memories with the Browse session', () => {
    const { setBrowseUi, resetBrowseUi } = useAppStore.getState();
    setBrowseUi({ categoryId: 100 });
    setBrowseUi({ section: 'Sound', heroCategoryId: 'none' });
    resetBrowseUi();
    setBrowseUi({ section: 'Sound' });
    expect(useAppStore.getState().browseUi).toMatchObject({ heroCategoryId: 'all', categoryId: 'all' });
    setBrowseUi({ section: 'Mod' });
    expect(useAppStore.getState().browseUi.categoryId).toBe('all');
  });
});

describe('appStore Browse artist overrides', () => {
  beforeEach(() => {
    useAppStore.getState().resetBrowseUi();
  });

  it('keeps an override supplied with its matching artist navigation', () => {
    useAppStore.getState().setBrowseUi({
      submitter: sqooky,
      hiddenCreatorOverrideId: sqooky.id,
    });

    expect(useAppStore.getState().browseUi).toMatchObject({
      submitter: sqooky,
      hiddenCreatorOverrideId: sqooky.id,
    });
  });

  it('clears the override on ordinary artist navigation', () => {
    useAppStore.getState().setBrowseUi({
      submitter: sqooky,
      hiddenCreatorOverrideId: sqooky.id,
    });
    useAppStore.getState().setBrowseUi({
      submitter: { id: 42, name: 'Hidden artist' },
    });

    expect(useAppStore.getState().browseUi.hiddenCreatorOverrideId).toBeUndefined();
  });
});
