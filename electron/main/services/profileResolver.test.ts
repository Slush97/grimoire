import { describe, it, expect, vi, beforeAll } from 'vitest';
import type { Mod } from '../../../src/types/mod';
import type { ProfileMod } from '../../../src/types/electron';
import {
  normalizeVpkIndex,
  inferMissingVpkIndexes,
  dedupeEnabledForProfile,
  buildProfileModResolver,
  type VpkIndexMeta,
} from './profileResolver';

// dedupe logs a warning per dropped duplicate; keep the suite output clean.
beforeAll(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

/** Minimal Mod. metaKey defaults to `<id>.vpk`; meta maps below key on that. */
function mod(over: Partial<Mod> & { id: string }): Mod {
  return {
    name: over.id,
    fileName: `${over.id}.vpk`,
    path: `/addons/${over.id}.vpk`,
    metaKey: `${over.id}.vpk`,
    enabled: true,
    priority: 1,
    size: 0,
    installedAt: '2026-01-01T00:00:00Z',
    ...over,
  };
}

/** getMeta driven by a metaKey -> metadata map (what getModMetadata provides). */
function metaLookup(map: Record<string, VpkIndexMeta>) {
  return (metaKey: string): VpkIndexMeta | undefined => map[metaKey];
}

function pm(over: Partial<ProfileMod> & { fileName: string }): ProfileMod {
  return { enabled: true, priority: 1, ...over };
}

describe('normalizeVpkIndex', () => {
  it('accepts non-negative integers, rejects the rest', () => {
    expect(normalizeVpkIndex(0)).toBe(0);
    expect(normalizeVpkIndex(2)).toBe(2);
    expect(normalizeVpkIndex(-1)).toBeUndefined();
    expect(normalizeVpkIndex(1.5)).toBeUndefined();
    expect(normalizeVpkIndex('3')).toBeUndefined();
    expect(normalizeVpkIndex(undefined)).toBeUndefined();
  });
});

describe('inferMissingVpkIndexes', () => {
  it('assigns indexes by ascending size within a GameBanana file group', () => {
    const mods = [mod({ id: 'big', size: 200 }), mod({ id: 'small', size: 100 })];
    const inferred = inferMissingVpkIndexes(
      mods,
      metaLookup({
        'big.vpk': { gameBananaId: 100, gameBananaFileId: 5 },
        'small.vpk': { gameBananaId: 100, gameBananaFileId: 5 },
      })
    );
    expect(inferred.get('small.vpk')).toBe(0);
    expect(inferred.get('big.vpk')).toBe(1);
  });

  it('skips single-VPK groups', () => {
    const inferred = inferMissingVpkIndexes(
      [mod({ id: 'a', size: 10 })],
      metaLookup({ 'a.vpk': { gameBananaId: 1, gameBananaFileId: 1 } })
    );
    expect(inferred.size).toBe(0);
  });

  it('refuses to guess when the sibling sizes are all equal', () => {
    const mods = [mod({ id: 'a', size: 100 }), mod({ id: 'b', size: 100 })];
    const inferred = inferMissingVpkIndexes(
      mods,
      metaLookup({
        'a.vpk': { gameBananaId: 1, gameBananaFileId: 1 },
        'b.vpk': { gameBananaId: 1, gameBananaFileId: 1 },
      })
    );
    expect(inferred.size).toBe(0);
  });

  it('never overwrites an index that was actually stamped', () => {
    const mods = [mod({ id: 'a', size: 100 }), mod({ id: 'b', size: 200 })];
    const inferred = inferMissingVpkIndexes(
      mods,
      metaLookup({
        'a.vpk': { gameBananaId: 1, gameBananaFileId: 1, vpkIndex: 5 },
        'b.vpk': { gameBananaId: 1, gameBananaFileId: 1 },
      })
    );
    expect(inferred.has('a.vpk')).toBe(false);
    expect(inferred.get('b.vpk')).toBe(1);
  });

  it('ignores mods without GameBanana ids', () => {
    const inferred = inferMissingVpkIndexes(
      [mod({ id: 'a', size: 1 }), mod({ id: 'b', size: 2 })],
      metaLookup({})
    );
    expect(inferred.size).toBe(0);
  });
});

describe('dedupeEnabledForProfile', () => {
  it('keeps distinct multi-VPK siblings (different indexes)', () => {
    const mods = [mod({ id: 'a', size: 100, priority: 1 }), mod({ id: 'b', size: 200, priority: 2 })];
    const out = dedupeEnabledForProfile(
      mods,
      metaLookup({
        'a.vpk': { gameBananaId: 1, gameBananaFileId: 1 },
        'b.vpk': { gameBananaId: 1, gameBananaFileId: 1 },
      })
    );
    expect(out.map((m) => m.id).sort()).toEqual(['a', 'b']);
  });

  it('keeps both equal-size legacy siblings that lack a stamped index', () => {
    // A multi-VPK submission installed before vpkIndex existed, whose two VPKs
    // are the same byte size, so inferMissingVpkIndexes bails and both stay
    // index-less -> identical `gbId:fileId` stable key. They are DISTINCT
    // physical files and both must survive: dropping one would half-load the
    // mod in game. (Regressed previously: the collapse dropped one.)
    const mods = [
      mod({ id: 'a', size: 100, priority: 1 }),
      mod({ id: 'b', size: 100, priority: 2 }),
    ];
    const out = dedupeEnabledForProfile(
      mods,
      metaLookup({
        'a.vpk': { gameBananaId: 1, gameBananaFileId: 1 },
        'b.vpk': { gameBananaId: 1, gameBananaFileId: 1 },
      })
    );
    expect(out.map((m) => m.id).sort()).toEqual(['a', 'b']);
  });

  it('drops a duplicate of the same file/index, keeping the higher load order (lower priority)', () => {
    // Both stamped index 0 -> same stable key -> duplicate. Feed the low-priority
    // copy second to exercise the swap-in-place branch.
    const mods = [mod({ id: 'hi', priority: 5 }), mod({ id: 'lo', priority: 1 })];
    const out = dedupeEnabledForProfile(
      mods,
      metaLookup({
        'hi.vpk': { gameBananaId: 1, gameBananaFileId: 1, vpkIndex: 0 },
        'lo.vpk': { gameBananaId: 1, gameBananaFileId: 1, vpkIndex: 0 },
      })
    );
    expect(out.map((m) => m.id)).toEqual(['lo']);
  });

  it('passes non-GameBanana mods through untouched', () => {
    const mods = [mod({ id: 'x', priority: 1 }), mod({ id: 'y', priority: 2 })];
    const out = dedupeEnabledForProfile(mods, metaLookup({}));
    expect(out.map((m) => m.id)).toEqual(['x', 'y']);
  });
});

describe('buildProfileModResolver', () => {
  it('matches a multi-VPK sibling by gbId+fileId+vpkIndex even after a fileName change', () => {
    const current = [mod({ id: 'm0' }), mod({ id: 'm1' })];
    const resolve = buildProfileModResolver(
      current,
      metaLookup({
        'm0.vpk': { gameBananaId: 10, gameBananaFileId: 20, vpkIndex: 0 },
        'm1.vpk': { gameBananaId: 10, gameBananaFileId: 20, vpkIndex: 1 },
      })
    );
    const r0 = resolve(pm({ fileName: 'renamed0.vpk', gameBananaId: 10, gameBananaFileId: 20, vpkIndex: 0 }));
    const r1 = resolve(pm({ fileName: 'renamed1.vpk', gameBananaId: 10, gameBananaFileId: 20, vpkIndex: 1 }));
    expect(r0).toMatchObject({ via: 'stable' });
    expect(r0.mod?.id).toBe('m0');
    expect(r1.mod?.id).toBe('m1');
  });

  it('resolves a legacy single-VPK profile entry (no vpkIndex) even when renamed', () => {
    const current = [mod({ id: 'm', fileName: 'pak01_dir.vpk' })];
    const resolve = buildProfileModResolver(
      current,
      metaLookup({ 'm.vpk': { gameBananaId: 10, gameBananaFileId: 20 } })
    );
    const r = resolve(pm({ fileName: 'DIFFERENT.vpk', gameBananaId: 10, gameBananaFileId: 20 }));
    expect(r.mod?.id).toBe('m');
    expect(r.via).toBe('stable');
  });

  it('resolves a legacy multi-VPK profile positionally without double-claiming', () => {
    // Old profile: two entries, same gb file, NO vpkIndex, fileNames that no
    // longer match. The installed siblings got inferred indexes (distinct
    // sizes). Each entry claims a distinct sibling; neither is double-assigned.
    const current = [
      mod({ id: 'm0', fileName: 'pak01_dir.vpk', size: 100 }),
      mod({ id: 'm1', fileName: 'pak02_dir.vpk', size: 200 }),
    ];
    const resolve = buildProfileModResolver(
      current,
      metaLookup({
        'm0.vpk': { gameBananaId: 1, gameBananaFileId: 1 },
        'm1.vpk': { gameBananaId: 1, gameBananaFileId: 1 },
      })
    );
    const a = resolve(pm({ fileName: 'oldA.vpk', gameBananaId: 1, gameBananaFileId: 1 }));
    const b = resolve(pm({ fileName: 'oldB.vpk', gameBananaId: 1, gameBananaFileId: 1 }));
    expect(a.mod?.id).toBe('m0');
    expect(b.mod?.id).toBe('m1');
  });

  it('never assigns one installed mod to two profile entries', () => {
    const current = [mod({ id: 'm0' }), mod({ id: 'm1' })];
    const resolve = buildProfileModResolver(
      current,
      metaLookup({
        'm0.vpk': { gameBananaId: 1, gameBananaFileId: 1, vpkIndex: 0 },
        'm1.vpk': { gameBananaId: 1, gameBananaFileId: 1, vpkIndex: 1 },
      })
    );
    const a = resolve(pm({ fileName: 'x', gameBananaId: 1, gameBananaFileId: 1, vpkIndex: 0 }));
    const b = resolve(pm({ fileName: 'y', gameBananaId: 1, gameBananaFileId: 1, vpkIndex: 0 }));
    expect(a.mod?.id).toBe('m0');
    expect(b.mod).toBeUndefined();
    expect(b.via).toBe('miss');
  });

  it('survives a file-id change by matching gbId + vpkIndex (update-tolerant)', () => {
    const current = [mod({ id: 'm0' }), mod({ id: 'm1' })];
    const resolve = buildProfileModResolver(
      current,
      metaLookup({
        'm0.vpk': { gameBananaId: 10, gameBananaFileId: 999, vpkIndex: 0 },
        'm1.vpk': { gameBananaId: 10, gameBananaFileId: 999, vpkIndex: 1 },
      })
    );
    // profile saved against the OLD file id 20
    const r = resolve(pm({ fileName: 'x', gameBananaId: 10, gameBananaFileId: 20, vpkIndex: 0 }));
    expect(r.mod?.id).toBe('m0');
    expect(r.via).toBe('stable');
  });

  it('survives a file-id change for a lone single-VPK install', () => {
    const current = [mod({ id: 'm' })];
    const resolve = buildProfileModResolver(
      current,
      metaLookup({ 'm.vpk': { gameBananaId: 10, gameBananaFileId: 999 } })
    );
    const r = resolve(pm({ fileName: 'x', gameBananaId: 10, gameBananaFileId: 20 }));
    expect(r.mod?.id).toBe('m');
    expect(r.via).toBe('stable');
  });

  it('refuses a fileName collision when ids cannot be reconciled', () => {
    const current = [mod({ id: 'other', fileName: 'pak01.vpk' })];
    const resolve = buildProfileModResolver(
      current,
      metaLookup({ 'other.vpk': { gameBananaId: 777, gameBananaFileId: 888 } })
    );
    const r = resolve(pm({ fileName: 'pak01.vpk', gameBananaId: 10, gameBananaFileId: 20 }));
    expect(r.mod).toBeUndefined();
    expect(r.via).toBe('refused-crossmatch');
    expect(r.via === 'refused-crossmatch' && r.candidateFileName).toBe('pak01.vpk');
  });

  it('falls back to fileName for local-to-local (no ids on either side)', () => {
    const current = [mod({ id: 'local', fileName: 'my_mod.vpk' })];
    const resolve = buildProfileModResolver(current, metaLookup({}));
    const r = resolve(pm({ fileName: 'my_mod.vpk' }));
    expect(r.mod?.id).toBe('local');
    expect(r.via).toBe('fileName');
  });

  it('misses cleanly when nothing matches', () => {
    const current = [mod({ id: 'a', fileName: 'a.vpk' })];
    const resolve = buildProfileModResolver(current, metaLookup({}));
    const r = resolve(pm({ fileName: 'nonexistent.vpk' }));
    expect(r.mod).toBeUndefined();
    expect(r.via).toBe('miss');
  });
});
