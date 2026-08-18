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

  // Local mods carry no GameBanana ids, so before sha256 their only identity was
  // the pakNN_ slot they happened to occupy, which every profile switch and
  // reorder rewrites.
  describe('local mods resolved by content hash', () => {
    const SHA_A = 'a'.repeat(64);
    const SHA_B = 'b'.repeat(64);

    it('finds a local mod that was renamed since the profile was saved', () => {
      const current = [mod({ id: 'local', fileName: 'glamorous_geist_dir.vpk' })];
      const resolve = buildProfileModResolver(
        current,
        metaLookup({ 'local.vpk': { sha256: SHA_A } })
      );
      const r = resolve(pm({ fileName: 'pak07_dir.vpk', sha256: SHA_A }));
      expect(r.mod?.id).toBe('local');
      expect(r.via).toBe('hash');
    });

    // Two known hashes that disagree at the same fileName means the slot was
    // reused, so the fallback is refused. The other reading of that shape is a
    // mod rebuilt in place (merge add/replace/extract, soul-container and
    // spirit-urn re-import all keep fileName + slot + metaKey while restamping
    // the hash), which the resolver cannot tell apart from here. Those callers
    // move the saved profile entries onto the new hash themselves, via
    // profiles.ts retargetProfileModSha, so a rebuilt mod resolves on 'hash'
    // and never reaches this branch. See profileShaRetarget.test.ts.
    it('refuses a different local mod that took over the saved slot', () => {
      const current = [mod({ id: 'other', fileName: 'pak07_dir.vpk' })];
      const resolve = buildProfileModResolver(
        current,
        metaLookup({ 'other.vpk': { sha256: SHA_B } })
      );
      const r = resolve(pm({ fileName: 'pak07_dir.vpk', sha256: SHA_A }));
      expect(r.mod).toBeUndefined();
      expect(r.via).toBe('refused-crossmatch');
      expect(r.via === 'refused-crossmatch' && r.candidateFileName).toBe('pak07_dir.vpk');
    });

    it('leaves legacy hash-less entries on the fileName fallback', () => {
      const current = [mod({ id: 'local', fileName: 'my_mod.vpk' })];
      const resolve = buildProfileModResolver(
        current,
        metaLookup({ 'local.vpk': { sha256: SHA_A } })
      );
      const r = resolve(pm({ fileName: 'my_mod.vpk' }));
      expect(r.mod?.id).toBe('local');
      expect(r.via).toBe('fileName');
    });

    it('falls back to fileName when the installed mod has no hash yet', () => {
      // Pre-backfill install: the profile knows its hash, the sidecar doesn't.
      const current = [mod({ id: 'local', fileName: 'my_mod.vpk' })];
      const resolve = buildProfileModResolver(current, metaLookup({}));
      const r = resolve(pm({ fileName: 'my_mod.vpk', sha256: SHA_A }));
      expect(r.mod?.id).toBe('local');
      expect(r.via).toBe('fileName');
    });

    it('misses cleanly when the content changed and the fileName moved too', () => {
      const current = [mod({ id: 'local', fileName: 'pak09_dir.vpk' })];
      const resolve = buildProfileModResolver(
        current,
        metaLookup({ 'local.vpk': { sha256: SHA_B } })
      );
      const r = resolve(pm({ fileName: 'pak07_dir.vpk', sha256: SHA_A }));
      expect(r.mod).toBeUndefined();
      expect(r.via).toBe('miss');
    });

    it('never assigns one byte-identical copy to two profile entries', () => {
      const current = [
        mod({ id: 'copy0', fileName: 'pak01_dir.vpk' }),
        mod({ id: 'copy1', fileName: 'pak02_dir.vpk' }),
      ];
      const resolve = buildProfileModResolver(
        current,
        metaLookup({ 'copy0.vpk': { sha256: SHA_A }, 'copy1.vpk': { sha256: SHA_A } })
      );
      const a = resolve(pm({ fileName: 'pak01_dir.vpk', sha256: SHA_A }));
      const b = resolve(pm({ fileName: 'pak02_dir.vpk', sha256: SHA_A }));
      expect(a.mod?.id).toBe('copy0');
      expect(b.mod?.id).toBe('copy1');
    });

    it('prefers the hash match over the unrelated mod now in the saved slot', () => {
      // The headline regression: applying the profile used to enable `other`
      // simply because it inherited pak07_dir.vpk.
      const current = [
        mod({ id: 'other', fileName: 'pak07_dir.vpk' }),
        mod({ id: 'local', fileName: 'pak12_dir.vpk' }),
      ];
      const resolve = buildProfileModResolver(
        current,
        metaLookup({ 'other.vpk': { sha256: SHA_B }, 'local.vpk': { sha256: SHA_A } })
      );
      const r = resolve(pm({ fileName: 'pak07_dir.vpk', sha256: SHA_A }));
      expect(r.mod?.id).toBe('local');
      expect(r.via).toBe('hash');
    });

    it('still prefers GameBanana stable ids when the entry also carries a hash', () => {
      const current = [
        mod({ id: 'gb', fileName: 'pak03_dir.vpk' }),
        mod({ id: 'local', fileName: 'pak04_dir.vpk' }),
      ];
      const resolve = buildProfileModResolver(
        current,
        metaLookup({
          'gb.vpk': { gameBananaId: 10, gameBananaFileId: 20, sha256: SHA_B },
          'local.vpk': { sha256: SHA_A },
        })
      );
      const r = resolve(
        pm({ fileName: 'x.vpk', gameBananaId: 10, gameBananaFileId: 20, sha256: SHA_A })
      );
      expect(r.mod?.id).toBe('gb');
      expect(r.via).toBe('stable');
    });
  });
});
