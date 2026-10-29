// Ported from ValveResourceFormat (MIT): ValveResourceFormat/Particles/Utils/ParticleRandom.cs and
// ValveResourceFormat/Particles/Utils/ThreadRandom.cs.

import { TAU, Vector3, f32, lerp, lerpV, toInt } from '../numerics';
import { RANDOM_FLOATS } from './randomFloats';

/** The step by which the operator offset advances between operators. */
const OPERATOR_STRIDE = 17;

/** Unsigned modulo keeps the index valid for any id, including ids that wrapped negative. */
function at(index: number): number {
  return RANDOM_FLOATS[(index >>> 0) % RANDOM_FLOATS.length];
}

/**
 * Identifies the evaluation of an input for the whole collection within one function call of one
 * system (ParticleRandom.EvaluationKey).
 */
export interface EvaluationKey {
  readonly random: ParticleRandom;
  readonly functionCall: number;
}

export function sameEvaluation(a: EvaluationKey | null, b: EvaluationKey): boolean {
  return a !== null && a.random === b.random && a.functionCall === b.functionCall;
}

/**
 * One particle system's access to the shared random table. `next...` advances a counter that runs
 * free for the life of the system, `forParticle...` reads a slot fixed by the particle, and
 * `forSample...` reads a slot the caller worked out in full.
 */
export class ParticleRandom {
  /** The offset into the shared table every deterministic draw by this system is displaced by. */
  seed = 0;

  /** Displaces the per-particle draws of the operator currently running. */
  operatorOffset = 0;

  private queryCount = 0;
  private functionCall = 0;

  /** @internal Read by InputSeed. */
  inputSeedGeneration = 0;

  resetOperatorOffset(): void {
    this.operatorOffset = 0;
    this.beginFunctionCall();
  }

  advanceOperatorOffset(): void {
    this.operatorOffset += OPERATOR_STRIDE;
    this.beginFunctionCall();
  }

  /** Takes `seed` and starts the draws over from `counter`. */
  start(seed: number, counter = 0): void {
    this.seed = seed & 0xfff;
    this.queryCount = counter;
    this.redrawInputSeeds();
    this.beginFunctionCall();
  }

  redrawInputSeeds(): void {
    this.inputSeedGeneration++;
  }

  beginFunctionCall(): void {
    this.functionCall++;
  }

  evaluation(): EvaluationKey {
    return { random: this, functionCall: this.functionCall };
  }

  /** Takes the next value from the table, in [0, 1). */
  next(): number {
    return at((this.queryCount++ + this.seed) | 0);
  }

  /** Takes the next value as an index in [0, count). */
  nextIndex(count: number): number {
    return toInt(f32(count * this.next()));
  }

  /**
   * Takes the next value from the shared counter, or for a non-zero `randomSeed` from a sequence of
   * its own that `counter.value` walks.
   */
  nextOrSeeded(randomSeed: number, counter: { value: number }): number {
    return randomSeed !== 0 ? at((this.seed + randomSeed + counter.value++) | 0) : this.next();
  }

  nextSeededTwice(): number {
    return at((this.queryCount++ + this.seed + this.seed) | 0);
  }

  /** Takes `count` consecutive draws at once and returns the counter of the first. */
  reserve(count: number): number {
    const first = this.queryCount;
    this.queryCount += count;
    return first;
  }

  drawn(counter: number): number {
    return at((counter + this.seed) | 0);
  }

  private nextInterior(): number {
    return f32(f32(this.next() * f32(0.9999)) + f32(0.0001));
  }

  /**
   * Takes three consecutive values as a point drawn uniformly through the unit ball, in the order
   * polar cosine, azimuth, then the radius fraction, which is returned alongside the scaled point.
   */
  nextInUnitBall(): { point: Vector3; radiusFraction: number } {
    const interior = this.nextInterior();
    const cosPolar = f32(f32(interior + interior) - 1);
    const azimuth = f32(this.nextInterior() * TAU);
    const radiusFraction = f32(Math.pow(this.nextInterior(), f32(1 / 3)));

    const sinPolar = f32(Math.sqrt(Math.max(0, f32(1 - f32(cosPolar * cosPolar)))));
    const sin = f32(Math.sin(azimuth));
    const cos = f32(Math.cos(azimuth));
    const ring = f32(sinPolar * radiusFraction);

    return {
      point: new Vector3(ring * cos, ring * sin, radiusFraction * cosPolar),
      radiusFraction,
    };
  }

  nextBetween(min: number, max: number): number {
    return lerp(min, max, this.next());
  }

  nextBetweenV(min: Vector3, max: Vector3): Vector3 {
    return lerpV(min, max, this.next());
  }

  nextWithExponentBetween(exponent: number, min: number, max: number): number {
    return lerp(min, max, f32(Math.pow(this.next(), exponent)));
  }

  nextBetweenPerComponent(min: Vector3, max: Vector3): Vector3 {
    const x = this.nextBetween(min.x, max.x);
    const y = this.nextBetween(min.y, max.y);
    const z = this.nextBetween(min.z, max.z);
    return new Vector3(x, y, z);
  }

