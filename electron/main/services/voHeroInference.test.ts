import { describe, it, expect } from 'vitest';
import { inferHeroFromVoPaths, needsModSectionVoHeroCheck } from './voHeroInference';

describe('inferHeroFromVoPaths', () => {
  it('tags a VO-only split VPK with its speaker', () => {
    expect(
      inferHeroFromVoPaths([
        'sounds/vo/hornet/hornet_ally_bebop_killed_in_lane_01.vsnd_c',
        'sounds/vo/hornet/hornet_kill_haze_02.vsnd_c',
        'addoninfo.txt',
      ])
    ).toBe('Vindicta');
  });

  it('reads the speaker from flat VO filenames and backslash paths', () => {
    expect(inferHeroFromVoPaths(['sounds\\vo\\haze_kill_synth_03.vsnd_c'])).toBe('Haze');
  });

  it('maps VO codenames that diverge from the ability-sound namespace', () => {
    expect(inferHeroFromVoPaths(['sounds/vo/atlas/atlas_ally_forge_clutch_heal_01.vsnd_c'])).toBe('Abrams');
    expect(inferHeroFromVoPaths(['sounds/vo/atlas_enemy_hornet_damaged_by_snipe_03.vsnd_c'])).toBe('Abrams');
    expect(inferHeroFromVoPaths(['sounds/vo/bull/bull_spawn_01.vsnd_c'])).toBe('Abrams');
    expect(inferHeroFromVoPaths(['sounds/vo/krill/krill_spawn_01.vsnd_c'])).toBe('Mo & Krill');
    expect(inferHeroFromVoPaths(['sounds/vo/digger/digger_spawn_01.vsnd_c'])).toBe('Mo & Krill');
    expect(inferHeroFromVoPaths(['sounds/vo/archer/archer_spawn_01.vsnd_c'])).toBe('Grey Talon');
  });

  it('refuses VPKs that voice more than one hero', () => {
    expect(
      inferHeroFromVoPaths([
        'sounds/vo/hornet/hornet_spawn_01.vsnd_c',
        'sounds/vo/haze/haze_spawn_01.vsnd_c',
      ])
    ).toBeNull();
  });

  it('ignores non-hero VO and non-VO sounds', () => {
    expect(
      inferHeroFromVoPaths([
        'sounds/vo/shopkeeper/shopkeeper_greet_01.vsnd_c',
        'sounds/abilities/hornet/a1_stake.vsnd_c',
        'panorama/images/heroes/hornet_card_psd.vtex_c',
      ])
    ).toBeNull();
  });
});

describe('needsModSectionVoHeroCheck', () => {
  const heroless = { sourceSection: 'Mod', categoryName: 'Skins' };

  it('checks a heroless Mod-section download under a non-hero category', () => {
    expect(needsModSectionVoHeroCheck(heroless, null)).toBe(true);
    expect(needsModSectionVoHeroCheck({ sourceSection: 'Mod' }, undefined)).toBe(true);
  });

  it('never overrides a manual or inferred hero tag', () => {
    const manual = { ...heroless, lockerHero: 'Haze', lockerHeroSource: 'manual' };
    expect(needsModSectionVoHeroCheck(manual, null)).toBe(false);
    expect(needsModSectionVoHeroCheck({ ...heroless, lockerHero: 'Haze' }, null)).toBe(false);
  });

  it('defers to a hero category', () => {
    expect(needsModSectionVoHeroCheck({ sourceSection: 'Mod', categoryName: 'Vindicta' }, null)).toBe(false);
  });

  it('skips global cosmetics, already-checked mods, and other sections', () => {
    expect(needsModSectionVoHeroCheck(heroless, 'hud')).toBe(false);
    expect(needsModSectionVoHeroCheck({ ...heroless, lockerHeroVpkChecked: true }, null)).toBe(false);
    expect(needsModSectionVoHeroCheck({ ...heroless, sourceSection: 'Sound' }, null)).toBe(false);
    expect(needsModSectionVoHeroCheck({ ...heroless, sourceSection: undefined }, null)).toBe(false);
  });
});
