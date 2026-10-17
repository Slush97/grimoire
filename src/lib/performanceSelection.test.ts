import { describe, expect, it } from 'vitest';
import {
  hasPinnedVersion,
  savedOptIns,
  savedVersion,
  savedVideoVariant,
  sortPresetsByTier,
} from './performanceSelection';
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
    date: '2026-08-01',
    settingCount: 10,
    videoSettingCount: 0,
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
  it('puts the recommended default first, then mildest to strongest with the preview config last', () => {
    const sorted = sortPresetsByTier([
      preset('p', 'preview'),
      preset('m', 'maximum'),
      preset('b', 'balanced'),
      preset('up', 'ultraPotato'),
      preset('pot', 'potato'),
      preset('a', 'aggressive'),
      preset('c', 'competitive'),
      preset('l', 'light'),
    ]);
    expect(sorted.map((p) => p.tier)).toEqual([
      'balanced',
      'light',
      'competitive',
      'aggressive',
      'maximum',
      'potato',
      'ultraPotato',
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

  it('falls back to the newest when a saved pick has aged out of the bundle', () => {
    expect(savedVersion(settings({ performanceConfigVersions: { p: '1.0' } }), p)).toBe('2.9');
  });

  it('reads picks per preset', () => {
    expect(savedVersion(settings({ performanceConfigVersions: { other: '2.8' } }), p)).toBe('2.9');
  });
});

describe('hasPinnedVersion', () => {
  const p = preset('p', 'balanced', [{ version: '2.9' }, { version: '2.8' }]);

  it('is false without a pick', () => {
    expect(hasPinnedVersion(null, p)).toBe(false);
    expect(hasPinnedVersion(settings({ performanceConfigVersions: { other: '2.8' } }), p)).toBe(false);
  });

  it('counts a pick of any bundled release, the newest included', () => {
    expect(hasPinnedVersion(settings({ performanceConfigVersions: { p: '2.8' } }), p)).toBe(true);
    expect(hasPinnedVersion(settings({ performanceConfigVersions: { p: '2.9' } }), p)).toBe(true);
  });

  it('ignores a pick this build no longer bundles', () => {
    expect(hasPinnedVersion(settings({ performanceConfigVersions: { p: '2b994f62' } }), p)).toBe(false);
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
});

describe('savedVideoVariant', () => {
  const p = preset('p', 'ultraPotato', [{ version: '5.6' }, { version: '5.5' }]);
  const [both, one] = p.versions;
  both.videoVariants = ['noShadows', 'shadows'];

  it('defaults to the first variant', () => {
    expect(savedVideoVariant(null, 'p', both)).toBe('noShadows');
  });

  it('keeps a saved pick the release ships', () => {
    expect(savedVideoVariant(settings({ performanceVideoVariants: { p: 'shadows' } }), 'p', both)).toBe('shadows');
  });

  it('falls back to the default for a pick the release does not ship', () => {
    expect(savedVideoVariant(settings({ performanceVideoVariants: { p: 'gone' } }), 'p', both)).toBe('noShadows');
  });

  it('is null for a release with a single video.txt, so the card offers no choice', () => {
    expect(savedVideoVariant(settings({ performanceVideoVariants: { p: 'shadows' } }), 'p', one)).toBeNull();
    expect(savedVideoVariant(null, 'p', null)).toBeNull();
  });
});
