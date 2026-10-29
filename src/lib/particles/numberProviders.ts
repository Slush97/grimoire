// Ported from ValveResourceFormat (MIT): ValveResourceFormat/Particles/INumberProvider.cs and the
// float input switch of ValveResourceFormat/Particles/ParticleDefinitionParser.cs.
//
// Every input type VRF runs is ported. Types VRF does not support (PF_TYPE_CLOSEST_CAMERA_DISTANCE,
// PF_TYPE_CONCURRENT_DEF_COUNT, PF_TYPE_RANGE and any unknown type) fall back to their literal value
// as VRF does, and are reported.

import { AttributeMapping, type SteadyState } from './attributeMapping';
import { readVector } from './buffer';
import { ParticleField, ParticleFloatBiasType, ParticleFloatRandomMode } from './enums';
import { isAngleField, isIntegerField } from './fields';
import { Vector3, clamp, clampEitherOrder, distance, f32, lerp, radiansToDegrees } from './numerics';
import type { ParticleDefinitionParser } from './parser';
import type { ParticleSpan } from './span';
import type { ParticleSystemState } from './state';
import { NoiseEvaluator } from './utils/noiseEvaluator';
import { biasFromParameter } from './utils/particleMath';
import { type EvaluationKey, InputSeed, type ParticleRandom, sameEvaluation } from './utils/random';
import { SnapshotBinding } from './utils/snapshotBinding';

/** A scalar input that may vary per particle or per frame (CParticleFloatInput). */
export abstract class NumberProvider {
  /** The value for the whole collection, as emitters and renderers read it. Inputs that read a particle return 0. */
  abstract nextNumber(state: ParticleSystemState): number;

  /** Whether the input can give each particle its own value. */
  get isPerParticle(): boolean {
    return false;
  }

  /** Writes the value for each particle of `particles` into `values`. */
  fill(particles: ParticleSpan, state: ParticleSystemState, values: Float32Array): void {
    if (!particles.isEmpty) {
      values.fill(this.nextNumber(state));
    }
  }

  /** Evaluates the value for each particle into a new column. */
  fillNew(particles: ParticleSpan, state: ParticleSystemState): Float32Array {
    const values = new Float32Array(particles.length);
    this.fill(particles, state, values);
    return values;
  }

  /**
   * Evaluates the input over `evaluated`, which contains `particles`, as a function that sets it up
   * over those particles does. Returns the values of `particles`.
   */
  fillEvaluated(particles: ParticleSpan, evaluated: ParticleSpan, state: ParticleSystemState): Float32Array {
    const offset = particles.start - evaluated.start;
    return this.fillNew(evaluated, state).subarray(offset, offset + particles.length);
  }

  /** The value the input holds from some time on, for inputs that settle, or null. */
  tryGetSteadyState(_state: ParticleSystemState): SteadyState | null {
    return null;
  }

  /** The value fill writes for the particle at `index` of `particles`. */
  nextNumberAt(particles: ParticleSpan, index: number, state: ParticleSystemState): number {
    const value = new Float32Array(1);
    this.fill(particles.slice(index, 1), state, value);
    return value[0];
  }
}

export class LiteralNumberProvider extends NumberProvider {
  readonly value: number;

  constructor(value: number) {
    super();
    this.value = f32(value);
  }

  nextNumber(): number {
    return this.value;
  }

  fill(_particles: ParticleSpan, _state: ParticleSystemState, values: Float32Array): void {
    values.fill(this.value);
  }

  tryGetSteadyState(): SteadyState | null {
    return { time: 0, value: this.value };
  }
}

/** An input evaluated for the whole collection (CParticleCollectionFloatInput). */
export class CollectionNumberInput extends NumberProvider {
  private readonly input: NumberProvider;

  constructor(input: NumberProvider) {
    super();
    this.input = input;
  }

  nextNumber(state: ParticleSystemState): number {
    return this.input.nextNumber(state);
  }
}

