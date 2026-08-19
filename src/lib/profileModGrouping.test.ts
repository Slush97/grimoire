import { describe, expect, it } from 'vitest';
import { profileModDisplayGroupKey } from './profileModGrouping';

describe('profileModDisplayGroupKey', () => {
  it('prefers an explicit local group over saved and adopted GameBanana identity', () => {
    expect(
      profileModDisplayGroupKey(
        42,
        { gameBananaId: 99, localGroupId: 'local-group' },
        'abc',
        'pak01_dir.vpk',
      ),
    ).toBe('localgroup:local-group');
  });

  it('groups ordinary GameBanana profile entries by submission', () => {
    expect(
      profileModDisplayGroupKey(42, { gameBananaId: 42 }, 'abc', 'pak01_dir.vpk'),
    ).toBe('gamebanana:42');
  });

  it('falls back to content and then filename for local entries', () => {
    expect(profileModDisplayGroupKey(undefined, undefined, 'abc', 'pak01_dir.vpk')).toBe(
      'sha:abc',
    );
    expect(profileModDisplayGroupKey(undefined, undefined, undefined, 'pak01_dir.vpk')).toBe(
      'file:pak01_dir.vpk',
    );
  });
});
