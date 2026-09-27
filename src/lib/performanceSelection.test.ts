import { describe, expect, it } from 'vitest';
import { savedOptIns, savedVersion, sortPresetsByTier } from './performanceSelection';
import type { AppSettings } from '../types/mod';
import type { PerformanceOptIn, PerformancePresetSummary } from '../types/electron';

const OPT_INS: PerformanceOptIn[] = [
  { key: 'citadel_trooper_glow_disabled', value: '1', group: 'visibility' },
  { key: 'citadel_camera_fov', value: '100', group: 'camera' },
  { key: 'sv_cheats', value: '1', group: 'devtools' },
];

function preset(
  id: string,
  tier: PerformancePresetSummary['tier'],
  versions: { version: string; optIn?: PerformanceOptIn[] }[] = [{ version: '2.0' }]
): PerformancePresetSummary {
  const releases = versions.map((v) => ({
    version: v.version,
    ref: v.version,
    refKind: 'tag' as const,
    commit: `commit-${v.version}`,
    historyCommit: `commit-${v.version}`,
    date: '2026-08-01',
    settingCount: 10,
    optIn: v.optIn ?? OPT_INS,
  }));
  return {
    id,
    name: id,
    version: releases[0].version,
    tier,
    author: 'author',
    unstable: false,
    isDefault: false,
    settingCount: 10,
    upstream: {
      url: 'https://github.com/o/r',
      repo: 'o/r',
      ref: releases[0].ref,
      refKind: 'tag',
      commit: releases[0].commit,
      license: 'GPL-3.0',
      credit: 'credit',
    },
    optIn: releases[0].optIn,
    versions: releases,
  };
}

const settings = (partial: Partial<AppSettings>) => partial as AppSettings;

describe('sortPresetsByTier', () => {
  it('orders mildest to strongest with the preview config last', () => {
    const sorted = sortPresetsByTier([
      preset('p', 'preview'),
      preset('m', 'maximum'),
      preset('b', 'balanced'),
      preset('pot', 'potato'),
      preset('a', 'aggressive'),
      preset('c', 'competitive'),
    ]);
    expect(sorted.map((p) => p.tier)).toEqual([
      'balanced',
      'competitive',
      'aggressive',
      'maximum',
      'potato',
      'preview',
    ]);
  });
});

describe('savedVersion', () => {
  const p = preset('p', 'balanced', [{ version: '2.9' }, { version: '2.8' }]);

  it('defaults to the newest bundled release', () => {
    expect(savedVersion(null, p)).toBe('2.9');
    expect(savedVersion(settings({}), p)).toBe('2.9');
  });

  it('keeps a saved rollback to a bundled release', () => {
    expect(savedVersion(settings({ performanceConfigVersions: { p: '2.8' } }), p)).toBe('2.8');
  });

  it('keeps a version pinned from the full history', () => {
    const s = settings({
      performanceConfigVersions: { p: 'abc1234' },
      performanceConfigRemotePins: { p: { version: 'abc1234', ref: 'v1', date: '2026-01-01' } },
    });
    expect(savedVersion(s, p)).toBe('abc1234');
  });

  it('falls back to the newest when a saved pick has aged out of the bundle', () => {
    expect(savedVersion(settings({ performanceConfigVersions: { p: '1.0' } }), p)).toBe('2.9');
  });

  it('reads pins per preset', () => {
    expect(savedVersion(settings({ performanceConfigVersions: { other: '2.8' } }), p)).toBe('2.9');
  });
});

describe('savedOptIns', () => {
  it("defaults to the creator's settings without developer tools", () => {
    const p = preset('p', 'balanced');
    expect(savedOptIns(null, p, '2.0')).toEqual(['citadel_trooper_glow_disabled', 'citadel_camera_fov']);
  });

  it('respects an explicit empty selection', () => {
    const p = preset('p', 'balanced');
    expect(savedOptIns(settings({ performanceConfigOptIns: { p: [] } }), p, '2.0')).toEqual([]);
  });

  it('keeps an explicitly enabled developer tool', () => {
    const p = preset('p', 'balanced');
    expect(savedOptIns(settings({ performanceConfigOptIns: { p: ['sv_cheats'] } }), p, '2.0')).toEqual([
      'sv_cheats',
    ]);
  });

  it('drops keys the chosen release does not define', () => {
    const older: PerformanceOptIn[] = [OPT_INS[0]];
    const p = preset('p', 'balanced', [{ version: '2.9' }, { version: '2.8', optIn: older }]);
    const s = settings({
      performanceConfigOptIns: { p: ['citadel_trooper_glow_disabled', 'citadel_camera_fov'] },
    });
    expect(savedOptIns(s, p, '2.8')).toEqual(['citadel_trooper_glow_disabled']);
    expect(savedOptIns(s, p, '2.9')).toEqual(['citadel_trooper_glow_disabled', 'citadel_camera_fov']);
  });

  it("uses the newest release's list for a version pinned from the full history", () => {
    const p = preset('p', 'balanced', [{ version: '2.9' }]);
    expect(savedOptIns(null, p, 'abc1234')).toEqual(['citadel_trooper_glow_disabled', 'citadel_camera_fov']);
  });
});