/** PF_TYPE_RANDOM_UNIFORM and PF_TYPE_RANDOM_BIASED. */
export class RandomNumberProvider extends NumberProvider {
  /** Displacement between the value draw and the draw that decides the sign. */
  private static readonly signFlipOffset = 37;

  private readonly minRange: number;
  private readonly maxRange: number;
  private readonly randomMode: number;
  private readonly isBiased: boolean;
  private readonly biasType: number = ParticleFloatBiasType.PF_BIAS_TYPE_STANDARD;
  private readonly biasParam: number = 0;
  private readonly hasRandomSignFlip: boolean;
  private readonly inputSeed = new InputSeed();
  private varyingKey: EvaluationKey | null = null;
  private varyingValue = 0;

  constructor(parse: ParticleDefinitionParser, isBiased = false, defaultMode: number = ParticleFloatRandomMode.PF_RANDOM_MODE_CONSTANT) {
    super();
    parse.addRandomInput();

    this.minRange = parse.float('m_flRandomMin');
    this.maxRange = parse.float('m_flRandomMax', 1);
    this.hasRandomSignFlip = parse.boolean('m_bHasRandomSignFlip', false);
    this.randomMode = parse.enum('m_nRandomMode', ParticleFloatRandomMode, defaultMode);
    this.isBiased = isBiased;

    if (isBiased) {
      this.biasParam = parse.float('m_flBiasParameter');
      this.biasType = parse.enum('m_nBiasType', ParticleFloatBiasType, this.biasType);
    }
  }

  /** A varying input draws once per function call; a constant one reads the slot of particle id 0. */
  nextNumber(state: ParticleSystemState): number {
    const random = state.random;

    if (this.randomMode === ParticleFloatRandomMode.PF_RANDOM_MODE_VARYING) {
      return this.varyingOnce(random);
    }

    return this.constant(random, this.inputSeed.get(random), 0);
  }

  get isPerParticle(): boolean {
    return true;
  }

  /** A varying input draws once per block of four particles; a constant one reads a slot per particle id. */
  fill(particles: ParticleSpan, state: ParticleSystemState, values: Float32Array): void {
    if (particles.isEmpty) {
      return;
    }

    const random = state.random;

    if (this.randomMode === ParticleFloatRandomMode.PF_RANDOM_MODE_VARYING) {
      for (const { offset, block } of particles.blocks()) {
        values.fill(this.varying(random), offset, offset + block.length);
      }

      const fillEnd = particles.start + particles.length;
      const batchEnd = state.initializerBatchEnd;
      const endsBlockRun = fillEnd === state.initializerRunEnd && fillEnd === (batchEnd & ~3);

      if (endsBlockRun && batchEnd > fillEnd) {
        this.varying(random);
      }

      return;
    }

    const seed = this.inputSeed.get(random);
    const particleIds = particles.readIntegers(ParticleField.ParticleId);

    for (let i = 0; i < particleIds.length; i++) {
      values[i] = this.constant(random, seed, particleIds[i]);
    }
  }

  private varyingOnce(random: ParticleRandom): number {
    const key = random.evaluation();

    if (!sameEvaluation(this.varyingKey, key)) {
      this.varyingKey = key;
      this.varyingValue = this.varying(random);
    }

    return this.varyingValue;
  }

  private varying(random: ParticleRandom): number {
    const draw = random.next();
    const sign = this.hasRandomSignFlip ? random.next() : 1;
    return this.shape(draw, sign);
  }

  private constant(random: ParticleRandom, seed: number, particleId: number): number {
    const draw = random.forParticle(particleId, seed);
    const sign = this.hasRandomSignFlip ? random.forParticle(particleId, (seed + RandomNumberProvider.signFlipOffset) | 0) : 1;
    return this.shape(draw, sign);
  }

  private shape(draw: number, sign: number): number {
    if (this.isBiased) {
      draw = biasFromParameter(Math.min(1, draw), this.biasParam, this.biasType);
    }

    const value = clampEitherOrder(lerp(this.minRange, this.maxRange, draw), this.minRange, this.maxRange);

    return sign < 0.5 ? -value : value;
  }
}

