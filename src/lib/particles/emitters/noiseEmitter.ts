// Ported from ValveResourceFormat (MIT): ValveResourceFormat/Particles/Emitters/NoiseEmitter.cs.

import { type ControlPointDefaults, type EmitCallback, ParticleFunctionEmitter } from '../functions';
import { Vector3, clamp, f32, toInt } from '../numerics';
import { LiteralNumberProvider, type NumberProvider } from '../numberProviders';
import type { ParticleDefinitionParser } from '../parser';
import type { ParticleSystemSimulation } from '../simulation';
import type { ParticleSystemState } from '../state';
import { value3D } from '../utils/noise';

const MAXIMUM_RATE = f32(2147483600);

/**
 * C_OP_NoiseEmitter: emits at a rate modulated by noise between a minimum and maximum. The noise is
 * sampled at the system's clock plus m_flOffset, plus the world clock in whole milliseconds scaled
 * by m_flWorldTimeScale.
 */
export class NoiseEmitter extends ParticleFunctionEmitter {
  private readonly emissionDuration: NumberProvider;
  private readonly startTime: NumberProvider;
  private readonly noiseScale: NumberProvider;
  private readonly emissionMin: NumberProvider;
  private readonly emissionMax: NumberProvider;
  private readonly noiseOffset: number;
  private readonly absVal: boolean;
  private readonly absValInv: boolean;
  private readonly emissionScale: number = 0;
  private readonly scaleControlPoint: number;
  private readonly scaleControlPointField: number;
  private readonly worldNoisePoint: number;
  private readonly worldNoiseScale: number;
  private readonly offsetLoc: Vector3;
  private readonly worldTimeScale: number;

  // A double and a long in the C#
  private totalToEmit = 1;
  private totalEmitted = 0;
  private timeBase = 0;
  private active = true;

  constructor(parse: ParticleDefinitionParser) {
    super(parse);
    this.emissionDuration = parse.numberProvider('m_flEmissionDuration', new LiteralNumberProvider(0));
    this.startTime = parse.numberProvider('m_flStartTime', new LiteralNumberProvider(0));
    this.noiseScale = parse.numberProvider('m_flNoiseScale', new LiteralNumberProvider(0.1));
    this.emissionMin = parse.numberProvider('m_flOutputMin', new LiteralNumberProvider(0));
    this.emissionMax = parse.numberProvider('m_flOutputMax', new LiteralNumberProvider(100));
    this.noiseOffset = parse.float('m_flOffset', 0);
    this.absVal = parse.boolean('m_bAbsVal', false);
    this.absValInv = parse.boolean('m_bAbsValInv', false);

    if (parse.behaviorVersion < 2) {
      this.emissionScale = Math.max(0, parse.float('m_flEmissionScale', 0));
    }

    this.scaleControlPoint = parse.int32('m_nScaleControlPoint', -1);
    this.scaleControlPointField = parse.int32('m_nScaleControlPointField', 0);
    this.worldNoisePoint = parse.int32('m_nWorldNoisePoint', -1);
    this.worldNoiseScale = parse.float('m_flWorldNoiseScale', f32(0.001));
    this.offsetLoc = parse.vector3('m_vecOffsetLoc', Vector3.zero);
    this.worldTimeScale = parse.float('m_flWorldTimeScale', 0);
  }

  addControlPointDefaults(defaults: ControlPointDefaults): void {
    defaults.addScale(this.scaleControlPoint, this.scaleControlPointField);
  }

  reset(): void {
    this.totalToEmit = 1;
    this.totalEmitted = 0;
    this.timeBase = 0;
    this.active = true;
  }

  restart(state: ParticleSystemState): void {
    if (this.duration(state) !== 0) {
      this.timeBase = state.age;
    }
  }

  // A negative duration counts as 0, which emits without an end
  private duration(state: ParticleSystemState): number {
    return Math.max(0, this.emissionDuration.nextNumber(state));
  }

  startEmission(state: ParticleSystemState): void {
    this.active = true;
    this.rearmFirstParticle(state, state.age);
  }

