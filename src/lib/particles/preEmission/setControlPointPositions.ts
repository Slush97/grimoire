// Ported from ValveResourceFormat (MIT): Particles/PreEmissionOperators/SetControlPointPositions.cs.
import { ParticleFunctionPreEmissionOperator } from '../functions';
import { Vector3, transform } from '../numerics';
import type { ParticleDefinitionParser } from '../parser';
import type { ParticleSystemState } from '../state';

export class SetControlPointPositions extends ParticleFunctionPreEmissionOperator {
  private readonly points: { controlPoint: number; position: Vector3 }[];
  private readonly setOnce: boolean;
  private readonly useWorldLocation: boolean;
  private readonly cpOffset: number;
  private readonly orient: boolean;
  private hasRunBefore = false;

  constructor(parse: ParticleDefinitionParser) {
    super(parse);
    this.points = [
      { controlPoint: parse.int32('m_nCP1', 1), position: parse.vector3('m_vecCP1Pos', new Vector3(128, 0, 0)) },
      { controlPoint: parse.int32('m_nCP2', 2), position: parse.vector3('m_vecCP2Pos', new Vector3(0, 128, 0)) },
      { controlPoint: parse.int32('m_nCP3', 3), position: parse.vector3('m_vecCP3Pos', new Vector3(-128, 0, 0)) },
      { controlPoint: parse.int32('m_nCP4', 4), position: parse.vector3('m_vecCP4Pos', new Vector3(0, -128, 0)) },
    ];
    this.setOnce = parse.boolean('m_bSetOnce', false);
    this.useWorldLocation = parse.boolean('m_bUseWorldLocation', false);
    this.cpOffset = parse.int32('m_nHeadLocation', 0);
    this.orient = parse.boolean('m_bOrient', false);
  }

  reset(): void { this.hasRunBefore = false; }
  restart(): void { this.reset(); }

  operate(state: ParticleSystemState): void {
    if (this.setOnce) {
      if (this.hasRunBefore) return;
      this.hasRunBefore = true;
    }
    if (this.useWorldLocation) {
      for (const { controlPoint, position } of this.points) state.setControlPointValue(controlPoint, position);
      return;
    }
    const head = state.getControlPoint(this.cpOffset);
    const headTransform = head.getTransform();
    for (const { controlPoint, position } of this.points) state.setControlPointValue(controlPoint, transform(position, headTransform));
    if (this.orient) {
      for (const { controlPoint } of this.points) state.setControlPointAxes(controlPoint, head.forward, head.left, head.up);
    }
  }
}
