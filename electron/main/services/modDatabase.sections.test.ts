import { afterEach, describe, expect, it, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const fixture = vi.hoisted(() => ({ directory: '' }));
vi.mock('electron', () => ({ app: { getPath: () => fixture.directory } }));
// Exercise the real SQL on CI's Node runtime without changing the native
// better-sqlite3 binary used by the Electron app in a developer checkout.
vi.mock('better-sqlite3', () => ({ default: class {
  database: DatabaseSync;
  constructor(file: string) { this.database = new DatabaseSync(file); }
  exec(sql: string) { this.database.exec(sql); }
  pragma(sql: string) { this.database.exec(`PRAGMA ${sql}`); }
  prepare(sql: string) {
    const statement = this.database.prepare(sql);
    statement.setAllowUnknownNamedParameters(true);
    return statement;
  }
  function(...args: Parameters<DatabaseSync['function']>) { this.database.function(...args); }
  transaction<T extends unknown[], R>(run: (...args: T) => R) {
    return (...args: T) => {
      this.database.exec('BEGIN');
      try { const result = run(...args); this.database.exec('COMMIT'); return result; }
      catch (error) { this.database.exec('ROLLBACK'); throw error; }
    };
  }
  close() { this.database.close(); }
} }));

import { closeDatabase, getCachedCategoryTree, getHiddenContentPreviews, getModById, getModCount, getModsDownloadCounts, getModsNsfwStatus, getSyncState, initDatabase, updateModDownloadCount, updateModNsfw, updateSyncState, upsertMod, upsertMods, type CachedMod } from './modDatabase';
import { searchMods } from './searchService';

function row(section: string, name = `${section} sample`): CachedMod {
  return { id: 42, section, name, categoryId: null, categoryName: null, subCategoryId: null,
    submitterId: null, submitterName: null, likeCount: 0, viewCount: 0, downloadCount: null,
    dateAdded: 1, dateModified: 2, hasFiles: true, isNsfw: false, thumbnailUrl: null,
    audioUrl: null, profileUrl: '', cachedAt: 3 };
}
function directory() { fixture.directory = mkdtempSync(join(tmpdir(), 'grimoire-catalog-identity-')); }
afterEach(() => { closeDatabase(); if (fixture.directory) rmSync(fixture.directory, { recursive: true, force: true }); });

describe('section-aware catalog identity', () => {
  it('keeps equal IDs distinct through single and batch upserts and enrichment', () => {
    directory();
    upsertMods([row('Mod'), row('Sound'), row('Wip')]);
    upsertMod(row('Sound', 'Updated audio'));
    expect(getModCount()).toBe(3);
    expect(getModById(42)?.name).toBe('Mod sample');
    expect(getModById(42, 'Sound')?.name).toBe('Updated audio');
    updateModNsfw(42, true, 'Wip');
    updateModDownloadCount(42, 77, 'Sound');
    expect(getModsNsfwStatus([42], 'Wip')).toEqual({ 42: true });
    expect(getModsNsfwStatus([42], 'Mod')).toEqual({ 42: false });
    expect(getModsDownloadCounts([42], 'Sound')).toEqual({ 42: 77 });
    expect(getModsDownloadCounts([42], 'Mod')).toEqual({});
    expect(getModById(42, 'Sound')?.downloadCount).toBe(77);
  });

  it('indexes each section independently through updates, searches and deletes', () => {
    directory();
    upsertMods([row('Mod', 'Blue suit'), row('Sound', 'Blue audio'), row('Wip', 'Blue prototype')]);
    expect(searchMods({ query: 'blue' }).totalCount).toBe(3);
    upsertMod(row('Sound', 'Red audio'));
    expect(searchMods({ query: 'blue' }).mods.map(mod => mod.section).sort()).toEqual(['Mod', 'Wip']);
    expect(searchMods({ query: 'red', section: 'Sound' }).mods[0]?.id).toBe(42);
    expect(searchMods({ query: 'lue', section: 'Wip' }).mods.map(mod => mod.name)).toEqual(['Blue prototype']);
    initDatabase().prepare('DELETE FROM mods WHERE id = ? AND section = ?').run(42, 'Wip');
    expect(searchMods({ query: 'blue' }).mods.map(mod => mod.section)).toEqual(['Mod']);
  });

  it('migrates a legacy cache without losing enrichment, categories or immediate search', () => {
    directory();
    const legacy = new DatabaseSync(join(fixture.directory, 'mods-cache.db'));
    legacy.exec(`
      CREATE TABLE mods (id INTEGER PRIMARY KEY, name TEXT NOT NULL, section TEXT NOT NULL,
        category_id INTEGER, category_name TEXT, sub_category_id INTEGER, submitter_name TEXT,
        submitter_id INTEGER, like_count INTEGER, view_count INTEGER, download_count INTEGER,
        date_added INTEGER, date_modified INTEGER, has_files INTEGER, is_nsfw INTEGER,
        thumbnail_url TEXT, audio_url TEXT, profile_url TEXT, cached_at INTEGER, tags TEXT);
      INSERT INTO mods VALUES (42, 'Legacy blue suit', 'Mod', 10, 'Skins', 20, 'Artist', 1,
        3, 4, 77, 5, 6, 1, 1, 'preview', 'audio', 'profile', 8, 'old');
      CREATE VIRTUAL TABLE mods_fts USING fts5(name, category_name, submitter_name, tags, content='mods', content_rowid='id');
      INSERT INTO mods_fts(mods_fts) VALUES('rebuild');
      CREATE TABLE category_cache (model TEXT PRIMARY KEY, fetched_at INTEGER NOT NULL, payload TEXT NOT NULL);
      INSERT INTO category_cache VALUES ('ModCategory', 123, '[]');
      CREATE TABLE sync_state (section TEXT PRIMARY KEY, last_sync INTEGER, total_count INTEGER, pages_synced INTEGER);
      INSERT INTO sync_state VALUES ('Mod', 100, 1, 1);
    `);
    legacy.close();
    expect(getModById(42)).toMatchObject({ name: 'Legacy blue suit', downloadCount: 77, isNsfw: true, subCategoryId: 20, audioUrl: 'audio' });
    expect(getCachedCategoryTree('ModCategory')).toEqual({ fetchedAt: 123, payload: '[]' });
    expect(searchMods({ query: 'blue' }).mods.map(mod => mod.id)).toEqual([42]);
    expect(getSyncState('Mod')?.lastSync).toBe(0);
    upsertMod(row('Sound', 'Blue audio'));
    expect(searchMods({ query: 'blue' }).totalCount).toBe(2);
    updateSyncState({ section: 'Mod', lastSync: 999, totalCount: 1, pagesSynced: 1 });
    closeDatabase();
    expect(getSyncState('Mod')?.lastSync).toBe(999);
    expect(getModCount()).toBe(2);
  });
});

describe('previews for the hidden creator and hidden mod lists', () => {
  const upload = (id: number, likeCount: number, extra: Partial<CachedMod> = {}): CachedMod =>
    ({ ...row('Mod', `Upload ${id}`), id, submitterId: 7, submitterName: 'Krak4n', likeCount, thumbnailUrl: `https://images.example/${id}.jpg`, ...extra });

  it('counts the cached uploads of a creator and returns the most liked few', () => {
    directory();
    upsertMods([upload(1, 5), upload(2, 50), upload(3, 20), upload(4, 1), upload(5, 9, { section: 'Sound', isNsfw: true }),
      upload(6, 99, { submitterId: 8, submitterName: 'Someone else' })]);
    const { creators } = getHiddenContentPreviews([7, 7, 404], []);
    expect(Object.keys(creators)).toEqual(['7']);
    expect(creators[7].count).toBe(5);
    expect(creators[7].mods.map(mod => mod.id)).toEqual([2, 3, 5]);
    expect(creators[7].mods[2]).toEqual({ id: 5, section: 'Sound', name: 'Upload 5', thumbnailUrl: 'https://images.example/5.jpg', isNsfw: true, submitterName: 'Krak4n' });
  });

  it('finds hidden mods by section and id, and leaves out what the catalog lacks', () => {
    directory();
    upsertMods([upload(42, 1), upload(42, 1, { section: 'Sound', name: 'Same id, a sound', thumbnailUrl: null })]);
    const { mods } = getHiddenContentPreviews([], [{ id: 42, section: 'Mod' }, { id: 42, section: 'Sound' }, { id: 43, section: 'Mod' }]);
    expect(Object.keys(mods).sort()).toEqual(['Mod:42', 'Sound:42']);
    expect(mods['Sound:42']).toMatchObject({ name: 'Same id, a sound', thumbnailUrl: null, submitterName: 'Krak4n' });
  });

  it('skips anything from the renderer that is not an id or a known section', () => {
    directory();
    upsertMods([upload(1, 5)]);
    expect(getHiddenContentPreviews('7', null)).toEqual({ creators: {}, mods: {} });
    expect(getHiddenContentPreviews([0, -7, 1.5, '7', null], [{ id: 1, section: 'Tool' }, { id: '1', section: 'Mod' }, null, 'Mod:1']))
      .toEqual({ creators: {}, mods: {} });
  });
});
