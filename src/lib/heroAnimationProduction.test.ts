import { describe, expect, it } from 'vitest';
import { HERO_ANIMATION_RECIPES, heroAnimationRecipe, preferredHeroAnimationName, selectHeroAnimations, type HeroAnimationInfo } from './heroAnimationCatalog';

// Installed production hero definitions and exact-model clip inventory, 2026-10-01.
const production: [string, string, number, number][] = [
  ['Infernus', 'shop_menu_base', 87, 30.0],
  ['Seven', 'primary_stand_idle', 79, 24.0],
  ['Vindicta', 'primary_stand_idle', 121, 30.0],
  ['Lady Geist', 'primary_stand_idle', 121, 60.0],
  ['Abrams', 'shop_menu_base', 91, 30.0],
  ['Wraith', 'ui_shop_idle', 91, 30.0],
  ['McGinnis', 'primary_shop_menu_idle', 101, 30.0],
  ['Paradox', 'shop_menu_base', 119, 30.0],
  ['Dynamo', 'primary_stand_idle', 80, 30.0],
  ['Kelvin', 'primary_stand_idle', 129, 35.0],
  ['Haze', 'shop_menu_base', 56, 30.0],
  ['Holliday', 'primary_stand_idle', 81, 30.0],
  ['Bebop', 'primary_stand_idle', 121, 30.0],
  ['Calico', 'primary_stand_idle', 96, 30.0],
  ['Grey Talon', 'shop_menu_base', 90, 30.0],
  ['Mo & Krill', 'primary_stand_idle', 31, 24.0],
  ['Shiv', 'primary_stand_idle', 121, 30.0],
  ['Ivy', 'primary_stand_idle', 61, 30.0],
  ['Warden', 'primary_stand_idle', 129, 35.0],
  ['Yamato', 'ui_hero_select', 10, 30.0],
  ['Lash', 'primary_stand_idle', 51, 30.0],
  ['Viscous', 'ui_hero_select', 129, 30.0],
  ['Pocket', 'primary_stand_idle', 120, 30.0],
  ['Mirage', 'primary_ooc_stand_idle', 100, 30.0],
  ['Vyper', 'primary_stand_idle', 61, 30.0],
  ['Sinclair', 'primary_stand_idle', 91, 30.0],
  ['Mina', 'weapon_stand_idle', 61, 30.0],
  ['Drifter', 'ui_shop', 241, 30.0],
  ['Venator', 'ui_shop', 201, 30.0],
  ['Victor', 'weapon_stand_idle', 110, 30.0],
  ['Paige', 'out_of_combat_stand_idle', 41, 30.0],
  ['Doorman', 'primary_stand_idle', 101, 30.0],
  ['Billy', 'primary_idle', 121, 30.0],
  ['Graves', 'weapon_stand_idle', 201, 30.0],
  ['Apollo', 'ui_shop', 171, 30.0],
  ['Deadman Danny', 'ui_shop', 247, 30.0],
  ['Rem', 'ui_shop', 76, 30.0],
  ['Silver', 'weapon_stand_idle', 57, 30.0],
  ['Celeste', 'ui_shop', 58, 30.0],
  ['Rat King', 'ui_shop_idle', 78, 30.0],
  ['Solomon', 'ui_shop', 200, 30.0],
  ['Violet', 'ui_shop', 170, 30.0],
  ['Nurse Harrow', 'weapon_stand_idle1', 61, 30.0],
  ['Baba', 'outofcombat_stand_idle', 121, 30.0],
];

describe('explicit production showcase coverage', () => {
  it('covers all 44 production heroes without a generic-name fallback', () => {
    expect(production).toHaveLength(44);
    for (const [hero, name] of production) {
      expect(HERO_ANIMATION_RECIPES[hero]?.[0].names).toContain(name);
    }
  });

  it.each(production)('%s selects its installed default before graph fragments', (hero, name, frameCount, fps) => {
    const make = (clipName: string): HeroAnimationInfo => ({ name: clipName, frameCount, fps,
      durationSeconds: (frameCount - 1) / fps, looping: false, default: false });
    const clips = [make('respawn_countdown_idle'), make('aim_idle'), make(name), make('flinch_melee_mid_add')];
    expect(selectHeroAnimations(clips, hero)[0]?.name).toBe(name);
    expect(preferredHeroAnimationName(selectHeroAnimations(clips, hero).map((clip) => clip.name), hero)).toBe(name);
    expect(heroAnimationRecipe(name, hero)?.action).toMatch(/^(idle|relaxedIdle|heroPose)$/);
    expect(selectHeroAnimations([{ ...make(name), additive: true }], hero)).toEqual([]);
  });

  it('holds the independently measured discontinuous production idles', () => {
    expect(heroAnimationRecipe('shop_menu_base', 'Infernus')?.playback).toBe('hold');
    expect(heroAnimationRecipe('primary_stand_idle', 'Calico')?.playback).toBe('hold');
    expect(heroAnimationRecipe('primary_idle', 'Billy')?.playback).toBe('hold');
  });
});
