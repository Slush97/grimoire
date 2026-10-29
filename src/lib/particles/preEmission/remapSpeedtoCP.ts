// Ported from ValveResourceFormat (MIT): ValveResourceFormat/Particles/PreEmissionOperators/RemapSpeedtoCP.cs.

import { ParticleFunctionPreEmissionOperator } from '../functions';
import { Vector3, f32, floatLerp, saturate } from '../numerics';
import type { ParticleDefinitionParser } from '../parser';
import type { ParticleSystemState } from '../state';

export class RemapSpeedtoCP extends ParticleFunctionPreEmissionOperator {
  private readonly inControlPoint: number;
  private readonly outControlPoint: number;
  private readonly field: number;
  private readonly inputMin: number;
  private readonly inputMax: number;
  private readonly outputMin: number;
  private readonly outputMax: number;
  private readonly useDeltaV: boolean;
  private previousVelocity = Vector3.zero;

  constructor(parse: ParticleDefinitionParser) {
    super(parse);
    this.inControlPoint = parse.int32('m_nInControlPointNumber', 0);
    this.outControlPoint = parse.int32('m_nOutControlPointNumber', -1);
    this.field = parse.int32('m_nField', 0);
    this.inputMin = parse.float('m_flInputMin', 0);
    this.inputMax = parse.float('m_flInputMax', 1);
    this.outputMin = parse.float('m_flOutputMin', 0);
    this.outputMax = parse.float('m_flOutputMax', 1);
    this.useDeltaV = parse.boolean('m_bUseDeltaV', false);
    if (this.outControlPoint === this.inControlPoint) {
      this.outControlPoint = -1;
    }
  }

  reset(): void {
    this.previousVelocity = Vector3.zero;
  }

  restart(state: ParticleSystemState): void {
    this.previousVelocity = state.getControlPoint(this.inControlPoint).position;
  }

  operate(state: ParticleSystemState, frameTime: number): void {
    if (this.outControlPoint < 0 || this.field < 0 || this.field > 2 || frameTime <= 0) {
      return;
    }
    const velocity = state.getControlPoint(this.inControlPoint).stepDelta.div(frameTime);
    let speed: number;
    if (this.useDeltaV) {
      speed = velocity.sub(this.previousVelocity).length();
      this.previousVelocity = velocity;
    } else {
      speed = velocity.length();
    }
    const output = this.inputMin === this.inputMax
      ? speed >= this.inputMax ? this.outputMax : this.outputMin
      : floatLerp(this.outputMin, this.outputMax, saturate(f32(f32(speed - this.inputMin) / f32(this.inputMax - this.inputMin))));
    state.setControlPointValueComponent(this.outControlPoint, this.field, output);
  }
}