/** PF_TYPE_NAMED_VALUE: the current float named value through the mapping, or the mapping of 0. */
export class NamedValueNumberProvider extends NumberProvider {
  private readonly name: string;
  private readonly attributeMapping: AttributeMapping;

  constructor(parse: ParticleDefinitionParser) {
    super();
    this.name = parse.string('m_NamedValue');
    this.attributeMapping = new AttributeMapping(parse);
  }

  nextNumber(state: ParticleSystemState): number {
    const value = state.data?.namedValues.tryGetFloat(this.name) ?? null;
    return this.attributeMapping.applyMapping(value ?? 0);
  }

  tryGetSteadyState(): SteadyState | null {
    return this.attributeMapping.tryGetSteadyState();
  }
}

/** PF_TYPE_COLLECTION_AGE. */
export class CollectionAgeNumberProvider extends NumberProvider {
  private readonly attributeMapping: AttributeMapping;

  constructor(parse: ParticleDefinitionParser) {
    super();
    this.attributeMapping = new AttributeMapping(parse);
  }

  nextNumber(state: ParticleSystemState): number {
    return this.attributeMapping.applyMapping(state.age);
  }

  tryGetSteadyState(): SteadyState | null {
    return this.attributeMapping.tryGetSteadyState();
  }

  /** Evaluates the input as if the system were `age` seconds old. */
  atAge(age: number): number {
    return this.attributeMapping.applyMapping(age);
  }
}

/** PF_TYPE_ENDCAP_AGE: how long the endcap has been running, 0 outside it. */
export class EndCapAgeNumberProvider extends NumberProvider {
  private readonly attributeMapping: AttributeMapping;

  constructor(parse: ParticleDefinitionParser) {
    super();
    this.attributeMapping = new AttributeMapping(parse);
  }

  nextNumber(state: ParticleSystemState): number {
    return this.attributeMapping.applyMapping(state.endCapAge);
  }

  tryGetSteadyState(): SteadyState | null {
    return this.attributeMapping.tryGetSteadyState();
  }
}

/** PF_TYPE_PARTICLE_DETAIL_LEVEL. */
export class DetailLevelNumberProvider extends NumberProvider {
  private readonly tiers: number[];

  constructor(parse: ParticleDefinitionParser) {
    super();
    this.tiers = [parse.float('m_flLOD0'), parse.float('m_flLOD1'), parse.float('m_flLOD2'), parse.float('m_flLOD3')];
  }

  nextNumber(state: ParticleSystemState): number {
    return this.tiers[clamp(state.detailLevel, 0, this.tiers.length - 1)];
  }

  tryGetSteadyState(state: ParticleSystemState): SteadyState | null {
    return { time: 0, value: this.nextNumber(state) };
  }
}

/** PF_TYPE_PARTICLE_AGE. */
export class ParticleAgeNumberProvider extends NumberProvider {
  private readonly attributeMapping: AttributeMapping;

  constructor(parse: ParticleDefinitionParser | null = null) {
    super();
    this.attributeMapping = new AttributeMapping(parse);
  }

  nextNumber(): number {
    return 0;
  }

  get isPerParticle(): boolean {
    return true;
  }

  fill(particles: ParticleSpan, _state: ParticleSystemState, values: Float32Array): void {
    const creationTimes = particles.floats(ParticleField.CreationTime);
    const time = particles.time;

    for (let i = 0; i < values.length; i++) {
      values[i] = time - creationTimes[i];
    }

    this.attributeMapping.applyMappingColumn(values);
  }
}

/** PF_TYPE_PARTICLE_AGE_NORMALIZED. */
export class ParticleAgeNormalizedNumberProvider extends NumberProvider {
  private readonly attributeMapping: AttributeMapping;

  constructor(parse: ParticleDefinitionParser) {
    super();
    this.attributeMapping = new AttributeMapping(parse);
  }

  nextNumber(): number {
    return 0;
  }

  get isPerParticle(): boolean {
    return true;
  }

