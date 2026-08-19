import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppStore, type BrowseArtistRef } from './appStore';

vi.mock('../i18n', () => ({
  default: { changeLanguage: vi.fn() },
  applyLanguagePreference: vi.fn(),
}));

const sqooky: BrowseArtistRef = { id: 3826762, name: 'Sqooky!' };

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
