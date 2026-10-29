// Ported from ValveResourceFormat (MIT): ValveResourceFormat/Particles/IVectorProvider.cs and the
// vector input switch of ValveResourceFormat/Particles/ParticleDefinitionParser.cs.
//
// Vector columns hold three floats per particle. Every input type VRF runs is ported;
// PVEC_TYPE_PARTICLE_GRAVITY (unsupported by VRF too) and unknown types fall back to their literal
// value as VRF does, and are reported.

import { fillVectors, readVector, writeVector } from './buffer';
import { ParticleField } from './enums';
import { getSubCollection } from './kv';
import { Vector3, distanceSquared, lerpV, lerpVV, saturate, f32, transformNormal } from './numerics';
import { LiteralNumberProvider, type NumberProvider, particleVelocity } from './numberProviders';
import type { ParticleDefinitionParser } from './parser';
import type { ParticleSpan } from './span';
import type { ParticleSystemState } from './state';
import { ControlPointTransformProvider } from './transformProviders';
import { ColorGradient } from './utils/colorGradient';
import { FLOAT_EPSILON } from './utils/particleMath';
import { type EvaluationKey, type ParticleRandom, sameEvaluation } from './utils/random';

/** A vector input that may vary per particle or per frame (CParticleVecInput). */
export abstract class VectorProvider {
  /** The value for the whole collection. Inputs that read a particle return zero. */
  abstract nextVector(state: ParticleSystemState): Vector3;

  /** Writes the value for each particle of `particles` into `values` (three floats each). */
  fill(particles: ParticleSpan, state: ParticleSystemState, values: Float32Array): void {
    if (!particles.isEmpty) {
      fillVectors(values.subarray(0, particles.length * 3), this.nextVector(state));
    }
  }

  fillNew(particles: ParticleSpan, state: ParticleSystemState): Float32Array {
    const values = new Float32Array(particles.length * 3);
    this.fill(particles, state, values);
    return values;
  }

  /** Whether the input takes its random draws block by block as the function walks its particles. */
  get drawsPerBlock(): boolean {
    return false;
  }

  /** Writes the values of `block`, the first of which reads lane `lane` of one evaluation. */
  fillBlock(block: ParticleSpan, _lane: number, state: ParticleSystemState, values: Float32Array): void {
    this.fill(block, state, values);
  }

  /** Fills the values of `block` at the start of `values` if the input draws per block. */
  fillPerBlock(block: ParticleSpan, lane: number, state: ParticleSystemState, values: Float32Array): void {
    if (this.drawsPerBlock) {
      this.fillBlock(block, lane, state, values.subarray(0, block.length * 3));
    }
  }

  /** Sets the input up for a function call over `particles`; filled now unless it draws per block. */
  prepare(particles: ParticleSpan, state: ParticleSystemState): Float32Array {
    const values = new Float32Array(particles.length * 3);

    if (!this.drawsPerBlock) {
      this.fill(particles, state, values);
    }

    return values;
  }

  /** Sets the input up over `evaluated`, which contains `particles`, and returns the column of `particles`. */
  prepareEvaluated(particles: ParticleSpan, evaluated: ParticleSpan, state: ParticleSystemState): Float32Array {
    const offset = particles.start - evaluated.start;
    return this.prepare(evaluated, state).subarray(offset * 3, (offset + particles.length) * 3);
  }

  nextVectorAt(particles: ParticleSpan, index: number, state: ParticleSystemState): Vector3 {
    const value = new Float32Array(3);
    this.fill(particles.slice(index, 1), state, value);
    return readVector(value, 0);
  }
}

/** PVEC_TYPE_CLOSEST_CAMERA_POSITION: the single render camera is always the closest one. */
export class ClosestCameraPositionVectorProvider extends VectorProvider {
  nextVector(state: ParticleSystemState): Vector3 {
    return state.cameraPosition;
  }
}

export class LiteralVectorProvider extends VectorProvider {
  readonly value: Vector3;

  constructor(value: Vector3) {
    super();
    this.value = value;
  }

  nextVector(): Vector3 {
    return this.value;
  }

  fill(_particles: ParticleSpan, _state: ParticleSystemState, values: Float32Array): void {
    fillVectors(values, this.value);
  }
}

