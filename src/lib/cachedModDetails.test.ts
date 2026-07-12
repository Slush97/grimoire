import { describe, expect, it } from 'vitest';
import type { CachedMod } from '../types/electron';
import { buildCachedModDetails, canUseCachedModDetails } from './cachedModDetails';

function cachedMod(overrides: Partial<CachedMod> = {}): CachedMod {
  return {
    id: 42,
    name: 'Cached mod',
    section: 'Mod',
    categoryId: 7,
    categoryName: 'Skins',
    submitterName: 'Modder',
    submitterId: 9,
    likeCount: 0,
    viewCount: 0,
    downloadCount: 0,
    dateAdded: 1,
    dateModified: 2,
    hasFiles: true,
    isNsfw: true,
    thumbnailUrl: 'https://images.gamebanana.com/img/ss/mods/preview.webp',
    audioUrl: null,
    profileUrl: 'https://gamebanana.com/mods/42',
    cachedAt: 3,
    ...overrides,
  };
}

describe('canUseCachedModDetails', () => {
  it.each([
    new TypeError('fetch failed'),
    new Error('GameBanana API request timed out after 30 seconds'),
    new Error('connect ECONNRESET'),
    new Error('GameBanana API error: 429 Too Many Requests'),
    new Error('GameBanana API error: 503 Service Unavailable'),
    new Error('GameBanana API returned empty response'),
    new Error('GameBanana API returned invalid JSON: SyntaxError'),
  ])('allows a cached fallback for a transient failure: %s', (error) => {
    expect(canUseCachedModDetails(error)).toBe(true);
  });

  it.each([
    new Error('GameBanana API error: 404 Not Found'),
    new Error('GameBanana API error: 403 Forbidden'),
    new Error('Unexpected mapping bug'),
    new TypeError("Cannot read properties of undefined (reading '_idRow')"),
  ])('keeps permanent or unexpected failures visible: %s', (error) => {
    expect(canUseCachedModDetails(error)).toBe(false);
  });
});

describe('buildCachedModDetails', () => {
  it('maps catalog metadata into a degraded details object', () => {
    expect(buildCachedModDetails(42, cachedMod())).toEqual({
      id: 42,
      name: 'Cached mod',
      nsfw: true,
      category: { id: 7, name: 'Skins' },
      submitter: { id: 9, name: 'Modder' },
      previewMedia: {
        images: [{
          baseUrl: 'https://images.gamebanana.com/img/ss/mods',
          file: 'preview.webp',
        }],
      },
    });
  });

  it('uses the installed name when the catalog has no row', () => {
    expect(buildCachedModDetails(42, null, 'Installed mod')).toEqual({
      id: 42,
      name: 'Installed mod',
      nsfw: false,
      category: undefined,
      submitter: undefined,
      previewMedia: undefined,
    });
  });

  it('cannot build linked-item details without a cached name', () => {
    expect(buildCachedModDetails(42, null)).toBeNull();
  });
});
