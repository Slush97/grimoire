// Ported from ValveResourceFormat (MIT): ValveResourceFormat/Particles/Initializers/RemapTransformToVector.cs.

import { readVector, writeVector } from '../buffer';
import { type ParticleCollection } from '../collection';
import { ParticleField, ParticleSetMethod } from '../enums';
import { fieldMask, isVectorField, isScalarField, isNormalizedField, applySetMethodV } from '../fields';
import { ParticleFunctionInitializer } from '../functions';
import { isCollection } from '../kv';
import { Vector3, Quaternion, f32, saturate, minV, maxV } from '../numerics';
import { type ParticleDefinitionParser } from '../parser';
import { type ParticleSpan } from '../span';
import { type ParticleSystemState } from '../state';
import { ControlPointTransformProvider, type TransformProvider } from '../transformProviders';
import { remapClamped } from '../utils/particleMath';
import { transformQuaternion } from '../utils/vectorMath';
import { bias } from '../utils/particleMath';

export class RemapTransformToVector extends ParticleFunctionInitializer {
  private readonly fieldOutput: number;
  private readonly inputMin: Vector3;
  private readonly inputMax: Vector3;
  private readonly outputMin: Vector3;
  private readonly outputMax: Vector3;
  private readonly transformInput: TransformProvider;
  private readonly localSpaceTransform: TransformProvider | null;
  private readonly startTime: number;
  private readonly endTime: number;
  private readonly setMethod: number;
  private readonly offset: boolean;
  private readonly accelerate: boolean;
  private readonly remapBias: number;

  constructor(parse: ParticleDefinitionParser) {
    super(parse);
    this.fieldOutput = parse.particleField('m_nFieldOutput', ParticleField.Position);
    this.inputMin = parse.vector3('m_vInputMin', Vector3.zero);
    this.inputMax = parse.vector3('m_vInputMax', Vector3.zero);
    this.outputMin = parse.vector3('m_vOutputMin', Vector3.zero);
    this.outputMax = parse.vector3('m_vOutputMax', Vector3.zero);
    this.transformInput = parse.transformInput('m_TransformInput', new ControlPointTransformProvider());
    this.localSpaceTransform = isCollection(parse.data.m_LocalSpaceTransform) && parse.nested(parse.data.m_LocalSpaceTransform).string('m_nType', 'PT_TYPE_INVALID') !== 'PT_TYPE_INVALID' ? parse.transformInput('m_LocalSpaceTransform', new ControlPointTransformProvider()) : null;
    this.startTime = parse.float('m_flStartTime', -1);
    this.endTime = parse.float('m_flEndTime', -1);
    this.setMethod = parse.enum('m_nSetMethod', ParticleSetMethod, ParticleSetMethod.PARTICLE_SET_REPLACE_VALUE);
    this.offset = parse.boolean('m_bOffset', false);
    this.accelerate = parse.boolean('m_bAccelerate', false);
    this.remapBias = parse.float('m_flRemapBias', 0.5);
  }

  get writtenFields(): bigint { return fieldMask(this.fieldOutput) | fieldMask(ParticleField.PositionPrevious); }
  protected initializeCall(run: ParticleSpan, _particles: ParticleCollection, state: ParticleSystemState): void {
    const times = run.readFloats(ParticleField.CreationTime);
    const scalar = isScalarField(this.fieldOutput);
    const currentValues = !scalar ? run.readVectors(this.fieldOutput) : null;
    const outputs = isVectorField(this.fieldOutput) ? run.vectors(this.fieldOutput) : null;
    const scalars = scalar ? run.withEnd(state.initializerBatchEnd).floats(this.fieldOutput) : null;
    const previous = this.offset ? run.vectors(ParticleField.PositionPrevious) : null;
    const dt = state.currentStep;
    const window = this.startTime !== -1 && this.endTime !== -1;
    const normalized = isNormalizedField(this.fieldOutput);
    const position = this.transformInput.nextTransform(state).translation;
    let outMin = this.outputMin;
    let outMax = this.outputMax;
    if (this.localSpaceTransform !== null) {
      const rotation = Quaternion.fromRotationMatrix(this.localSpaceTransform.nextTransform(state));
      outMin = transformQuaternion(outMin, rotation);
      outMax = transformQuaternion(outMax, rotation);
    }
    for (let i = 0; i < run.length; i++) {
      if (window && (times[i] < this.startTime || times[i] >= this.endTime)) {
        continue;
      }
      let value = new Vector3(remapClamped(position.x, this.inputMin.x, this.inputMax.x, outMin.x, outMax.x), remapClamped(position.y, this.inputMin.y, this.inputMax.y, outMin.y, outMax.y), remapClamped(position.z, this.inputMin.z, this.inputMax.z, outMin.z, outMax.z));
      if (this.remapBias !== 0.5) {
        value = new Vector3(bias(saturate(value.x), this.remapBias), bias(saturate(value.y), this.remapBias), bias(saturate(value.z), this.remapBias));
      }
      const current = scalars !== null ? new Vector3(scalars[i], i + 4 < scalars.length ? scalars[i + 4] : 0, i + 8 < scalars.length ? scalars[i + 8] : 0) : currentValues !== null ? readVector(currentValues, i) : Vector3.zero;
      value = applySetMethodV(value, current, current, dt, this.setMethod);
      if (normalized) {
        value = minV(maxV(value, Vector3.zero), Vector3.one);
      }
      else if (this.accelerate && !this.offset) {
        value = value.scale(dt);
      }
      else if (this.offset) {
        value = value.add(current);
        if (previous !== null) {
          writeVector(previous, i, readVector(previous, i).add(value));
        }
        if (this.accelerate) {
          value = value.scale(f32(1 + dt));
        }
      }
      if (outputs !== null) {
        writeVector(outputs, i, value);
      }
      else if (scalars !== null) {
        scalars[i] = value.x;
        if (i + 4 < scalars.length) {
          scalars[i + 4] = value.y;
        }
        if (i + 8 < scalars.length) {
          scalars[i + 8] = value.z;
        }
      }
    }
  }
}
