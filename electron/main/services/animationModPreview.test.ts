import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ app: { getPath: () => '' }, net: { fetch: vi.fn() }, protocol: { handle: vi.fn() } }));

const { animationModClips, heroForClipPath } = await import('./animationModPreview');

describe('heroForClipPath', () => {
  it('names the hero from the clip folder, whatever its version suffix or tree', () => {
    expect(heroForClipPath('models/heroes_staging/shiv/clips/parry.vnmclip_c')).toBe('Shiv');
    expect(heroForClipPath('models/heroes_staging/gigawatt_prisoner/clips/ability_storm_cloud_loop.vnmclip_c')).toBe('Seven');
    expect(heroForClipPath('models/heroes_wip/doorman_v2/clips/slide_loop.vnmclip_c')).toBe('Doorman');
    // Yamato's clips sit under heroes_wip/yamato while her model is heroes_staging/yamato_v2.
    expect(heroForClipPath('models/heroes_wip/yamato/clips/melee_hit.vnmclip_c')).toBe('Yamato');
    expect(heroForClipPath('models/props/clips/idle.vnmclip_c')).toBeNull();
  });
});

describe('animationModClips', () => {
  it('keeps the clips of the hero most of them belong to, without compiled variants', () => {
    expect(animationModClips([
      'models/heroes_staging/shiv/clips/parry.vnmclip_c',
      'models/heroes_staging/shiv/clips/melee_hit.vnmclip_c',
      'models/heroes_staging/shiv/clips/melee_hit.vnmclip+non_additive.vnmclip_c',
      'models/heroes_wip/doorman_v2/clips/slide_loop.vnmclip_c',
      'sounds/doorman/bell.vsnd_c',
    ])).toEqual({ heroName: 'Shiv', clips: ['models/heroes_staging/shiv/clips/melee_hit.vnmclip_c', 'models/heroes_staging/shiv/clips/parry.vnmclip_c'] });
    expect(animationModClips(['animgraphs/animgraph2/hero/doorman/doorman_abilitymask.vnmgraph_c'])).toBeNull();
  });
});
