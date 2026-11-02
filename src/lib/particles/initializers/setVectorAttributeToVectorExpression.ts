// Ported from ValveResourceFormat (MIT): ValveResourceFormat/Particles/Initializers/SetVectorAttributeToVectorExpression.cs.

import { readVector, writeVector } from '../buffer';
import { type ParticleCollection } from '../collection';
import { ParticleField, ParticleSetMethod, VectorExpressionType } from '../enums';
import { fieldMask, isVectorField, isNormalizedField, applySetMethodV } from '../fields';
import { ParticleFunctionInitializer } from '../functions';
import { Vector3, f32, minV, maxV } from '../numerics';
import { LiteralNumberProvider, type NumberProvider } from '../numberProviders';
import { type ParticleDefinitionParser } from '../parser';
import { type ParticleSpan } from '../span';
import { type ParticleSystemState } from '../state';
import { LiteralVectorProvider, type VectorProvider } from '../vectorProviders';
import { FLOAT_MIN_NORMAL, FLOAT_EPSILON, normalizeWithEpsilon } from '../utils/particleMath';
import { evaluateVector } from '../utils/particleExpressions';

export class SetVectorAttributeToVectorExpression extends ParticleFunctionInitializer {
  private readonly expression: number;
  private readonly input1: VectorProvider;
  private readonly input2: VectorProvider;
  private readonly lerp: NumberProvider;
  private readonly outputField: number;
  private readonly setMethod: number;
  private readonly normalizedOutput: boolean;

  constructor(parse: ParticleDefinitionParser) {
    super(parse);
    this.expression = parse.enum('m_nExpression', VectorExpressionType, VectorExpressionType.VECTOR_EXPRESSION_ADD);
    this.input1 = parse.vectorProvider('m_vInput1', new LiteralVectorProvider(Vector3.zero));
    this.input2 = parse.vectorProvider('m_vInput2', new LiteralVectorProvider(Vector3.zero));
    this.lerp = parse.numberProvider('m_flLerp', new LiteralNumberProvider(0));
    this.outputField = parse.particleField('m_nOutputField', ParticleField.Normal);
    this.setMethod = parse.enum('m_nSetMethod', ParticleSetMethod, ParticleSetMethod.PARTICLE_SET_REPLACE_VALUE);
    this.normalizedOutput = parse.boolean('m_bNormalizedOutput', false);
  }

  get writtenFields(): bigint { return fieldMask(this.outputField); }
  protected initializeCall(run: ParticleSpan, particles: ParticleCollection, state: ParticleSystemState): void { this.initializeRun(run, particles, state, false); }
  protected initializeBlocks(run: ParticleSpan, particles: ParticleCollection, state: ParticleSystemState): void { this.initializeRun(run, particles, state, true); }
  private initializeRun(run: ParticleSpan, particles: ParticleCollection, state: ParticleSystemState, blockRun: boolean): void {
    const values1 = this.input1.prepare(run, state);
    const values2 = this.input2.prepare(run, state);
    const lerps = this.lerp.fillEvaluated(run, particles.currentSpan, state);
    for (const { offset, block, lane } of run.inputBlocks()) {
      this.input1.fillPerBlock(block, lane, state, values1.subarray(offset * 3));
      this.input2.fillPerBlock(block, lane, state, values2.subarray(offset * 3));
    }
    if (!isVectorField(this.outputField)) {
      return;
    }
    const outputs = run.vectors(this.outputField);
    for (let i = 0; i < run.length; i++) {
      const current = readVector(outputs, i);
      const fallback = blockRun ? (i >= 4 ? readVector(outputs, i - 4) : Vector3.zero) : current;
      const result = evaluateVector(this.expression, readVector(values1, i), readVector(values2, i), lerps[i], blockRun) ?? fallback;
      let value = applySetMethodV(result, current, current, state.currentStep, this.setMethod);
      if (isNormalizedField(this.outputField)) {
        value = minV(maxV(value, Vector3.zero), Vector3.one);
      }
      if (this.normalizedOutput) {
        if (blockRun) {
          const squared = value.lengthSquared();
          value = value.div(f32(Math.sqrt(squared < FLOAT_MIN_NORMAL ? FLOAT_EPSILON : squared)));
        }
        else {
          value = normalizeWithEpsilon(value);
        }
      }
      writeVector(outputs, i, value);
    }
  }
}
