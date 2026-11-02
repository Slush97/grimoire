// Ported from ValveResourceFormat (MIT): ValveResourceFormat/Particles/Operators/BasicMovement.cs.

import { readVector, writeVector } from '../buffer';
import type { ParticleCollection } from '../collection';
import { ParticleField } from '../enums';
import { fieldMask } from '../fields';
import { ParticleFunctionOperator } from '../functions';
import { Vector3, clamp, f32 } from '../numerics';
import { LiteralNumberProvider, type NumberProvider } from '../numberProviders';
import type { ParticleDefinitionParser } from '../parser';
import type { ParticleSystemState } from '../state';
import { FLOAT_EPSILON } from '../utils/particleMath';
import { LiteralVectorProvider, type VectorProvider } from '../vectorProviders';

/**
 * C_OP_BasicMovement ("Movement Basic"): integrates velocity each step, with gravity, an exponential
 * drag and the system's force generators, then runs the constraints.
 */
export class BasicMovement extends ParticleFunctionOperator {
  private readonly gravity: VectorProvider;
  private readonly drag: NumberProvider;
  private readonly maxConstraintPasses: number;

  constructor(parse: ParticleDefinitionParser) {
    super(parse);
    this.gravity = parse.vectorProvider('m_Gravity', new LiteralVectorProvider(Vector3.zero));
    this.drag = parse.numberProvider('m_fDrag', new LiteralNumberProvider(0));
    this.maxConstraintPasses = parse.int32('m_nMaxConstraintPasses', 3);
  }

  get storedFields(): bigint {
    return fieldMask(ParticleField.Position) | fieldMask(ParticleField.PositionPrevious);
  }

  operate(particles: ParticleCollection, frameTime: number, state: ParticleSystemState): void {
    // Gravity is set up before the drag is evaluated and read after it, so only an input drawing per block draws after the drag
    const setUpGravity = this.gravity.drawsPerBlock ? Vector3.zero : this.gravity.nextVector(state);

    const timeStepSquared = f32(frameTime * frameTime);
    const dragValue = clamp(this.drag.nextNumber(state), 0, f32(1 - FLOAT_EPSILON));
    const stepRatio = state.previousStep > 0 ? f32(frameTime / state.previousStep) : 1;
    const dragFactor = f32(stepRatio * f32(Math.pow(f32(1 - dragValue), f32(frameTime * 30))));

    const gravityAcceleration = this.gravity.drawsPerBlock ? this.gravity.nextVector(state) : setUpGravity;

    const current = particles.currentSpan;
    const forces = new Float32Array(current.length * 3);

    // Force generators run from here and add into the accumulator before integration
    const forceGenerators = state.data?.forceGenerators;

    if (forceGenerators !== undefined) {
      for (const forceGenerator of forceGenerators) {
        const forceStrength = forceGenerator.getOperatorRunStrength(state);

        if (forceStrength <= 0) {
          continue;
        }

        forceGenerator.movementGravity = gravityAcceleration;
        forceGenerator.generateForces(particles, forces, frameTime, state, forceStrength);
      }
    }

    const positions = current.vectors(ParticleField.Position);
    const previousPositions = current.vectors(ParticleField.PositionPrevious);
    const forceScales = current.readFloats(ParticleField.ForceScale);

    for (let i = 0; i < current.length; i++) {
      // ForceScale (per-particle) weights the applied forces; 0 = pinned/immovable
      const position = readVector(positions, i);
      const acceleration = gravityAcceleration.add(readVector(forces, i));
      const step = position.sub(readVector(previousPositions, i)).scale(dragFactor).add(acceleration.scale(timeStepSquared).scale(forceScales[i]));
      writeVector(previousPositions, i, position);
      writeVector(positions, i, position.add(step));
    }

    state.data?.runConstraints(particles, frameTime, this.maxConstraintPasses);
  }
}