  fill(particles: ParticleSpan, _state: ParticleSystemState, values: Float32Array): void {
    const lifetimes = particles.readFloats(ParticleField.LifeDuration);
    const creationTimes = particles.floats(ParticleField.CreationTime);
    const time = particles.time;

    for (let i = 0; i < values.length; i++) {
      values[i] = time - creationTimes[i];
    }

    for (let i = 0; i < values.length; i++) {
      values[i] = lifetimes[i] <= 0 ? 0 : values[i] / lifetimes[i];
    }

    this.attributeMapping.applyMappingColumn(values);
  }
}

/** PF_TYPE_PARTICLE_FLOAT: a scalar attribute, with angles read in degrees. */
export class PerParticleNumberProvider extends NumberProvider {
  private readonly field: number;
  private readonly mapping: AttributeMapping;

  constructor(parse: ParticleDefinitionParser) {
    super();
    this.field = parse.particleField('m_nScalarAttribute', ParticleField.Radius);
    this.mapping = new AttributeMapping(parse);
  }

  nextNumber(): number {
    return 0;
  }

  get isPerParticle(): boolean {
    return true;
  }

  fill(particles: ParticleSpan, _state: ParticleSystemState, values: Float32Array): void {
    PerParticleNumberProvider.read(particles, this.field, values);
    this.mapping.applyMappingColumn(values);
  }

  /** Reads `field`: an integer attribute converted to its value, an angle in degrees, 0 for a non-scalar. */
  static read(particles: ParticleSpan, field: number, values: Float32Array): void {
    if (isIntegerField(field)) {
      const integers = particles.readIntegers(field);
      for (let i = 0; i < values.length; i++) {
        values[i] = integers[i];
      }
      return;
    }

    const { values: scalars, constant } = particles.tryGetFloats(field);

    if (!scalars) {
      values.fill(isAngleField(field) ? radiansToDegrees(constant) : constant);
      return;
    }

    if (isAngleField(field)) {
      for (let i = 0; i < values.length; i++) {
        values[i] = radiansToDegrees(scalars[i]);
      }
      return;
    }

    values.set(scalars);
  }
}

/** PF_TYPE_PARTICLE_INITIAL_FLOAT: a scalar attribute as the particle's initializers left it. */
export class PerParticleInitialNumberProvider extends NumberProvider {
  private readonly field: number;
  private readonly mapping: AttributeMapping;

  constructor(parse: ParticleDefinitionParser) {
    super();
    this.field = parse.particleField('m_nScalarAttribute', ParticleField.Radius);
    this.mapping = new AttributeMapping(parse);
    parse.addInitialRead(this.field);
  }

  nextNumber(): number {
    return 0;
  }

  get isPerParticle(): boolean {
    return true;
  }

  fill(particles: ParticleSpan, state: ParticleSystemState, values: Float32Array): void {
    PerParticleNumberProvider.read(state.initialOf(particles), this.field, values);
    this.mapping.applyMappingColumn(values);
  }
}

/** PF_TYPE_PARTICLE_VECTOR_COMPONENT and PF_TYPE_PARTICLE_INITIAL_VECTOR_COMPONENT. */
export class PerParticleVectorComponentNumberProvider extends NumberProvider {
  private readonly field: number;
  private readonly component: number;
  private readonly initial: boolean;
  private readonly mapping: AttributeMapping;

  constructor(parse: ParticleDefinitionParser, initial: boolean) {
    super();
    this.field = parse.particleField('m_nVectorAttribute', ParticleField.Color);
    this.component = parse.int32('m_nVectorComponent');
    this.initial = initial;
    this.mapping = new AttributeMapping(parse);

    if (initial) {
      parse.addInitialRead(this.field);
    }
  }

  nextNumber(): number {
    return 0;
  }

  get isPerParticle(): boolean {
    return true;
  }

  fill(particles: ParticleSpan, state: ParticleSystemState, values: Float32Array): void {
    const source = this.initial ? state.initialOf(particles) : particles;
    const vectors = source.readVectors(this.field);

    for (let i = 0; i < values.length; i++) {
      values[i] = readVector(vectors, i).component(this.component);
    }

    this.mapping.applyMappingColumn(values);
  }
}

