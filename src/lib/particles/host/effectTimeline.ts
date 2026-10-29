// Stages effects against a hero's animation the way the game's code would spawn them: a timeline of
// the clips the rig plays, the effects that start and stop at given moments with control points on the
// rig or at staged points of the world, and how far the hero has travelled. Pure, no graphics: the
// player runs each effect on the faithful runtime (ParticleEffectHost) and tells a drawing layer which
// hosts to draw, as HeroParticleHost does for a hero's ambient effects.
//
// The timeline itself is data. Movement previews build one from the game's vdata and the hero's clips
// (src/lib/movementStaging.ts); an ability cast preview builds one the same way from its ability.

import { ParticleModel } from '../model';
import { Matrix4x4, Vector3, f32 } from '../numerics';
import type { ParticleDefinitionSource } from '../simulation';
import { createTranslation } from '../model';
import { bundleDefinitionSource } from './bundleSource';
import { type BundleAttachment, type BundleEffect, type ParticleBundle, type StagedControlPoint, bundleSystemKey } from './bundle';
import { getArray, getString, isCollection } from '../kv';
import { type HostPose, ParticleEffectHost, PosedModelObject } from './effectHost';
import type { HostListener } from './heroParticleHost';

/** The longest real time one frame steps, as the viewer's mixer clamps it. */
const MAX_FRAME_TIME = 0.1;

/** A clip the rig plays over part of the timeline, from `from` seconds into the clip. */
export interface TimelineClip {
  /** The clip as the viewer names it (`movement_charge`). */
  clip: string;
  start: number;
  end: number;
  from: number;
}

/** One effect: when it starts and stops, how it is bound and where the stage puts its control points. */
export interface EffectCue {
  /** What it stands for, for review (`heavy melee charge`). */
  label: string;
  /** The root system, `particles/...vpcf`. */
  system: string;
  start: number;
  /** When emission stops, with the end cap or not; an effect without one plays out by itself. */
  stop: { at: number; endCap: boolean } | null;
  /** The control point configuration to bind by (`preview`, else VRF's pick). */
  configuration: string | null;
  controlPoints: StagedControlPoint[];
  /** Where each choice came from: a vdata field, a clip event, the staging table. */
  evidence: string[];
}

/** The hero moving forward (model +X) over part of the timeline. */
export interface TimelineTravel {
  start: number;
  duration: number;
  /** Inches. */
  distance: number;
  /** The fraction of the distance covered at evenly spaced times, 0 to 1 (linear when empty). */
  profile: number[];
}

export interface EffectTimeline {
  duration: number;
  clips: TimelineClip[];
  cues: EffectCue[];
  travel: TimelineTravel[];
  /** The rig's turn about its up axis, radians, for the view (a staging choice). */
  yaw: number;
  /** How long a clip blends in and out, seconds. */
  blend: number;
  notes: string[];
}

/** The time into one run of a timeline, looping or held at its end. */
export function timelineTime(timeline: EffectTimeline, elapsed: number, loop: boolean): number {
  return loop ? elapsed % timeline.duration : Math.min(elapsed, timeline.duration);
}

/** How far the hero has travelled at `time`, inches along model +X. */
export function travelAt(timeline: EffectTimeline, time: number): number {
  let distance = 0;

  for (const leg of timeline.travel) {
    const t = Math.min(Math.max((time - leg.start) / Math.max(leg.duration, 1e-6), 0), 1);
    let fraction = t;

    if (leg.profile.length >= 2) {
      const at = t * (leg.profile.length - 1);
      const i = Math.min(Math.floor(at), leg.profile.length - 2);
      fraction = leg.profile[i] + (leg.profile[i + 1] - leg.profile[i]) * (at - i);
    }

    distance += leg.distance * fraction;
  }

  return distance;
}

/**
 * What the rig plays at `time`: each clip of the timeline with its weight (blending in and out over
 * `blend` seconds, a clip that starts where another ends taking over without a gap) and its time, and
 * the weight left for the idle pose.
 */
export function clipWeightsAt(timeline: EffectTimeline, time: number): { clips: { clip: string; weight: number; time: number }[]; idle: number } {
  const blend = Math.max(timeline.blend, 1e-6);
  const clips = timeline.clips.map((segment) => {
    const fadeIn = timeline.clips.some((other) => other !== segment && Math.abs(other.end - segment.start) < 1e-6)
      ? 1 : Math.min(Math.max((time - segment.start) / blend, 0), 1);
    const fadeOut = timeline.clips.some((other) => other !== segment && Math.abs(other.start - segment.end) < 1e-6)
      ? (time < segment.end ? 1 : 0) : Math.min(Math.max((segment.end + blend - time) / blend, 0), 1);
    const weight = time < segment.start ? 0 : Math.min(fadeIn, fadeOut);
    return { clip: segment.clip, weight, time: segment.from + Math.max(0, time - segment.start) };
  });
  const total = clips.reduce((sum, clip) => sum + clip.weight, 0);
  const scale = total > 1 ? 1 / total : 1;
  return { clips: clips.map((clip) => ({ ...clip, weight: clip.weight * scale })), idle: Math.max(0, 1 - total * scale) };
}

/** The effect a cue runs, as the bundle's effects describe one. */
function cueEffect(cue: EffectCue, index: number): BundleEffect {
  return {
    id: `cue-${index}`,
    system: cue.system,
    source: 'anim-event',
    evidence: cue.evidence.join('; '),
    configuration: cue.configuration,
    attachment: null,
    attachmentCp1: null,
    controlPoints: cue.controlPoints,
  };
}

