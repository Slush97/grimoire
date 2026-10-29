// Ported from ValveResourceFormat (MIT): ValveResourceFormat/Particles/ForceGenerators/AttractToControlPoint.cs.

import { readVector, writeVector } from '../buffer';
import type { ParticleCollection } from '../collection';
import { ParticleField } from '../enums';
import { ParticleFunctionForceGenerator } from '../functions';
import { Vector3, f32, transformNormal } from '../numerics';
import { LiteralNumberProvider, type NumberProvider } from '../numberProviders';
import type { ParticleDefinitionParser } from '../parser';
import type { ParticleSystemState } from '../state';
import { ControlPointTransformProvider, type TransformProvider } from '../transformProviders';
import { FLOAT_EPSILON, powQuarterSteps } from '../utils/particleMath';

/**
 * C_OP_AttractToControlPoint ("Pull Towards Control Point"): a pull toward a control point with a
 * falloff power in quarter steps. Within m_fMinimumDistance the pull is the force amount times the
 * offset, unnormalized and without falloff.
 */
export class AttractToControlPoint extends ParticleFunctionForceGenerator {
  private readonly componentScale: Vector3;
  private readonly forceAmount: NumberProvider;
  private readonly minimumDistance: NumberProvider;
  private readonly forceAmountMin: NumberProvider;
  private readonly applyMinForce: boolean;
  private readonly falloff: number;
  private readonly transformInput: TransformProvider;

  constructor(parse: ParticleDefinitionParser) {
    super(parse);
    this.componentScale = parse.vector3('m_vecComponentScale', Vector3.one);
    this.forceAmount = parse.numberProvider('m_fForceAmount', new LiteralNumberProvider(100));
    this.minimumDistance = parse.numberProvider('m_fMinimumDistance', new LiteralNumberProvider(0));
    this.forceAmountMin = parse.numberProvider('m_fForceAmountMin', new LiteralNumberProvider(0));
    this.applyMinForce = parse.boolean('m_bApplyMinForce', false);
    this.falloff = parse.float('m_fFalloffPower', 2);
    this.transformInput = parse.transformInput('m_TransformInput', new ControlPointTransformProvider(0, false));
  }

  generateForces(particles: ParticleCollection, forces: Float32Array, _frameTime: number, state: ParticleSystemState, strength: number): void {
    const transform = this.transformInput.nextTransform(state);
    const target = transform.translation;
    const scale = transformNormal(this.componentScale, transform).scale(strength);
    const current = particles.currentSpan;
    const positions = current.readVectors(ParticleField.Position);
    const amounts = this.forceAmount.fillNew(current, state);
    const minAmounts = this.applyMinForce ? this.forceAmountMin.fillNew(current, state) : null;
    const minimumDistances = this.minimumDistance.fillNew(current, state);

    for (let i = 0; i < current.length; i++) {
      let amount = amounts[i];

      if (minAmounts !== null) {
        amount = Math.max(amount, minAmounts[i]);
      }

      const diff = readVector(positions, i).sub(target);
      let distance = diff.length();

      if (distance < minimumDistances[i]) {
        distance = 1;
      }

      if (distance <= FLOAT_EPSILON) {
        continue;
      }

      const forceMagnitude = f32(f32(amount / distance) * powQuarterSteps(distance, -this.falloff));
      writeVector(forces, i, readVector(forces, i).sub(diff.scale(forceMagnitude).mul(scale)));
    }
  }
}
