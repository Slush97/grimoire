// Ported from ValveResourceFormat (MIT): ValveResourceFormat/Particles/Initializers/CreateWithinSphereTransform.cs.

import { readVector, writeVector } from '../buffer';
import type { ParticleCollection } from '../collection';
import { ParticleField } from '../enums';
import { fieldMask, isVectorField } from '../fields';
import { ParticleFunctionInitializer } from '../functions';
import { Vector3, clamp, lerp, lerpVV, safeNormalize, transformNormal } from '../numerics';
import { LiteralNumberProvider, type NumberProvider } from '../numberProviders';
import type { ParticleDefinitionParser } from '../parser';
import type { ParticleSpan } from '../span';
import type { ParticleSystemState } from '../state';
import { ControlPointTransformProvider, type TransformProvider } from '../transformProviders';
import { powQuarterSteps } from '../utils/particleMath';
import type { ThreadRandom } from '../utils/random';
import { LiteralVectorProvider, type VectorProvider } from '../vectorProviders';

/**
 * C_INIT_CreateWithinSphereTransform: places particles at random positions within a sphere centred
 * on a transform, with an initial outward velocity drawn from a speed range. The whole blocks of four
 * of an emission of 16 or more particles draw from the thread generator instead of the random table.
 */
export class CreateWithinSphereTransform extends ParticleFunctionInitializer {
  private readonly transformInput: TransformProvider;
  private readonly radiusMin: NumberProvider;
  private readonly radiusMax: NumberProvider;
  private readonly speedMin: NumberProvider;
  private readonly speedMax: NumberProvider;
  private readonly localCoordinateSystemSpeedMin: VectorProvider;
  private readonly localCoordinateSystemSpeedMax: VectorProvider;
  private readonly speedRandExp: number;
  private readonly distanceBias: VectorProvider;

  /** Per-axis flags folding the spawn direction into the positive half of that axis. */
  private readonly distanceBiasAbs: Vector3;

  /** Whether the spawn direction is rotated by the transform, only while the bias shapes the sphere. */
  private readonly localCoords: boolean;

  private readonly outputField: number;

  /** PositionPrevious gives the particle a velocity; any other field receives the position minus the velocity. */
  private readonly velocityField: number;

  constructor(parse: ParticleDefinitionParser) {
    super(parse);
    this.transformInput = parse.transformInput('m_TransformInput', new ControlPointTransformProvider());
    this.radiusMin = parse.numberProvider('m_fRadiusMin', new LiteralNumberProvider(0));
    this.radiusMax = parse.numberProvider('m_fRadiusMax', new LiteralNumberProvider(0));
    this.speedMin = parse.numberProvider('m_fSpeedMin', new LiteralNumberProvider(0));
    this.speedMax = parse.numberProvider('m_fSpeedMax', new LiteralNumberProvider(0));
    this.speedRandExp = clamp(parse.float('m_fSpeedRandExp', 1), -255, 255);
    this.localCoordinateSystemSpeedMin = parse.vectorProvider('m_LocalCoordinateSystemSpeedMin', new LiteralVectorProvider(Vector3.zero));
    this.localCoordinateSystemSpeedMax = parse.vectorProvider('m_LocalCoordinateSystemSpeedMax', new LiteralVectorProvider(Vector3.zero));
    this.distanceBias = parse.vectorProvider('m_vecDistanceBias', new LiteralVectorProvider(Vector3.one));
    this.distanceBiasAbs = parse.vector3('m_vecDistanceBiasAbs', Vector3.zero);
    this.localCoords = parse.boolean('m_bLocalCoords', false);
    this.outputField = parse.particleField('m_nFieldOutput', ParticleField.Position);
    this.velocityField = parse.particleField('m_nFieldVelocity', ParticleField.PositionPrevious);
  }

  get writtenFields(): bigint {
    return this.outputField === ParticleField.Position
      ? fieldMask(ParticleField.Position) | fieldMask(ParticleField.PositionPrevious) | fieldMask(this.velocityField)
      : fieldMask(this.outputField) | fieldMask(this.velocityField);
  }

  private writesVelocity(state: ParticleSystemState): boolean {
    if (this.velocityField === ParticleField.NoneDisabled || this.velocityField < 0) {
      return false;
    }

    return ParticleFunctionInitializer.isUnwritten(state, this.velocityField);
  }

  protected initializeCall(run: ParticleSpan, particles: ParticleCollection, state: ParticleSystemState): void {
    this.initializeRun(run, particles, state, false);
  }

  protected initializeBlocks(run: ParticleSpan, particles: ParticleCollection, state: ParticleSystemState): void {
    this.initializeRun(run, particles, state, true);
  }

