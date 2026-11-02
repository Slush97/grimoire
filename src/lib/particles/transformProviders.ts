// Ported from ValveResourceFormat (MIT): ValveResourceFormat/Particles/ITransformProvider.cs and the
// transform input switch of ValveResourceFormat/Particles/ParticleDefinitionParser.cs.
//

import { type KVValue, getString, isCollection, toInteger } from './kv';
import { ParticleField } from './enums';
import { Matrix4x4, Quaternion, Vector3, clamp, degreesToRadians, radiansToDegrees, lerpV, saturate, transform, transformNormal } from './numerics';
import { eulerAnglesToRotationMatrix, quaternionToEulerAngles } from './utils/vectorMath';
import type { ParticleDefinitionParser } from './parser';
import { CONTROL_POINT_COUNT, ControlPoint, MAX_CONTROL_POINT, type ParticleSystemState } from './state';

/** A transform derived from a control point or other source (CParticleTransformInput). */
export interface TransformProvider {
  nextTransform(state: ParticleSystemState): Matrix4x4;

  /** The transform as it stood at `time` within the step being simulated. */
  nextTransformAtTime(state: ParticleSystemState, time: number): Matrix4x4;
}

/** A control point's axes and position, or one control point picked at random out of a range. */
export class ControlPointTransformProvider implements TransformProvider {
  private readonly controlPoint: number;
  private readonly useOrientation: boolean;
  private readonly rangeMax: number;
  private readonly endGrowthTime: number;
  private readonly isRange: boolean;

  /** Control point 0 with its orientation by default, as an unset m_TransformInput deserializes to. */
  constructor(controlPoint = 0, useOrientation = true, range: { rangeMax: number; endGrowthTime: number } | null = null) {
    this.controlPoint = controlPoint;
    this.useOrientation = useOrientation;
    this.rangeMax = range?.rangeMax ?? 0;
    this.endGrowthTime = range?.endGrowthTime ?? 0;
    this.isRange = range !== null;
  }

  private pickControlPoint(state: ParticleSystemState): number {
    if (!this.isRange) {
      return this.controlPoint;
    }

    const low = this.controlPoint;
    const high = Math.max(this.controlPoint, this.rangeMax);
    const candidates: number[] = [];

    for (let cp = Math.max(low, 0); cp <= Math.min(high, MAX_CONTROL_POINT) && candidates.length < CONTROL_POINT_COUNT; cp++) {
      if (state.getControlPoint(cp).changeTime !== -1) {
        candidates.push(cp);
      }
    }

    const growth = this.endGrowthTime === 0 ? 1 : Math.fround(Math.min(state.age, this.endGrowthTime) / this.endGrowthTime);

    if (growth < 1) {
      const limit = Math.floor(Math.fround(Math.fround(saturate(growth) * (high - low)) + low));
      const candidate = low + state.random.nextIndex(limit - low + 1);

      if (candidates.includes(candidate)) {
        return candidate;
      }
    } else if (candidates.length === 0) {
      return this.controlPoint;
    }

    const index = state.random.nextIndex(candidates.length);

    return candidates.length === 0 ? this.controlPoint : candidates[Math.min(index, candidates.length - 1)];
  }

  private rotation(cp: ControlPoint): Matrix4x4 {
    return this.useOrientation ? cp.getRotationMatrix() : Matrix4x4.identity();
  }

  nextTransform(state: ParticleSystemState): Matrix4x4 {
    const cp = state.getControlPoint(this.pickControlPoint(state));
    return this.rotation(cp).withTranslation(cp.position);
  }

  nextTransformAtTime(state: ParticleSystemState, time: number): Matrix4x4 {
    const cp = state.getControlPoint(this.pickControlPoint(state));
    const fraction = ControlPoint.stepFraction(state, time);

    const rotation = this.useOrientation
      ? Matrix4x4.fromQuaternion(Quaternion.slerp(cp.getPreviousRotation(), cp.getRotation(), fraction))
      : Matrix4x4.identity();

    return rotation.withTranslation(lerpV(cp.positionPrevious, cp.position, fraction));
  }

  /** Transforms a local offset into control point `cp`'s frame (rotation and translation). */
  static transformPosition(state: ParticleSystemState, cp: number, localOffset: Vector3): Vector3 {
    return transform(localOffset, new ControlPointTransformProvider(cp, true).nextTransform(state));
  }

  /** Rotates a local direction into control point `cp`'s frame (rotation only). */
  static transformDirection(state: ParticleSystemState, cp: number, localDirection: Vector3): Vector3 {
    return transformNormal(localDirection, state.getControlPoint(cp).getRotationMatrix());
  }

