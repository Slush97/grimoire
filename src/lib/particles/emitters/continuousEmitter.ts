// Ported from ValveResourceFormat (MIT): ValveResourceFormat/Particles/Emitters/ContinuousEmitter.cs.

import { ParticleEventType } from '../enums';
import { type EmitCallback, ParticleFunctionEmitter } from '../functions';
import { f32 } from '../numerics';
import { CollectionAgeNumberProvider, LiteralNumberProvider, type NumberProvider } from '../numberProviders';
import type { ParticleDefinitionParser } from '../parser';
import type { ParticleSystemSimulation } from '../simulation';
import type { ParticleSystemState } from '../state';
import { SnapshotBinding } from '../utils/snapshotBinding';

const FLUSH_EPSILON = 0.001;

/**
 * C_OP_ContinuousEmitter: emits particles at a rate over time, forever with a duration of 0. With
 * m_bInitFromKilledParentParticles it emits one particle per parent particle event instead.
 */
export class ContinuousEmitter extends ParticleFunctionEmitter {
  private readonly emissionDuration: NumberProvider;
  private readonly startTime: NumberProvider;
  private readonly emitRate: NumberProvider;
  private readonly snapshotBinding: SnapshotBinding;

  /** Scales the rate by the number of control points in use; only read below behavior version 2. */
  private readonly emissionScale: number = 0;

  /** Scales the rate by the parent system's live particle count. */
  private readonly scalePerParentParticle: number;

  private readonly initFromKilledParentParticles: boolean;
  private readonly eventType: number;

  /** Most particles spawned per update when positive. */
  private readonly limitPerUpdate: number;

  private readonly forceEmitOnFirstUpdate: boolean;
  private readonly forceEmitOnLastUpdate: boolean;

  /** False when the rate settles at zero or below. */
  private steadyRateCanBePositive = true;

  /** The age from which a settling rate holds its final value. */
  private steadyTime = 0;

  // The accumulator and counts are double and long in the C#
  private emitAccumulator = 0;
  private emitted = 0;
  private timeBase = 0;
  private duration = 0;
  private windowStart = -1;
  private emitting = true;
  private forcePending = false;

  constructor(parse: ParticleDefinitionParser) {
    super(parse);
    this.emissionDuration = parse.numberProvider('m_flEmissionDuration', new LiteralNumberProvider(0));
    this.startTime = parse.numberProvider('m_flStartTime', new LiteralNumberProvider(0));
    this.emitRate = parse.numberProvider('m_flEmitRate', new LiteralNumberProvider(100));
    this.snapshotBinding = new SnapshotBinding(parse);

    if (parse.behaviorVersion < 2) {
      this.emissionScale = Math.max(0, parse.float('m_flEmissionScale', 0));
    }

    this.scalePerParentParticle = parse.float('m_flScalePerParentParticle', 0);
    this.initFromKilledParentParticles = parse.boolean('m_bInitFromKilledParentParticles', false);
    this.eventType = parse.enum('m_nEventType', ParticleEventType, ParticleEventType.PARTICLE_EVENT_TYPE_MASK_KILLED);
    this.limitPerUpdate = parse.int32('m_nLimitPerUpdate', 0);
    this.forceEmitOnFirstUpdate = parse.boolean('m_bForceEmitOnFirstUpdate', false);
    this.forceEmitOnLastUpdate = parse.boolean('m_bForceEmitOnLastUpdate', false);
  }

  get eventTypeMask(): number {
    return this.initFromKilledParentParticles ? this.eventType : ParticleEventType.PARTICLE_EVENT_TYPE_MASK_NONE;
  }

  /** Whether emission ends: a duration is set, or the rate settles at zero or below. */
  private get isFinite(): boolean {
    return this.duration !== 0 || !this.steadyRateCanBePositive;
  }

  /** How long a finite emitter emits for after its start. */
  private get emitSpan(): number {
    if (this.steadyRateCanBePositive) {
      return this.duration;
    }

    return this.duration === 0 ? this.steadyTime : Math.min(this.duration, this.steadyTime);
  }

  initialize(state: ParticleSystemState): void {
    super.initialize(state);

    this.steadyRateCanBePositive = true;
    this.steadyTime = 0;

    // The settle point is taken as seconds after the start of emission whatever the rate input measures
    const steady = this.emitRate.tryGetSteadyState(state);

    if (steady !== null) {
      this.steadyTime = steady.time;
      this.steadyRateCanBePositive = steady.value > 0;
    }
  }

  reset(): void {
    this.emitAccumulator = 0;
    this.emitted = 0;
    this.timeBase = 0;
    this.windowStart = -1;
    this.emitting = true;
    this.forcePending = false;
  }