/** The velocity of a particle that moved from `previous` to `position` over `frameTime`, or zero. */
export function particleVelocity(position: Vector3, previous: Vector3, frameTime: number): Vector3 {
  return frameTime > 0 ? position.sub(previous).div(frameTime) : Vector3.zero;
}

/** PF_TYPE_PARTICLE_SPEED. */
export class PerParticleSpeedNumberProvider extends NumberProvider {
  private readonly attributeMapping: AttributeMapping;

  constructor(parse: ParticleDefinitionParser) {
    super();
    this.attributeMapping = new AttributeMapping(parse);
  }

  nextNumber(): number {
    return 0;
  }

  get isPerParticle(): boolean {
    return true;
  }

  fill(particles: ParticleSpan, state: ParticleSystemState, values: Float32Array): void {
    const frameTime = state.data?.currentFrameTime ?? 0;
    const positions = particles.readVectors(ParticleField.Position);
    const previousPositions = particles.readVectors(ParticleField.PositionPrevious);

    for (let i = 0; i < values.length; i++) {
      values[i] = particleVelocity(readVector(positions, i), readVector(previousPositions, i), frameTime).length();
    }

    this.attributeMapping.applyMappingColumn(values);
  }
}

/** PF_TYPE_PARTICLE_NUMBER: the particle's place in the collection, or its particle number while initializing. */
export class PerParticleCountNumberProvider extends NumberProvider {
  private readonly attributeMapping: AttributeMapping;
  private readonly reverseOrder: boolean;

  constructor(parse: ParticleDefinitionParser) {
    super();
    this.attributeMapping = new AttributeMapping(parse);
    this.reverseOrder = parse.boolean('m_bReverseOrder');
  }

  nextNumber(): number {
    return 0;
  }

  get isPerParticle(): boolean {
    return true;
  }

  fill(particles: ParticleSpan, state: ParticleSystemState, values: Float32Array): void {
    for (let i = 0; i < values.length; i++) {
      values[i] = this.number(particles.start + i, state);
    }

    this.attributeMapping.applyMappingColumn(values);
  }

  private number(index: number, state: ParticleSystemState): number {
    let place = index;

    if (state.initializingParticles) {
      place -= state.initializedFirst;
    }

    if (this.reverseOrder) {
      return state.particleCount - place;
    }

    if (state.initializingParticles) {
      return state.particleNumber(index);
    }

    return place;
  }
}

/** PF_TYPE_PARTICLE_NUMBER_NORMALIZED. */
export class PerParticleCountNormalizedNumberProvider extends NumberProvider {
  private readonly attributeMapping: AttributeMapping;

  constructor(parse: ParticleDefinitionParser) {
    super();
    this.attributeMapping = new AttributeMapping(parse);
  }

  nextNumber(): number {
    return 0;
  }

  get isPerParticle(): boolean {
    return true;
  }

  fill(particles: ParticleSpan, state: ParticleSystemState, values: Float32Array): void {
    const behaviorVersion = state.data?.behaviorVersion;
    const divisor = behaviorVersion !== undefined && behaviorVersion >= 12
      ? Math.max(state.particleCount - 1, 1)
      : Math.max(state.particleCount, 1);
    const reciprocal = f32(1 / divisor);

    for (let i = 0; i < values.length; i++) {
      values[i] = (particles.start + i) * reciprocal;
    }

    this.attributeMapping.applyMappingColumn(values);
  }
}

/** PF_TYPE_PARTICLE_ROPE_SEGMENT. */
export class RopeSegmentNumberProvider extends NumberProvider {
  private readonly attributeMapping: AttributeMapping;
  private readonly reverseOrder: boolean;

  constructor(parse: ParticleDefinitionParser) {
    super();
    this.attributeMapping = new AttributeMapping(parse);
    this.reverseOrder = parse.boolean('m_bReverseOrder');
  }

