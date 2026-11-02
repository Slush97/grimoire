// Ported from ValveResourceFormat (MIT): ValveResourceFormat/Particles/Initializers/SetAttributeToScalarExpression.cs.

import { AttributeMapping } from '../attributeMapping';
import { type ParticleCollection } from '../collection';
import { ParticleField, ParticleSetMethod, ScalarExpressionType } from '../enums';
import { fieldMask, isScalarField, applySetMethod, setFloatRange } from '../fields';
import { ParticleFunctionInitializer } from '../functions';
import { clamp } from '../numerics';
import { LiteralNumberProvider, type NumberProvider } from '../numberProviders';
import { type ParticleDefinitionParser } from '../parser';
import { type ParticleSpan } from '../span';
import { type ParticleSystemState } from '../state';
import { evaluateScalar } from '../utils/particleExpressions';

export class SetAttributeToScalarExpression extends ParticleFunctionInitializer {
  private readonly expression: number;
  private readonly input1: NumberProvider;
  private readonly input2: NumberProvider;
  private readonly outputRemap: AttributeMapping | null;
  private readonly outputField: number;
  private readonly setMethod: number;

  constructor(parse: ParticleDefinitionParser) {
    super(parse);
    this.expression = parse.enum('m_nExpression', ScalarExpressionType, ScalarExpressionType.SCALAR_EXPRESSION_ADD);
    this.input1 = parse.numberProvider('m_flInput1', new LiteralNumberProvider(0));
    this.input2 = parse.numberProvider('m_flInput2', new LiteralNumberProvider(0));
    this.outputRemap = AttributeMapping.fromRemapInput(parse, 'm_flOutputRemap');
    this.outputField = parse.particleField('m_nOutputField', ParticleField.Radius);
    this.setMethod = parse.enum('m_nSetMethod', ParticleSetMethod, ParticleSetMethod.PARTICLE_SET_REPLACE_VALUE);
  }

  get writtenFields(): bigint { return fieldMask(this.outputField); }

  get liveWrittenFields(): bigint { return fieldMask(this.outputField); }
  protected initializeCall(run: ParticleSpan, particles: ParticleCollection, state: ParticleSystemState): void { this.initializeRun(run, particles, state, false); }
  protected initializeBlocks(run: ParticleSpan, particles: ParticleCollection, state: ParticleSystemState): void { this.initializeRun(run, particles, state, true); }
  private initializeRun(run: ParticleSpan, particles: ParticleCollection, state: ParticleSystemState, blockRun: boolean): void {
    const target = blockRun ? particles.currentSpan : run;
    const values1 = this.input1.fillNew(target, state);
    const values2 = this.input2.fillNew(target, state);
    if (!isScalarField(this.outputField)) {
      return;
    }
    const [min, max] = setFloatRange(this.outputField);
    const outputs = target.floats(this.outputField);
    for (let i = 0; i < outputs.length; i++) {
      const current = outputs[i];
      let value = evaluateScalar(this.expression, values1[i], values2[i], blockRun) ?? current;
      if (this.outputRemap !== null) {
        value = this.outputRemap.applyMapping(value);
      }
      outputs[i] = clamp(applySetMethod(value, current, current, state.currentStep, this.setMethod), min, max);
    }
  }
}
