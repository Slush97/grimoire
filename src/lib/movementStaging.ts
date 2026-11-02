import type { MovementFxChoice } from './movementFx';
import type { MovementGameData } from './movementGameData';
import type { EffectCue, EffectTimeline, TimelineClip } from './particles/host/effectTimeline';

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
   * impact only when the blow connects, where the trace meets the target; the preview has no target
   * and stages it as on a hit, since a recolour mod changes the impact too.
   */
  impactAt: 'melee attachment at the swing',
  /** The dash effect stops, with its end cap, when the dash's travel ends (EAirDashDuration). */
  dashStopsWithEndCap: true,
  /**
   * The dash effect's control point 2 (which way the dash goes, set from code in game) is the end of
   * the dash, straight ahead: control point 10 turns toward it once, the rings and streaks take its
   * frame.
   */
  dashTarget: 'end of the dash, straight ahead',
  /**
   * The view: the dash is seen from the side (a quarter turn), so the trail runs across the screen;
   * the heavy melee from the front, turned 30 degrees toward the striking side, so the wind up does
   * not hide the charged fist behind the body and the lunge and impact read in depth. The camera follows
   * the hero as the game's does: the hero stays in frame and the world moves past.
   */
  yaw: { dash: Math.PI / 2, 'heavy-melee': -Math.PI / 6 },
  /** Clip lengths for heroes without the clip, seconds: the median of the heroes that have it. */
  fallbackClipSeconds: { charge: 0.5, punch: 0.67, dash: 1.67 },
} as const;

/** The clips a movement preview plays, as the movement bundle names them (selectMovementClips). */
export const MOVEMENT_CLIPS = { charge: 'movement_charge', lunge: 'movement_lunge', punch: 'movement_punch', dash: 'movement_dash' } as const;

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
}

/** The effect timeline of a movement preview, or null when the game data names no effect for it. */
export function buildMovementTimeline({ kind, data, clipDurations, fallbackMeleeAttachment }: MovementStagingInput): EffectTimeline | null {
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
    const attachment = melee.attachment ?? fallbackMeleeAttachment;
    const attachmentEvidence = melee.attachment ? `abilities.vdata ${melee.ability}.m_strEffectsAttachName` : 'the charge effect\'s preview configuration (the ability names no attachment)';
    const onHand = attachment ? [{ cp: 1, kind: 'attachment' as const, attachment, follow: true }] : [];
    const atHand = attachment ? [{ cp: 0, kind: 'attachment' as const, attachment, follow: false, facing: 'model' as const }] : [];
    const onHero = [{ cp: 0, kind: 'origin' as const, follow: false }];

    const chargeStart = s.leadIn;
    const attackStart = chargeStart + clip(MOVEMENT_CLIPS.charge, chargeStart, s.fallbackClipSeconds.charge);
    const lunge = melee.lunge ?? { duration: 0, distance: 0, profile: [] };
    // The lunge clip plays for as long as the attack carries the hero forward (m_MovementSpeedCurve)
    const lungeDuration = clipDurations.has(MOVEMENT_CLIPS.lunge) ? lunge.duration : 0;
    if (lungeDuration > 0) clips.push({ clip: MOVEMENT_CLIPS.lunge, start: attackStart, end: attackStart + lungeDuration, from: 0 });
    const hit = attackStart + lunge.duration;
    const end = hit + clip(MOVEMENT_CLIPS.punch, hit, s.fallbackClipSeconds.punch);

    if (melee.holdBegin) {
      cues.push({
        label: 'heavy melee charge', system: melee.holdBegin, start: chargeStart, stop: { at: attackStart, endCap: s.chargeStopsWithEndCap },
        configuration: 'preview', controlPoints: onHand,
        evidence: [`abilities.vdata ${melee.ability}.m_HoldBeginEffect`, attachmentEvidence, 'MOVEMENT_STAGING.heldFor', 'MOVEMENT_STAGING.chargeStopsWithEndCap'],
      });
    }
    if (melee.attack) {
      cues.push({
        label: 'heavy melee attack', system: melee.attack, start: attackStart, stop: null, configuration: 'preview', controlPoints: onHand,
        evidence: [`abilities.vdata ${melee.ability}.m_mapAttacks.EAttackType_Heavy.m_MeleeAttackParticle`, attachmentEvidence],
      });
    }
    if (melee.swing) {
      cues.push({
        label: 'heavy melee swing', system: melee.swing, start: hit, stop: null, configuration: 'preview', controlPoints: onHero,
        evidence: [`abilities.vdata ${melee.ability}.m_mapAttacks.EAttackType_Heavy.m_MeleeSwingParticle`, 'MOVEMENT_STAGING.swingAt', 'MOVEMENT_STAGING.swingOn'],
      });
    }
    if (melee.impact) {
      cues.push({
        label: 'heavy melee impact', system: melee.impact, start: hit, stop: null, configuration: 'preview', controlPoints: atHand,
        evidence: [`abilities.vdata ${melee.ability}.m_mapAttacks.EAttackType_Heavy.m_MeleeImpactParticle`, 'MOVEMENT_STAGING.swingAt', 'MOVEMENT_STAGING.impactAt'],
      });
    }

    return {
      duration: end + s.rest, clips, cues, notes, yaw: s.yaw['heavy-melee'], blend: s.blend,
      travel: lunge.distance > 0 ? [{ start: attackStart, duration: lunge.duration, distance: lunge.distance, profile: lunge.profile }] : [],
    };
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
