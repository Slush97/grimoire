/**
 * Unit coverage for the conflict-ignore identity logic. detectConflicts itself
 * needs a real VPK sandbox, but the identity/pair-key helpers that drive the
 * four-layer ignore system (per-file / global / whole-mod / pair) are pure
 * except for a getModMetadata read, so we mock the whole service dep-chain and
 * exercise them directly. Mocking the deps keeps this off the electron/sqlite
 * graph (conflicts.ts only imports these four modules).
 */
import { beforeEach, describe, it, expect } from 'vitest';
import { vi } from 'vitest';
import type { AppSettings, Mod } from '../../../src/types/mod';
import { scanMods } from './mods';
import { parseVpkDirectoriesAsync } from './vpk';
import { loadSettings } from './settings';

const h = vi.hoisted(() => ({
  metaMap: {} as Record<
    string,
    { gameBananaId?: number; gameBananaFileId?: number; sourceFileName?: string } | undefined
  >,
}));

vi.mock('./metadata', () => ({ getModMetadata: (k: string) => h.metaMap[k] }));
vi.mock('./mods', () => ({ scanMods: vi.fn() }));
vi.mock('./vpk', () => ({ parseVpkDirectoriesAsync: vi.fn() }));
vi.mock('./settings', async importOriginal => ({
    ...(await importOriginal<typeof import('./settings')>()), loadSettings: vi.fn(() => ({})),
}));

import {
  conflictPairKey,
  modConflictIdentity,
  migrateIgnoredConflictKeysForMods,
  detectConflicts,
} from './conflicts';

function mod(over: Partial<Mod> & { id: string }): Mod {
  return {
    name: over.id,
    fileName: `${over.id}.vpk`,
    path: `/addons/${over.id}.vpk`,
    metaKey: over.metaKey ?? `${over.id}.vpk`,
    enabled: true,
    priority: 1,
    size: 0,
    installedAt: '2026-01-01T00:00:00Z',
    ...over,
  };
}

describe('conflictPairKey', () => {
  it('is order-independent and sorts the pair', () => {
    expect(conflictPairKey('a', 'b')).toBe('a::b');
    expect(conflictPairKey('b', 'a')).toBe('a::b');
  });
});

describe('modConflictIdentity', () => {
  it('prefers gb file id, then source name, then bare mod, over the local fallback', () => {
    h.metaMap['file.vpk'] = { gameBananaId: 10, gameBananaFileId: 20 };
    h.metaMap['src.vpk'] = { gameBananaId: 10, sourceFileName: 'Cool Skin.zip' };
    h.metaMap['mod.vpk'] = { gameBananaId: 10 };
    expect(modConflictIdentity(mod({ id: 'a', metaKey: 'file.vpk' }))).toBe('gb:10:file:20');
    expect(modConflictIdentity(mod({ id: 'b', metaKey: 'src.vpk' }))).toBe('gb:10:source:cool skin.zip');
    expect(modConflictIdentity(mod({ id: 'c', metaKey: 'mod.vpk' }))).toBe('gb:10:mod');
  });

  it('falls back to size + install stamp for a local (non-GameBanana) mod', () => {
    const m = mod({ id: 'loc', metaKey: 'loc.vpk', size: 1234, installedAt: '2026-01-01T00:00:00Z' });
    expect(modConflictIdentity(m)).toBe(`local:1234:${Date.parse('2026-01-01T00:00:00Z')}`);
  });

  it('collides two GB mods sharing a page but lacking a file id (documents the over-broad key)', () => {
    // Both resolve to gb:77:mod, so an "ignore this mod everywhere" on one also
    // silences the other's real conflicts. Locked in so the behavior is a known
    // trade-off, not a surprise.
    h.metaMap['x.vpk'] = { gameBananaId: 77 };
    h.metaMap['y.vpk'] = { gameBananaId: 77 };
    expect(modConflictIdentity(mod({ id: 'x', metaKey: 'x.vpk' }))).toBe(
      modConflictIdentity(mod({ id: 'y', metaKey: 'y.vpk' }))
    );
  });

  it('gives a local mod a reinstall-fragile identity (embeds installedAt)', () => {
    // Documents conflict-review finding: local ignores do NOT survive reinstall,
    // because the identity embeds the install timestamp.
    const before = modConflictIdentity(mod({ id: 'l', metaKey: 'l.vpk', size: 5, installedAt: '2026-01-01T00:00:00Z' }));
    const afterReinstall = modConflictIdentity(mod({ id: 'l', metaKey: 'l.vpk', size: 5, installedAt: '2026-02-02T00:00:00Z' }));
    expect(before).not.toBe(afterReinstall);
  });
});

