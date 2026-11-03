import { describe, expect, it } from 'vitest';
import { overlapKind, overlapKinds, sharesModel } from './overlapKinds';

describe('overlapKind', () => {
  it('splits panorama images from the rest of the HUD', () => {
    expect(overlapKind('panorama/images/heroes/hornet_card_psd.vtex_c')).toBe('images');
    expect(overlapKind('panorama/styles/hud.vcss_c')).toBe('hud');
    expect(overlapKind('panorama/layout/hud/hud_top_bar.vxml_c')).toBe('hud');
  });

  it('groups sound files with their soundevents', () => {
    expect(overlapKind('sounds/mods/announcer.vsnd_c')).toBe('sounds');
    expect(overlapKind('soundevents/hero/hornet.vsndevts_c')).toBe('sounds');
  });

  it('ignores case and falls back to other', () => {
    expect(overlapKind('Models/Heroes_Staging/hornet_v3/hornet.vmdl_c')).toBe('models');
    expect(overlapKind('cfg/gameinfo_branchspecific.gi')).toBe('other');
  });
});

describe('overlapKinds', () => {
  it('lists each kind once, most files first', () => {
    expect(overlapKinds([
      'materials/a.vmat_c',
      'models/a.vmdl_c',
      'materials/b.vtex_c',
      'materials/c.vtex_c',
      'models/b.vmesh_c',
      'particles/a.vpcf_c',
    ])).toEqual(['textures', 'models', 'effects']);
  });

  it('returns nothing for no files', () => {
    expect(overlapKinds([])).toEqual([]);
  });
});

describe('sharesModel', () => {
  it('is true only when a compiled model is shared', () => {
    expect(sharesModel(['models/props_gameplay/soul_container/soul_container.vmdl_c'])).toBe(true);
    expect(sharesModel(['models/heroes/hornet/hornet_body.vmesh_c', 'materials/a.vmat_c'])).toBe(false);
  });
});
