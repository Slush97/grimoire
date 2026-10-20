import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

vi.mock('electron', () => ({ app: { getPath: () => testDirectory } }));

import { closeDatabase, upsertMods, type CachedMod } from './modDatabase';
import { searchMods } from './searchService';

const testDirectory = mkdtempSync(join(tmpdir(), 'grimoire-mixed-search-'));

function row(id: number, section: string, name: string, date: number, subCategoryId: number | null = null): CachedMod {
  return {
    id, section, name, dateAdded: date, dateModified: date, subCategoryId,
    categoryId: null, categoryName: null, submitterName: null, submitterId: null,
    likeCount: date, viewCount: date, downloadCount: null, hasFiles: true, isNsfw: false,
    thumbnailUrl: null, audioUrl: null, profileUrl: '', cachedAt: 0,
  };
}

describe('combined catalog search', () => {
  beforeAll(() => upsertMods([
    row(1, 'Mod', 'Blue suit', 40, 42),
    row(2, 'Sound', 'Haze blue audio', 30),
    row(3, 'Wip', 'Haze blue test', 20),
    row(4, 'Sound', 'Other audio', 10, 42),
    row(5, 'Mod', 'Haze unrelated skin', 50, 99),
  ]));
  afterAll(() => {
    closeDatabase();
    rmSync(testDirectory, { recursive: true, force: true });
  });

  it('sorts and paginates selected sections together', () => {
    const options = { sections: ['Mod', 'Wip'], sortBy: 'date' as const, limit: 2 };
    const first = searchMods(options);
    expect(first.totalCount).toBe(3);
    expect(first.mods.map((mod) => mod.id)).toEqual([5, 1]);
    expect(searchMods({ ...options, offset: 2 }).mods.map((mod) => mod.id)).toEqual([3]);
  });

  it('uses exact skin categories for Mods and hero names for Sounds and WiPs', () => {
    const result = searchMods({ sections: ['Mod', 'Sound', 'Wip'], heroCategoryIds: [42], heroName: 'Haze', sortBy: 'date' });
    expect(result.mods.map((mod) => mod.id)).toEqual([1, 2, 3]);
  });

  it('keeps section scoping in FTS and substring fallback', () => {
    expect(searchMods({ sections: ['Sound', 'Wip'], query: 'blue' }).mods.map((mod) => mod.section).sort()).toEqual(['Sound', 'Wip']);
    expect(searchMods({ sections: ['Sound', 'Wip'], query: 'lue' }).mods.map((mod) => mod.section).sort()).toEqual(['Sound', 'Wip']);
  });
});
