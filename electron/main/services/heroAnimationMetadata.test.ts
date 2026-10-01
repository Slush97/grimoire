import { describe, expect, it, vi } from 'vitest';
vi.mock('./modMerger', () => ({ runVpkmergeStdout: vi.fn() }));
import { heroAnimationMetadataPaths, parseHeroAnimationMetadata } from './heroAnimationMetadata';
const clip = { name: 'ui_shop_idle', frameCount: 91, fps: 30, durationSeconds: 3, looping: true, default: false };

describe('compiled animation metadata provenance', () => {
  it('limits reload alias lookup to the three reviewed neighboring model clips', () => {
    for (const hero of ['dynamo', 'wraith', 'yamato']) {
      const folder = `models/heroes_wip/${hero}`;
      expect(heroAnimationMetadataPaths(`${folder}/${hero}.vmdl_c`, 'primary_stand_reload')).toEqual([
        `${folder}/clips/primary_stand_reload.vnmclip_c`, `${folder}/clips/reload_idle.vnmclip_c`,
      ]);
      expect(heroAnimationMetadataPaths(`${folder}/${hero}.vmdl_c`, 'primary_stand_reload_quick')).toHaveLength(1);
    }
    expect(heroAnimationMetadataPaths('models/heroes_wip/mirage/mirage.vmdl_c', 'primary_stand_reload')).toHaveLength(1);
    expect(heroAnimationMetadataPaths('models/heroes_wip/wraith/skin/model.vmdl_c', 'primary_stand_reload')).toHaveLength(1);
  });
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
