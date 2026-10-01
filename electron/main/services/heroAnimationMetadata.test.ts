import { describe, expect, it, vi } from 'vitest';
vi.mock('./modMerger', () => ({ runVpkmergeStdout: vi.fn() }));
import { parseHeroAnimationMetadata } from './heroAnimationMetadata';
const clip = { name: 'ui_shop_idle', frameCount: 91, fps: 30, durationSeconds: 3, looping: true, default: false };

describe('compiled animation metadata provenance', () => {
  it('preserves additive and root-motion flags from a matching NmClip', () => {
    expect(parseHeroAnimationMetadata({ m_nNumFrames: 91, m_flDuration: 3, m_bIsAdditive: true,
      m_rootMotion: { m_flAverageLinearVelocity: 329.1 } }, clip)).toEqual({ additive: true, rootMotion: true });
  });
  it('does not attach a current short pose flag to a different legacy sequence', () => {
    expect(parseHeroAnimationMetadata({ m_nNumFrames: 11, m_flDuration: 0.3333, m_bIsAdditive: false }, clip)).toBeNull();
    expect(parseHeroAnimationMetadata({ m_nNumFrames: 91, m_flDuration: 0.3333, m_bIsAdditive: false }, clip)).toBeNull();
    expect(parseHeroAnimationMetadata({ m_nNumFrames: 91, m_flDuration: 3 }, clip)).toBeNull();
  });
});