  nextNumber(): number {
    return 0;
  }

  get isPerParticle(): boolean {
    return true;
  }

  fill(particles: ParticleSpan, _state: ParticleSystemState, values: Float32Array): void {
    const segments = particles.readVectors(ParticleField.RopeSegmentData);

    for (let i = 0; i < values.length; i++) {
      const data = readVector(segments, i);
      values[i] = this.reverseOrder ? data.z - data.x : data.x;
    }

    this.attributeMapping.applyMappingColumn(values);
  }
}

/** PF_TYPE_PARTICLE_ROPE_SEGMENT_NORMALIZED. */
export class RopeSegmentNormalizedNumberProvider extends NumberProvider {
  private readonly attributeMapping: AttributeMapping;

  constructor(parse: ParticleDefinitionParser) {
    super();
    this.attributeMapping = new AttributeMapping(parse);
  }

  nextNumber(): number {
    return 0;
  }

  get isPerParticle(): boolean {
    return true;
  }

  fill(particles: ParticleSpan, _state: ParticleSystemState, values: Float32Array): void {
    const segments = particles.readVectors(ParticleField.RopeSegmentData);

    for (let i = 0; i < values.length; i++) {
      values[i] = segments[i * 3 + 1];
    }

    this.attributeMapping.applyMappingColumn(values);
  }
}

/** PF_TYPE_CONTROL_POINT_COMPONENT. */
export class ControlPointComponentNumberProvider extends NumberProvider {
  private readonly attributeMapping: AttributeMapping;
  private readonly cp: number;
  private readonly vectorComponent: number;

  constructor(parse: ParticleDefinitionParser) {
    super();
    this.attributeMapping = new AttributeMapping(parse);
    this.cp = parse.int32('m_nControlPoint');
    this.vectorComponent = parse.int32('m_nVectorComponent');
  }

  nextNumber(state: ParticleSystemState): number {
    return this.attributeMapping.applyMapping(state.getControlPoint(this.cp).position.component(this.vectorComponent));
  }
}

/** PF_TYPE_RENDERER_CAMERA_DISTANCE: camera distance to the control point or to the bounds centre. */
export class RendererCameraDistanceNumberProvider extends NumberProvider {
  private readonly attributeMapping: AttributeMapping;
  private readonly cp: number;
  private readonly useBoundsCenter: boolean;

  constructor(parse: ParticleDefinitionParser) {
    super();
    this.attributeMapping = new AttributeMapping(parse);
    this.cp = parse.int32('m_nControlPoint');
    this.useBoundsCenter = parse.boolean('m_bUseBoundsCenter');
  }

  nextNumber(state: ParticleSystemState): number {
    const system = state.data;
    const target = this.useBoundsCenter && system !== null
      ? system.localBoundingBoxCenter.add(system.mainControlPoint.position)
      : state.getControlPoint(this.cp).position;

    return this.attributeMapping.applyMapping(distance(state.cameraPosition, target));
  }
}

/** PF_TYPE_PARTICLE_NOISE: fractal noise over a vector attribute, or over the control point for the collection. */
export class NoiseNumberProvider extends NumberProvider {
  private readonly inputField: number;
  private readonly controlPoint: number;
  private readonly noise: NoiseEvaluator;
  private readonly mapping: AttributeMapping;

  constructor(parse: ParticleDefinitionParser) {
    super();
    this.inputField = parse.particleField('m_nNoiseInputVectorAttribute', ParticleField.Position);
    this.controlPoint = parse.int32('m_nControlPoint', 0);
    this.noise = new NoiseEvaluator(parse);
    this.mapping = new AttributeMapping(parse);
  }

  nextNumber(state: ParticleSystemState): number {
    const input = this.controlPoint < 0 ? Vector3.zero : state.getControlPoint(this.controlPoint).position;
    return this.mapping.applyMapping(this.noise.evaluate(input, state.age));
  }

  get isPerParticle(): boolean {
    return true;
  }

