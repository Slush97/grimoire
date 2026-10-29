// Ported from ValveResourceFormat (MIT): ValveResourceFormat/Particles/Initializers/CreateSequentialPathV2.cs.

import { writeVector } from '../buffer';
import type { ParticleCollection } from '../collection';
import { ParticleField } from '../enums';
import { fieldMask } from '../fields';
import { ParticleFunctionInitializer } from '../functions';
import { Vector3, f32, toInt } from '../numerics';
import { LiteralNumberProvider, type NumberProvider } from '../numberProviders';
import type { ParticleDefinitionParser } from '../parser';
import type { ParticleSpan } from '../span';
import type { ParticleSystemState } from '../state';
import { ParticlePathParameters, calculatePathValues, evaluatePath } from '../utils/particlePath';

const PATH_PARAMETER_EPSILON = f32(1e-5);

export class CreateSequentialPathV2 extends ParticleFunctionInitializer {
  private readonly maxDistance: NumberProvider;
  private readonly numToAssign: NumberProvider;
  private readonly loop: boolean;
  private readonly cpPairs: boolean;
  private readonly saveOffset: boolean;
  private readonly pathParams: ParticlePathParameters;
  private readonly spanLength: number;
  private readonly spanDirection: number;
  private pathParameter = 0;
  private parameterStep = 0;
  private cachedNumToAssign = Number.NaN;

  constructor(parse: ParticleDefinitionParser) {
    super(parse);
    this.maxDistance = parse.numberProvider('m_fMaxDistance', new LiteralNumberProvider(0));
    this.numToAssign = parse.collectionNumberProvider('m_flNumToAssign', new LiteralNumberProvider(100));
    this.loop = parse.boolean('m_bLoop', true);
    this.cpPairs = parse.boolean('m_bCPPairs', false);
    this.saveOffset = parse.boolean('m_bSaveOffset', false);
    this.pathParams = new ParticlePathParameters(parse).withClampedControlPoints();
    this.spanDirection = this.pathParams.endControlPointNumber >= this.pathParams.startControlPointNumber ? 1 : -1;
    if (this.cpPairs) {
      this.spanLength = Math.abs(this.pathParams.endControlPointNumber - this.pathParams.startControlPointNumber);
      if (this.spanLength <= 1) {
        this.cpPairs = false;
      }
    } else {
      this.spanLength = 1;
    }
  }

  reset(): void {
    this.pathParameter = 0;
    this.parameterStep = 0;
    this.cachedNumToAssign = Number.NaN;
  }

  restart(): void {
    this.reset();
  }

  get writtenFields(): bigint {
    return fieldMask(ParticleField.Position) | fieldMask(ParticleField.PositionPrevious) | fieldMask(ParticleField.HitboxOffsetPosition);
  }

  protected initializeCall(run: ParticleSpan, particles: ParticleCollection, state: ParticleSystemState): void {
    const assignCount = this.numToAssign.nextNumber(state);
    if (assignCount !== this.cachedNumToAssign) {
      this.cachedNumToAssign = assignCount;
      this.parameterStep = assignCount > 1 ? f32(1 / f32(assignCount - 1)) : 0;
      if (this.cpPairs && this.spanLength > 1) {
        this.parameterStep = f32(this.parameterStep * this.spanLength);
      }
    }
    let endpointsDistinct = true;
    if (this.cpPairs && this.loop) {
      const startPos = state.getControlPoint(this.pathParams.startControlPointNumber).position;
      const endPos = state.getControlPoint(this.pathParams.endControlPointNumber).position;
      endpointsDistinct = Math.abs(f32(startPos.x - endPos.x)) > f32(0.001)
        || Math.abs(f32(startPos.y - endPos.y)) > f32(0.001)
        || Math.abs(f32(startPos.z - endPos.z)) > f32(0.001);
    }
    const jitters = this.maxDistance.fillEvaluated(run, particles.currentSpan, state);
    const creationTimes = run.readFloats(ParticleField.CreationTime);
    const positions = run.vectors(ParticleField.Position);
    const previous = run.vectors(ParticleField.PositionPrevious);
    const hitboxOffsets = this.saveOffset ? run.vectors(ParticleField.HitboxOffsetPosition) : null;
    let cachedSegment: [number, number] | null = null;
    let cachedPath = { start: Vector3.zero, mid: Vector3.zero, end: Vector3.zero };
    for (let i = 0; i < run.length; i++) {
      let t = this.pathParameter;
      let segmentStart: number;
      let segmentEnd: number;
      if (!this.cpPairs) {
        segmentStart = this.pathParams.startControlPointNumber;
        segmentEnd = this.pathParams.endControlPointNumber;
      } else {
        segmentStart = this.pathParams.startControlPointNumber + toInt(t) * this.spanDirection;
        segmentEnd = segmentStart + this.spanDirection;
        t = f32(t - toInt(t));
        if (this.spanDirection * (this.spanDirection + segmentStart - this.pathParams.endControlPointNumber) >= 1) {
          segmentEnd = this.pathParams.endControlPointNumber;
          segmentStart = this.pathParams.endControlPointNumber - this.spanDirection;
          t = 1;
        }
      }
      if (cachedSegment === null || cachedSegment[0] !== segmentStart || cachedSegment[1] !== segmentEnd) {
        cachedSegment = [segmentStart, segmentEnd];
        cachedPath = calculatePathValues(state, this.pathParams.withControlPoints(segmentStart, segmentEnd), creationTimes[i]);
      }
      const { start, mid, end } = cachedPath;
      let position = evaluatePath(start, mid, end, t);
      if (hitboxOffsets !== null) {
        writeVector(hitboxOffsets, i, new Vector3(t, segmentStart, segmentEnd));
      }
      const jitter = jitters[i];
      position = position.add(state.random.nextBetweenPerComponent(Vector3.splat(-jitter), Vector3.splat(jitter)));
      writeVector(positions, i, position);
      writeVector(previous, i, position);
      const previousParameter = this.pathParameter;
      this.pathParameter = f32(this.pathParameter + this.parameterStep);
      let advanced = this.pathParameter;
      if (this.parameterStep > PATH_PARAMETER_EPSILON) {
        if (Math.abs(f32(advanced - this.spanLength)) < PATH_PARAMETER_EPSILON) {
          advanced = this.spanLength;
          this.pathParameter = advanced;
        } else if (Math.abs(advanced) < PATH_PARAMETER_EPSILON) {
          advanced = 0;
          this.pathParameter = 0;
        }
      }
      if (advanced > this.spanLength || advanced < 0) {
        let wrapped = this.parameterStep <= 0 ? -advanced : f32(advanced - this.spanLength);
        if (this.loop) {
          this.pathParameter = wrapped;
          if (endpointsDistinct && previousParameter === this.spanLength) {
            this.pathParameter = 0;
          }
        } else {
          if (this.parameterStep >= 0) {
            wrapped = f32(this.spanLength - wrapped);
          }
          this.pathParameter = wrapped;
          this.parameterStep = -this.parameterStep;
        }
      }
    }
  }
}