/** An input evaluated for the whole collection (CParticleCollectionVecInput). */
export class CollectionVectorInput extends VectorProvider {
  private readonly input: VectorProvider;

  constructor(input: VectorProvider) {
    super();
    this.input = input;
  }

  nextVector(state: ParticleSystemState): Vector3 {
    return this.input.nextVector(state);
  }
}

/** Literal colors are authored as 0-255; providers return normalized 0-1 colors. */
export class LiteralColorVectorProvider extends VectorProvider {
  readonly value: Vector3;

  constructor(value: Vector3) {
    super();
    this.value = value.div(255);
  }

  nextVector(): Vector3 {
    return this.value;
  }

  fill(_particles: ParticleSpan, _state: ParticleSystemState, values: Float32Array): void {
    fillVectors(values, this.value);
  }
}

/** PVEC_TYPE_PARTICLE_VECTOR and PVEC_TYPE_PARTICLE_INITIAL_VECTOR. */
export class PerParticleVectorProvider extends VectorProvider {
  private readonly vectorAttribute: number;
  private readonly vectorAttributeScale: Vector3;
  private readonly initial: boolean;

  constructor(parse: ParticleDefinitionParser, initial: boolean) {
    super();
    this.vectorAttribute = parse.particleField('m_nVectorAttribute', ParticleField.Color);
    this.vectorAttributeScale = parse.vector3('m_vVectorAttributeScale', Vector3.one);
    this.initial = initial;

    if (initial) {
      parse.addInitialRead(this.vectorAttribute);
    }
  }

  nextVector(): Vector3 {
    return Vector3.zero;
  }

  fill(particles: ParticleSpan, state: ParticleSystemState, values: Float32Array): void {
    const source = this.initial ? state.initialOf(particles) : particles;
    const vectors = source.readVectors(this.vectorAttribute);

    for (let i = 0; i < particles.length; i++) {
      writeVector(values, i, this.vectorAttributeScale.mul(readVector(vectors, i)));
    }
  }
}

/** PVEC_TYPE_PARTICLE_VELOCITY. */
export class ParticleVelocityVectorProvider extends VectorProvider {
  private readonly vectorAttributeScale: Vector3;

  constructor(parse: ParticleDefinitionParser | null = null) {
    super();
    this.vectorAttributeScale = parse?.vector3('m_vVectorAttributeScale', Vector3.one) ?? Vector3.one;
  }

  nextVector(): Vector3 {
    return Vector3.zero;
  }

  fill(particles: ParticleSpan, state: ParticleSystemState, values: Float32Array): void {
    const frameTime = state.data?.currentFrameTime ?? 0;
    const positions = particles.readVectors(ParticleField.Position);
    const previousPositions = particles.readVectors(ParticleField.PositionPrevious);

    for (let i = 0; i < particles.length; i++) {
      writeVector(values, i, this.vectorAttributeScale.mul(particleVelocity(readVector(positions, i), readVector(previousPositions, i), frameTime)));
    }
  }
}

/** PVEC_TYPE_NAMED_VALUE. */
export class NamedValueVectorProvider extends VectorProvider {
  private readonly name: string;
  private readonly follow: boolean;

  constructor(parse: ParticleDefinitionParser) {
    super();
    this.name = parse.string('m_NamedValue');
    this.follow = parse.boolean('m_bFollowNamedValue');
  }

  nextVector(state: ParticleSystemState): Vector3 {
    return state.data?.namedValues.getVector(this.name, this.follow) ?? Vector3.zero;
  }
}

/** PVEC_TYPE_CP_VALUE. */
export class CPValueVectorProvider extends VectorProvider {
  private readonly cp: number;
  private readonly scale: Vector3;

  constructor(parse: ParticleDefinitionParser | null, controlPoint = 0) {
    super();
    this.cp = parse?.int32('m_nControlPoint') ?? controlPoint;
    this.scale = parse?.vector3('m_vCPValueScale', Vector3.one) ?? Vector3.one;
  }

  nextVector(state: ParticleSystemState): Vector3 {
    return state.getControlPoint(this.cp).position.mul(this.scale);
  }
}

/** PVEC_TYPE_CP_DELTA. */
export class CPDeltaVectorProvider extends VectorProvider {
  private readonly cp: number;
  private readonly deltaCP: number;

