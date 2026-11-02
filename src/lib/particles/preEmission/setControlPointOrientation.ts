// Ported from ValveResourceFormat (MIT): ValveResourceFormat/Particles/PreEmissionOperators/SetControlPointOrientation.cs.

import { ParticleFunctionPreEmissionOperator } from '../functions';
import { Vector3, Quaternion } from '../numerics';
import { LiteralNumberProvider, type NumberProvider } from '../numberProviders';
import { type ParticleDefinitionParser } from '../parser';
import { type ParticleSystemState } from '../state';
import { quaternionMultiply } from '../utils/vectorMath';
import { eulerAnglesToQuaternion } from '../numerics';

export class SetControlPointOrientation extends ParticleFunctionPreEmissionOperator {
  private readonly useWorldLocation: boolean;
  private readonly randomize: boolean;
  private readonly setOnce: boolean;
  private readonly cp: number;
  private readonly headLocation: number;
  private readonly rotation: Vector3;
  private readonly rotationB: Vector3;
  private readonly interpolation: NumberProvider;

  constructor(parse: ParticleDefinitionParser) {
    super(parse);
    this.useWorldLocation = parse.boolean('m_bUseWorldLocation', false);
    this.randomize = parse.boolean('m_bRandomize', false);
    this.setOnce = parse.boolean('m_bSetOnce', false);
    this.cp = parse.controlPoint('m_nCP', 1);
    this.headLocation = parse.controlPoint('m_nHeadLocation', 0);
    this.rotation = parse.vector3('m_vecRotation', Vector3.zero);
    this.rotationB = parse.vector3('m_vecRotationB', Vector3.zero);
    this.interpolation = parse.numberProvider('m_flInterpolation', new LiteralNumberProvider(1));
  }
  private hasRunBefore = false;
  private resolvedRotation = Vector3.zero;
  private zeroRotation = false;

  initialize(state: ParticleSystemState): void {
    this.resolvedRotation = this.randomize ? state.random.nextBetweenPerComponent(this.rotation, this.rotationB) : this.rotation;
    this.hasRunBefore = false;
    this.zeroRotation = this.rotation.equals(Vector3.zero) && (!this.randomize || this.rotationB.equals(Vector3.zero));
  }

  restart(): void { this.hasRunBefore = false; }

  operate(state: ParticleSystemState): void {
    if (this.setOnce) {
      if (this.hasRunBefore) {
        return;
      }
      this.hasRunBefore = true;
    }
    const amount = this.interpolation.nextNumber(state);
    let target = eulerAnglesToQuaternion(this.resolvedRotation);
    const point = state.getControlPoint(this.cp);
    if (!this.useWorldLocation) {
      if (this.headLocation === this.cp) {
        return;
      }
      const head = state.getControlPoint(this.headLocation);
      if (this.zeroRotation && amount === 1) {
        point.setOrientation(head.forward, head.left, head.up);
        return;
      }
      const headRotation = head.getRotation();
      if (Quaternion.dot(target, headRotation) < 0) {
        target = new Quaternion(-target.x, -target.y, -target.z, -target.w);
      }
      target = quaternionMultiply(headRotation, target);
    }
    if (!this.setOnce && amount !== 1) {
      target = Quaternion.slerp(point.getRotation(), target, amount);
    }
    point.setRotation(target);
  }
}
