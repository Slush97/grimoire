import type { MovementFxChoice } from './movementFx';
import type { MovementGameData } from './movementGameData';
import type { EffectCue, EffectTimeline, TimelineActor, TimelineActorId, TimelineClip } from './particles/host/effectTimeline';
import type { StagedControlPoint } from './particles/host/bundle';

/**
 * Every staging choice the game data does not make, in one place. The game spawns these effects from
 * code, on input the preview does not have (how long the button is held, where the target stands, which
 * way the player dashes), so the preview picks. Each entry says why.
 */
export const MOVEMENT_STAGING = {
  /** Seconds of idle before the action, so the loop reads as a start. */
  leadIn: 0.35,
  /** Seconds of idle after the last clip ends, before the loop starts over. */
  rest: 0.6,
  /** How long a clip blends in and out of the idle pose, seconds. */
  blend: 0.12,
  /**
   * The heavy melee is held for exactly the length of the hero's charge clip (melee_start): the game
   * attacks when the button is released, any time after the wind up, and the clip is the wind up.
   */
  heldFor: 'charge clip',
  /**
   * The charge effect stops, with its end cap, when the attack starts: the hold ends there. The game
   * code that stops m_HoldBeginEffect is not data.
   */
  chargeStopsWithEndCap: true,
  /**
   * The swing and impact effects start with the hit clip (melee_hit), whose first frame carries the
   * AE_TAGGED_SOUND `melee_swing_charged` event: that is when the blow lands.
   */
  swingAt: 'hit clip start',
  /**
   * The swing effect stands on the hero, facing as the hero faces, where the hero is when it starts:
   * it is authored in the hero's frame (its preview configuration puts control point 0 on the hero
   * with no attachment; its distortion sits 100 in ahead and 60 in up, its smoke runs ahead along the
   * floor). The game spawns it on the attacker.
   */
  swingOn: 'hero origin at the swing',
  /**
   * Where the blow lands: the melee effects attachment as it stands when the swing starts (the fist,
   * foot or weapon tip the ability names), not following it after, facing as the hero faces (its
   * preview configuration puts control point 0 at the world origin with no angles). The game plays the
   * impact only when the blow connects, where the trace meets the target; without a target the preview
   * stages it as on a hit, since a recolour mod changes the impact too. With the target staged it plays
   * on the target's ability_apply attachment (where the game applies effects to a hero), facing as the
   * striking hero faces.
   */
  impactAt: 'target ability_apply at the swing',
  /** The dash effect stops, with its end cap, when the dash's travel ends (EAirDashDuration). */
  dashStopsWithEndCap: true,
  /**
   * The dash effect's control point 2 (which way the dash goes, set from code in game) is the end of
   * the dash, straight ahead: control point 10 turns toward it once, the rings and streaks take its
   * frame.
   */
  dashTarget: 'end of the dash, straight ahead',
  /**
   * The view: the dash is seen from the side (a quarter turn), so the trail runs across the screen. The
   * heavy melee and the parry are seen from the side too: the other hero stands straight ahead (the
   * target the blow lands on, the attacker the parry catches), and from the front it would stand between
   * the hero and the camera. The camera follows the hero as the game's does: the
   * hero stays in frame and the world moves past.
   */
  yaw: { dash: Math.PI / 2, 'heavy-melee': Math.PI / 2, parry: Math.PI / 2 },
  /** Clip lengths for heroes without the clip, seconds: the median of the heroes that have it. */
  fallbackClipSeconds: { charge: 0.5, punch: 0.67, dash: 1.67, parry: 0.6, parrySuccess: 0.8, knockdownStart: 0.5, knockdownLoop: 1 },
  /**
   * The other hero a movement preview needs: the attacker a parry catches, the target a heavy melee
   * strikes. The same hero for every previewed hero (the user's pick), so the previews read the same
   * everywhere, vanilla. It stands straight ahead of the hero, facing it, `reach` inches apart when the
   * blow lands (a hero's length and a half in the in-game references).
   */
  opponent: { hero: 'Bebop', reach: 90 },
  /**
   * The heavy melee's target stands where the lunge carries the hero (its m_MovementSpeedCurve distance)
   * plus the opponent's reach, still in the world: the hero closes on it, and the charged blow lands on it
   * at the hit.
   */
  meleeTargetAt: 'lunge distance plus reach',
  /**
   * The target's hit reaction: the flinch for a blow from the front (hero_flinch.vnmgraph plays
   * flinch_back when its flinch is `back`, cutting in and back out with no blend). The graph plays it
   * as an additive layer; the preview plays its non-additive companion clip, which Valve ships beside it
   * (flinch_back.vnmclip+non_additive), over the idle pose. Game code picks the direction, not data.
   */
  meleeHitReaction: 'flinch_back',
  /**
   * How long the parried blow shows before the attacker goes down: the references catch the attacker
   * mid swing for about a frame at 6 Hz, then it drops.
   */
  parryBlowShown: 0.15,
  /**
   * The parried attacker drops to one knee for the stun: the medium knockdown. No hero graph has a stun
   * state, and knockdowns are entered by the knockdown_* actions game code sets, so the size is from the
   * references (Bebop and Infernus on one knee, 2026-11-08). Its graph (hero_knockdown.vnmgraph) plays
   * knockdown_medium_start (a hero's knockdown_medium_intro), cuts to the looping knockdown_medium_loop
   * when it completes, and has no get up: the hero leaves the knockdown for player control
   * (hero.vnmgraph, Knockdown to PlayerControl) blending over parryStunExitBlend when the stun ends.
   */
  parryStunPose: 'medium knockdown',
  /** hero.vnmgraph's Knockdown to PlayerControl transition, seconds. */
  parryStunExitBlend: 0.2,
  /**
   * The parry catches a blow this long after it goes up: inside the parry, as any parried melee lands.
   * The game parries whatever melee arrives while it is up; the preview has no attacker and picks one.
   */
  parryCatchAfter: 0.3,
  /**
   * The parry success clip takes over at the catch where its pose continues the parry's. The game's graph
   * (hero_parry.vnmgraph, Parry to Parry_Success) cuts to it with no blend, no time offset and no sync,
   * which suits heroes whose success clip starts from the held guard (Abrams': 3 degrees from it). Some
   * heroes' success clip repeats their whole parry from the rest pose (Lash's matches his parry frame for
   * frame), and entering it at its start would raise the guard a second time, which the game recordings
   * do not show: the clip is entered at the time whose pose best matches the parry's at the catch.
   */
  parrySuccessFrom: 'pose continuing the parry',
  /**
   * The active parry effect stops, with its end cap, when the blow is caught: the parry ends there. The
   * game code that removes the parry modifier is not data.
   */
  parryStopsWithEndCap: true,
  /**
   * The successful parry's control point 1 (its spiral's centre, `ability_apply` in its preview
   * configuration) is on the attacker: the references centre the spiral on the parried hero.
   */
  parrySuccessOn: 'attacker ability_apply',
  /**
   * The game's stunned indicator plays on the stunned attacker for the stun: game code adds it for any stun
   * (the parry's data does not name it). client.dll names particles/modifiers/stunned.vpcf, the parent of
   * the star (stunned_orbit), its tilted ring (stunned_orbit_halo), the burst and the dust. The parent puts
   * the orbit's centre (control point 10) control point 2's x times 140 in over control point 0 (the hero's
   * origin) and tilts it 20 degrees. Game code sets control point 2; no data names its value.
   * Measured in recording 020805 (frames 2,0 and 2,2 of tile_020805_stun.png), with the parried stun's "!"
   * as the ruler (data places it on the hero's `aim` attachment): the orbit's centre sits half the "!"'s
   * height below its bottom, about 11 in by the ring's 30 in width (its radius is 15), and about 42 in over
   * Bebop's head. At x 1 (140 in) ours sat level with the "!"'s bottom, so the centre comes down 11 in to
   * 129 in, which is `above` inches over `aim` (64.3 in on Bebop). Staged on `aim`, so another opponent keeps
   * the measured gap to its "!". It plays as the game ships it: the parry recolour bakes only melee_parry systems.
   */
  parryStunIndicator: { system: 'particles/modifiers/stunned.vpcf', heightOver: { attachment: 'aim', above: 64.7, per: 140 } },
  /** The stun shows for ParriedStunTime, cut to this many seconds so the loop comes round. */
  parryStunShownMax: 1.5,
} as const;

