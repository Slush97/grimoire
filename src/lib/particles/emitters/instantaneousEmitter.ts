// Ported from ValveResourceFormat (MIT): ValveResourceFormat/Particles/Emitters/InstantaneousEmitter.cs.

import { MAX_PARTICLES } from '../collection';
import { ParticleEventType, ParticleField } from '../enums';
import { type EmitCallback, ParticleFunctionEmitter } from '../functions';
import { f32, toInt } from '../numerics';
import { LiteralNumberProvider, type NumberProvider } from '../numberProviders';
import type { ParticleDefinitionParser } from '../parser';
import type { ParticleSystemSimulation } from '../simulation';
import type { ParticleSystemState } from '../state';
import { type ParticleSnapshot, SnapshotBinding } from '../utils/snapshotBinding';

/**
 * C_OP_InstantaneousEmitter: emits a fixed number of particles in a single burst at a start time.
 * With m_flInitFromKilledParentParticles it emits a burst per parent particle event; with a
 * snapshot control point, one particle per snapshot row, each released at the row's creation time.
 */
export class InstantaneousEmitter extends ParticleFunctionEmitter {
  private readonly emitCount: NumberProvider;
  private readonly startTime: NumberProvider;

  /** Multiplies the burst by the parent system's live particle count. -1 leaves it unscaled. */
  private readonly parentParticleScale: NumberProvider;

  private readonly maxEmittedPerFrame: number;

  /** Scales the burst by how many parent particles raised the event. */
  private readonly initFromKilledParentParticles: number;
  private readonly eventType: number;
  private readonly snapshotBinding: SnapshotBinding;
  private readonly resetSnapshotIndexOnChanges: boolean;

  private remainingToEmit = 0;
  private emitTime = -1;
  private timeBase = 0;
  private burstComputed = false;

  /** Set once an event emitter with a literal burst size has seen its first parent event after the start. */
  private eventBurstSettled = false;
  private emitting = true;

  /** The next snapshot row the walk releases. */
  private snapshotIndex = 0;

  /** The next snapshot row whose creation time an emitted particle takes. */
  private snapshotEmitIndex = 0;
  private walkedSnapshot: ParticleSnapshot | null = null;
  private walkedSerial = 0;

  constructor(parse: ParticleDefinitionParser) {
    super(parse);
    this.emitCount = parse.numberProvider('m_nParticlesToEmit', new LiteralNumberProvider(100));
    let startTime = parse.numberProvider('m_flStartTime', new LiteralNumberProvider(0));
    this.parentParticleScale = parse.numberProvider('m_flParentParticleScale', new LiteralNumberProvider(-1));
    this.maxEmittedPerFrame = parse.int32('m_nMaxEmittedPerFrame', -1);
    this.initFromKilledParentParticles = parse.float('m_flInitFromKilledParentParticles', 0);
    this.eventType = parse.enum('m_nEventType', ParticleEventType, ParticleEventType.PARTICLE_EVENT_TYPE_MASK_KILLED);
    this.snapshotBinding = new SnapshotBinding(parse);
    this.resetSnapshotIndexOnChanges = parse.boolean('m_bResetSnapshotIndexOnChanges', false);

    if (this.resetSnapshotIndexOnChanges) {
      startTime = new LiteralNumberProvider(0);
    }

    this.startTime = startTime;
  }

  private get isEventEmitter(): boolean {
    return this.initFromKilledParentParticles > 0;
  }

  get eventTypeMask(): number {
    return this.isEventEmitter ? this.eventType : ParticleEventType.PARTICLE_EVENT_TYPE_MASK_NONE;
  }

  reset(): void {
    this.remainingToEmit = 0;
    this.emitTime = -1;
    this.timeBase = 0;
    this.burstComputed = false;
    this.eventBurstSettled = false;
    this.emitting = true;
    this.snapshotIndex = 0;
    this.snapshotEmitIndex = 0;
    this.walkedSnapshot = null;
    this.walkedSerial = 0;
  }

  restart(state: ParticleSystemState): void {
    const isEndCapChild = state.data?.isEndCapChild ?? false;

    this.timeBase = isEndCapChild ? 0 : state.age;
    this.remainingToEmit = 0;
    this.emitTime = -1;
    this.burstComputed = false;
    this.eventBurstSettled = false;
    this.emitting = true;
    this.snapshotIndex = 0;
    this.snapshotEmitIndex = 0;
  }

  startEmission(): void {
    this.emitting = true;
  }

  stopEmission(): void {
    this.emitting = false;
  }

