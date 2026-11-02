// Ported from ValveResourceFormat (MIT): ValveResourceFormat/Particles/PreEmissionOperators/SetControlPointToVectorExpression.cs.

import { VectorExpression } from '../enums';
import { ParticleFunctionPreEmissionOperator } from '../functions';
import { Vector3, cross, lerpV, maxV, minV, safeNormalize } from '../numerics';
import { LiteralNumberProvider, type NumberProvider } from '../numberProviders';
import type { ParticleDefinitionParser } from '../parser';
import type { ParticleSystemState } from '../state';
import { LiteralVectorProvider, type VectorProvider } from '../vectorProviders';

export class SetControlPointToVectorExpression extends ParticleFunctionPreEmissionOperator {
  private readonly outputCP: number;
  private readonly input1: VectorProvider;
  private readonly input2: VectorProvider;
  private readonly lerp: NumberProvider;
  private readonly expression: number;
  private readonly normalizedOutput: boolean;

  constructor(parse: ParticleDefinitionParser) {
    super(parse);
    this.outputCP = parse.int32('m_nOutputCP', 2);
    this.input1 = parse.vectorProvider('m_vInput1', new LiteralVectorProvider(Vector3.zero));
    this.input2 = parse.vectorProvider('m_vInput2', new LiteralVectorProvider(Vector3.zero));
    this.lerp = parse.numberProvider('m_flLerp', new LiteralNumberProvider(0));
    this.expression = parse.enum('m_nExpression', VectorExpression, VectorExpression.VECTOR_EXPRESSION_ADD);
    this.normalizedOutput = parse.boolean('m_bNormalizedOutput', false);
  }

  operate(state: ParticleSystemState): void {
    const setUpVec1 = this.input1.drawsPerBlock ? Vector3.zero : this.input1.nextVector(state);
    const setUpVec2 = this.input2.drawsPerBlock ? Vector3.zero : this.input2.nextVector(state);
    const simulation = state.data;
    const lerpAmount = simulation !== null && simulation.particles.count > 0
      ? this.lerp.nextNumberAt(simulation.particles.currentSpan, 0, state)
      : this.lerp.nextNumber(state);
    const vec1 = this.input1.drawsPerBlock ? this.input1.nextVector(state) : setUpVec1;
    const vec2 = this.input2.drawsPerBlock ? this.input2.nextVector(state) : setUpVec2;
    let output: Vector3;
    switch (this.expression) {
      case VectorExpression.VECTOR_EXPRESSION_ADD:
        output = vec1.add(vec2);
        break;
      case VectorExpression.VECTOR_EXPRESSION_SUBTRACT:
        output = vec1.sub(vec2);
        break;
      case VectorExpression.VECTOR_EXPRESSION_MUL:
        output = vec1.mul(vec2);
        break;
      case VectorExpression.VECTOR_EXPRESSION_DIVIDE:
        output = new Vector3(vec1.x / vec2.x, vec1.y / vec2.y, vec1.z / vec2.z);
        break;
      case VectorExpression.VECTOR_EXPRESSION_INPUT_1:
        output = vec1;
        break;
      case VectorExpression.VECTOR_EXPRESSION_MIN:
        output = minV(vec1, vec2);
        break;
      case VectorExpression.VECTOR_EXPRESSION_MAX:
        output = maxV(vec1, vec2);
        break;
      case VectorExpression.VECTOR_EXPRESSION_CROSSPRODUCT:
        output = cross(vec1, vec2);
        break;
      case VectorExpression.VECTOR_EXPRESSION_LERP:
        output = lerpV(vec1, vec2, lerpAmount);
        break;
      default:
        output = Vector3.zero;
    }
    if (this.normalizedOutput) {
      output = safeNormalize(output);
    }
    state.setControlPointValue(this.outputCP, output);
  }
}
