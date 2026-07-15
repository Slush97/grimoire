/**
 * Unit coverage for findChunkSiblingNames (vpk.ts), the pure name matcher
 * behind the imprint anomaly guard's 'chunked' reason. The matcher is fed a
 * folder listing by checkImprintAnomaly; here the listings are plain arrays,
 * so no filesystem is involved.
 */
import { describe, it, expect } from 'vitest';
import { findChunkSiblingNames } from './vpk';

describe('findChunkSiblingNames', () => {
  it('finds numeric chunk siblings for a dir VPK', () => {
    const siblings = ['pak01_dir.vpk', 'pak01_000.vpk', 'pak01_001.vpk', 'pak02_dir.vpk'];
    expect(findChunkSiblingNames('pak01_dir.vpk', siblings)).toEqual([
      'pak01_000.vpk',
      'pak01_001.vpk',
    ]);
  });

  it('returns [] when the dir VPK stands alone', () => {
    expect(findChunkSiblingNames('pak01_dir.vpk', ['pak01_dir.vpk', 'pak02_dir.vpk'])).toEqual([]);
  });

  it('matches case-insensitively and tolerates non-3-digit chunk numbers', () => {
    const siblings = ['PAK01_000.VPK', 'pak01_1.vpk', 'pak01_0001.vpk'];
    expect(findChunkSiblingNames('pak01_dir.vpk', siblings)).toEqual(siblings);
  });

  it('ignores the dir VPK itself and non-numeric suffixes', () => {
    const siblings = ['pak01_dir.vpk', 'pak01_extra.vpk', 'pak01_00a.vpk', 'pak01_000.txt'];
    expect(findChunkSiblingNames('pak01_dir.vpk', siblings)).toEqual([]);
  });

  it('does not cross-match another mod sharing a name prefix', () => {
    // free-form disabled names: "cool skin_dir.vpk" vs "cool skin 2_dir.vpk"
    const siblings = ['cool skin 2_dir.vpk', 'cool skin 2_000.vpk'];
    expect(findChunkSiblingNames('cool skin_dir.vpk', siblings)).toEqual([]);
  });

  it('returns [] for a file name that is not a _dir.vpk at all', () => {
    expect(findChunkSiblingNames('loose.vpk', ['loose_000.vpk'])).toEqual([]);
  });
});
