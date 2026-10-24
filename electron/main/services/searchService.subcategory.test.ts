import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';

vi.mock('electron', () => ({ app: { getPath: () => testDirectory } }));

import { closeDatabase, upsertMods, type CachedMod } from './modDatabase';
import { searchMods } from './searchService';

const testDirectory = mkdtempSync(join(tmpdir(), 'grimoire-subcategory-search-'));

// The catalog stores only the root category's name; the deepest category rides
// in sub_category_id (a mod filed directly under its root has none).
function row(id: number, categoryName: string, subCategoryId: number | null, date: number): CachedMod {
  return {
    id, section: 'Mod', name: `Mod ${id}`, dateAdded: date, dateModified: date, subCategoryId,
    categoryId: null, categoryName, submitterName: null, submitterId: null,
    likeCount: date, viewCount: date, downloadCount: null, hasFiles: true, isNsfw: false,
    thumbnailUrl: null, audioUrl: null, profileUrl: '', cachedAt: 0,
  };
}

// After the documented `electron-rebuild -w better-sqlite3` step the native
// module targets Electron's ABI and plain Node cannot load it. CI builds it for
// Node, so the suite must never skip there.
const nativeSqliteUnavailable = !process.env.CI && (() => {
  try {
    new Database(':memory:').close();
    return false;
  } catch {
    return true;
  }
})();

describe.skipIf(nativeSqliteUnavailable)('catalog category scoping', () => {
  beforeAll(() => upsertMods([
    row(1, 'Model Replacement', 44206, 60),
    row(2, 'Model Replacement', 44687, 50),
    row(3, 'Model Replacement', 41868, 40),
    row(4, 'Model Replacement', null, 30),
    row(5, 'HUD', 44745, 20),
  ]));
  afterAll(() => {
    closeDatabase();
    rmSync(testDirectory, { recursive: true, force: true });
  });

  const ids = (options: Parameters<typeof searchMods>[0]) =>
    searchMods({ section: 'Mod', sortBy: 'date', ...options }).mods.map((mod) => mod.id);

  it('keeps a root pick on every mod filed under it', () => {
    expect(ids({ categoryId: 33154, categoryName: 'Model Replacement' })).toEqual([1, 2, 3, 4]);
  });

  it('returns only the picked subcategory, not its root', () => {
    expect(ids({ categoryId: 44206, categoryName: 'Model Replacement', categoryIds: [44206] })).toEqual([1]);
  });

  it('includes mods filed in a nested category of the pick', () => {
    expect(ids({ categoryId: 44691, categoryName: 'Model Replacement', categoryIds: [44691, 44687] })).toEqual([2]);
  });

  it('scopes the substring fallback the same way', () => {
    const options = { categoryId: 44206, categoryName: 'Model Replacement', categoryIds: [44206] };
    expect(ids({ ...options, query: 'od' })).toEqual([1]);
  });
});