/** The clips a movement preview plays, as the movement bundle names them (selectMovementClips). */
export const MOVEMENT_CLIPS = {
  charge: 'movement_charge', lunge: 'movement_lunge', punch: 'movement_punch', dash: 'movement_dash',
  parry: 'movement_parry', parrySuccess: 'movement_parrySuccess',
  knockdownStart: 'movement_knockdownStart', knockdownLoop: 'movement_knockdownLoop', hitReaction: 'movement_hitReaction',
} as const;

export interface MovementStagingInput {
  kind: MovementFxChoice['kind'];
  data: MovementGameData;
  /** The duration of each movement clip the hero has, by viewer name. */
  clipDurations: ReadonlyMap<string, number>;
  /**
   * The attachment the melee effects play on when the ability names none: the one the charge effect's
   * own preview configuration names for its control point 1 (the mannequin's palm).
   */
  fallbackMeleeAttachment: string | null;
  /** The duration of each movement clip a staged actor has, by actor id and viewer name. */
  actorClipDurations?: ReadonlyMap<string, ReadonlyMap<string, number>>;
  /** A staged actor's own movement data (the attacker's heavy melee), by actor id. */
  actorData?: ReadonlyMap<string, MovementGameData>;
  /** Where `to` continues the pose `from` holds at `fromTime` (matchingClipTime); its start when absent. */
  continueClip?: (from: string, fromTime: number, to: string) => number;
}

