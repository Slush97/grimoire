// Ported from ValveResourceFormat (MIT): ValveResourceFormat/Particles/PreEmissionOperators/SetControlPointRotation.cs.

import { ParticleFunctionPreEmissionOperator } from '../functions';
import { Quaternion, Vector3, f32, safeNormalize } from '../numerics';
import { LiteralNumberProvider, type NumberProvider } from '../numberProviders';
import { type ParticleDefinitionParser } from '../parser';
import { type ParticleSystemState } from '../state';
import { quaternionNormalize } from '../utils/quaternionMath';
import { quaternionMultiply, transformQuaternion } from '../utils/vectorMath';
import { LiteralVectorProvider, type VectorProvider } from '../vectorProviders';

/** Spins a control point about an axis (in the world, or in another control point's frame) at a rate in degrees per second. */
export class SetControlPointRotation extends ParticleFunctionPreEmissionOperator {
  private readonly axis: VectorProvider;
  private readonly cp: number;
  private readonly localCP: number;
  private readonly rotationRate: NumberProvider;

  constructor(parse: ParticleDefinitionParser) {
    super(parse);
    this.axis = parse.vectorProvider('m_vecRotAxis', new LiteralVectorProvider(new Vector3(0, 0, 1)));
    this.rotationRate = parse.numberProvider('m_flRotRate', new LiteralNumberProvider(180));
    this.cp = parse.int32('m_nCP', 0);
    this.localCP = parse.int32('m_nLocalCP', -1);
  }

  operate(state: ParticleSystemState, frameTime: number): void {
    const angle = f32(f32(this.rotationRate.nextNumber(state) * f32(Math.PI / 180)) * frameTime);
    // MathUtils.SafeNormalize with Vector3.UnitZ for no length
    let rotationAxis = safeNormalize(this.axis.nextVector(state));
    if (rotationAxis.lengthSquared() === 0) rotationAxis = new Vector3(0, 0, 1);
    if (this.localCP > -1) rotationAxis = transformQuaternion(rotationAxis, state.getControlPoint(this.localCP).getRotation());
    // This frame's increment onto the control point's rotation, so it spins on
    const point = state.getControlPoint(this.cp);
    const half = f32(angle * 0.5);
    const sin = f32(Math.sin(half));
    const increment = new Quaternion(f32(rotationAxis.x * sin), f32(rotationAxis.y * sin), f32(rotationAxis.z * sin), f32(Math.cos(half)));
    state.setControlPointRotation(this.cp, quaternionNormalize(quaternionMultiply(point.getRotation(), increment)));
  }
}
