// Runs every effect of a hero particle bundle on the hero's pose: the ambient ones for as long as the
// host lives, the animation event ones as the playing clip passes their events. Steps once a frame by
// the frame's time scaled by the viewer's playback speed, as VRF's viewer steps a particle node by the
// scene's timestep. Pure, no graphics: a drawing layer subscribes to the hosts it creates and removes.

import { ParticleModel } from '../model';
import { Matrix4x4, Vector3, f32 } from '../numerics';
import type { ControlPointDefaults } from '../controlPointDefaults';
import type { ParticleDefinitionSource } from '../simulation';
import { bundleDefinitionSource } from './bundleSource';
import type { BundleAttachment, BundleEffect, ParticleBundle } from './bundle';
import { type HostPose, ParticleEffectHost, PosedModelObject } from './effectHost';

/**
 * The longest real time one frame steps, as the viewer's animation mixer clamps it, so a stall does
 * not jump the effects ahead of the pose.
 */
const MAX_FRAME_TIME = 0.1;

export interface HostListener {
  /** A host was created; build its renderer now, before it starts. Return renderer defaults to add, if any. */
  added(host: ParticleEffectHost): ((defaults: ControlPointDefaults) => void) | void;
  removed(host: ParticleEffectHost): void;
}

export interface ClipState {
  name: string;
  /** Seconds into the clip. */
  time: number;
  duration: number;
}

export class HeroParticleHost {
  readonly bundle: ParticleBundle;
  readonly pose: HostPose;
  private readonly model: ParticleModel;
  private readonly modelObject: PosedModelObject;
  private readonly attachments: ReadonlyMap<string, BundleAttachment>;
  private readonly source: ParticleDefinitionSource;
  private readonly listener: HostListener;
  private readonly hosts: ParticleEffectHost[] = [];
  private uptime = 0;
  private clip: { name: string; fraction: number } | null = null;
  /** Effects that failed to build, with why. */
  readonly failures: { effect: BundleEffect; error: string }[] = [];

  constructor(bundle: ParticleBundle, listener: HostListener) {
    this.bundle = bundle;
    this.listener = listener;
    this.model = ParticleModel.deserialize(bundle.model);
    this.pose = { bones: new Array(this.model.skeleton.bones.length), transform: Matrix4x4.identity() };
    this.modelObject = new PosedModelObject(this.model, this.pose);
    this.attachments = new Map(bundle.attachments.map((attachment) => [attachment.name, attachment]));
    this.source = bundleDefinitionSource(bundle);

    for (const effect of bundle.effects) {
      if (effect.clip === undefined) this.create(effect);
    }
  }

  /** The bones of the bundled model, by name, in bone order, for the owner to drive. */
  get boneNames(): string[] {
    return this.model.skeleton.bones.map((bone) => bone.name);
  }

  get activeHosts(): readonly ParticleEffectHost[] {
    return this.hosts;
  }

  private create(effect: BundleEffect): ParticleEffectHost | null {
    try {
      const host = new ParticleEffectHost(effect, { source: this.source, model: this.model, modelObject: this.modelObject, attachments: this.attachments });
      const rendererDefaults = this.listener.added(host);
      if (rendererDefaults) host.addRendererDefaults(rendererDefaults);
      host.start();
      this.hosts.push(host);
      return host;
    } catch (error) {
      this.failures.push({ effect, error: String(error) });
      return null;
    }
  }

  private remove(host: ParticleEffectHost): void {
    this.hosts.splice(this.hosts.indexOf(host), 1);
    this.listener.removed(host);
  }

  /** Reports the clip the viewer plays, for the animation event effects; null when none plays. */
  setClip(state: ClipState | null): void {
    const fraction = state && state.duration > 0 ? Math.min(Math.max(state.time / state.duration, 0), 1) : 0;
    const previous = this.clip;

    if (state === null || previous?.name !== state.name) {
      // A clip change stops the effects that end with their sequence
      for (const host of [...this.hosts]) {
        const clip = host.effect.clip;
        if (clip && clip.name === previous?.name && clip.stopOnClipChange && !host.stopped) host.stop(false, false);
      }

      this.clip = state === null ? null : { name: state.name, fraction };

      if (state !== null) this.passEvents(state.name, -1, fraction);
      return;
    }

    if (fraction >= previous.fraction) {
      this.passEvents(state.name, previous.fraction, fraction);
    } else {
      // The clip looped
      this.passEvents(state.name, previous.fraction, 1);
      this.passEvents(state.name, -1, fraction);
    }

    previous.fraction = fraction;
  }

  /** Creates and stops the event effects of `clip` whose times fall in (from, to]. */
  private passEvents(clip: string, from: number, to: number): void {
    for (const effect of this.bundle.effects) {
      const events = effect.clip;
      if (events === undefined || events.name !== clip) continue;

      for (const stop of events.stops) {
        if (stop.time > from && stop.time <= to) {
          for (const host of this.hosts) {
            if (host.effect === effect && !host.stopped) host.stop(stop.immediately, stop.endCap);
          }
        }
      }

      if (events.start > from && events.start <= to) this.create(effect);
    }
  }

  /**
   * Advances the effects by `delta` real seconds at `speed`, unless paused, in one step. A fixed step
   * (the oracle's 1/64 s) ran one step most frames and two now and then at 60 Hz, and none every other
   * frame above 64 Hz, while the pose moved every frame: the effects hitched against the animation.
   */
  update(delta: number, speed: number, paused: boolean, cameraPosition: Vector3): void {
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