  static transformAngle(state: ParticleSystemState, cp: number, field: number, radians: number): number {
    const degrees = radiansToDegrees(radians);
    const angles = field === ParticleField.Pitch ? new Vector3(degrees, 0, 0) : field === ParticleField.Yaw ? new Vector3(0, degrees, 0) : new Vector3(0, 0, degrees);
    const result = ControlPointTransformProvider.transformAngles(state, cp, angles);
    return degreesToRadians(field === ParticleField.Pitch ? result.x : field === ParticleField.Yaw ? result.y : result.z);
  }

  static transformAngles(state: ParticleSystemState, cp: number, angles: Vector3): Vector3 {
    const composed = eulerAnglesToRotationMatrix(angles).multiply(state.getControlPoint(cp).getRotationMatrix());
    return quaternionToEulerAngles(Quaternion.fromRotationMatrix(composed));
  }
}

/** PT_TYPE_NAMED_VALUE: the system's transform named value, blended from the previous step's within a step. */
export class NamedValueTransformProvider implements TransformProvider {
  private readonly name: string;
  private readonly follow: boolean;
  private readonly useOrientation: boolean;

  constructor(parse: ParticleDefinitionParser) {
    this.name = parse.string('m_NamedValue');
    this.follow = parse.boolean('m_bFollowNamedValue');
    this.useOrientation = parse.boolean('m_bUseOrientation', true);
  }

  private get(state: ParticleSystemState) {
    return state.data?.namedValues.tryGetTransform(this.name, this.follow) ?? null;
  }

  private compose(rotation: Quaternion, position: Vector3): Matrix4x4 {
    const matrix = this.useOrientation ? Matrix4x4.fromQuaternion(rotation) : Matrix4x4.identity();
    return matrix.withTranslation(position);
  }

  nextTransform(state: ParticleSystemState): Matrix4x4 {
    const found = this.get(state);
    return this.compose(found?.value.rotation ?? Quaternion.identity, found?.value.vector ?? Vector3.zero);
  }

  nextTransformAtTime(state: ParticleSystemState, time: number): Matrix4x4 {
    const found = this.get(state);
    const value = found?.value;
    const previous = found?.previous;
    const fraction = ControlPoint.stepFraction(state, time);

    return this.compose(
      Quaternion.slerp(previous?.rotation ?? Quaternion.identity, value?.rotation ?? Quaternion.identity, fraction),
      lerpV(previous?.vector ?? Vector3.zero, value?.vector ?? Vector3.zero, fraction),
    );
  }
}

/** A transform provider that always returns the identity matrix. */
export class IdentityTransformProvider implements TransformProvider {
  nextTransform(): Matrix4x4 {
    return Matrix4x4.identity();
  }

  nextTransformAtTime(): Matrix4x4 {
    return Matrix4x4.identity();
  }
}

/** The transform input a definition authors (ParticleDefinitionParser.ReadTransformInput). */
export function createTransformProvider(value: KVValue, parse: ParticleDefinitionParser): TransformProvider {
  if (isCollection(value)) {
    const type = getString(value, 'm_nType', 'PT_TYPE_CONTROL_POINT');
    const nested = parse.nested(value);

    switch (type) {
      case 'PT_TYPE_CONTROL_POINT':
        return new ControlPointTransformProvider(nested.int32('m_nControlPoint'), nested.boolean('m_bUseOrientation', true));
      case 'PT_TYPE_CONTROL_POINT_RANGE':
        return new ControlPointTransformProvider(nested.int32('m_nControlPoint'), nested.boolean('m_bUseOrientation', true), {
          rangeMax: nested.int32('m_nControlPointRangeMax'),
          endGrowthTime: nested.float('m_flEndCPGrowthTime'),
        });
      case 'PT_TYPE_NAMED_VALUE':
        return new NamedValueTransformProvider(nested);
      case 'PT_TYPE_INVALID':
        return new IdentityTransformProvider();
      default:
        parse.logger.report('unsupported-input', `Transform type ${type} not supported, using identity transform`);
        return new IdentityTransformProvider();
    }
  }

  // Fields that became transform inputs without a format bump still hold a bare control point number in older content
  if (value !== null) {
    return new ControlPointTransformProvider(clamp(typeof value === 'string' && value.trim() === '' ? 0 : toInteger(value), 0, MAX_CONTROL_POINT), true);
  }

  return new IdentityTransformProvider();
}