describe('detectConflicts ignores imprint metadata entries', () => {
  // Drive the real detection loop through the mocked scan/parse seams: two
  // enabled mods on distinct pakNN slots whose VPK trees are supplied directly,
  // so the only question left is whether the overlap filter treats the imprint
  // entries (and the legacy grimoire_meta.json companion) as real conflicts.
  const imprintEntries = ['addoninfo.txt', 'modinfo.json', 'grimoire_meta.json'];

  function installed(fileLists: Record<string, string[]>): void {
    const mods = Object.keys(fileLists).map((id, i) =>
      mod({ id, metaKey: `${id}.vpk`, priority: i + 1 })
    );
    vi.mocked(scanMods).mockResolvedValue(mods);
    vi.mocked(parseVpkDirectoriesAsync).mockResolvedValue(
      new Map(mods.map((m) => [m.path, fileLists[m.id]]))
    );
  }

  it('reports no conflict when two imprinted mods overlap only on imprint entries', async () => {
    installed({
      a: [...imprintEntries, 'models/heroes/abrams/body.vmdl_c'],
      b: [...imprintEntries, 'models/heroes/bebop/body.vmdl_c'],
    });
    expect(await detectConflicts('/deadlock')).toEqual([]);
  });

  it('still reports the real overlap between two imprinted mods', async () => {
    installed({
      a: [...imprintEntries, 'models/heroes/abrams/body.vmdl_c'],
      b: [...imprintEntries, 'models/heroes/abrams/body.vmdl_c'],
    });
    const conflicts = await detectConflicts('/deadlock');
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].conflictType).toBe('file');
    expect(conflicts[0].files).toEqual(['models/heroes/abrams/body.vmdl_c']);
  });
});

describe('migrateIgnoredConflictKeysForMods', () => {
  it('rewrites id::id keys to identity::identity and dedupes', () => {
    h.metaMap['a.vpk'] = { gameBananaId: 1, gameBananaFileId: 2 };
    h.metaMap['b.vpk'] = { gameBananaId: 3, gameBananaFileId: 4 };
    const mods = [mod({ id: 'idA', metaKey: 'a.vpk' }), mod({ id: 'idB', metaKey: 'b.vpk' })];
    expect(migrateIgnoredConflictKeysForMods(['idA::idB'], mods)).toEqual([
      conflictPairKey('gb:1:file:2', 'gb:3:file:4'),
    ]);
  });

  it('leaves keys whose ids are not among the current mods untouched', () => {
    expect(migrateIgnoredConflictKeysForMods(['ghost1::ghost2'], [])).toEqual(['ghost1::ghost2']);
  });
});

