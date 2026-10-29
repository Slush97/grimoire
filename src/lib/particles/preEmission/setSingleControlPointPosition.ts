// Ported from ValveResourceFormat (MIT): ValveResourceFormat/Particles/PreEmissionOperators/SetSingleControlPointPosition.cs.

import { ParticleFunctionPreEmissionOperator } from '../functions';
import { Vector3, transform } from '../numerics';
import type { ParticleDefinitionParser } from '../parser';
import type { ParticleSystemState } from '../state';
import { ControlPointTransformProvider, type TransformProvider } from '../transformProviders';
import { LiteralVectorProvider, type VectorProvider } from '../vectorProviders';

export class SetSingleControlPointPosition extends ParticleFunctionPreEmissionOperator {
  private readonly cp1: number;
  private readonly cp1Pos: VectorProvider;
  private readonly setOnce: boolean;
  private readonly transformInput: TransformProvider;
  private hasRunBefore = false;

  constructor(parse: ParticleDefinitionParser) {
    super(parse);
    this.cp1 = parse.int32('m_nCP1', 1);
    this.cp1Pos = parse.vectorProvider('m_vecCP1Pos', new LiteralVectorProvider(new Vector3(128, 0, 0)));
    this.setOnce = parse.boolean('m_bSetOnce', false);
    this.transformInput = parse.transformInput('m_transformInput', new ControlPointTransformProvider());
  }

  reset(): void {
    this.hasRunBefore = false;
  }

  restart(): void {
    this.reset();
  }

  operate(state: ParticleSystemState): void {
    const position = this.cp1Pos.nextVector(state);
    if (this.setOnce) {
      if (this.hasRunBefore) {
        return;
      }
      this.hasRunBefore = true;
    }
    state.setControlPointValue(this.cp1, transform(position, this.transformInput.nextTransform(state)));
  }
}
