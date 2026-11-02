// Ported from ValveResourceFormat (MIT): Particles/ForceGenerators/TwistAroundAxis.cs.
import { readVector, writeVector } from '../buffer';
import type { ParticleCollection } from '../collection';
import { ParticleField } from '../enums';
import { ParticleFunctionForceGenerator } from '../functions';
import { Vector3, cross, dot, f32, safeNormalize } from '../numerics';
import type { ParticleDefinitionParser } from '../parser';
import type { ParticleSystemState } from '../state';
import { ControlPointTransformProvider } from '../transformProviders';
import { FLOAT_EPSILON } from '../utils/particleMath';

export class TwistAroundAxis extends ParticleFunctionForceGenerator {
  private readonly forceAmount: number;
  private readonly twistAxis: Vector3;
  private readonly localSpace: boolean;
  private readonly controlPoint: number;
  private readonly axisControlPoint: number;

  constructor(parse: ParticleDefinitionParser) {
    super(parse);
    this.forceAmount = parse.float('m_fForceAmount', 0);
    this.twistAxis = parse.vector3('m_TwistAxis', new Vector3(0, 0, 1));
    this.localSpace = parse.boolean('m_bLocalSpace', false);
    this.controlPoint = parse.int32('m_nControlPointNumber', 0);
    this.axisControlPoint = parse.behaviorVersion >= 3 ? this.controlPoint : 0;
  }

  generateForces(particles: ParticleCollection, forces: Float32Array, _frameTime: number, state: ParticleSystemState, strength: number): void {
    const axis = safeNormalize(this.localSpace
      ? ControlPointTransformProvider.transformDirection(state, this.axisControlPoint, this.twistAxis) : this.twistAxis);
    const center = state.getControlPoint(this.controlPoint).position;
    const amount = f32(this.forceAmount * strength);
    const positions = particles.currentSpan.readVectors(ParticleField.Position);
    for (let i = 0; i < particles.count; i++) {
      const delta = readVector(positions, i).sub(center);
      if (delta.lengthSquared() <= FLOAT_EPSILON) continue;
      const direction = safeNormalize(delta);
      const alignment = f32(1 - dot(direction, axis));
      if (f32(alignment * alignment) <= FLOAT_EPSILON) continue;
      writeVector(forces, i, readVector(forces, i).add(cross(direction, axis).scale(amount)));
    }
  }
}
