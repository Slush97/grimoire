/**
 * Unit coverage for the conflict-ignore identity logic. detectConflicts itself
 * needs a real VPK sandbox, but the identity/pair-key helpers that drive the
 * four-layer ignore system (per-file / global / whole-mod / pair) are pure
 * except for a getModMetadata read, so we mock the whole service dep-chain and
 * exercise them directly. Mocking the deps keeps this off the electron/sqlite
 * graph (conflicts.ts only imports these four modules).
 */
import { describe, it, expect } from 'vitest';
import { vi } from 'vitest';
import type { Mod } from '../../../src/types/mod';

const h = vi.hoisted(() => ({
  metaMap: {} as Record<
    string,
    { gameBananaId?: number; gameBananaFileId?: number; sourceFileName?: string } | undefined
  >,
}));

vi.mock('./metadata', () => ({ getModMetadata: (k: string) => h.metaMap[k] }));
vi.mock('./mods', () => ({ scanMods: vi.fn() }));
vi.mock('./vpk', () => ({ parseVpkDirectoriesAsync: vi.fn() }));
vi.mock('./settings', () => ({ loadSettings: vi.fn(() => ({})) }));

import { conflictPairKey, modConflictIdentity, migrateIgnoredConflictKeysForMods } from './conflicts';

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