  fill(particles: ParticleSpan, state: ParticleSystemState, values: Float32Array): void {
    const inputs = particles.readVectors(this.inputField);

    for (let i = 0; i < values.length; i++) {
      values[i] = this.noise.evaluate(readVector(inputs, i), state.age);
    }

    this.mapping.applyMappingColumn(values);
  }
}

/** PF_TYPE_CONTROL_POINT_SPEED: distance moved since the previous frame over the step being run. */
export class ControlPointSpeedNumberProvider extends NumberProvider {
  private static readonly fallbackStep = f32(0.1);

  private readonly attributeMapping: AttributeMapping;
  private readonly cp: number;

  constructor(parse: ParticleDefinitionParser) {
    super();
    this.attributeMapping = new AttributeMapping(parse);
    this.cp = parse.int32('m_nControlPoint');
  }

  nextNumber(state: ParticleSystemState): number {
    const point = state.getControlPoint(this.cp);
    let step = state.data?.currentFrameTime ?? 0;

    if (step === 0) {
      step = ControlPointSpeedNumberProvider.fallbackStep;
    }

    return this.attributeMapping.applyMapping(f32(distance(point.position, point.positionPrevious) / step));
  }
}

/** PF_TYPE_CONTROL_POINT_CHANGE_AGE. */
export class ControlPointChangeAgeNumberProvider extends NumberProvider {
  private readonly attributeMapping: AttributeMapping;
  private readonly cp: number;

  constructor(parse: ParticleDefinitionParser) {
    super();
    this.attributeMapping = new AttributeMapping(parse);
    this.cp = parse.int32('m_nControlPoint');
  }

  nextNumber(state: ParticleSystemState): number {
    return this.attributeMapping.applyMapping(f32(state.age - state.getControlPoint(this.cp).changeTime));
  }
}

/** PF_TYPE_CONTROL_POINT_IS_SET: 1 once the control point has changed. */
export class ControlPointIsSetNumberProvider extends NumberProvider {
  private readonly attributeMapping: AttributeMapping;
  private readonly cp: number;

  constructor(parse: ParticleDefinitionParser) {
    super();
    this.attributeMapping = new AttributeMapping(parse);
    this.cp = parse.int32('m_nControlPoint');
  }

  nextNumber(state: ParticleSystemState): number {
    const isSet = this.cp !== -1 && state.getControlPoint(this.cp).changeTime !== -1;
    return this.attributeMapping.applyMapping(isSet ? 1 : 0);
  }
}

/** PF_TYPE_SNAPSHOT_COUNT. */
export class SnapshotCountNumberProvider extends NumberProvider {
  private readonly attributeMapping: AttributeMapping;
  private readonly snapshot: SnapshotBinding;

  constructor(parse: ParticleDefinitionParser) {
    super();
    this.attributeMapping = new AttributeMapping(parse);
    this.snapshot = new SnapshotBinding(parse, 'm_nControlPoint', 0);
  }

  nextNumber(state: ParticleSystemState): number {
    return this.attributeMapping.applyMapping(this.snapshot.count(state));
  }
}

/** PF_TYPE_CONTROL_POINT_DISTANCE. */
export class ControlPointDistanceNumberProvider extends NumberProvider {
  private readonly attributeMapping: AttributeMapping;
  private readonly cp: number;

  constructor(parse: ParticleDefinitionParser) {
    super();
    this.attributeMapping = new AttributeMapping(parse);
    this.cp = parse.int32('m_nControlPoint');
  }

  nextNumber(): number {
    return 0;
  }

  get isPerParticle(): boolean {
    return true;
  }

  fill(particles: ParticleSpan, state: ParticleSystemState, values: Float32Array): void {
    const target = state.getControlPoint(this.cp).position;
    const positions = particles.readVectors(ParticleField.Position);

    for (let i = 0; i < values.length; i++) {
      values[i] = distance(readVector(positions, i), target);
    }

    this.attributeMapping.applyMappingColumn(values);
  }
}