describe('indexed conflict scans', () => {
  beforeEach(() => {
    h.metaMap = {};
    vi.mocked(loadSettings).mockReturnValue({} as AppSettings);
  });

  function installed(files: string[][], overrides: Partial<Mod>[] = []) {
    const mods = files.map((_, i) => mod({
      id: `mod${i}`, priority: i + 1, size: i + 1, ...overrides[i],
    }));
    vi.mocked(scanMods).mockResolvedValue(mods);
    vi.mocked(parseVpkDirectoriesAsync).mockResolvedValue(
      new Map(mods.map((m, i) => [m.path, files[i]]))
    );
    return mods;
  }

  it('preserves pair order, mod A path order, deduplication, and case-sensitive overlaps', async () => {
    installed([
      ['z.txt', 'a.txt', 'z.txt', 'Case.txt'],
      ['a.txt', 'z.txt', 'case.txt'],
      ['Case.txt', 'a.txt', 'z.txt'],
    ]);
    const conflicts = await detectConflicts('/deadlock');
    expect(conflicts.map((c) => [c.modA, c.modB, c.files])).toEqual([
      ['mod0', 'mod1', ['z.txt', 'a.txt']],
      ['mod0', 'mod2', ['z.txt', 'a.txt', 'Case.txt']],
      ['mod1', 'mod2', ['a.txt', 'z.txt']],
    ]);
    expect(conflicts[1].details).toBe('3 shared file(s): z.txt, a.txt, Case.txt');
  });

  it('keeps priority conflicts first and scopes slots to their addon folder', async () => {
    installed([['shared.txt'], ['shared.txt'], ['shared.txt'], ['shared.txt']], [
      { priority: 1 }, { priority: 1 }, { priority: 2 }, { priority: 1, metaKey: 'addons1/mod3.vpk' },
    ]);
    const conflicts = await detectConflicts('/deadlock');
    expect(conflicts.map((c) => [c.modA, c.modB, c.conflictType])).toEqual([
      ['mod0', 'mod1', 'priority'],
      ['mod0', 'mod2', 'file'], ['mod0', 'mod3', 'file'],
      ['mod1', 'mod2', 'file'], ['mod1', 'mod3', 'file'],
      ['mod2', 'mod3', 'file'],
    ]);
    expect(conflicts[0].files).toBeUndefined();
    expect(conflicts[0].details).toBe('Both use pak01');
  });

  it('retains pair suppression even if a scan contains repeated mod ids', async () => {
    installed([['shared.txt'], ['shared.txt'], ['shared.txt']], [{}, {}, { id: 'mod1' }]);
    expect((await detectConflicts('/deadlock')).map((c) => [c.modA, c.modB])).toEqual([
      ['mod0', 'mod1'], ['mod1', 'mod1'],
    ]);
  });

  it('filters built-in metadata and compiler artifacts case-insensitively', async () => {
    const paths = ['README.TXT', 'nested/ModInfo.json', 'PANORAMA/image_compiler.vdata_c',
      'materials/default/default_foo.vtex_c', 'nested/default_foo.vtex_c'];
    installed([paths, paths.slice()]);
    expect((await detectConflicts('/deadlock'))[0].files).toEqual(['nested/default_foo.vtex_c']);
  });

  it('applies every ignore layer freshly even when the file index is cached', async () => {
    installed([['a.txt', 'b.txt', 'c.txt'], ['c.txt', 'b.txt', 'a.txt']]);
    const [conflict] = await detectConflicts('/deadlock');
    const settings = (value: Partial<AppSettings>) => vi.mocked(loadSettings).mockReturnValue(value as AppSettings);
    settings({ ignoredConflictFilesGlobal: ['a.txt'], ignoredConflictFiles: { [conflict.ignoreKey]: ['b.txt'] } });
    expect((await detectConflicts('/deadlock'))[0].files).toEqual(['c.txt']);
    settings({ ignoredConflictFiles: { [conflict.ignoreKey]: ['a.txt', 'b.txt', 'c.txt'] } });
    expect(await detectConflicts('/deadlock')).toEqual([]);
    for (const value of [
      { ignoreConflictsByDefault: true },
      { ignoredConflicts: [conflict.ignoreKey] },
      { ignoredConflicts: [conflictPairKey(conflict.modA, conflict.modB)] },
      { ignoredConflictMods: [conflict.modAIdentity] },
    ]) {
      settings(value);
      expect(await detectConflicts('/deadlock')).toEqual([]);
    }
    settings({});
    expect(await detectConflicts('/deadlock')).toEqual([conflict]);
  });

  it('reuses unchanged parse arrays and rebuilds after replacement, disappearance, or reordering', async () => {
    let reads = 0;
    const filesA = ['a.txt', 'b.txt'];
    Object.defineProperty(filesA, 0, { get: () => { reads++; return 'a.txt'; } });
    const filesB = ['b.txt', 'a.txt'];
    const mods = installed([filesA, filesB]);
    expect((await detectConflicts('/deadlock'))[0].files).toEqual(['a.txt', 'b.txt']);
    const initialReads = reads;
    expect((await detectConflicts('/deadlock'))[0].files).toEqual(['a.txt', 'b.txt']);
    expect(reads).toBe(initialReads);

    vi.mocked(scanMods).mockResolvedValue([mods[1], { ...mods[0], name: 'Renamed' }]);
    h.metaMap[mods[0].metaKey] = { gameBananaId: 40 };
    const [reordered] = await detectConflicts('/deadlock');
    expect(reordered.files).toEqual(['b.txt', 'a.txt']);
    expect(reordered.modBName).toBe('Renamed');
    expect(reordered.modBIdentity).toBe('gb:40:mod');

    vi.mocked(parseVpkDirectoriesAsync).mockResolvedValue(new Map([
      [mods[0].path, ['new.txt']], [mods[1].path, filesB],
    ]));
    expect(await detectConflicts('/deadlock')).toEqual([]);
    vi.mocked(parseVpkDirectoriesAsync).mockResolvedValue(new Map([[mods[1].path, filesB]]));
    expect(await detectConflicts('/deadlock')).toEqual([]);
  });

  it('matches the pairwise reference across varied sparse and dense trees', async () => {
    let seed = 7;
    const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed; };
    for (let round = 0; round < 8; round++) {
      const files = Array.from({ length: 18 }, (_, i) => Array.from({ length: 70 }, () =>
        random() % 3 === 0 ? `unique/${i}/${random()}.txt` : `shared/${random() % (20 + round * 30)}.txt`
      ));
      const mods = installed(files);
      const expected: [string, string, string[]][] = [];
      for (let i = 0; i < mods.length; i++) {
        for (let j = i + 1; j < mods.length; j++) {
          const other = new Set(files[j]);
          const shared = [...new Set(files[i])].filter((file) => other.has(file));
          if (shared.length) expected.push([mods[i].id, mods[j].id, shared]);
        }
      }
      expect((await detectConflicts('/deadlock')).map((c) => [c.modA, c.modB, c.files])).toEqual(expected);
    }
  });
});
