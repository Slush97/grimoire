// Ported from ValveResourceFormat (MIT): ValveResourceFormat/Particles/Operators/SetPerChildControlPoint.cs.

import { type ParticleCollection } from '../collection';
import { ParticleField } from '../enums';
import { ParticleFunctionOperator } from '../functions';
import { Vector3, safeNormalize, toInt } from '../numerics';
import { LiteralNumberProvider, type NumberProvider } from '../numberProviders';
import { type ParticleDefinitionParser } from '../parser';
import { type ParticleSystemState } from '../state';

export class SetPerChildControlPoint extends ParticleFunctionOperator {
  private readonly childGroupId: number;
  private readonly firstControlPoint: number;
  private readonly numControlPoints: number;
  private readonly particleIncrement: NumberProvider;
  private readonly firstSourcePoint: NumberProvider;
  private readonly setOrientation: boolean;
  private readonly orientationField: number;
  private readonly numBasedOnParticleCount: boolean;

  constructor(parse: ParticleDefinitionParser) {
    super(parse);
    this.childGroupId = parse.int32('m_nChildGroupID', 0);
    this.firstControlPoint = parse.int32('m_nFirstControlPoint', 0);
    this.numControlPoints = parse.int32('m_nNumControlPoints', 1);
    this.particleIncrement = parse.collectionNumberProvider('m_nParticleIncrement', new LiteralNumberProvider(1));
    this.firstSourcePoint = parse.collectionNumberProvider('m_nFirstSourcePoint', new LiteralNumberProvider(0));
    this.setOrientation = parse.boolean('m_bSetOrientation', false);
    this.orientationField = parse.particleField('m_nOrientationField', ParticleField.NoneDisabled);
    this.numBasedOnParticleCount = parse.boolean('m_bNumBasedOnParticleCount', false);
  }

  operate(particles: ParticleCollection, _frameTime: number, state: ParticleSystemState): void {
    const live = particles.currentSpan;
    const count = this.numBasedOnParticleCount ? live.length : this.numControlPoints;
    let source = toInt(this.firstSourcePoint.nextNumber(state));
    const increment = toInt(this.particleIncrement.nextNumber(state));
    let remaining = Math.min(Math.min(live.length - source, state.children.length), count);
    const step = increment % live.length;
    for (const child of state.children) {
      if (remaining <= 0 || (source >>> 0) >= (live.length >>> 0)) {
        return;
      }
      if (child.data?.groupId !== this.childGroupId) {
        continue;
      }
      const position = live.readVector(ParticleField.Position, source);
      const point = child.getControlPoint(this.firstControlPoint);
      point.position = position;
      if (this.setOrientation) {
        const velocity = position.sub(live.readVector(ParticleField.PositionPrevious, source));
        if (!velocity.equals(Vector3.zero)) {
          point.orientation = velocity;
        }
      }
      else if (this.orientationField !== ParticleField.NoneDisabled) {
        const value = live.readVector(this.orientationField, source);
        point.orientation = value.lengthSquared() === 0 ? Vector3.unitZ : safeNormalize(value);
      }
      remaining--;
      source += step;
      if (source < 0) {
        source += live.length;
      }
    }
  }
}
