// Ported from ValveResourceFormat (MIT): ValveResourceFormat/Particles/PreEmissionOperators/SetControlPointFieldToScalarExpression.cs.

import { AttributeMapping } from '../attributeMapping';
import { ScalarExpressionType } from '../enums';
import { ParticleFunctionPreEmissionOperator } from '../functions';
import { saturate, lerp } from '../numerics';
import { LiteralNumberProvider, type NumberProvider } from '../numberProviders';
import { type ParticleDefinitionParser } from '../parser';
import { type ParticleSystemState } from '../state';
import { evaluateScalar } from '../utils/particleExpressions';

export class SetControlPointFieldToScalarExpression extends ParticleFunctionPreEmissionOperator {
  private readonly expression: number;
  private readonly input1: NumberProvider;
  private readonly input2: NumberProvider;
  private readonly outputRemap: AttributeMapping | null;
  private readonly outputCP: number;
  private readonly outVectorField: number;
  private readonly interpolation: NumberProvider;

  constructor(parse: ParticleDefinitionParser) {
    super(parse);
    this.expression = parse.enum('m_nExpression', ScalarExpressionType, ScalarExpressionType.SCALAR_EXPRESSION_ADD);
    this.input1 = parse.collectionNumberProvider('m_flInput1', new LiteralNumberProvider(0));
    this.input2 = parse.collectionNumberProvider('m_flInput2', new LiteralNumberProvider(0));
    this.outputRemap = AttributeMapping.fromRemapInput(parse, 'm_flOutputRemap');
    this.outputCP = parse.int32('m_nOutputCP', 2);
    this.outVectorField = parse.int32('m_nOutVectorField', 0);
    this.interpolation = parse.collectionNumberProvider('m_flInterpolation', new LiteralNumberProvider(1));
  }

  operate(state: ParticleSystemState): void {
    let value = evaluateScalar(this.expression, this.input1.nextNumber(state), this.input2.nextNumber(state)) ?? 0;
    if (this.outputRemap !== null) {
      value = this.outputRemap.applyMapping(value);
    }
    const amount = this.interpolation.nextNumber(state);
    if (this.outVectorField < 0 || this.outVectorField > 2) {
      return;
    }
    const point = state.getControlPoint(this.outputCP);
    if (amount !== 1) {
      value = lerp(point.position.component(this.outVectorField), value, saturate(amount));
    }
    point.setComponent(this.outVectorField, value);
  }
}
