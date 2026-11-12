import { describe, expect, it } from 'vitest';
import { resolveMovementGameData, speedCurveTravel } from './movementGameData';
import { MOVEMENT_CLIPS, MOVEMENT_STAGING, buildMovementTimeline } from './movementStaging';
import { clipWeightsAt, timelineTime, travelAt } from './particles/host/effectTimeline';
import { actorAt, actorShiftAt } from './stagedActorPlacement';

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
  citadel_ability_melee_parry: {
    m_ActiveParryParticle: 'particles/abilities/melee/melee_parry.vpcf',
    m_SuccessfulParryParticle: 'particles/abilities/melee/melee_parry_success.vpcf',
    m_ParryVictimModifier: { m_strParticleEffect: 'particles/abilities/melee/melee_parry_debuff.vpcf' },
    m_mapAbilityProperties: { ParriedStunTime: { m_strValue: '2.75' } },
  },
};
const heroes = {
  hero_base: { m_mapStartingStats: { EAirDashDistanceInMeters: 8, EAirDashDuration: 0.47 }, m_mapBoundAbilities: { ESlot_Ability_Innate_1: 'citadel_ability_dash' } },
  hero_lash: { _base: 'hero_base', m_mapBoundAbilities: { ESlot_Weapon_Melee: 'ability_melee_lash', ESlot_Ability_Innate_1: 'citadel_ability_dash', ESlot_Ability_Innate_3: 'citadel_ability_melee_parry' } },
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

  it('finds the parry by the ability that carries a parry effect, not by slot alone', () => {
    expect(resolveMovementGameData(heroes, abilities, ['lash'])!.parry).toEqual({
      ability: 'citadel_ability_melee_parry', active: 'particles/abilities/melee/melee_parry.vpcf',
      success: 'particles/abilities/melee/melee_parry_success.vpcf', victim: 'particles/abilities/melee/melee_parry_debuff.vpcf', stunSeconds: 2.75,
    });
    // Bookworm's Innate_3 is unbound, and Innate_1 is the dash (no parry effect)
    expect(resolveMovementGameData(heroes, abilities, ['bookworm'])!.parry).toBeNull();
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
    // The blow lands on the target: its ability_apply, facing as the striker faces
    expect(timeline.cues[3].controlPoints).toEqual([{ cp: 0, kind: 'attachment', attachment: 'ability_apply', follow: false, facing: 'owner', actor: 'opponent' }]);
    // The target stands where the lunge carries the hero, plus the reach
    expect(timeline.actors).toEqual([{ id: 'opponent', hero: s.opponent.hero, position: [data.melee!.lunge!.distance + s.opponent.reach, 0, 0], yaw: Math.PI }]);
    expect(timeline.duration).toBeCloseTo(hit + 0.67 + s.rest);
    // With its clips, it flinches at the hit and the loop waits for it
    const struck = buildMovementTimeline({ kind: 'heavy-melee', data, clipDurations: durations, fallbackMeleeAttachment: 'palm_L',
      actorClipDurations: new Map([['opponent', new Map([[MOVEMENT_CLIPS.hitReaction, 1.2]])]]) })!;
    expect(struck.clips.find((clip) => clip.actor === 'opponent')).toEqual({ clip: MOVEMENT_CLIPS.hitReaction, start: hit, end: hit + 1.2, from: 0, actor: 'opponent' });
    expect(struck.duration).toBeCloseTo(hit + 1.2 + s.blend + s.rest);
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

  it('stages the parry against an attacker whose own heavy melee lands on the catch and who kneels through the stun', () => {
    const data = resolveMovementGameData(heroes, abilities, ['lash'])!;
    // The attacker swings Lash's heavy melee in this fixture: its 0.31 s lunge comes before the blow
    const attackerData = resolveMovementGameData(heroes, abilities, ['lash'])!;
    const parryDurations = new Map([[MOVEMENT_CLIPS.parry, 0.6], [MOVEMENT_CLIPS.parrySuccess, 0.8]]);
    const attacker = new Map([[MOVEMENT_CLIPS.charge, 0.5], [MOVEMENT_CLIPS.lunge, 0.4], [MOVEMENT_CLIPS.punch, 0.67],
      [MOVEMENT_CLIPS.knockdownStart, 0.5], [MOVEMENT_CLIPS.knockdownLoop, 0.8]]);
    const timeline = buildMovementTimeline({ kind: 'parry', data, clipDurations: parryDurations, fallbackMeleeAttachment: null,
      actorClipDurations: new Map([['opponent', attacker]]), actorData: new Map([['opponent', attackerData]]) })!;
    const s = MOVEMENT_STAGING;
    const lunge = attackerData.melee!.lunge!.duration;
    // The wind up and lunge are longer than the parry is up before the catch: the parry waits for them
    const start = s.leadIn + 0.5 + lunge - s.parryCatchAfter;
    const caught = start + s.parryCatchAfter;
    const released = caught - lunge;
    const knocked = caught + s.parryBlowShown;
    const stunEnd = caught + s.parryStunShownMax;
    // It starts a lunge back from where its blow lands and closes in over the lunge (its own m_MovementSpeedCurve),
    // the hero standing still: at the catch it is at reach, and kneels and gets up there
    const distance = attackerData.melee!.lunge!.distance;
    expect(timeline.actors).toEqual([{ id: 'opponent', hero: s.opponent.hero, position: [s.opponent.reach + distance, 0, 0], yaw: Math.PI }]);
    expect(timeline.travel).toEqual([{ actor: 'opponent', start: released, duration: lunge, distance, profile: attackerData.melee!.lunge!.profile }]);
    const opponent = timeline.actors![0];
    expect(actorAt(timeline, opponent, released).position[0]).toBeCloseTo(s.opponent.reach + distance);
    expect(actorAt(timeline, opponent, caught).position[0]).toBeCloseTo(s.opponent.reach);
    expect(actorAt(timeline, opponent, stunEnd).position[0]).toBeCloseTo(s.opponent.reach);
    expect(travelAt(timeline, caught)).toBe(0);
    expect(actorShiftAt(timeline, opponent, caught)).toEqual([expect.closeTo(-distance), expect.closeTo(0), 0]);
    const round = (clips: typeof timeline.clips) => clips.map(({ clip, start, end, actor }) => [clip, +start.toFixed(3), +end.toFixed(3), actor ?? 'hero']);
    expect(round(timeline.clips)).toEqual(round([
      { clip: MOVEMENT_CLIPS.parry, start, end: caught, from: 0 },
      { clip: MOVEMENT_CLIPS.parrySuccess, start: caught, end: caught + 0.8, from: 0 },
      { clip: MOVEMENT_CLIPS.charge, start: released - 0.5, end: released, from: 0, actor: 'opponent' },
      { clip: MOVEMENT_CLIPS.lunge, start: released, end: caught, from: 0, actor: 'opponent' },
      { clip: MOVEMENT_CLIPS.punch, start: caught, end: knocked, from: 0, actor: 'opponent' },
      { clip: MOVEMENT_CLIPS.knockdownStart, start: knocked, end: knocked + 0.5, from: 0, actor: 'opponent' },
      { clip: MOVEMENT_CLIPS.knockdownLoop, start: knocked + 0.5, end: knocked + 1.3, from: 0, actor: 'opponent' },
      { clip: MOVEMENT_CLIPS.knockdownLoop, start: knocked + 1.3, end: stunEnd, from: 0, actor: 'opponent' },
    ]));
    // Up again over the graph's knockdown exit blend once the stun ends
    expect(timeline.clips.at(-1)!.blendOut).toBe(s.parryStunExitBlend);
    expect(clipWeightsAt(timeline, stunEnd + s.parryStunExitBlend / 2, 'opponent').idle).toBeCloseTo(0.5);
    expect(timeline.cues.map((cue) => [cue.label, +cue.start.toFixed(3), cue.actor ?? 'hero'])).toEqual([
      ['heavy melee charge', +(released - 0.5).toFixed(3), 'opponent'],
      ['heavy melee attack', +released.toFixed(3), 'opponent'],
      ['heavy melee swing', +caught.toFixed(3), 'opponent'],
      ['parry', +start.toFixed(3), 'hero'],
      ['parry success', +caught.toFixed(3), 'hero'],
      ['stunned indicator', +caught.toFixed(3), 'opponent'],
      ['parried stun', +caught.toFixed(3), 'opponent'],
    ]);
    // The game's stunned indicator on the attacker, for the stun: on its origin, its orbit at the measured height over `aim`
    const indicator = timeline.cues.find((cue) => cue.label === 'stunned indicator')!;
    expect(indicator.system).toBe('particles/modifiers/stunned.vpcf');
    expect(indicator.stop).toEqual({ at: stunEnd, endCap: true });
    expect(indicator.controlPoints).toEqual([{ cp: 0, kind: 'origin', follow: true }, { cp: 2, kind: 'height', attachment: 'aim', above: 64.7, per: 140 }]);
    // A parried blow does not land: no impact
    expect(timeline.cues.some((cue) => cue.label === 'heavy melee impact')).toBe(false);
    // The catch's spiral centres on the attacker; the stun binds to its model by its own configuration
    const success = timeline.cues.find((cue) => cue.label === 'parry success')!;
    expect(success.controlPoints[1]).toEqual({ cp: 1, kind: 'attachment', attachment: 'ability_apply', follow: true, actor: 'opponent' });
    expect(timeline.cues.find((cue) => cue.label === 'parried stun')!.stop).toEqual({ at: stunEnd, endCap: true });
    expect(timeline.duration).toBeCloseTo(stunEnd + s.parryStunExitBlend + s.rest);
    expect(buildMovementTimeline({ kind: 'parry', data: { ...data, parry: null }, clipDurations: parryDurations, fallbackMeleeAttachment: null })).toBeNull();
  });

  it('blends the clip before a clip the attacker lacks into the one after', () => {
    const data = resolveMovementGameData(heroes, abilities, ['lash'])!;
    const s = MOVEMENT_STAGING;
    // No lunge data here, and no hit clip: the wind up blends into the idle pose
    const attacker = new Map([[MOVEMENT_CLIPS.charge, 0.5]]);
    const timeline = buildMovementTimeline({ kind: 'parry', data, clipDurations: new Map(), fallbackMeleeAttachment: null,
      actorClipDurations: new Map([['opponent', attacker]]) })!;
    const of = (name: string) => timeline.clips.filter((clip) => clip.clip === name && clip.actor === 'opponent');
    expect(of(MOVEMENT_CLIPS.punch)).toEqual([]);
    expect(of(MOVEMENT_CLIPS.charge)).toHaveLength(1);
    expect(timeline.notes).toContain(`The attacker has no ${MOVEMENT_CLIPS.punch} clip: the clip before it blends into the next.`);
    expect(s.parryStunPose).toBe('medium knockdown');
  });

  it('holds the last pose of the knockdown start for the stun when the attacker has no knockdown loop', () => {
    const data = resolveMovementGameData(heroes, abilities, ['lash'])!;
    const s = MOVEMENT_STAGING;
    const attacker = new Map([[MOVEMENT_CLIPS.charge, 0.5], [MOVEMENT_CLIPS.punch, 0.67], [MOVEMENT_CLIPS.knockdownStart, 0.4]]);
    const timeline = buildMovementTimeline({ kind: 'parry', data, clipDurations: new Map(), fallbackMeleeAttachment: null,
      actorClipDurations: new Map([['opponent', attacker]]) })!;
    const caught = s.leadIn + 0.5;
    const down = timeline.clips.find((clip) => clip.clip === MOVEMENT_CLIPS.knockdownStart)!;
    expect(down.start).toBeCloseTo(caught + s.parryBlowShown);
    expect(down.end).toBeCloseTo(caught + s.parryStunShownMax);
    expect(down.blendOut).toBe(s.parryStunExitBlend);
    expect(timeline.clips.some((clip) => clip.clip === MOVEMENT_CLIPS.knockdownLoop)).toBe(false);
    expect(timeline.notes).toContain(`The attacker has no ${MOVEMENT_CLIPS.knockdownLoop} clip: the knockdown start holds its last pose.`);
  });

  it('enters the parry success clip where its pose continues the parry', () => {
    const data = resolveMovementGameData(heroes, abilities, ['lash'])!;
    const s = MOVEMENT_STAGING;
    const parryDurations = new Map([[MOVEMENT_CLIPS.parry, 1.1], [MOVEMENT_CLIPS.parrySuccess, 1.1]]);
    const asked: [string, number, string][] = [];
    // A success clip that repeats the parry: continued where the parry has got to
    const timeline = buildMovementTimeline({ kind: 'parry', data, clipDurations: parryDurations, fallbackMeleeAttachment: null,
      continueClip: (from, at, to) => { asked.push([from, at, to]); return at; } })!;
    // Without the attacker's clips its wind up takes the fallback length, and the parry waits for it
    const caught = Math.max(s.leadIn, s.leadIn + s.fallbackClipSeconds.charge - s.parryCatchAfter) + s.parryCatchAfter;
    expect(asked).toEqual([[MOVEMENT_CLIPS.parry, s.parryCatchAfter, MOVEMENT_CLIPS.parrySuccess]]);
    const success = timeline.clips.find((clip) => clip.clip === MOVEMENT_CLIPS.parrySuccess)!;
    expect(success.from).toBeCloseTo(s.parryCatchAfter);
    expect(success.start).toBeCloseTo(caught);
    expect(success.end).toBeCloseTo(caught + 1.1 - s.parryCatchAfter);
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
