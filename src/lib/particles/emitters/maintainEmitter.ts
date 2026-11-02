// Ported from ValveResourceFormat (MIT): ValveResourceFormat/Particles/Emitters/MaintainEmitter.cs.

import { type EmitCallback, ParticleFunctionEmitter } from '../functions';
import { clamp, f32, toInt } from '../numerics';
import { LiteralNumberProvider, type NumberProvider } from '../numberProviders';
import type { ParticleDefinitionParser } from '../parser';
import type { ParticleSystemState } from '../state';
import { SnapshotBinding } from '../utils/snapshotBinding';

/**
 * C_OP_MaintainEmitter: keeps the system topped up to a particle count, emitting whenever particles
 * die, either at once or limited to an emission rate.
 */
export class MaintainEmitter extends ParticleFunctionEmitter {
  private readonly particlesToMaintain: NumberProvider;
  private readonly emissionDuration: NumberProvider;
  private readonly scale: NumberProvider;
  private readonly startTime: number;
  private readonly emissionRate: number;
  private readonly emitInstantaneously: boolean;
  private readonly finalEmitOnStop: boolean;
  private readonly snapshotBinding: SnapshotBinding;

  private timeBase = 0;

  // Fractional particles the rate has earned but not yet spent
  private rateBudget = 0;

  private emitting = true;
  private finalEmitPending = false;

  constructor(parse: ParticleDefinitionParser) {
    super(parse);
    this.particlesToMaintain = parse.numberProvider('m_nParticlesToMaintain', new LiteralNumberProvider(100));
    this.emissionDuration = parse.numberProvider('m_flEmissionDuration', new LiteralNumberProvider(0));
    this.scale = parse.numberProvider('m_flScale', new LiteralNumberProvider(1));
    this.startTime = parse.float('m_flStartTime', 0);
    this.emissionRate = parse.float('m_flEmissionRate', -1);
    this.emitInstantaneously = parse.boolean('m_bEmitInstantaneously', false);
    this.finalEmitOnStop = parse.boolean('m_bFinalEmitOnStop', false);
    this.snapshotBinding = new SnapshotBinding(parse);
  }

  reset(): void {
    this.timeBase = 0;
    this.rateBudget = 0;
    this.emitting = true;
    this.finalEmitPending = false;
  }

  restart(state: ParticleSystemState): void {
    this.timeBase = state.age;
    this.emitting = true;
    this.finalEmitPending = false;
    this.rateBudget = 0;
  }

  startEmission(): void {
    this.emitting = true;
    this.finalEmitPending = false;
  }

  stopEmission(): void {
    this.rateBudget = 0;

    if (this.finalEmitOnStop) {
      this.finalEmitPending = true;
      return;
    }

    this.emitting = false;
  }

  mayCreateMoreParticles(state: ParticleSystemState): boolean {
    const duration = this.emissionDuration.nextNumber(state);

    if (duration !== 0 && f32(state.age - state.currentStep) > f32(duration + this.startTime)) {
      return false;
    }

    // Unlike the other emitters, only an oscillating fade with a fade out time stops emission past the fade out
    const isPastFadeOut = this.opFadeOscillatePeriod !== 0 && this.opEndFadeOutTime > 0 && this.getFunctionTime(state) > this.opEndFadeOutTime;
    return this.emitting && !isPastFadeOut;
  }

  emit(state: ParticleSystemState, _strength: number, emit: EmitCallback): void {
    if (!this.emitting) {
      return;
    }

    if (this.finalEmitPending) {
      this.emitting = false;
      this.finalEmitPending = false;
    }

    const time = state.age;
    const start = f32(this.timeBase + this.startTime);

    if (start > time) {
      return;
    }

    const target = this.targetCount(state);
    const active = state.data?.particles.count ?? 0;

    if (active >= target || target <= 0) {
      return;
    }

    const duration = this.emissionDuration.nextNumber(state);

    if (duration !== 0 && f32(time - state.currentStep) > f32(duration + this.startTime)) {
      return;
    }

    let count = target - active;

    if (this.emissionRate > 0) {
      const budget = f32(clamp(f32(this.emissionRate * state.currentStep), 0, count) + this.rateBudget);
      count = toInt(budget);
      this.rateBudget = f32(budget - count);
    }

    count = Math.max(0, Math.min(count, ParticleFunctionEmitter.freeSlots(state)));

    if (count === 0) {
      return;
    }

    let creationTime = Math.max(state.stepStartAge, start);
    const spacing = !this.emitInstantaneously || this.emissionRate > 0 ? f32(f32(time - creationTime) / count) : 0;

    for (let i = 0; i < count; i++) {
      creationTime = Math.min(creationTime, time);
      emit(creationTime);
      creationTime = f32(creationTime + spacing);
    }
  }

  private targetCount(state: ParticleSystemState): number {
    let target = toInt(this.particlesToMaintain.nextNumber(state));
    const snapshot = this.snapshotBinding.resolve(state);

    if (snapshot !== null) {
      target = snapshot.numParticles;
    }

    return Math.max(0, toInt(f32(target * this.scale.nextNumber(state))));
  }
}
