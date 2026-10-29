// Ported from ValveResourceFormat (MIT): ValveResourceFormat/Particles/Operators/DistanceToTransform.cs.

import { readVector } from '../buffer';
import { type ParticleCollection } from '../collection';
import { ParticleField, ParticleSetMethod } from '../enums';
import { fieldMask, isScalarField, isAlphaField, applySetMethod } from '../fields';
import { ParticleFunctionOperator } from '../functions';
import { Vector3, f32, saturate, lerp } from '../numerics';
import { LiteralNumberProvider, type NumberProvider } from '../numberProviders';
import { type ParticleDefinitionParser } from '../parser';
import { type ParticleSystemState } from '../state';
import { ControlPointTransformProvider, type TransformProvider } from '../transformProviders';
import { LiteralVectorProvider, type VectorProvider } from '../vectorProviders';
import { scaleDistance } from '../operators/lineOfSightTrace';
import { clampedFraction } from '../utils/particleMath';

export class DistanceToTransform extends ParticleFunctionOperator {
  private readonly outputField: number;
  private readonly inputMin: NumberProvider;
  private readonly inputMax: NumberProvider;
  private readonly outputMin: NumberProvider;
  private readonly outputMax: NumberProvider;
  private readonly transformStart: TransformProvider;
  private readonly los: boolean;
  private readonly maxTraceLength: number;
  private readonly losScale: number;
  private readonly setMethod: number;
  private readonly activeRange: boolean;
  private readonly additive: boolean;
  private readonly componentScale: VectorProvider;

  constructor(parse: ParticleDefinitionParser) {
    super(parse);
    this.outputField = parse.particleField('m_nFieldOutput', ParticleField.Radius);
    this.inputMin = parse.numberProvider('m_flInputMin', new LiteralNumberProvider(0));
    this.inputMax = parse.numberProvider('m_flInputMax', new LiteralNumberProvider(128));
    this.outputMin = parse.numberProvider('m_flOutputMin', new LiteralNumberProvider(0));
    this.outputMax = parse.numberProvider('m_flOutputMax', new LiteralNumberProvider(1));
    this.transformStart = parse.transformInput('m_TransformStart', new ControlPointTransformProvider());
    this.los = parse.boolean('m_bLOS', false);
    this.maxTraceLength = parse.float('m_flMaxTraceLength', -1);
    this.losScale = parse.float('m_flLOSScale', 0);
    this.setMethod = parse.enum('m_nSetMethod', ParticleSetMethod, ParticleSetMethod.PARTICLE_SET_REPLACE_VALUE);
    this.activeRange = parse.boolean('m_bActiveRange', false);
    this.additive = parse.boolean('m_bAdditive', false);
    this.componentScale = parse.vectorProvider('m_vecComponentScale', new LiteralVectorProvider(Vector3.one));
    ParticleFunctionOperator.addInitialReadOf(parse, this.setMethod, this.outputField);
  }

  get storedFields(): bigint { return fieldMask(this.outputField); }

  operate(particles: ParticleCollection, _frameTime: number, state: ParticleSystemState, strength: number): void {
    const origin = this.transformStart.nextTransform(state).translation;
    const current = particles.currentSpan;
    const clampOutput = isAlphaField(this.outputField);
    if (!isScalarField(this.outputField)) {
      return;
    }
    const scales = this.componentScale.prepare(current, state);
    const inputMins = this.inputMin.fillNew(current, state);
    const inputMaxs = this.inputMax.fillNew(current, state);
    const outputMins = this.outputMin.fillNew(current, state);
    const outputMaxs = this.outputMax.fillNew(current, state);
    for (const { offset, block, lane } of current.inputBlocks()) {
      this.componentScale.fillPerBlock(block, lane, state, scales.subarray(offset * 3));
    }
    const positions = current.readVectors(ParticleField.Position);
    const outputs = current.floats(this.outputField);
    const initials = particles.initialSpan.readFloats(this.outputField);
    const values = new Float32Array(4);
    const pass = new Array<boolean>(4);
    for (let offset = 0; offset < current.length; offset += 4) {
      let anyPass = false;
      const blockLength = Math.min(4, current.length - offset);
      for (let lane = 0; lane < blockLength; lane++) {
        const index = offset + lane;
        const position = readVector(positions, index);
        let minimumOutput = outputMins[index];
        let maximumOutput = outputMaxs[index];
        const scaledDelta = position.sub(origin).mul(readVector(scales, index));
        let distanceSquared = scaledDelta.dot(scaledDelta);
        const inputMinSquared = f32(inputMins[index] * inputMins[index]);
        const inputMaxSquared = f32(inputMaxs[index] * inputMaxs[index]);
        pass[lane] = !this.activeRange || (distanceSquared <= inputMaxSquared && inputMinSquared <= distanceSquared);
        anyPass ||= pass[lane];
        if (this.los && pass[lane]) {
          distanceSquared = scaleDistance(state.collision, origin, position, distanceSquared, this.maxTraceLength, this.losScale);
        }
        if (clampOutput) {
          minimumOutput = saturate(minimumOutput);
          maximumOutput = saturate(maximumOutput);
        }
        const remapped = clampedFraction(distanceSquared, inputMinSquared, inputMaxSquared);
        values[lane] = lerp(minimumOutput, maximumOutput, remapped);
      }
      if (!anyPass) {
        continue;
      }
      for (let lane = 0; lane < blockLength; lane++) {
        const index = offset + lane;
        const laneStrength = pass[lane] ? strength : 0;
        const currentValue = outputs[index];
        const finalValue = applySetMethod(values[lane], initials[index], currentValue, state.currentStep, this.setMethod);
        const delta = f32(f32(finalValue - currentValue) * laneStrength);
        outputs[index] = this.additive ? f32(currentValue + f32(currentValue + delta)) : f32(currentValue + delta);
      }
    }
  }
}
