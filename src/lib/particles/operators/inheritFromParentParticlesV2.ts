// Ported from ValveResourceFormat (MIT): ValveResourceFormat/Particles/Operators/InheritFromParentParticlesV2.cs.

import { readVector, writeVector } from '../buffer';
import { type ParticleCollection } from '../collection';
import { ParticleField, ParticleMissingParentBehavior } from '../enums';
import { fieldMask, isVectorField, isScalarField, isNormalizedField, isAlphaField } from '../fields';
import { ParticleFunctionOperator } from '../functions';
import { Vector3, INT_MIN, f32, clamp, saturate, lerp, lerpV, minV, maxV, toInt } from '../numerics';
import { LiteralNumberProvider, type NumberProvider } from '../numberProviders';
import { type ParticleDefinitionParser } from '../parser';
import { type ParticleSystemState } from '../state';
import { isIntegerField } from '../fields';

export class InheritFromParentParticlesV2 extends ParticleFunctionOperator {
  private readonly scale: NumberProvider;
  private readonly fieldOutput: number;
  private readonly increment: NumberProvider;
  private readonly subSample: boolean;
  private readonly randomDistribution: boolean;
  private readonly reverse: boolean;
  private readonly missingParentBehavior: number;
  private readonly interpolation: NumberProvider;

  constructor(parse: ParticleDefinitionParser) {
    super(parse);
    this.scale = parse.numberProvider('m_flScale', new LiteralNumberProvider(1));
    this.fieldOutput = parse.particleField('m_nFieldOutput', ParticleField.Radius);
    this.increment = parse.numberProvider('m_nIncrement', new LiteralNumberProvider(1));
    this.subSample = parse.boolean('m_bSubSample', false);
    this.randomDistribution = parse.boolean('m_bRandomDistribution', false);
    this.reverse = parse.boolean('m_bReverse', false);
    this.missingParentBehavior = parse.enum('m_nMissingParentBehavior', ParticleMissingParentBehavior, ParticleMissingParentBehavior.MISSING_PARENT_DO_NOTHING);
    this.interpolation = parse.numberProvider('m_flInterpolation', new LiteralNumberProvider(1));
  }

  get storedFields(): bigint { return fieldMask(this.fieldOutput) | fieldMask(ParticleField.ParentParticleIndex) | fieldMask(ParticleField.ParentParticleId); }

  operate(particles: ParticleCollection, _frameTime: number, state: ParticleSystemState): void {
    const parent = state.parentSystem?.data;
    if (parent === null || parent === undefined) {
      return;
    }
    const current = particles.currentSpan;
    const parents = parent.particles.currentSpan;
    const count = parents.length;
    if (count === 0) {
      if (this.missingParentBehavior === ParticleMissingParentBehavior.MISSING_PARENT_KILL) {
        for (let i = 0; i < current.length; i++) {
          particles.kill(i);
        }
      }
      return;
    }
    const bones = this.fieldOutput === ParticleField.BoneIndices ? current.buffer.boneIndices : null;
    const vectors = isVectorField(this.fieldOutput) ? current.vectors(this.fieldOutput) : null;
    const scalars = isScalarField(this.fieldOutput) ? current.floats(this.fieldOutput) : null;
    const ids = current.integers(ParticleField.ParentParticleId);
    const indices = current.integers(ParticleField.ParentParticleIndex);
    const scales = this.scale.fillNew(current, state);
    const increments = this.increment.fillNew(current, state);
    const blends = this.interpolation.fillNew(current, state);
    let walk = this.reverse ? count - 1 : 0;
    let carried = 0;
    let copied = 0;
    const rebind = (i: number, index: number) => { indices[i] = index; ids[i] = parents.readInteger(ParticleField.ParticleId, index); };
    for (let i = 0; i < current.length; i++) {
      if (this.randomDistribution) {
        walk = state.random.nextIndex(count);
      }
      else if (walk < 0 || walk > count - 1) {
        walk = this.reverse ? count - 1 : 0;
      }
      const step = increments[i];
      const fractional = this.subSample && step < 1;
      if (ids[i] < 0 && indices[i] < 0) {
        rebind(i, walk);
      }
      let copy = true;
      if (ids[i] === INT_MIN) {
        switch (this.missingParentBehavior) {
          case ParticleMissingParentBehavior.MISSING_PARENT_KILL:
            particles.kill(i);
            copy = false;
            break;
          case ParticleMissingParentBehavior.MISSING_PARENT_FIND_NEW:
            rebind(i, state.random.nextIndex(count));
            break;
          case ParticleMissingParentBehavior.MISSING_PARENT_SAME_INDEX:
            rebind(i, clamp(indices[i], 0, count - 1));
            break;
          default: copy = false;
        }
      }
      if (copy && (indices[i] >>> 0) < (count >>> 0)) {
        const source = indices[i];
        const next = this.reverse ? Math.max(source - 1, 0) : Math.min(source + 1, count - 1);
        if (bones !== null) {
          bones[current.start + i] = parents.buffer.boneIndices?.[parents.start + source] ?? parents.buffer.constants.boneIndices;
        }
        else if (vectors !== null) {
          let value = parents.readVector(this.fieldOutput, source).scale(scales[copied]);
          const normalized = isNormalizedField(this.fieldOutput);
          if (normalized) {
            value = minV(maxV(value, Vector3.zero), Vector3.one);
          }
          if (carried > 0) {
            let nextValue = parents.readVector(this.fieldOutput, next).scale(scales[copied]);
            if (normalized) {
              nextValue = minV(maxV(nextValue, Vector3.zero), Vector3.one);
            }
            value = lerpV(value, nextValue, carried);
          }
          writeVector(vectors, i, lerpV(readVector(vectors, i), value, blends[copied]));
        }
        else if (scalars !== null) {
          if (isIntegerField(this.fieldOutput)) {
            scalars[i] = parents.readFloat(this.fieldOutput, source);
          }
          else {
            let value = f32(parents.readFloat(this.fieldOutput, source) * scales[copied]);
            if (carried > 0) {
              value = lerp(value, f32(parents.readFloat(this.fieldOutput, next) * scales[copied]), saturate(carried));
            }
            value = lerp(scalars[i], value, saturate(blends[copied]));
            if (isAlphaField(this.fieldOutput)) {
              value = saturate(value);
            }
            scalars[i] = value;
          }
        }
      }
      if (copy) {
        copied++;
      }
      if (fractional) {
        carried = f32(carried + step);
        if (carried >= 1) {
          carried = f32(carried - Math.floor(carried));
          walk += this.reverse ? -1 : 1;
        }
      }
      else {
        walk += toInt(this.reverse ? -step : step);
      }
    }
  }
}