/**
 * The actor a movement preview stages beside the hero, if any: the parried attacker, or the heavy melee's
 * target. Its place takes the hero's movement data (the lunge); without it, it stands at its reach.
 */
export function movementActors(kind: MovementFxChoice['kind'], data?: MovementGameData, opponent?: MovementGameData): TimelineActor[] {
  if (kind === 'dash') return [];
  const { hero, reach } = MOVEMENT_STAGING.opponent;
  // A heavy melee's target stands where the hero's lunge ends, a parried attacker starts its own lunge back
  // from where its blow lands (each heavy melee's m_MovementSpeedCurve)
  const ahead = reach + ((kind === 'heavy-melee' ? data : opponent)?.melee?.lunge?.distance ?? 0);
  return [{ id: 'opponent', hero, position: [ahead, 0, 0], yaw: Math.PI }];
}

/**
 * A heavy melee's effects, on whoever swings it: the charge on the melee attachment while the wind up
 * is held, the attack at release, the swing at the hit, and the impact where the blow lands when it
 * lands (`impact`). `actor` binds them to a staged actor's model instead of the hero's.
 */
function heavyMeleeCues(melee: NonNullable<MovementGameData['melee']>, fallbackAttachment: string | null,
  { chargeStart, attackStart, hit }: { chargeStart: number; attackStart: number; hit: number },
  { impact, actor, impactAt }: { impact: boolean; actor?: TimelineActorId; impactAt?: StagedControlPoint[] }): EffectCue[] {
  const s = MOVEMENT_STAGING;
  const attachment = melee.attachment ?? fallbackAttachment;
  const attachmentEvidence = melee.attachment ? `abilities.vdata ${melee.ability}.m_strEffectsAttachName` : 'the charge effect\'s preview configuration (the ability names no attachment)';
  const onHand = attachment ? [{ cp: 1, kind: 'attachment' as const, attachment, follow: true }] : [];
  const atHand = attachment ? [{ cp: 0, kind: 'attachment' as const, attachment, follow: false, facing: 'model' as const }] : [];
  const onSwinger = [{ cp: 0, kind: 'origin' as const, follow: false }];
  const cues: EffectCue[] = [];
  const on = actor ? { actor } : {};
  if (melee.holdBegin) {
    cues.push({
      label: 'heavy melee charge', system: melee.holdBegin, start: chargeStart, stop: { at: attackStart, endCap: s.chargeStopsWithEndCap },
      configuration: 'preview', controlPoints: onHand, ...on,
      evidence: [`abilities.vdata ${melee.ability}.m_HoldBeginEffect`, attachmentEvidence, 'MOVEMENT_STAGING.heldFor', 'MOVEMENT_STAGING.chargeStopsWithEndCap'],
    });
  }
  if (melee.attack) {
    cues.push({
      label: 'heavy melee attack', system: melee.attack, start: attackStart, stop: null, configuration: 'preview', controlPoints: onHand, ...on,
      evidence: [`abilities.vdata ${melee.ability}.m_mapAttacks.EAttackType_Heavy.m_MeleeAttackParticle`, attachmentEvidence],
    });
  }
  if (melee.swing) {
    cues.push({
      label: 'heavy melee swing', system: melee.swing, start: hit, stop: null, configuration: 'preview', controlPoints: onSwinger, ...on,
      evidence: [`abilities.vdata ${melee.ability}.m_mapAttacks.EAttackType_Heavy.m_MeleeSwingParticle`, 'MOVEMENT_STAGING.swingAt', 'MOVEMENT_STAGING.swingOn'],
    });
  }
  if (impact && melee.impact) {
    cues.push({
      label: 'heavy melee impact', system: melee.impact, start: hit, stop: null, configuration: 'preview', controlPoints: impactAt ?? atHand, ...on,
      evidence: [`abilities.vdata ${melee.ability}.m_mapAttacks.EAttackType_Heavy.m_MeleeImpactParticle`, 'MOVEMENT_STAGING.swingAt', 'MOVEMENT_STAGING.impactAt'],
    });
  }
  return cues;
}