  skipToTime(time: number, simulation: ParticleSystemSimulation): void {
    this.rearmFirstParticle(simulation.renderState, time);
  }

  /** Once the start time has passed, restores the accumulator so a particle emits on the next step. */
  private rearmFirstParticle(state: ParticleSystemState, time: number): void {
    const start = f32(this.timeBase + this.startTime.nextNumber(state));

    if (start >= time) {
      return;
    }

    this.totalToEmit = 1;
    this.totalEmitted = 0;
  }

  stopEmission(): void {
    this.active = false;
  }

  mayCreateMoreParticles(state: ParticleSystemState): boolean {
    const duration = this.duration(state);
    const start = f32(this.timeBase + this.startTime.nextNumber(state));

    return this.active && !(duration !== 0 && f32(state.age - state.currentStep) > f32(start + duration)) && !this.isPastFadeOut(state);
  }

  emit(state: ParticleSystemState, strength: number, emit: EmitCallback): void {
    const time = state.age;
    const step = state.currentStep;

    const amplitude = this.absVal ? 1 : 0.5;
    const indexScale = f32(state.highestControlPoint * this.emissionScale);

    let position = Vector3.zero;
    let worldScale = 1;

    if (this.worldNoisePoint !== -1) {
      position = state.getControlPoint(this.worldNoisePoint).position.add(this.offsetLoc);
      worldScale = this.worldNoiseScale;
    }

    const timeTerm = f32(f32(this.noiseOffset + time) * this.noiseScale.nextNumber(state));
    // The time term is the process wall clock in milliseconds in the game; the world time keeps playback deterministic
    const worldTimeTerm = f32(toInt(f32(state.worldTime * 1000)) * this.worldTimeScale);
    let noise = value3D(position.scale(worldScale).add(Vector3.splat(timeTerm)).add(Vector3.splat(worldTimeTerm)));

    if (this.absVal) {
      noise = Math.abs(noise);
    }

    if (this.absValInv) {
      noise = f32(1 - noise);
    }

    const outputMin = this.emissionMin.nextNumber(state);
    const range = f32(this.emissionMax.nextNumber(state) - outputMin);
    let rate = f32(
      clamp(f32(f32(f32(range * amplitude) * noise) + f32(f32(f32(1 - amplitude) * range) + outputMin)), 0, MAXIMUM_RATE) * strength,
    );

    if (this.scaleControlPoint >= 0 && this.scaleControlPointField !== -1) {
      const component = this.scaleControlPointField >= 0 && this.scaleControlPointField <= 2
        ? state.getControlPoint(this.scaleControlPoint).position.component(this.scaleControlPointField)
        : 0;

      rate = f32(rate * Math.max(0, component));
    }

    if (indexScale !== 0) {
      rate = f32(rate * indexScale);
    }

    const duration = this.duration(state);
    const start = f32(this.timeBase + this.startTime.nextNumber(state));

    if (rate === 0 || !this.active || (duration !== 0 && f32(time - step) > f32(start + duration)) || this.isPastFadeOut(state) || start > time) {
      return;
    }

    let windowStart = f32(time - step);
    let windowEnd = time;

    if (duration !== 0) {
      windowStart = Math.max(start, windowStart);
      windowEnd = Math.min(f32(duration + start), time);
    }

    this.totalToEmit += f32(f32(windowEnd - windowStart) * rate);

    let count = Math.max(Math.trunc(Math.floor(this.totalToEmit)) - Math.trunc(this.totalEmitted), 0);
    this.totalEmitted += count;
    count = Math.min(count, Math.max(ParticleFunctionEmitter.freeSlots(state), 0));

    if (count === 0) {
      return;
    }

    const spacing = f32(f32(windowEnd - windowStart) / count);
    let creationTime = windowStart;

    for (let i = 0; i < count; i++) {
      creationTime = Math.min(f32(creationTime + spacing), windowEnd);
      emit(creationTime);
    }
  }
}