  constructor(parse: ParticleDefinitionParser) {
    super();
    this.cp = parse.int32('m_nControlPoint');
    this.deltaCP = parse.int32('m_nDeltaControlPoint');
  }

  nextVector(state: ParticleSystemState): Vector3 {
    return state.getControlPoint(this.cp).position.sub(state.getControlPoint(this.deltaCP).position);
  }
}

/** PVEC_TYPE_CP_RELATIVE_POSITION: an offset placed in the control point's frame. */
export class CPRelativePositionProvider extends VectorProvider {
  private readonly cp: number;
  private readonly relativePosition: Vector3;

  constructor(parse: ParticleDefinitionParser) {
    super();
    this.cp = parse.int32('m_nControlPoint');
    this.relativePosition = parse.vector3('m_vCPRelativePosition', Vector3.zero);
  }

  nextVector(state: ParticleSystemState): Vector3 {
    return ControlPointTransformProvider.transformPosition(state, this.cp, this.relativePosition);
  }
}

/** PVEC_TYPE_CP_RELATIVE_DIR: a direction rotated into the control point's frame. */
export class CPRelativeDirectionProvider extends VectorProvider {
  private readonly cp: number;
  private readonly relativeDirection: Vector3;

  constructor(parse: ParticleDefinitionParser) {
    super();
    this.cp = parse.int32('m_nControlPoint');
    this.relativeDirection = parse.vector3('m_vCPRelativeDir', Vector3.unitX);
  }

  nextVector(state: ParticleSystemState): Vector3 {
    return ControlPointTransformProvider.transformDirection(state, this.cp, this.relativeDirection);
  }
}

/**
 * PVEC_TYPE_RANDOM_UNIFORM. Each block of four particles in a function call takes twelve draws, four
 * per axis, and a particle reads the draw of its lane in each axis.
 */
export class RandomUniformVectorProvider extends VectorProvider {
  private static readonly blockDraws = 12;

  private readonly min: Vector3;
  private readonly max: Vector3;

  /** Whether the range is a single point, which takes no draw at all. */
  private readonly isDegenerate: boolean;

  private blockKey: EvaluationKey | null = null;
  private blockCounter = 0;

  constructor(parse: ParticleDefinitionParser) {
    super();
    this.min = parse.vector3('m_vRandomMin');
    this.max = parse.vector3('m_vRandomMax');
    this.isDegenerate = distanceSquared(this.min, this.max) <= FLOAT_EPSILON;
  }

  nextVector(state: ParticleSystemState): Vector3 {
    return this.drawOnce(state.random);
  }

  get drawsPerBlock(): boolean {
    return true;
  }

  fill(particles: ParticleSpan, state: ParticleSystemState, values: Float32Array): void {
    for (const { offset, block } of particles.blocks()) {
      this.fillBlock(block, block.start & 3, state, values.subarray(offset * 3, (offset + block.length) * 3));
    }
  }

  fillBlock(block: ParticleSpan, lane: number, state: ParticleSystemState, values: Float32Array): void {
    if (this.isDegenerate) {
      fillVectors(values.subarray(0, block.length * 3), this.min);
    } else {
      const random = state.random;
      const counter = random.reserve(RandomUniformVectorProvider.blockDraws);

      for (let i = 0; i < block.length; i++) {
        writeVector(values, i, this.lane(random, counter, lane + i));
      }
    }

    this.apply(block, state, values);
  }

  /** Turns the drawn values into the input's values, for the input types built on this one. */
  protected apply(_particles: ParticleSpan, _state: ParticleSystemState, _values: Float32Array): void {}

  /** The drawn value for the collection, drawing its block only at the first read in the function call. */
  protected drawOnce(random: ParticleRandom): Vector3 {
    if (this.isDegenerate) {
      return this.min;
    }

    const key = random.evaluation();

    if (!sameEvaluation(this.blockKey, key)) {
      this.blockKey = key;
      this.blockCounter = random.reserve(RandomUniformVectorProvider.blockDraws);
    }

    return this.lane(random, this.blockCounter, 0);
  }

  private lane(random: ParticleRandom, counter: number, lane: number): Vector3 {
    const first = counter + lane;
    return lerpVV(this.min, this.max, new Vector3(random.drawn(first), random.drawn(first + 4), random.drawn(first + 8)));
  }
}