  nextBetweenPerComponentSeededTwice(min: Vector3, max: Vector3): Vector3 {
    const x = lerp(min.x, max.x, this.nextSeededTwice());
    const y = lerp(min.y, max.y, this.nextSeededTwice());
    const z = lerp(min.z, max.z, this.nextSeededTwice());
    return new Vector3(x, y, z);
  }

  forParticle(particleId: number, fieldOffset = 0): number {
    return at((this.seed + this.operatorOffset + fieldOffset + particleId) | 0);
  }

  forParticleBetween(particleId: number, fieldOffset: number, min: number, max: number): number {
    return lerp(min, max, this.forParticle(particleId, fieldOffset));
  }

  forParticleBetweenV(particleId: number, fieldOffset: number, min: Vector3, max: Vector3): Vector3 {
    return lerpV(min, max, this.forParticle(particleId, fieldOffset));
  }

  forParticleWithExponentBetween(particleId: number, fieldOffset: number, exponent: number, min: number, max: number): number {
    return lerp(min, max, f32(Math.pow(this.forParticle(particleId, fieldOffset), exponent)));
  }

  static forSample(sampleId: number): number {
    return at(sampleId | 0);
  }

  static forSampleBetween(sampleId: number, min: number, max: number): number {
    return lerp(min, max, at(sampleId | 0));
  }

  static forSampleBetweenPerComponent(sampleId: number, min: Vector3, max: Vector3): Vector3 {
    return new Vector3(
      ParticleRandom.forSampleBetween(sampleId, min.x, max.x),
      ParticleRandom.forSampleBetween(sampleId + 1, min.y, max.y),
      ParticleRandom.forSampleBetween(sampleId + 2, min.z, max.z),
    );
  }
}

/**
 * The per-function seed of an input whose random value is constant per particle. It is drawn from
 * the counter at first use, and again after a redraw, so inputs of different functions read
 * unrelated slots for the same particle.
 */
export class InputSeed {
  private owner: ParticleRandom | null = null;
  private generation = 0;
  private value = 0;

  get(random: ParticleRandom): number {
    if (this.owner !== random || this.generation !== random.inputSeedGeneration) {
      this.owner = random;
      this.generation = random.inputSeedGeneration;
      this.value = toInt(f32(random.next() * -2147483648));
    }

    return this.value;
  }
}

const ENTRIES = 55;
const LANES = 4;

/**
 * The random generator some particle functions draw from instead of the shared table: a lagged
 * Fibonacci generator of four lanes, started from a fixed seed. Each system holds its own.
 */
export class ThreadRandom {
  private readonly ring = new Float32Array(ENTRIES * LANES);
  private lag = 23;
  private head = ENTRIES - 1;

  constructor() {
    let state = 0x12345678;

    for (let i = 0; i < this.ring.length; i++) {
      this.ring[i] = (state >>> 16) / 65536;
      state = Math.imul((state + 1) | 0, 0xbb40e62d) >>> 0;
    }
  }

  /** Takes the next four values in [0, 1), one per lane. */
  next(): number[] {
    return this.nextLanes();
  }

  /** ThreadRandom.NextBetween: scales each of the four lanes, rounding before adding min. */
  nextBetween(min: number, max: number): number[] {
    return this.next().map((value) => f32(f32(value * f32(max - min)) + min));
  }

  /** Takes four points in the unit ball, one per lane, by rejection from the cube. */
  nextInUnitBall(): Vector3[] {
    let x = this.nextSigned();
    let y = this.nextSigned();
    let z = this.nextSigned();
    let outside = lengthsSquared(x, y, z).map((value) => value > 1);

    while (outside.some(Boolean)) {
      const nx = this.nextSigned();
      x = x.map((value, lane) => (outside[lane] ? nx[lane] : value));
      const ny = this.nextSigned();
      y = y.map((value, lane) => (outside[lane] ? ny[lane] : value));
      const nz = this.nextSigned();
      z = z.map((value, lane) => (outside[lane] ? nz[lane] : value));
      outside = lengthsSquared(x, y, z).map((value) => value >= 1);
    }

    return [0, 1, 2, 3].map((lane) => new Vector3(x[lane], y[lane], z[lane]));
  }

  private nextLanes(): number[] {
    const values: number[] = [];

    for (let lane = 0; lane < LANES; lane++) {
      let value = f32(this.ring[this.lag * LANES + lane] + this.ring[this.head * LANES + lane]);

      if (value >= 1) {
        value = f32(value - 1);
      }

      this.ring[this.head * LANES + lane] = value;
      values.push(value);
    }

    this.lag = this.lag === 0 ? ENTRIES - 1 : this.lag - 1;
    this.head = this.head === 0 ? ENTRIES - 1 : this.head - 1;

    return values;
  }

  private nextSigned(): number[] {
    return this.nextLanes().map((value) => f32(f32(value * 2) - 1));
  }
}

function lengthsSquared(x: number[], y: number[], z: number[]): number[] {
  return x.map((_, lane) => f32(f32(z[lane] * z[lane]) + f32(f32(y[lane] * y[lane]) + f32(x[lane] * x[lane]))));
}
