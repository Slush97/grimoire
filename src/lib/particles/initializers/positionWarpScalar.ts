// Ported from ValveResourceFormat (MIT): ValveResourceFormat/Particles/Initializers/PositionWarpScalar.cs.

import { readVector, writeVector } from '../buffer';
import { type ParticleCollection } from '../collection';
import { ParticleField } from '../enums';
import { fieldMask } from '../fields';
import { ParticleFunctionInitializer, type ControlPointDefaults } from '../functions';
import { Vector3 } from '../numerics';
import { LiteralNumberProvider, type NumberProvider } from '../numberProviders';
import { type ParticleDefinitionParser } from '../parser';
import { type ParticleSpan } from '../span';
import { type ParticleSystemState } from '../state';
import { vectorLerp } from '../utils/vectorMath';
import { warpPosition } from '../utils/particleWarp';

export class PositionWarpScalar extends ParticleFunctionInitializer {
  private readonly warpMin: Vector3;
  private readonly warpMax: Vector3;
  private readonly inputValue: NumberProvider;
  private readonly prevPosScale: number;
  private readonly scaleControlPointNumber: number;
  private readonly controlPointNumber: number;

  constructor(parse: ParticleDefinitionParser) {
    super(parse);
    this.warpMin = parse.vector3('m_vecWarpMin', Vector3.one);
    this.warpMax = parse.vector3('m_vecWarpMax', Vector3.one);
    this.inputValue = parse.numberProvider('m_InputValue', new LiteralNumberProvider(0));
    this.prevPosScale = parse.float('m_flPrevPosScale', 1);
    this.scaleControlPointNumber = parse.int32('m_nScaleControlPointNumber', -1);
    this.controlPointNumber = parse.controlPoint('m_nControlPointNumber', 0);
  }

  addControlPointDefaults(defaults: ControlPointDefaults): void {
    for (let component = 0; component < 3; component++) {
      defaults.addScale(this.scaleControlPointNumber, component);
    }
  }

  get writtenFields(): bigint { return fieldMask(ParticleField.Position) | fieldMask(ParticleField.PositionPrevious) | fieldMask(ParticleField.Radius); }
  protected initializeCall(run: ParticleSpan, _particles: ParticleCollection, state: ParticleSystemState): void {
    const inputs = this.inputValue.fillNew(run, state);
    const positions = run.vectors(ParticleField.Position);
    const previous = run.vectors(ParticleField.PositionPrevious);
    const creationTimes = run.readFloats(ParticleField.CreationTime);
    let start = this.warpMin;
    let end = this.warpMax;
    if (this.scaleControlPointNumber >= 0) {
      const scale = state.getControlPoint(this.scaleControlPointNumber).position;
      start = start.mul(scale);
      end = end.mul(scale);
    }
    const cp = state.getControlPoint(this.controlPointNumber);
    for (let i = 0; i < run.length; i++) {
      const warp = vectorLerp(start, end, inputs[i]);
      const frame = cp.getBasisAtTime(creationTimes[i]);
      const result = warpPosition(frame, warp, this.prevPosScale, readVector(positions, i), readVector(previous, i));
      writeVector(positions, i, result.position);
      writeVector(previous, i, result.previous);
    }
  }
}