/** PVEC_TYPE_RANDOM_UNIFORM_OFFSET. */
export class RandomUniformOffsetVectorProvider extends RandomUniformVectorProvider {
  private readonly vectorAttribute: number;
  private readonly vectorAttributeScale: Vector3;

  constructor(parse: ParticleDefinitionParser) {
    super(parse);
    this.vectorAttribute = parse.particleField('m_nVectorAttribute', ParticleField.Color);
    this.vectorAttributeScale = parse.vector3('m_vVectorAttributeScale', Vector3.one);
  }

  /** The collection reads the attribute of the first slot of its particles, live or not. */
  nextVector(state: ParticleSystemState): Vector3 {
    const value = super.nextVector(state);
    const attribute = state.data?.particles.firstSlotVector(this.vectorAttribute) ?? Vector3.zero;
    return this.vectorAttributeScale.mul(attribute).add(value);
  }

  protected apply(particles: ParticleSpan, _state: ParticleSystemState, values: Float32Array): void {
    const vectors = particles.readVectors(this.vectorAttribute);

    for (let i = 0; i < particles.length; i++) {
      writeVector(values, i, this.vectorAttributeScale.mul(readVector(vectors, i)).add(readVector(values, i)));
    }
  }
}

/** PVEC_TYPE_CP_RELATIVE_RANDOM_DIR: a random vector rotated into the control point's frame at creation. */
export class CPRelativeRandomDirectionProvider extends RandomUniformVectorProvider {
  private readonly controlPoint: ControlPointTransformProvider;

  constructor(parse: ParticleDefinitionParser) {
    super(parse);
    this.controlPoint = new ControlPointTransformProvider(parse.int32('m_nControlPoint'), true);
  }

  nextVector(state: ParticleSystemState): Vector3 {
    return transformNormal(super.nextVector(state), this.controlPoint.nextTransform(state));
  }

  protected apply(particles: ParticleSpan, state: ParticleSystemState, values: Float32Array): void {
    const creationTimes = particles.readFloats(ParticleField.CreationTime);

    for (let i = 0; i < particles.length; i++) {
      writeVector(values, i, transformNormal(readVector(values, i), this.controlPoint.nextTransformAtTime(state, creationTimes[i])));
    }
  }
}

/** PVEC_TYPE_FLOAT_COMPONENTS: three float inputs, each evaluated over all the particles before the next. */
export class FloatComponentsVectorProvider extends VectorProvider {
  private readonly x: NumberProvider;
  private readonly y: NumberProvider;
  private readonly z: NumberProvider;

  constructor(parse: ParticleDefinitionParser) {
    super();
    this.x = parse.numberProvider('m_FloatComponentX', new LiteralNumberProvider(0));
    this.y = parse.numberProvider('m_FloatComponentY', new LiteralNumberProvider(0));
    this.z = parse.numberProvider('m_FloatComponentZ', new LiteralNumberProvider(0));
  }

  nextVector(state: ParticleSystemState): Vector3 {
    const x = this.x.nextNumber(state);
    const y = this.y.nextNumber(state);
    const z = this.z.nextNumber(state);
    return new Vector3(x, y, z);
  }

  fill(particles: ParticleSpan, state: ParticleSystemState, values: Float32Array): void {
    const evaluated = state.vectorInputParticles(particles);
    const xs = this.x.fillNew(evaluated, state);
    const ys = this.y.fillNew(evaluated, state);
    const zs = this.z.fillNew(evaluated, state);

    for (let i = 0; i < particles.length; i++) {
      writeVector(values, i, new Vector3(xs[i], ys[i], zs[i]));
    }
  }
}

/** PVEC_TYPE_FLOAT_INTERP_CLAMPED, _OPEN and _GRADIENT. */
export class FloatInterpolationVectorProvider extends VectorProvider {
  private readonly floatInterp: NumberProvider;
  private readonly input0: number;
  private readonly input1: number;
  private readonly output0: Vector3;
  private readonly output1: Vector3;
  private readonly clamp: boolean;
  private readonly gradient: ColorGradient | null = null;

