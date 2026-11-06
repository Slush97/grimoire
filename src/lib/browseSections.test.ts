import { describe, expect, it } from 'vitest';
import { BROWSE_REQUEST_SIZE, browseCacheIsFresh, browsePageHasMore, completeBrowseRowCount, mergeBrowseMods, browseModKey, browseModSection, toggleBrowseSection } from './browseSections';
import type { GameBananaMod } from '../types/gamebanana';

describe('Browse section selection', () => {
  it('combines sections and removes one without permitting an empty feed', () => {
    const both = toggleBrowseSection(['Mod'], 'Sound');
    expect(both).toEqual(['Mod', 'Sound']);
    expect(toggleBrowseSection(both, 'Mod')).toEqual(['Sound']);
    expect(toggleBrowseSection(['Sound'], 'Sound')).toEqual(['Sound']);
  });

  it('keeps equal item numbers in different sections distinct', () => {
    const mod = { id: 42, profileUrl: 'https://gamebanana.com/mods/42' };
    const sound = { id: 42, profileUrl: 'https://gamebanana.com/sounds/42' };
    expect(browseModKey(mod)).toBe('Mod:42');
    expect(browseModKey(sound)).toBe('Sound:42');
    expect(browseModSection({ section: 'Wip', profileUrl: '' })).toBe('Wip');
  });
});

const mod = (id: number, extra: Partial<GameBananaMod> = {}): GameBananaMod => ({
  id, name: `Mod ${id}`, profileUrl: `https://gamebanana.com/mods/${id}`, hasFiles: true,
  dateAdded: 0, dateModified: 0, likeCount: 0, viewCount: 0, nsfw: false, ...extra,
});

describe('Browse buffered rows', () => {
  it('reveals complete rows across requests and retains the remainder for resizing or the end', () => {
    expect(BROWSE_REQUEST_SIZE).toBe(50);
    expect(completeBrowseRowCount(50, 6, true)).toBe(48);
    expect(completeBrowseRowCount(100, 6, true)).toBe(96);
    expect(completeBrowseRowCount(150, 6, true)).toBe(150);
    expect(completeBrowseRowCount(50, 7, true)).toBe(49);
    expect(completeBrowseRowCount(50, 5, true)).toBe(50);
    expect(completeBrowseRowCount(53, 6, false)).toBe(53);
  });
  it('handles list view and grids wider than one response', () => {
    expect(completeBrowseRowCount(15, 1, true)).toBe(15);
    expect(completeBrowseRowCount(50, 60, true)).toBe(0);
    expect(completeBrowseRowCount(100, 60, true)).toBe(60);
  });
  it('follows a smaller reported page size and does not stop at a short search page', () => {
    const response = { records: Array.from({ length: 14 }, (_, i) => mod(i)), totalCount: 199, perPage: 15 };
    expect(browsePageHasMore(response, 2)).toBe(true);
    expect(browsePageHasMore(response, 14)).toBe(false);
    expect(browsePageHasMore({ ...response, records: [] }, 2)).toBe(false);
    expect(browsePageHasMore({ ...response, perPage: NaN, totalCount: 60 }, 2)).toBe(false);
  });
  it('expires old session data without a timer or extending its life on navigation', () => {
    const fetchedAt = 1000;
    expect(browseCacheIsFresh(fetchedAt, fetchedAt + 299_999)).toBe(true);
    expect(browseCacheIsFresh(fetchedAt, fetchedAt + 300_000)).toBe(false);
    expect(browseCacheIsFresh(undefined)).toBe(false);
    expect(browseCacheIsFresh(fetchedAt, fetchedAt - 1)).toBe(false);
  });
});

describe('Browse page reconciliation', () => {
  it('updates duplicate metadata and moves an updated mod into the correct loaded position', () => {
    const previous = [mod(1, { dateModified: 20 }), mod(2, { dateModified: 10, downloadCount: 123 })];
    const merged = mergeBrowseMods(previous, [mod(2, { dateModified: 30, name: 'Updated', downloadCount: undefined }), mod(3, { dateModified: 15 })], 'updated');
    expect(merged.map(mod => mod.id)).toEqual([2, 1, 3]);
    expect(merged[0]).toMatchObject({ name: 'Updated', dateModified: 30, downloadCount: 123 });
    expect(previous[1]).toMatchObject({ name: 'Mod 2', dateModified: 10 });
    expect(merged[1]).toBe(previous[0]);
  });
  it('keeps relevance order, preserves newer data, and distinguishes sections', () => {
    const previous = [mod(2, { dateModified: 30 }), mod(1)];
    const merged = mergeBrowseMods(previous, [mod(2, { dateModified: 20 }), mod(2, { section: 'Sound' })], 'default');
    expect(merged.map(browseModKey)).toEqual(['Mod:2', 'Mod:1', 'Sound:2']);
    expect(merged[0]).toBe(previous[0]);
  });
  it('deduplicates a single response and uses deterministic tie ordering', () => {
    expect(mergeBrowseMods([], [mod(1, { dateModified: 10 }), mod(2, { dateModified: 10 }), mod(1, { dateModified: 20 })], 'updated')
      .map(mod => mod.id)).toEqual([1, 2]);
    expect(mergeBrowseMods([], [mod(1, { dateAdded: 5 }), mod(2, { dateAdded: 5 })], 'recent')
      .map(mod => mod.id)).toEqual([2, 1]);
  });
});