  restart(state: ParticleSystemState): void {
    this.duration = this.emissionDuration.nextNumber(state);

    if (!this.isFinite) {
      return;
    }

    this.windowStart = f32(state.age + this.startTime.nextNumber(state));
    this.emitAccumulator = 0;
    this.emitted = 0;
    this.timeBase = state.age;
  }

  startEmission(): void {
    this.emitting = true;
  }

  stopEmission(): void {
    if (this.forceEmitOnLastUpdate) {
      this.forcePending = true;
    }

    this.emitting = false;
  }

  mayCreateMoreParticles(state: ParticleSystemState): boolean {
    if (!this.emitting && !this.forcePending) {
      return false;
    }

    // Before its first emission the emitter keeps the system alive until the endcap has run for a while
    if (this.windowStart === -1) {
      return !state.inEndCap || state.age <= 2;
    }

    if (this.initFromKilledParentParticles || this.isPastFadeOut(state)) {
      return false;
    }

    const start = this.windowStart;
    const time = state.age;

    if (this.duration !== 0 && f32(time - state.currentStep) > f32(start + this.duration)) {
      return false;
    }

    return this.steadyRateCanBePositive || time <= f32(start + this.steadyTime);
  }

  emit(state: ParticleSystemState, strength: number, emit: EmitCallback): void {
    this.duration = this.emissionDuration.nextNumber(state);
    const start = f32(this.timeBase + this.startTime.nextNumber(state));
    this.windowStart = start;

    const time = state.age;
    const step = state.currentStep;

    if (start > time) {
      return;
    }

    let rate = Math.max(0, f32(strength * this.evaluateRate(state, start)));

    if (rate <= 0) {
      return;
    }

    let previous: number;
    let current = time;
    let span: number;
    let budget: number;

    if (this.initFromKilledParentParticles) {
      const events = state.parentSystem !== null ? state.emitterEventCount : 0;

      if (events === 0) {
        return;
      }

      if (this.isFinite) {
        current = Math.min(Math.max(current, start), f32(start + this.emitSpan));
      }

      previous = current;
      span = 0;
      budget = events;
    } else {
      if (this.scalePerParentParticle > 0) {
        const parent = state.parentSystem?.data ?? null;
        rate = f32(rate * (parent !== null ? f32(parent.particles.count * this.scalePerParentParticle) : this.scalePerParentParticle));
      } else if (this.emissionScale > 0) {
        rate = f32(rate * f32((state.highestControlPoint + 1) * this.emissionScale));
      }

      if (this.snapshotBinding.hasControlPoint) {
        rate = f32(rate * this.snapshotBinding.count(state));
      }

      if (rate <= 0 || (!this.emitting && !this.forcePending) || this.isPastFadeOut(state)) {
        return;
      }

      if (this.duration !== 0 && f32(time - step) > f32(start + this.duration)) {
        return;
      }

      previous = state.stepStartAge;

      if (this.isFinite) {
        previous = Math.max(previous, start);
        current = Math.min(current, f32(start + this.emitSpan));
      }

      span = Math.min(current - previous, step);
      budget = Math.max(0, rate * span);
    }

    this.emitAccumulator += budget;

    let count = Math.max(0, Math.trunc(Math.floor(this.emitAccumulator + FLUSH_EPSILON)) - Math.trunc(this.emitted));

    if (this.forceEmitOnFirstUpdate && f32(time - step) === 0) {
      count = Math.max(count, 1);
    }

    if (this.forcePending) {
      this.forcePending = false;
      count = Math.max(count, 1);
    }

    if (this.limitPerUpdate > 0) {
      count = Math.min(count, this.limitPerUpdate);
    }

    if (count <= 0) {
      return;
    }

    this.emitted += count;
    count = Math.min(count, ParticleFunctionEmitter.freeSlots(state));

    if (count <= 0) {
      return;
    }

    const creationStep = f32(span / count);
    let creationTime = f32(creationStep + previous);
    const currentTime = f32(current);

    for (let i = 0; i < count; i++) {
      const particleTime = Math.min(creationTime, currentTime);
      emit(particleTime);
      creationTime = f32(particleTime + creationStep);
    }
  }

  /** Reads the rate, with a rate driven by the system's age measured from the start of emission. */
  private evaluateRate(state: ParticleSystemState, start: number): number {
    return this.emitRate instanceof CollectionAgeNumberProvider
      ? this.emitRate.atAge(f32(state.age - start))
      : this.emitRate.nextNumber(state);
  }

  skipToTime(time: number, simulation: ParticleSystemSimulation): void {
    const state = simulation.renderState;
    const start = f32(this.startTime.nextNumber(state) + this.timeBase);

    if (start >= time || this.initFromKilledParentParticles) {
      return;
    }

    const now = state.age;
    let from = f32(now - time);

    if (this.isFinite) {
      from = Math.max(start, from);
    }

    simulation.resimulate(f32(now - Math.min(f32(now - from), 4)), time);
  }
}
