// Ported from ValveResourceFormat (MIT): ValveResourceFormat/Particles/PreEmissionOperators/SetParentControlPointsToChildCP.cs.

import { ParticleFunctionPreEmissionOperator } from '../functions';
import type { ParticleDefinitionParser } from '../parser';
import { ParticleSystemSimulation } from '../simulation';
import type { ParticleSystemState } from '../state';

/**
 * C_OP_SetParentControlPointsToChildCP: hands this system's control points down to the children of
 * a group, each the next source control point in turn, written to the same destination index.
 */
export class SetParentControlPointsToChildCP extends ParticleFunctionPreEmissionOperator {
  private readonly childGroupId: number;
  private readonly childControlPoint: number;
  private readonly numControlPoints: number;
  private readonly firstSourcePoint: number;
  private readonly setOrientation: boolean;

  constructor(parse: ParticleDefinitionParser) {
    super(parse);
    this.childGroupId = parse.int32('m_nChildGroupID', 0);
    this.childControlPoint = parse.int32('m_nChildControlPoint', 0);
    this.numControlPoints = parse.int32('m_nNumControlPoints', 1);
    this.firstSourcePoint = parse.int32('m_nFirstSourcePoint', 0);
    this.setOrientation = parse.boolean('m_bSetOrientation', false);
  }

  operate(state: ParticleSystemState): void {
    const children = state.children;
    let remaining = Math.min(this.numControlPoints, children.length);
    let source = this.firstSourcePoint;

    for (const child of children) {
      if (remaining <= 0) {
        break;
      }

      if (!ParticleSystemSimulation.isInGroup(child, this.childGroupId)) {
        continue;
      }

      const sourcePoint = state.getControlPoint(source);
      const destination = child.getControlPoint(this.childControlPoint);

      destination.position = sourcePoint.position;

      if (this.setOrientation) {
        destination.setOrientation(sourcePoint.forward, sourcePoint.left, sourcePoint.up);
      }

      remaining--;
      source++;
    }
  }
}