/**
 * Runs an effect timeline on a hero bundle's model. The owner drives the rig, reads its bone poses into
 * `pose` every frame and calls `update` with the timeline's time; a time that goes back (a loop or a
 * replay) starts the timeline over, dropping every effect.
 */
export class EffectTimelinePlayer {
  readonly pose: HostPose;
  readonly timeline: EffectTimeline;
  private readonly model: ParticleModel;
  private readonly modelObject: PosedModelObject;
  private readonly attachments: ReadonlyMap<string, BundleAttachment>;
  private readonly source: ParticleDefinitionSource;
  private readonly listener: HostListener;
  private readonly effects: BundleEffect[];
  private readonly hosts: ParticleEffectHost[] = [];
  private time: number | null = null;
  private uptime = 0;
  /** Cues that failed to start, with why. */
  readonly failures: { cue: EffectCue; error: string }[] = [];

  constructor(bundle: ParticleBundle, timeline: EffectTimeline, listener: HostListener) {
    this.timeline = timeline;
    this.listener = listener;
    this.model = ParticleModel.deserialize(bundle.model);
    this.pose = { bones: new Array(this.model.skeleton.bones.length), transform: Matrix4x4.identity() };
    this.modelObject = new PosedModelObject(this.model, this.pose);
    this.attachments = new Map(bundle.attachments.map((attachment) => [attachment.name, attachment]));
    this.source = bundleDefinitionSource(bundle);
    this.effects = timeline.cues.map(cueEffect);
  }

  /** The bones of the bundled model, by name, in bone order, for the owner to drive. */
  get boneNames(): string[] {
    return this.model.skeleton.bones.map((bone) => bone.name);
  }

  get activeHosts(): readonly ParticleEffectHost[] {
    return this.hosts;
  }

  /** How far the hero has travelled at the current time, inches along model +X. */
  get travel(): number {
    return this.time === null ? 0 : travelAt(this.timeline, this.time);
  }

  private create(index: number): void {
    const cue = this.timeline.cues[index];

    try {
      const host = new ParticleEffectHost(this.effects[index], { source: this.source, model: this.model, modelObject: this.modelObject, attachments: this.attachments });
      const rendererDefaults = this.listener.added(host);
      if (rendererDefaults) host.addRendererDefaults(rendererDefaults);
      host.start();
      this.hosts.push(host);
    } catch (error) {
      this.failures.push({ cue, error: String(error) });
    }
  }

  private remove(host: ParticleEffectHost): void {
    this.hosts.splice(this.hosts.indexOf(host), 1);
    this.listener.removed(host);
  }

  /**
   * Moves the timeline to `time` (seconds): places the hero at its travel, starts and stops the cues
   * passed since the last call, and steps every running effect by the frame time at `speed`.
   */
  update(time: number, delta: number, speed: number, paused: boolean, cameraPosition: Vector3): void {
    if (this.time !== null && time < this.time - 1e-6) {
      for (const host of [...this.hosts]) this.remove(host);
      this.time = null;
    }

    const from = this.time ?? -Infinity;
    this.pose.transform = createTranslation(new Vector3(travelAt(this.timeline, time), 0, 0));

    this.timeline.cues.forEach((cue, index) => {
      if (cue.stop && cue.stop.at > from && cue.stop.at <= time) {
        for (const host of this.hosts) {
          if (host.effect === this.effects[index] && !host.stopped) host.stop(false, cue.stop.endCap);
        }
      }
    });

    this.timeline.cues.forEach((cue, index) => {
      if (cue.start > from && cue.start <= time) this.create(index);
    });

    this.time = time;

    for (const host of this.hosts) host.place();

    if (paused) return;

    const frameTime = f32(Math.min(Math.max(delta, 0), MAX_FRAME_TIME) * Math.max(speed, 0));

    if (frameTime > 0) {
      this.uptime = f32(this.uptime + frameTime);
      for (const host of this.hosts) host.step(frameTime, this.uptime, cameraPosition);
    }

    for (const host of [...this.hosts]) {
      if (host.done || (!host.loop && host.simulation.isFinished())) this.remove(host);
    }
  }

  dispose(): void {
    for (const host of [...this.hosts]) this.remove(host);
  }
}

/**
 * The attachment a system's control point configuration (`preview` by default) puts `cp` on, when a
 * driver puts it on a point: what the effect's author previewed it on. Null when none does.
 */
export function configurationAttachment(bundle: ParticleBundle, system: string | null, cp: number, configuration = 'preview'): string | null {
  const data = system === null ? undefined : bundle.systems[bundleSystemKey(system)]?.data;
  const configurations = Array.isArray(data?.m_controlPointConfigurations) ? data.m_controlPointConfigurations : [];

  for (const entry of configurations) {
    if (!isCollection(entry) || (getString(entry, 'm_name') ?? '').toLowerCase() !== configuration) continue;

    for (const driver of (getArray(entry, 'm_drivers') ?? []).filter(isCollection)) {
      const type = String(driver.m_iAttachType ?? '');
      const name = getString(driver, 'm_attachmentName') ?? '';
      if ((Number(driver.m_iControlPoint ?? 0) | 0) === cp && /PATTACH_POINT/.test(type) && name !== '') return name;
    }
  }

  return null;
}