/** The effect timeline of a movement preview, or null when the game data names no effect for it. */
export function buildMovementTimeline({ kind, data, clipDurations, fallbackMeleeAttachment, actorClipDurations, actorData, continueClip }: MovementStagingInput): EffectTimeline | null {
  const s = MOVEMENT_STAGING;
  const clips: TimelineClip[] = [];
  const cues: EffectCue[] = [];
  const notes: string[] = [];
  const clip = (name: string, start: number, fallback: number) => {
    const duration = clipDurations.get(name);
    if (duration === undefined) notes.push(`No ${name} clip: the idle pose holds for ${fallback} s.`);
    else clips.push({ clip: name, start, end: start + duration, from: 0 });
    return duration ?? fallback;
  };

  if (kind === 'heavy-melee') {
    const melee = data.melee;
    if (!melee || (!melee.holdBegin && !melee.attack && !melee.swing && !melee.impact)) return null;
    const chargeStart = s.leadIn;
    const attackStart = chargeStart + clip(MOVEMENT_CLIPS.charge, chargeStart, s.fallbackClipSeconds.charge);
    const lunge = melee.lunge ?? { duration: 0, distance: 0, profile: [] };
    // The lunge clip plays for as long as the attack carries the hero forward (m_MovementSpeedCurve)
    const lungeDuration = clipDurations.has(MOVEMENT_CLIPS.lunge) ? lunge.duration : 0;
    if (lungeDuration > 0) clips.push({ clip: MOVEMENT_CLIPS.lunge, start: attackStart, end: attackStart + lungeDuration, from: 0 });
    const hit = attackStart + lunge.duration;
    const end = hit + clip(MOVEMENT_CLIPS.punch, hit, s.fallbackClipSeconds.punch);

    // The target the blow lands on (meleeTargetAt), with its hit reaction (meleeHitReaction)
    const actors = movementActors(kind, data);
    const target = actorClipDurations?.get('opponent');
    const reaction = target?.get(MOVEMENT_CLIPS.hitReaction);
    if (reaction !== undefined) clips.push({ clip: MOVEMENT_CLIPS.hitReaction, start: hit, end: hit + reaction, from: 0, actor: 'opponent' });
    else if (target) notes.push(`The target has no ${MOVEMENT_CLIPS.hitReaction} clip: its idle pose holds.`);
    const onTarget: StagedControlPoint[] = [{ cp: 0, kind: 'attachment', attachment: 'ability_apply', follow: false, facing: 'owner', actor: 'opponent' }];
    cues.push(...heavyMeleeCues(melee, fallbackMeleeAttachment, { chargeStart, attackStart, hit }, { impact: true, impactAt: onTarget }));

    return {
      duration: Math.max(end, hit + (reaction ?? 0) + s.blend) + s.rest, clips, cues, notes, yaw: s.yaw['heavy-melee'], blend: s.blend, actors,
      travel: lunge.distance > 0 ? [{ start: attackStart, duration: lunge.duration, distance: lunge.distance, profile: lunge.profile }] : [],
    };
  }

  if (kind === 'parry') {
    const parry = data.parry;
    if (!parry || (!parry.active && !parry.success && !parry.victim)) return null;
    const onHero = [{ cp: 0, kind: 'origin' as const, follow: true }];
    const attackerMelee = actorData?.get('opponent')?.melee ?? null;
    const actors = movementActors(kind, data, actorData?.get('opponent'));
    const loaded = actorClipDurations?.get('opponent');
    const attacker = loaded ?? new Map<string, number>();
    // A clip the attacker's rig lacks takes no time when its clips are known (its fallback length when the
    // rig did not load), and the next clip it has blends in over the one before rather than cutting to it
    const length = (name: string, fallback: number) => attacker.get(name) ?? (loaded ? 0 : fallback);
    let previous: TimelineClip | null = null;
    let skipped = false;
    const attackerClip = (name: string, start: number, end: number, from = 0) => {
      if (!attacker.has(name)) { skipped = true; return; }
      if (skipped && previous) previous.end += s.blend;
      skipped = false;
      previous = { clip: name, start, end, from, actor: 'opponent' };
      clips.push(previous);
    };
    const windUp = length(MOVEMENT_CLIPS.charge, s.fallbackClipSeconds.charge);
    // Its heavy melee carries it forward for its lunge before the blow (m_MovementSpeedCurve)
    const lunge = attackerMelee?.lunge?.duration ?? 0;
    // The attacker winds up from the lead in at the earliest, and its blow lands on the catch
    const start = Math.max(s.leadIn, s.leadIn + windUp + lunge - s.parryCatchAfter);
    const caught = start + s.parryCatchAfter;
    // The parry pose holds until the catch, then the success clip takes over
    const parrySeconds = clipDurations.get(MOVEMENT_CLIPS.parry);
    if (parrySeconds === undefined) notes.push(`No ${MOVEMENT_CLIPS.parry} clip: the idle pose holds.`);
    else clips.push({ clip: MOVEMENT_CLIPS.parry, start, end: Math.min(caught, start + parrySeconds), from: 0 });
    const successSeconds = clipDurations.get(MOVEMENT_CLIPS.parrySuccess);
    let end = caught + s.fallbackClipSeconds.parrySuccess;
    if (successSeconds === undefined) notes.push(`No ${MOVEMENT_CLIPS.parrySuccess} clip: the idle pose holds for ${s.fallbackClipSeconds.parrySuccess} s.`);
    else {
      const held = Math.min(s.parryCatchAfter, parrySeconds ?? 0);
      const from = parrySeconds !== undefined && continueClip ? Math.min(continueClip(MOVEMENT_CLIPS.parry, held, MOVEMENT_CLIPS.parrySuccess), successSeconds) : 0;
      end = caught + successSeconds - from;
      clips.push({ clip: MOVEMENT_CLIPS.parrySuccess, start: caught, end, from });
    }
    const stunShown = Math.min(parry.stunSeconds ?? s.parryStunShownMax, s.parryStunShownMax);
    const stunEnd = caught + stunShown;

    // The attacker: wind up, lunge, the blow, down on one knee for the stun, then up (parryStunPose)
    const released = caught - lunge;
    attackerClip(MOVEMENT_CLIPS.charge, released - windUp, released);
    if (lunge > 0) attackerClip(MOVEMENT_CLIPS.lunge, released, caught);
    const knocked = caught + s.parryBlowShown;
    attackerClip(MOVEMENT_CLIPS.punch, caught, knocked);
    const kneel = Math.min(length(MOVEMENT_CLIPS.knockdownStart, s.fallbackClipSeconds.knockdownStart), stunEnd - knocked);
    attackerClip(MOVEMENT_CLIPS.knockdownStart, knocked, knocked + kneel);
    // The loop repeats until the stun ends, its last pass cut there. Without it, the knockdown's start holds
    // its last pose instead (the loop holds the pose the start ends in)
    const hold = attacker.get(MOVEMENT_CLIPS.knockdownLoop);
    const down = clips.at(-1);
    if (hold === undefined && down?.actor === 'opponent' && down.clip === MOVEMENT_CLIPS.knockdownStart) down.end = stunEnd;
    else for (let at = knocked + kneel; at < stunEnd - 1e-3; at += hold ?? s.fallbackClipSeconds.knockdownLoop) {
      attackerClip(MOVEMENT_CLIPS.knockdownLoop, at, Math.min(at + (hold ?? s.fallbackClipSeconds.knockdownLoop), stunEnd));
    }
    // Up again as the graph leaves the knockdown
    const last = clips.at(-1);
    if (last?.actor === 'opponent' && Math.abs(last.end - stunEnd) < 1e-6) last.blendOut = s.parryStunExitBlend;
    for (const name of [MOVEMENT_CLIPS.charge, MOVEMENT_CLIPS.punch, MOVEMENT_CLIPS.knockdownStart, MOVEMENT_CLIPS.knockdownLoop]) {
      if (loaded && !attacker.has(name)) {
        notes.push(name === MOVEMENT_CLIPS.knockdownLoop && attacker.has(MOVEMENT_CLIPS.knockdownStart)
          ? `The attacker has no ${name} clip: the knockdown start holds its last pose.`
          : `The attacker has no ${name} clip: the clip before it blends into the next.`);
      }
    }

    // Its own heavy melee effects, the parried blow's: no impact, since a parried blow does not land (the
    // parry names no impact of its own; the recordings show its success effect at the catch, no melee impact)
    if (attackerMelee) {
      cues.push(...heavyMeleeCues(attackerMelee, fallbackMeleeAttachment, { chargeStart: released - windUp, attackStart: released, hit: caught },
        { impact: false, actor: 'opponent' }));
    }
    if (parry.active) {
      cues.push({
        label: 'parry', system: parry.active, start, stop: { at: caught, endCap: s.parryStopsWithEndCap }, configuration: 'preview', controlPoints: onHero,
        evidence: [`abilities.vdata ${parry.ability}.m_ActiveParryParticle`, 'MOVEMENT_STAGING.parryCatchAfter', 'MOVEMENT_STAGING.parryStopsWithEndCap'],
      });
    }
    if (parry.success) {
      cues.push({
        label: 'parry success', system: parry.success, start: caught, stop: null, configuration: 'preview',
        controlPoints: [...onHero, { cp: 1, kind: 'attachment', attachment: 'ability_apply', follow: true, actor: 'opponent' }],
        evidence: [`abilities.vdata ${parry.ability}.m_SuccessfulParryParticle`, 'MOVEMENT_STAGING.parryCatchAfter', 'MOVEMENT_STAGING.parrySuccessOn'],
      });
    }
    // The game's stunned indicator over the attacker for the stun (parryStunIndicator)
    const indicator = s.parryStunIndicator;
    cues.push({
      label: 'stunned indicator', system: indicator.system, start: caught, stop: { at: stunEnd, endCap: true }, configuration: 'preview', actor: 'opponent',
      controlPoints: [{ cp: 0, kind: 'origin', follow: true }, { cp: 2, kind: 'height', ...indicator.heightOver }],
      evidence: ['MOVEMENT_STAGING.parryStunIndicator', `abilities.vdata ${parry.ability}.ParriedStunTime`, 'MOVEMENT_STAGING.parryStunShownMax'],
    });
    if (parry.victim) {
      // On the attacker: its preview configuration binds it to the model it plays on (control point 0 on `aim`)
      cues.push({
        label: 'parried stun', system: parry.victim, start: caught, stop: { at: stunEnd, endCap: true }, configuration: 'preview',
        controlPoints: [], actor: 'opponent',
        evidence: [`abilities.vdata ${parry.ability}.m_ParryVictimModifier.m_strParticleEffect`, `abilities.vdata ${parry.ability}.ParriedStunTime`,
          'MOVEMENT_STAGING.opponent', 'MOVEMENT_STAGING.parryStunShownMax', 'MOVEMENT_STAGING.parryStunPose'],
      });
    }
    // It closes in over the lunge, as the hero does in its own heavy melee; the stun and the get up stay there
    const attackerLunge = attackerMelee?.lunge;
    const travel = attackerLunge && attackerLunge.distance > 0
      ? [{ actor: 'opponent' as const, start: released, duration: attackerLunge.duration, distance: attackerLunge.distance, profile: attackerLunge.profile }] : [];
    return { duration: Math.max(end, stunEnd + s.parryStunExitBlend) + s.rest, clips, cues, notes, yaw: s.yaw.parry, blend: s.blend, travel, actors };
  }

  const dash = data.dash;
  if (!dash?.particle) return null;
  const start = s.leadIn;
  const end = start + clip(MOVEMENT_CLIPS.dash, start, s.fallbackClipSeconds.dash);
  cues.push({
    label: 'dash', system: dash.particle, start, stop: { at: start + dash.duration, endCap: s.dashStopsWithEndCap }, configuration: 'preview',
    controlPoints: [{ cp: 2, kind: 'world', position: [dash.distance, 0, 0], forward: [1, 0, 0] }],
    evidence: [`abilities.vdata ${dash.ability}.m_DashParticle`, 'heroes.vdata m_mapStartingStats.EAirDashDuration', 'MOVEMENT_STAGING.dashTarget'],
  });

  return {
    duration: Math.max(end, start + dash.duration) + s.rest, clips, cues, notes, yaw: s.yaw.dash, blend: s.blend,
    // m_groundDashPositionCurve is linear: the dash covers its distance evenly
    travel: [{ start, duration: dash.duration, distance: dash.distance, profile: [] }],
  };
}