  constructor(parse: ParticleDefinitionParser, isClamped: boolean, isGradient: boolean) {
    super();
    this.floatInterp = parse.numberProvider('m_FloatInterp', new LiteralNumberProvider(0));
    this.input0 = parse.float('m_flInterpInput0', 0);
    this.input1 = parse.float('m_flInterpInput1', 1);
    this.output0 = parse.vector3('m_vInterpOutput0', Vector3.zero);
    this.output1 = parse.vector3('m_vInterpOutput1', Vector3.one);
    this.clamp = isClamped;

    if (isGradient) {
      this.gradient = new ColorGradient(getSubCollection(parse.data, 'm_Gradient'));
    }
  }

  nextVector(state: ParticleSystemState): Vector3 {
    return this.interpolate(this.floatInterp.nextNumber(state));
  }

  fill(particles: ParticleSpan, state: ParticleSystemState, values: Float32Array): void {
    const inputs = this.floatInterp.fillNew(state.vectorInputParticles(particles), state);

    for (let i = 0; i < particles.length; i++) {
      writeVector(values, i, this.interpolate(inputs[i]));
    }
  }

  private interpolate(value: number): Vector3 {
    let t = f32(f32(value - this.input0) / f32(this.input1 - this.input0));

    if (this.gradient !== null) {
      return this.gradient.evaluate(t);
    }

    if (this.clamp) {
      t = saturate(t);
    }

    return lerpV(this.output0, this.output1, t);
  }
}

/** The CParticleVecInput of type `type` (ParticleDefinitionParser.ReadVectorProvider). */
export function createVectorProvider(type: string, parse: ParticleDefinitionParser): VectorProvider {
  switch (type) {
    case 'PVEC_TYPE_LITERAL':
      return new LiteralVectorProvider(parse.vector3('m_vLiteralValue'));
    case 'PVEC_TYPE_LITERAL_COLOR':
      return new LiteralColorVectorProvider(parse.vector3('m_LiteralColor'));
    case 'PVEC_TYPE_NAMED_VALUE':
      return new NamedValueVectorProvider(parse);
    case 'PVEC_TYPE_PARTICLE_VECTOR':
      return new PerParticleVectorProvider(parse, false);
    case 'PVEC_TYPE_PARTICLE_INITIAL_VECTOR':
      return new PerParticleVectorProvider(parse, true);
    case 'PVEC_TYPE_CLOSEST_CAMERA_POSITION':
      return new ClosestCameraPositionVectorProvider();
    case 'PVEC_TYPE_PARTICLE_VELOCITY':
      return new ParticleVelocityVectorProvider(parse);
    case 'PVEC_TYPE_CP_VALUE':
      return new CPValueVectorProvider(parse);
    case 'PVEC_TYPE_CP_DELTA':
      return new CPDeltaVectorProvider(parse);
    case 'PVEC_TYPE_CP_RELATIVE_POSITION':
      return new CPRelativePositionProvider(parse);
    case 'PVEC_TYPE_CP_RELATIVE_DIR':
      return new CPRelativeDirectionProvider(parse);
    case 'PVEC_TYPE_FLOAT_COMPONENTS':
      return new FloatComponentsVectorProvider(parse);
    case 'PVEC_TYPE_FLOAT_INTERP_CLAMPED':
      return new FloatInterpolationVectorProvider(parse, true, false);
    case 'PVEC_TYPE_FLOAT_INTERP_OPEN':
      return new FloatInterpolationVectorProvider(parse, false, false);
    case 'PVEC_TYPE_FLOAT_INTERP_GRADIENT':
      return new FloatInterpolationVectorProvider(parse, false, true);
    case 'PVEC_TYPE_RANDOM_UNIFORM':
      return new RandomUniformVectorProvider(parse);
    case 'PVEC_TYPE_RANDOM_UNIFORM_OFFSET':
      return new RandomUniformOffsetVectorProvider(parse);
    case 'PVEC_TYPE_CP_RELATIVE_RANDOM_DIR':
      return new CPRelativeRandomDirectionProvider(parse);
    default:
      // PVEC_TYPE_PARTICLE_GRAVITY needs the game's gravity; VRF does not support it either
      parse.logger.report('unsupported-input', `Vector provider of type ${type} is not supported, using its literal value`);
      return new LiteralVectorProvider(parse.vector3('m_vLiteralValue'));
  }
}
