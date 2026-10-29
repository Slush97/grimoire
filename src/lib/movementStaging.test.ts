import { describe, expect, it } from 'vitest';
import { resolveMovementGameData, speedCurveTravel } from './movementGameData';
import { MOVEMENT_CLIPS, MOVEMENT_STAGING, buildMovementTimeline } from './movementStaging';
import { clipWeightsAt, timelineTime, travelAt } from './particles/host/effectTimeline';

const curve = (points: [number, number][]) => ({ m_spline: points.map(([x, y]) => ({ x, y, m_flSlopeIncoming: 0, m_flSlopeOutgoing: 0 })) });

const abilities = {
  melee_base: { m_HoldBeginEffect: 'particles/abilities/melee/melee_heavy_activate_charge.vpcf' },
  citadel_hold_melee: {
    _multibase: ['melee_base'],
    m_mapAttacks: { EAttackType_Heavy: {
      m_MeleeAttackParticle: 'particles/abilities/melee/melee_heavy_activate.vpcf',
      m_MeleeSwingParticle: 'particles/abilities/melee_swing_heavy.vpcf',
      m_MeleeImpactParticle: 'particles/abilities/melee/melee_impact_heavy.vpcf',
      m_MovementSpeedCurve: curve([[0, 800], [0.3, 800], [0.31, 0]]),
    } },
  },
  ability_melee_lash: { _multibase: ['citadel_hold_melee'], m_strEffectsAttachName: 'palm_r' },
  ability_melee_bookworm: { _multibase: ['citadel_hold_melee'], m_mapAttacks: { EAttackType_Heavy: { m_MeleeSwingParticle: 'particles/abilities/bookworm/swing.vpcf' } } },
  citadel_ability_dash: { m_DashParticle: 'particles/generic/air_dash.vpcf' },
};
const heroes = {
  hero_base: { m_mapStartingStats: { EAirDashDistanceInMeters: 8, EAirDashDuration: 0.47 }, m_mapBoundAbilities: { ESlot_Ability_Innate_1: 'citadel_ability_dash' } },
  hero_lash: { _base: 'hero_base', m_mapBoundAbilities: { ESlot_Weapon_Melee: 'ability_melee_lash', ESlot_Ability_Innate_1: 'citadel_ability_dash' } },
  hero_bookworm: { _base: 'hero_base', m_mapStartingStats: { EAirDashDuration: 0.51 }, m_mapBoundAbilities: { ESlot_Weapon_Melee: 'ability_melee_bookworm' } },
};

describe('movement game data', () => {
  it('resolves the heavy melee chain through the ability bases', () => {
    const data = resolveMovementGameData(heroes, abilities, ['lash'])!;
    expect(data.melee).toMatchObject({
      ability: 'ability_melee_lash', attachment: 'palm_r', holdBegin: 'particles/abilities/melee/melee_heavy_activate_charge.vpcf',
      attack: 'particles/abilities/melee/melee_heavy_activate.vpcf', swing: 'particles/abilities/melee_swing_heavy.vpcf',
    });
    expect(data.melee!.lunge!.duration).toBeCloseTo(0.31);
    expect(data.melee!.lunge!.distance).toBeGreaterThan(240);
    expect(data.melee!.lunge!.distance).toBeLessThan(250);
    expect(data.dash).toMatchObject({ ability: 'citadel_ability_dash', particle: 'particles/generic/air_dash.vpcf', duration: 0.47 });
    expect(data.dash!.distance).toBeCloseTo(8 / 0.0254);
  });

  it('honours a per-hero override and inherited hero stats', () => {
    const data = resolveMovementGameData(heroes, abilities, ['bookworm'])!;
    expect(data.melee!.swing).toBe('particles/abilities/bookworm/swing.vpcf');
    expect(data.melee!.impact).toBe('particles/abilities/melee/melee_impact_heavy.vpcf');
    expect(data.melee!.attachment).toBeNull();
    expect(data.dash!.duration).toBe(0.51);
    expect(resolveMovementGameData(heroes, abilities, ['missing'])).toBeNull();
  });

  it('integrates a speed curve with a monotone profile', () => {
    const travel = speedCurveTravel(curve([[0, 100], [1, 100]]))!;
    expect(travel.distance).toBeCloseTo(100, 3);
    expect(travel.profile[0]).toBe(0);
    expect(travel.profile.at(-1)).toBeCloseTo(1);
    expect(travel.profile.every((value, i, all) => i === 0 || value >= all[i - 1])).toBe(true);
  });
});

