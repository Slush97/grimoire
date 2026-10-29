// Ported from ValveResourceFormat (MIT): Particles/Operators/SetAttributeToScalarExpression.cs.
import { AttributeMapping } from '../attributeMapping';
import type { ParticleCollection } from '../collection';
import { ParticleField, ParticleSetMethod, ScalarExpressionType } from '../enums';
import { applySetMethod, fieldMask, isScalarField, setFloatRange } from '../fields';
import { ParticleFunctionOperator } from '../functions';
import { clamp, f32 } from '../numerics';
import { LiteralNumberProvider, type NumberProvider } from '../numberProviders';
import type { ParticleDefinitionParser } from '../parser';
import type { ParticleSystemState } from '../state';
import { evaluateScalar } from '../utils/particleExpressions';

export class SetAttributeToScalarExpression extends ParticleFunctionOperator {
  private readonly outputField: number;
  private readonly input1: NumberProvider;
  private readonly input2: NumberProvider;
  private readonly expression: number;
  private readonly setMethod: number;
  private readonly outputRemap: AttributeMapping | null;

  constructor(parse: ParticleDefinitionParser) {
    super(parse);
    this.outputField = parse.particleField('m_nOutputField', ParticleField.Radius);
    this.input1 = parse.numberProvider('m_flInput1', new LiteralNumberProvider(0));
    this.input2 = parse.numberProvider('m_flInput2', new LiteralNumberProvider(0));
    this.expression = parse.enum('m_nExpression', ScalarExpressionType, ScalarExpressionType.SCALAR_EXPRESSION_ADD);
    this.setMethod = parse.enum('m_nSetMethod', ParticleSetMethod, ParticleSetMethod.PARTICLE_SET_REPLACE_VALUE);
    this.outputRemap = AttributeMapping.fromRemapInput(parse, 'm_flOutputRemap');
    ParticleFunctionOperator.addInitialReadOf(parse, this.setMethod, this.outputField);
  }

  get storedFields(): bigint { return fieldMask(this.outputField); }

  operate(particles: ParticleCollection, _frameTime: number, state: ParticleSystemState, strength: number): void {
    const [min, max] = setFloatRange(this.outputField);
    const current = particles.currentSpan;
    const values1 = this.input1.fillNew(current, state);
    const values2 = this.input2.fillNew(current, state);
    if (!isScalarField(this.outputField)) return;
    const outputs = current.floats(this.outputField);
    const initial = particles.initialSpan.readFloats(this.outputField);
    const scalesByStrength = this.expression !== ScalarExpressionType.SCALAR_EXPRESSION_EQUAL
      && this.expression !== ScalarExpressionType.SCALAR_EXPRESSION_GT && this.expression !== ScalarExpressionType.SCALAR_EXPRESSION_LT;
    for (let i = 0; i < outputs.length; i++) {
      let evaluated = evaluateScalar(this.expression, values1[i], values2[i], true);
      if (scalesByStrength && evaluated !== null) evaluated = f32(evaluated * strength);
      let output = evaluated ?? outputs[i];
      if (this.outputRemap !== null) output = this.outputRemap.applyMapping(output);
      outputs[i] = clamp(applySetMethod(output, initial[i], outputs[i], state.currentStep, this.setMethod), min, max);
    }
  }
}