  private initializeRun(run: ParticleSpan, particles: ParticleCollection, state: ParticleSystemState, blockRun: boolean): void {
    const creationTimes = run.readFloats(ParticleField.CreationTime);
    const outputs = isVectorField(this.outputField) ? run.vectors(this.outputField) : null;
    const writesVelocity = this.writesVelocity(state);
    const velocities = writesVelocity && isVectorField(this.velocityField) ? run.vectors(this.velocityField) : null;
    const previous = writesVelocity && this.outputField === ParticleField.Position ? run.vectors(ParticleField.PositionPrevious) : null;

    const radiusMins = this.radiusMin.fillNew(run, state);
    const radiusMaxs = this.radiusMax.fillNew(run, state);
    const speedMins = this.speedMin.fillNew(run, state);
    const speedMaxs = this.speedMax.fillNew(run, state);
    // The block run evaluates the vector inputs for every live particle, and each particle of the run reads its own value
    const evaluated = blockRun ? particles.currentSpan : run;
    const biases = this.distanceBias.prepareEvaluated(run, evaluated, state);
    const localSpeedMins = this.localCoordinateSystemSpeedMin.prepareEvaluated(run, evaluated, state);
    const localSpeedMaxs = this.localCoordinateSystemSpeedMax.prepareEvaluated(run, evaluated, state);

    for (const { offset, block, lane } of run.inputBlocks()) {
      this.distanceBias.fillPerBlock(block, lane, state, biases.subarray(offset * 3));

      if (writesVelocity) {
        this.localCoordinateSystemSpeedMin.fillPerBlock(block, lane, state, localSpeedMins.subarray(offset * 3));
        this.localCoordinateSystemSpeedMax.fillPerBlock(block, lane, state, localSpeedMaxs.subarray(offset * 3));
      }
    }

    let blockPoints: Vector3[] = [];
    let blockSpeedDraws: number[] = [];
    let blockLocalSpeedDraws: Vector3[] = [];

    if (blockRun) {
      ({ points: blockPoints, speedDraws: blockSpeedDraws, localSpeedDraws: blockLocalSpeedDraws } = drawBlocks(state.threadRandom, writesVelocity, run.length));
    }

    for (let i = 0; i < run.length; i++) {
      let randomVector: Vector3;
      let radiusFraction: number;

      if (blockRun) {
        randomVector = blockPoints[i];
        radiusFraction = randomVector.length();
      } else {
        const drawn = state.random.nextInUnitBall();
        randomVector = drawn.point;
        radiusFraction = drawn.radiusFraction;
      }

      if (this.distanceBiasAbs.x !== 0) {
        randomVector = randomVector.withX(Math.abs(randomVector.x));
      }

      if (this.distanceBiasAbs.y !== 0) {
        randomVector = randomVector.withY(Math.abs(randomVector.y));
      }

      if (this.distanceBiasAbs.z !== 0) {
        randomVector = randomVector.withZ(Math.abs(randomVector.z));
      }

      const bias = readVector(biases, i);

      let direction = safeNormalize(randomVector.mul(bias));

      const transform = this.transformInput.nextTransformAtTime(state, creationTimes[i]);

      if (this.localCoords && (!bias.equals(Vector3.one) || !this.distanceBiasAbs.equals(Vector3.zero))) {
        direction = transformNormal(direction, transform);
      }

      const distance = lerp(radiusMins[i], radiusMaxs[i], radiusFraction);

      // The centre is the transform interpolated to the creation time once, as in VRF
      const worldOffset = transform.translation.add(direction.scale(distance));

      if (outputs !== null) {
        writeVector(outputs, i, worldOffset);
      }

      if (!writesVelocity) {
        continue;
      }

      let speed: number;
      let localCoordinateSystemSpeed: Vector3;

      if (blockRun) {
        speed = lerp(speedMins[i], speedMaxs[i], powQuarterSteps(blockSpeedDraws[i], this.speedRandExp));
        localCoordinateSystemSpeed = lerpVV(readVector(localSpeedMins, i), readVector(localSpeedMaxs, i), blockLocalSpeedDraws[i]);
      } else {
        speed = state.random.nextWithExponentBetween(this.speedRandExp, speedMins[i], speedMaxs[i]);
        localCoordinateSystemSpeed = state.random.nextBetweenPerComponent(readVector(localSpeedMins, i), readVector(localSpeedMaxs, i));
      }

      const velocityLocal = transformNormal(localCoordinateSystemSpeed, transform);
      let velocity = direction.scale(speed).negate().sub(velocityLocal);

      if (this.velocityField === ParticleField.PositionPrevious) {
        velocity = velocity.scale(state.previousStep);
      } else if (previous !== null) {
        writeVector(previous, i, worldOffset);
      }

      if (velocities !== null) {
        writeVector(velocities, i, worldOffset.add(velocity));
      }
    }
  }
}

/**
 * Takes the block run's draws from the thread generator, block by block of four: a point in the unit
 * ball, whose length is the radius fraction, then with a velocity the speed draw and the three local
 * speed draws.
 */
function drawBlocks(generator: ThreadRandom, writesVelocity: boolean, length: number): { points: Vector3[]; speedDraws: number[]; localSpeedDraws: Vector3[] } {
  const points: Vector3[] = [];
  const speedDraws: number[] = [];
  const localSpeedDraws: Vector3[] = [];

  for (let blockStart = 0; blockStart < length; blockStart += 4) {
    points.push(...generator.nextInUnitBall());

    if (!writesVelocity) {
      continue;
    }

    const speeds = generator.next();
    const localX = generator.next();
    const localY = generator.next();
    const localZ = generator.next();

    for (let lane = 0; lane < 4; lane++) {
      speedDraws[blockStart + lane] = speeds[lane];
      localSpeedDraws[blockStart + lane] = new Vector3(localX[lane], localY[lane], localZ[lane]);
    }
  }

  return { points, speedDraws, localSpeedDraws };
}
