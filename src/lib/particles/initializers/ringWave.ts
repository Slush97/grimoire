// Ported from ValveResourceFormat (MIT): ValveResourceFormat/Particles/Initializers/RingWave.cs.

import { writeVector } from '../buffer';
import type { ParticleCollection } from '../collection';
import { ParticleField } from '../enums';
import { fieldMask } from '../fields';
import { ParticleFunctionInitializer } from '../functions';
import { TAU, Vector3, f32, safeNormalize, transform, transformNormal } from '../numerics';
import { LiteralNumberProvider, type NumberProvider } from '../numberProviders';
import type { ParticleDefinitionParser } from '../parser';
import type { ParticleSpan } from '../span';
import type { ParticleSystemState } from '../state';
import { ControlPointTransformProvider, type TransformProvider } from '../transformProviders';
import { eulerAnglesToRotationMatrix } from '../utils/vectorMath';

export class RingWave extends ParticleFunctionInitializer {
  private readonly evenDistribution: boolean;
  private readonly initialRadius: NumberProvider;
  private readonly thickness: NumberProvider;
  private readonly particlesPerOrbit: NumberProvider;
  private readonly initialSpeedMin: NumberProvider;
  private readonly initialSpeedMax: NumberProvider;
  private readonly roll: NumberProvider;
  private readonly pitch: NumberProvider;
  private readonly yaw: NumberProvider;
  private readonly transformInput: TransformProvider;
  private readonly xyVelocityOnly: boolean;
  private orbitCount = 0;

  constructor(parse: ParticleDefinitionParser) {
    super(parse);
    this.evenDistribution = parse.boolean('m_bEvenDistribution', false);
    this.particlesPerOrbit = parse.collectionNumberProvider('m_flParticlesPerOrbit', new LiteralNumberProvider(-1));
    this.initialRadius = parse.numberProvider('m_flInitialRadius', new LiteralNumberProvider(0));
    this.thickness = parse.numberProvider('m_flThickness', new LiteralNumberProvider(0));
    this.initialSpeedMin = parse.numberProvider('m_flInitialSpeedMin', new LiteralNumberProvider(0));
    this.initialSpeedMax = parse.numberProvider('m_flInitialSpeedMax', new LiteralNumberProvider(0));
    this.transformInput = parse.transformInput('m_TransformInput', new ControlPointTransformProvider());
    this.xyVelocityOnly = parse.boolean('m_bXYVelocityOnly', true);
    this.roll = parse.numberProvider('m_flRoll', new LiteralNumberProvider(0));
    this.pitch = parse.numberProvider('m_flPitch', new LiteralNumberProvider(0));
    this.yaw = parse.numberProvider('m_flYaw', new LiteralNumberProvider(0));
  }

  reset(): void {
    this.orbitCount = 0;
  }

  get writtenFields(): bigint {
    return fieldMask(ParticleField.Position) | fieldMask(ParticleField.PositionPrevious);
  }

  protected initializeCall(run: ParticleSpan, particles: ParticleCollection, state: ParticleSystemState): void {
    const thicknesses = this.thickness.fillNew(run, state);
    const perOrbit = this.particlesPerOrbit.nextNumber(state);
    const radii = this.initialRadius.fillNew(run, state);
    const pitches = this.pitch.fillNew(run, state);
    const yaws = this.yaw.fillNew(run, state);
    const rolls = this.roll.fillNew(run, state);
    const speedMins = this.initialSpeedMin.fillNew(run, state);
    const speedMaxes = this.initialSpeedMax.fillNew(run, state);
    const creationTimes = run.readFloats(ParticleField.CreationTime);
    const positions = run.vectors(ParticleField.Position);
    const previousPositions = ParticleFunctionInitializer.spawnPreviousPositions(run, state);
    const activeParticles = particles.count;
    const previousFrameTime = state.previousStep;
    for (let i = 0; i < run.length; i++) {
      const thicknessOffset = state.random.nextInUnitBall().point.scale(thicknesses[i]);
      const radius = radii[i];
      const matrix = this.transformInput.nextTransformAtTime(state, creationTimes[i]);
      const angle = this.getNextAngle(perOrbit, activeParticles, state);
      const sin = f32(Math.sin(angle));
      const cos = f32(Math.cos(angle));
      const ringAngles = new Vector3(pitches[i], yaws[i], rolls[i]);
      const ring = transformNormal(new Vector3(f32(radius * cos), f32(radius * sin), 0), eulerAnglesToRotationMatrix(ringAngles));
      const position = transform(ring.add(thicknessOffset), matrix);
      const outward = safeNormalize(position.sub(matrix.translation));
      const speed = state.random.nextBetween(speedMins[i], speedMaxes[i]);
      let previous = position.sub(outward.scale(f32(speed * previousFrameTime)));
      if (this.xyVelocityOnly) {
        previous = previous.withZ(position.z);
      }
      writeVector(positions, i, position);
      if (previousPositions !== null) {
        writeVector(previousPositions, i, previous);
      }
    }
  }

  private getNextAngle(particlesPerOrbit: number, activeParticles: number, state: ParticleSystemState): number {
    this.orbitCount = (this.orbitCount + 1) >>> 0;
    if (this.evenDistribution) {
      const perOrbit = particlesPerOrbit === -1 ? f32(activeParticles) : particlesPerOrbit;
      return f32(f32(this.orbitCount) * f32(TAU / Math.max(1, perOrbit)));
    }
    return f32(f32(this.orbitCount) * f32(state.random.next() * TAU));
  }
}