  mayCreateMoreParticles(): boolean {
    if (this.isEventEmitter) {
      // An event emitter stays alive until its first parent event, or forever when the burst size is not a literal
      return this.emitting && (!this.eventBurstSettled || this.remainingToEmit > 0);
    }

    return this.emitting && (!this.burstComputed || this.remainingToEmit > 0);
  }

  private updateParticlesToEmit(state: ParticleSystemState): void {
    const time = state.age;

    if (this.isEventEmitter) {
      const burst = toInt(this.emitCount.nextNumber(state));
      const events = state.parentSystem !== null ? state.emitterEventCount : 0;
      this.remainingToEmit = toInt(f32(events * f32(burst * this.initFromKilledParentParticles)));
      this.emitTime = time;

      if (this.emitCount instanceof LiteralNumberProvider && time > 0) {
        this.eventBurstSettled = true;
      }

      return;
    }

    this.emitTime = f32(this.timeBase + this.startTime.nextNumber(state));

    if (this.emitTime > time) {
      return;
    }

    if (!this.snapshotBinding.isBound) {
      if (this.burstComputed) {
        return;
      }

      let scale = 1;
      const parent = state.parentSystem?.data ?? null;

      if (parent !== null) {
        const parentScale = this.parentParticleScale.nextNumber(state);

        if (parentScale !== -1) {
          scale = f32(parent.particles.count * parentScale);
        }
      }

      this.remainingToEmit = Math.max(toInt(f32(scale * this.emitCount.nextNumber(state))), 0);
      this.burstComputed = true;
      return;
    }

    if (this.burstComputed) {
      return;
    }

    const snapshot = this.snapshotBinding.resolve(state);
    const serial = snapshot?.serial ?? 0;

    if (this.resetSnapshotIndexOnChanges && (snapshot !== this.walkedSnapshot || serial !== this.walkedSerial)) {
      this.snapshotIndex = 0;
      this.snapshotEmitIndex = 0;
    }

    this.walkedSnapshot = snapshot;
    this.walkedSerial = serial;

    // A resettable snapshot walk can start over, so it never finishes
    const canFinish = !this.resetSnapshotIndexOnChanges;

    if (snapshot === null) {
      this.burstComputed = canFinish;
      return;
    }

    const count = snapshot.numParticles;
    const creationTimes = this.snapshotCreationTimes(state);

    if (creationTimes === null) {
      this.remainingToEmit += Math.max(count - this.snapshotIndex, 0);
      this.snapshotIndex = Math.max(this.snapshotIndex, count);
      this.burstComputed = canFinish;
      return;
    }

    if (this.snapshotEmitIndex >= count) {
      this.remainingToEmit = 0;
      this.burstComputed = canFinish;
      return;
    }

    // Each row is counted once here, so rows skipped by strength or a full buffer are never emitted later
    const elapsed = f32(time - this.timeBase);

    while (this.snapshotIndex < count && (this.snapshotIndex >= creationTimes.length || creationTimes[this.snapshotIndex] <= elapsed)) {
      this.snapshotIndex++;
      this.remainingToEmit++;
    }
  }

  private snapshotCreationTimes(state: ParticleSystemState): ArrayLike<number> | null {
    return this.snapshotBinding.resolveAttribute(state, ParticleField.CreationTime);
  }

  emit(state: ParticleSystemState, strength: number, emit: EmitCallback): void {
    if (!this.emitting) {
      return;
    }

    this.updateParticlesToEmit(state);

    if (this.emitTime > state.age || this.remainingToEmit <= 0) {
      return;
    }

    const perFrameCap = this.maxEmittedPerFrame >= 0 ? this.maxEmittedPerFrame : (state.data?.particleCapacity ?? MAX_PARTICLES);

    const claimed = Math.min(perFrameCap, this.remainingToEmit);
    this.remainingToEmit -= claimed;

    const count = Math.min(ParticleFunctionEmitter.freeSlots(state), toInt(f32(claimed * strength)));
    const creationTimes = this.snapshotBinding.isBound ? this.snapshotCreationTimes(state) : null;

    for (let i = 0; i < count; i++) {
      let creationTime = this.emitTime;

      if (creationTimes !== null && this.snapshotEmitIndex < creationTimes.length) {
        creationTime = f32(creationTime + creationTimes[this.snapshotEmitIndex]);
      }

      this.snapshotEmitIndex++;
      emit(creationTime);
    }
  }

  skipToTime(time: number, simulation: ParticleSystemSimulation): void {
    const state = simulation.renderState;

    if (this.isEventEmitter || f32(this.startTime.nextNumber(state) + this.timeBase) >= time) {
      return;
    }

    simulation.resimulate(f32(state.age - time), time);
  }
}
