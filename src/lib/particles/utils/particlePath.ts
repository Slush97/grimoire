// Ported from ValveResourceFormat (MIT): ValveResourceFormat/Particles/Utils/ParticlePath.cs.

import { getSubCollection } from '../kv';
import { Vector3, clamp, f32 } from '../numerics';
import type { ParticleDefinitionParser } from '../parser';
import { MAX_CONTROL_POINT, type ParticleSystemState } from '../state';
import { MINIMUM_LENGTH } from './particleMath';
import { ParticleRandom } from './random';
import { vectorLerp } from './vectorMath';

export class ParticlePathParameters {
  readonly startControlPointNumber: number;
  readonly midControlPointNumber: number;
  readonly endControlPointNumber: number;
  readonly bulgeControl: number;
  readonly bulge: number;
  readonly midPoint: number;
  readonly startPointOffset: Vector3;
  readonly midPointOffset: Vector3;
  readonly endOffset: Vector3;

  constructor(...args: [parse: ParticleDefinitionParser, key?: string] | [start: number, mid: number, end: number, source: ParticlePathParameters]) {
    if (args.length === 4) {
      const [start, mid, end, source] = args;
      this.startControlPointNumber = start;
      this.midControlPointNumber = mid;
      this.endControlPointNumber = end;
      this.bulgeControl = source.bulgeControl;
      this.bulge = source.bulge;
      this.midPoint = source.midPoint;
      this.startPointOffset = source.startPointOffset;
      this.midPointOffset = source.midPointOffset;
      this.endOffset = source.endOffset;
      return;
    }

    const [parse, key = 'm_PathParams'] = args;
    const block = getSubCollection(parse.data, key);
    const nested = block === null ? null : parse.nested(block);
    this.startControlPointNumber = nested?.int32('m_nStartControlPointNumber', 0) ?? 0;
    this.midControlPointNumber = nested?.int32('m_nMidControlPointNumber', -1) ?? -1;
    this.endControlPointNumber = nested?.int32('m_nEndControlPointNumber', 0) ?? 0;
    this.bulgeControl = nested?.int32('m_nBulgeControl', 0) ?? 0;
    this.bulge = nested?.float('m_flBulge', 0) ?? 0;
    this.midPoint = nested?.float('m_flMidPoint', 0.5) ?? 0.5;
    this.startPointOffset = nested?.vector3('m_vStartPointOffset', Vector3.zero) ?? Vector3.zero;
    this.midPointOffset = nested?.vector3('m_vMidPointOffset', Vector3.zero) ?? Vector3.zero;
    this.endOffset = nested?.vector3('m_vEndOffset', Vector3.zero) ?? Vector3.zero;
  }

  withControlPoints(start: number, end: number): ParticlePathParameters {
    return new ParticlePathParameters(start, this.midControlPointNumber, end, this);
  }

  withClampedControlPoints(): ParticlePathParameters {
    return new ParticlePathParameters(
      clamp(this.startControlPointNumber, 0, MAX_CONTROL_POINT),
      clamp(this.midControlPointNumber, -1, MAX_CONTROL_POINT),
      clamp(this.endControlPointNumber, 0, MAX_CONTROL_POINT),
      this,
    );
  }
}

export interface ParticlePathValues {
  start: Vector3;
  mid: Vector3;
  end: Vector3;
}

export function getControlPointAtTime(state: ParticleSystemState, controlPoint: number, time: number): Vector3 {
  return state.getControlPoint(controlPoint).getPositionAtTime(time);
}

export function calculatePathValues(state: ParticleSystemState, path: ParticlePathParameters, timeStamp: number): ParticlePathValues {
  const start = getControlPointAtTime(state, path.startControlPointNumber, timeStamp).add(path.startPointOffset);
  const end = getControlPointAtTime(state, path.endControlPointNumber, timeStamp).add(path.endOffset);
  if (path.midControlPointNumber > -1) {
    const through = getControlPointAtTime(state, path.midControlPointNumber, timeStamp);
    return { start, mid: through.scale(2).sub(start.add(end).scale(0.5)).add(path.midPointOffset), end };
  }
  let mid = vectorLerp(start, end, path.midPoint);
  if (path.bulgeControl !== 0) {
    const bulgeCp = path.bulgeControl === 2 ? path.endControlPointNumber : path.startControlPointNumber;
    const forward = state.getControlPoint(bulgeCp).orientation;
    const direction = end.sub(start);
    const length = direction.length();
    const perpendicularity = length > MINIMUM_LENGTH ? f32(1 - Math.abs(direction.div(length).dot(forward))) : 0;
    const forwardLength = forward.length();
    if (forwardLength > MINIMUM_LENGTH) {
      mid = mid.add(forward.scale(f32(f32(f32(length * path.bulge) * perpendicularity) / forwardLength)));
    }
  } else {
    mid = mid.add(ParticleRandom.forSampleBetweenPerComponent(state.random.seed, Vector3.splat(-path.bulge), Vector3.splat(path.bulge)));
  }
  mid = mid.add(path.midPointOffset);
  return { start, mid, end };
}

export function evaluatePath(start: Vector3, mid: Vector3, end: Vector3, t: number): Vector3 {
  return vectorLerp(vectorLerp(start, mid, t), vectorLerp(mid, end, t), t);
}