describe('movement staging', () => {
  const durations = new Map([[MOVEMENT_CLIPS.charge, 0.5], [MOVEMENT_CLIPS.lunge, 0.47], [MOVEMENT_CLIPS.punch, 0.67], [MOVEMENT_CLIPS.dash, 1.67]]);

  it('stages charge, attack, swing and impact on the hero clips', () => {
    const data = resolveMovementGameData(heroes, abilities, ['lash'])!;
    const timeline = buildMovementTimeline({ kind: 'heavy-melee', data, clipDurations: durations, fallbackMeleeAttachment: 'palm_L' })!;
    const s = MOVEMENT_STAGING;
    const attack = s.leadIn + 0.5;
    const hit = attack + data.melee!.lunge!.duration;
    expect(timeline.clips.map((clip) => [clip.clip, clip.start])).toEqual([[MOVEMENT_CLIPS.charge, s.leadIn], [MOVEMENT_CLIPS.lunge, attack], [MOVEMENT_CLIPS.punch, hit]]);
    expect(timeline.cues.map((cue) => [cue.label, cue.start])).toEqual([
      ['heavy melee charge', s.leadIn], ['heavy melee attack', attack], ['heavy melee swing', hit], ['heavy melee impact', hit],
    ]);
    expect(timeline.cues[0].stop).toEqual({ at: attack, endCap: true });
    expect(timeline.cues[0].controlPoints).toEqual([{ cp: 1, kind: 'attachment', attachment: 'palm_r', follow: true }]);
    expect(timeline.cues[2].controlPoints).toEqual([{ cp: 0, kind: 'origin', follow: false }]);
    expect(timeline.cues[3].controlPoints).toEqual([{ cp: 0, kind: 'attachment', attachment: 'palm_r', follow: false, facing: 'model' }]);
    expect(timeline.duration).toBeCloseTo(hit + 0.67 + s.rest);
    expect(travelAt(timeline, attack)).toBe(0);
    expect(travelAt(timeline, hit + 1)).toBeCloseTo(data.melee!.lunge!.distance);
  });

  it('falls back to the effect attachment and holds idle for a missing clip', () => {
    const data = resolveMovementGameData(heroes, abilities, ['bookworm'])!;
    const timeline = buildMovementTimeline({ kind: 'heavy-melee', data, clipDurations: new Map(), fallbackMeleeAttachment: 'palm_L' })!;
    expect(timeline.clips).toEqual([]);
    expect(timeline.notes.length).toBeGreaterThan(0);
    expect(timeline.cues[0].controlPoints[0]).toMatchObject({ attachment: 'palm_L' });
  });

  it('stages the dash with its travel and target', () => {
    const data = resolveMovementGameData(heroes, abilities, ['lash'])!;
    const timeline = buildMovementTimeline({ kind: 'dash', data, clipDurations: durations, fallbackMeleeAttachment: null })!;
    expect(timeline.cues).toHaveLength(1);
    expect(timeline.cues[0].stop!.at).toBeCloseTo(MOVEMENT_STAGING.leadIn + 0.47);
    expect(timeline.cues[0].controlPoints[0]).toMatchObject({ cp: 2, kind: 'world', forward: [1, 0, 0] });
    expect(travelAt(timeline, MOVEMENT_STAGING.leadIn + 0.235)).toBeCloseTo(data.dash!.distance / 2);
    expect(timelineTime(timeline, timeline.duration + 0.25, true)).toBeCloseTo(0.25);
    expect(timelineTime(timeline, timeline.duration + 0.25, false)).toBe(timeline.duration);
  });

  it('blends clips over the idle pose and hands over between adjacent clips', () => {
    const data = resolveMovementGameData(heroes, abilities, ['lash'])!;
    const timeline = buildMovementTimeline({ kind: 'heavy-melee', data, clipDurations: durations, fallbackMeleeAttachment: null })!;
    expect(clipWeightsAt(timeline, 0).idle).toBe(1);
    const mid = clipWeightsAt(timeline, MOVEMENT_STAGING.leadIn + MOVEMENT_STAGING.blend / 2);
    expect(mid.clips[0].weight).toBeCloseTo(0.5);
    const handover = clipWeightsAt(timeline, MOVEMENT_STAGING.leadIn + 0.5 + 0.01);
    expect(handover.clips.map((clip) => clip.weight)).toEqual([0, 1, 0]);
    expect(handover.clips[1].time).toBeCloseTo(0.01);
  });
});