/** The CParticleFloatInput of type `type` (ParticleDefinitionParser.ReadNumberProvider), or null for PF_TYPE_INVALID. */
export function createNumberProvider(type: string, parse: ParticleDefinitionParser): NumberProvider | null {
  switch (type) {
    case 'PF_TYPE_INVALID':
      return null;
    case 'PF_TYPE_LITERAL':
      return new LiteralNumberProvider(parse.float('m_flLiteralValue'));
    case 'PF_TYPE_RANDOM_UNIFORM':
      return new RandomNumberProvider(parse, false);
    case 'PF_TYPE_RANDOM_BIASED':
      return new RandomNumberProvider(parse, true);
    case 'PF_TYPE_NAMED_VALUE':
      return new NamedValueNumberProvider(parse);
    case 'PF_TYPE_COLLECTION_AGE':
      return new CollectionAgeNumberProvider(parse);
    case 'PF_TYPE_ENDCAP_AGE':
      return new EndCapAgeNumberProvider(parse);
    case 'PF_TYPE_CONTROL_POINT_COMPONENT':
      return new ControlPointComponentNumberProvider(parse);
    case 'PF_TYPE_PARTICLE_DETAIL_LEVEL':
      return new DetailLevelNumberProvider(parse);
    case 'PF_TYPE_PARTICLE_AGE':
      return new ParticleAgeNumberProvider(parse);
    case 'PF_TYPE_PARTICLE_AGE_NORMALIZED':
      return new ParticleAgeNormalizedNumberProvider(parse);
    case 'PF_TYPE_PARTICLE_FLOAT':
      return new PerParticleNumberProvider(parse);
    case 'PF_TYPE_PARTICLE_INITIAL_FLOAT':
      return new PerParticleInitialNumberProvider(parse);
    case 'PF_TYPE_PARTICLE_VECTOR_COMPONENT':
      return new PerParticleVectorComponentNumberProvider(parse, false);
    case 'PF_TYPE_PARTICLE_INITIAL_VECTOR_COMPONENT':
      return new PerParticleVectorComponentNumberProvider(parse, true);
    case 'PF_TYPE_RENDERER_CAMERA_DISTANCE':
      return new RendererCameraDistanceNumberProvider(parse);
    case 'PF_TYPE_PARTICLE_SPEED':
      return new PerParticleSpeedNumberProvider(parse);
    case 'PF_TYPE_PARTICLE_NUMBER':
      return new PerParticleCountNumberProvider(parse);
    case 'PF_TYPE_PARTICLE_NUMBER_NORMALIZED':
      return new PerParticleCountNormalizedNumberProvider(parse);
    case 'PF_TYPE_CONTROL_POINT_SPEED':
      return new ControlPointSpeedNumberProvider(parse);
    case 'PF_TYPE_CONTROL_POINT_CHANGE_AGE':
      return new ControlPointChangeAgeNumberProvider(parse);
    case 'PF_TYPE_CONTROL_POINT_IS_SET':
      return new ControlPointIsSetNumberProvider(parse);
    case 'PF_TYPE_SNAPSHOT_COUNT':
      return new SnapshotCountNumberProvider(parse);
    case 'PF_TYPE_CONTROL_POINT_DISTANCE':
      return new ControlPointDistanceNumberProvider(parse);
    case 'PF_TYPE_PARTICLE_NOISE':
      return new NoiseNumberProvider(parse);
    case 'PF_TYPE_PARTICLE_ROPE_SEGMENT':
      return new RopeSegmentNumberProvider(parse);
    case 'PF_TYPE_PARTICLE_ROPE_SEGMENT_NORMALIZED':
      return new RopeSegmentNormalizedNumberProvider(parse);
    default:
      // Known types VRF does not support either: PF_TYPE_CLOSEST_CAMERA_DISTANCE, PF_TYPE_CONCURRENT_DEF_COUNT, PF_TYPE_RANGE
      parse.logger.report('unsupported-input', `Number provider of type ${type} is not supported, using its literal value`);
      return new LiteralNumberProvider(parse.float('m_flLiteralValue'));
  }
}
