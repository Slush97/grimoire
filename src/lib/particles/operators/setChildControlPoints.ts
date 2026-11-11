// Ported from ValveResourceFormat (MIT): ValveResourceFormat/Particles/Operators/SetChildControlPoints.cs,
// with SetControlPointsToParticle's OrientToVelocity, OrientToDirection and OrientToRotations.

import { type ParticleCollection } from '../collection';
import { ParticleField } from '../enums';
import { ParticleFunctionOperator } from '../functions';
import { Vector3, eulerAnglesToQuaternion, toInt } from '../numerics';
import { LiteralNumberProvider, type NumberProvider } from '../numberProviders';
import { type ParticleDefinitionParser } from '../parser';
import { ParticleOrientationType } from '../render/enums';
import { CONTROL_POINT_COUNT, MAX_CONTROL_POINT, type ControlPoint, type ParticleSystemState } from '../state';

/**
 * Places a run of control points on each child of a group, one per particle of this system, optionally
 * turned to match the particle. Each child gets the same points.
 */
export class SetChildControlPoints extends ParticleFunctionOperator {
  private readonly childGroupId: number;
  private readonly firstControlPoint: number;
  private readonly numControlPoints: number;
  private readonly firstSourcePoint: NumberProvider;
  private readonly reverse: boolean;
  private readonly setOrientation: boolean;
  private readonly orientationType: number;
  private readonly matchingChildren: ParticleSystemState[] = [];

  constructor(parse: ParticleDefinitionParser) {
    super(parse);
    this.childGroupId = parse.int32('m_nChildGroupID', 0);
    const authoredFirst = parse.int32('m_nFirstControlPoint', 0);
    this.firstControlPoint = Math.min(Math.max(authoredFirst, 0), MAX_CONTROL_POINT);
    this.numControlPoints = Math.min(parse.int32('m_nNumControlPoints', 1), CONTROL_POINT_COUNT - Math.max(authoredFirst, 0));
    this.firstSourcePoint = parse.numberProvider('m_nFirstSourcePoint', new LiteralNumberProvider(0));
    this.reverse = parse.boolean('m_bReverse', false);
    this.setOrientation = parse.boolean('m_bSetOrientation', false);
    this.orientationType = parse.enum('m_nOrientation', ParticleOrientationType, ParticleOrientationType.PARTICLE_ORIENTATION_VELOCITY);
  }

  operate(particles: ParticleCollection, _frameTime: number, state: ParticleSystemState): void {
    if (!state.data) {
      return;
    }
    this.matchingChildren.length = 0;
    state.data.collectChildStatesInGroup(this.childGroupId, this.matchingChildren);
    if (this.matchingChildren.length === 0) {
      return;
    }
    const live = particles.currentSpan;
    const first = toInt(this.firstSourcePoint.nextNumber(state));
    const count = Math.min(live.length - first, this.numControlPoints);
    for (const child of this.matchingChildren) {
      for (let i = 0; i < count; i++) {
        const index = this.reverse ? Math.max(live.length - (first + i) - 1, 0) : first + i;
        // An index out of range ends the loop rather than reading past the particles
        if ((index >>> 0) >= (live.length >>> 0)) {
          break;
        }
        const point = child.getControlPoint(this.firstControlPoint + i);
        point.position = live.readVector(ParticleField.Position, index);
        if (this.setOrientation) this.orient(point, live, index);
      }
    }
  }

  private orient(point: ControlPoint, live: ParticleCollection['currentSpan'], index: number): void {
    const toward = (direction: Vector3) => {
      if (!direction.equals(Vector3.zero)) point.orientation = direction;
    };
    if (this.orientationType === ParticleOrientationType.PARTICLE_ORIENTATION_VELOCITY) {
      toward(live.readVector(ParticleField.Position, index).sub(live.readVector(ParticleField.PositionPrevious, index)));
    } else if (this.orientationType === ParticleOrientationType.PARTICLE_ORIENTATION_NORMAL) {
      toward(live.readVector(ParticleField.Normal, index));
    } else if (this.orientationType === ParticleOrientationType.PARTICLE_ORIENTATION_ROTATION) {
      const degrees = (field: number) => (live.readFloat(field, index) * 180) / Math.PI;
      point.setRotation(eulerAnglesToQuaternion(new Vector3(degrees(ParticleField.Pitch), degrees(ParticleField.Yaw), degrees(ParticleField.Roll))));
    }
  }
}
