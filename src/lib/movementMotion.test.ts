import { describe, expect, it } from 'vitest';
import { movementFrame, selectMovementClips } from './movementMotion';

describe('movement playback', () => {
  it('starts and recovers to standing, with continuous normalized action weights', () => {
    for (const kind of ['dash', 'heavy-melee'] as const) {
      expect(movementFrame(kind, 0, false).standing).toBe(1);
      expect(movementFrame(kind, 2, false).standing).toBe(1);
      expect(movementFrame(kind, 30, false).standing).toBe(1);
      for (let t = 0; t < 3; t += .01) {
        const f = movementFrame(kind, t, false);
        expect(f.standing + f.charge + f.punch + f.dash + f.dashBack).toBeCloseTo(1);
      }
    }
  });
  it('resets all timelines together at a replay boundary', () => {
    expect(movementFrame('dash', 3.25, true)).toEqual({ ...movementFrame('dash', .25, true), cycle: 1 });
  });
  it('uses a backward action while returning and recovers to idle before the loop', () => {
    const returning = movementFrame('dash', 2.4, true);
    expect(returning.dashBack).toBe(1);
    expect(returning.distance).toBeCloseTo(1.15);
    expect(movementFrame('dash', 2.9, true).standing).toBe(1);
    expect(movementFrame('dash', 2.9, true).distance).toBe(0);
  });
  it('discovers backward clips with alternate spellings and hero prefixes', () => {
    for (const name of ['dash_air_back', 'air_dash_back', 'dash_air_backward']) {
      const paths = ['weapon_stand_idle', name].map(clip => `models/heroes_wip/vampirebat/clips/vampirebat_${clip}.vnmclip_c`);
      expect(selectMovementClips(paths, 'models/heroes_wip/vampirebat/vampirebat.vmdl_c').at(-1)).toEqual(['dashBack', paths[1]]);
    }
  });
  it('selects current standing actions together and excludes other heroes and stale versions', () => {
    const paths = ['models/heroes_staging/lash_v2/clips/weapon_stand_idle.vnmclip_c',
      'models/heroes_staging/lash_v2/clips/melee_hit.vnmclip_c',
      'models/heroes_staging/lash/clips/weapon_stand_idle.vnmclip_c',
      'models/heroes_staging/atlas/clips/melee_start.vnmclip_c'];
    expect(selectMovementClips(paths, 'models/heroes_wip/lash/lash.vmdl_c')).toEqual([
      ['standing', paths[0]], ['punch', paths[1]],
    ]);
  });
  it('discovers prefixed Mina clips and a dash outside Rem\'s idle directory', () => {
    const mina = ['weapon_stand_idle', 'melee_start', 'melee_hit', 'dash_air_forward']
      .map(name => `models/heroes_wip/vampirebat/clips/vampirebat_${name}.vnmclip_c`);
    expect(selectMovementClips(mina, 'models/heroes_wip/vampirebat/vampirebat.vmdl_c').map(([name]) => name))
      .toEqual(['standing', 'charge', 'punch', 'dash']);
    const rem = ['weapon_stand_idle', 'melee_start', 'melee_hit'].map(name => `models/heroes_wip/familiar/clips/${name}.vnmclip_c`);
    rem.push('models/heroes_wip/familiar/dmx/animation/dash_air_forward.vnmclip_c');
    expect(selectMovementClips(rem, 'models/heroes_wip/familiar/familiar_wip.vmdl_c').at(-1)).toEqual(['dash', rem[3]]);
  });
  it('accepts the alternate air-dash spelling without borrowing another hero\'s action', () => {
    const root = 'models/heroes_staging/tengu/tengu_v2/clips/';
    const paths = ['weapon_stand_idle', 'melee_start', 'melee_hit', 'air_dash_forward'].map(name => `${root}${name}.vnmclip_c`);
    expect(selectMovementClips(paths, 'models/heroes_staging/tengu/tengu.vmdl_c').at(-1)).toEqual(['dash', paths[3]]);
  });
});
