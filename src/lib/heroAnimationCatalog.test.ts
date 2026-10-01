import { describe, expect, it } from 'vitest';
import { heroAnimationRecipe, isStandaloneHeroAnimation, preferredHeroAnimationName, selectHeroAnimations, type HeroAnimationInfo } from './heroAnimationCatalog';

const clip = (name: string, extra: Partial<HeroAnimationInfo> = {}): HeroAnimationInfo => ({ name, frameCount: 61, fps: 30, durationSeconds: 2, looping: true, default: false, ...extra });

describe('whole hero showcase actions', () => {
  it('retains reviewed secondary actions without replacing showcase defaults', () => {
    for (const [hero, idle, secondary] of [
      ['Dynamo', 'primary_stand_idle', 'primary_stand_reload'],
      ['Wraith', 'ui_shop_idle', 'item_run_n'],
      ['Celeste', 'ui_shop', 'weapon_run_n'],
      ['Yamato', 'ui_hero_select', 'primary_stand_reload'],
    ]) {
      const clips = [clip(secondary), clip(idle), clip('primary_crouch_reload')];
      expect(selectHeroAnimations(clips, hero).map((c) => c.name)).toEqual([idle, secondary]);
      expect(preferredHeroAnimationName(clips.map((c) => c.name), hero)).toBe(idle);
      for (const flags of [{ additive: true }, { rootMotion: true }, { requiresBase: true }, { standalone: false }]) {
        expect(selectHeroAnimations([clip(idle), clip(secondary, flags)], hero).map((c) => c.name)).toEqual([idle]);
      }
    }
    expect(heroAnimationRecipe('primary_stand_reload', 'Wraith')?.playback).toBe('hold');
    expect(heroAnimationRecipe('weapon_run_n', 'Celeste')?.playback).toBe('loop');
  });
  it('keeps Graves weapon in its authored standing pose instead of the parked shop pose', () => {
    const clips = [clip('respawn_countdown_idle'), clip('ui_shop'), clip('weapon_stand_idle', { looping: false })];
    expect(selectHeroAnimations(clips, 'Graves').map((c) => c.name)).toEqual(['weapon_stand_idle']);
    expect(preferredHeroAnimationName(clips.map((c) => c.name), 'Graves')).toBe('weapon_stand_idle');
  });
  it('lets positive compiled metadata reject a previously reviewed name', () => {
    const clips = [clip('ui_shop_idle', { additive: true }), clip('primary_stand_idle'), clip('ui_hero_select')];
    expect(selectHeroAnimations(clips, 'Wraith').map((c) => c.name)).toEqual(['primary_stand_idle', 'ui_hero_select']);
    for (const flag of ['hidden', 'delta', 'requiresBase', 'transition', 'rootMotion'] as const) {
      expect(isStandaloneHeroAnimation(clip('primary_stand_idle', { [flag]: true }))).toBe(false);
    }
    expect(isStandaloneHeroAnimation(clip('primary_stand_idle', { standalone: false }))).toBe(false);
  });
  it('holds discontinuous and static poses and avoids equivalent idle variants', () => {
    expect(heroAnimationRecipe('ui_shop', 'Rem')?.playback).toBe('hold');
    expect(heroAnimationRecipe('ui_hero_select', 'Yamato')?.playback).toBe('hold');
    expect(heroAnimationRecipe('hero_pose', 'Dynamo')?.playback).toBe('hold');
    expect(selectHeroAnimations([clip('ui_hero_select'), clip('primary_stand_idle')], 'Viscous').map((c) => c.name)).toEqual(['ui_hero_select']);
    expect(selectHeroAnimations([clip('ui_hero_select'), clip('primary_stand_idle')], 'Yamato').map((c) => c.name)).toEqual(['ui_hero_select']);
  });
  it('rejects additive, body split and transition fragments before defaults', () => {
    const names = ['aim_idle', 'shoot_idle', 'flinch_melee_left_add', 'mirage_reload_add_null', 'upperbody_idle', 'idle_transition', 'jump_apex_loop', 'respawn_countdown_idle'];
    expect(selectHeroAnimations(names.map((n) => clip(n)), 'Rem')).toEqual([]);
    expect(isStandaloneHeroAnimation(clip('ability_djinnsmark', { additive: true, standalone: true }))).toBe(false);
  });
  it('keeps explicitly complete unknown actions while refusing raw category guesses', () => {
    expect(selectHeroAnimations([clip('primary_stand_idle'), clip('custom_motion', { standalone: true }), clip('primary_crouch_reload')]).map((c) => c.name)).toEqual(['primary_stand_idle', 'custom_motion']);
  });
  it('uses a neutral deterministic fallback and bounds the decode budget', () => {
    const clips = [clip('weapon_stand_idle'), clip('primary_stand_idle'), clip('out_of_combat_stand_idle')];
    expect(selectHeroAnimations(clips, 'Rem').map((c) => c.name)).toEqual(['primary_stand_idle']);
    expect(selectHeroAnimations([...clips].reverse(), 'Rem').map((c) => c.name)).toEqual(['primary_stand_idle']);
    expect(selectHeroAnimations([clip('primary_stand_idle', { frameCount: 10001 })])).toEqual([]);
    expect(selectHeroAnimations([clip('hero_pose', { frameCount: 1, durationSeconds: 0 })])).toEqual([]);
  });
});
