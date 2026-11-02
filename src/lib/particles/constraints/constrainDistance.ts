// Ported from ValveResourceFormat (MIT): ValveResourceFormat/Particles/Constraints/ConstrainDistance.cs.

import { readVector, writeVector } from '../buffer';
import { type ParticleCollection } from '../collection';
import { ParticleField } from '../enums';
import { fieldMask } from '../fields';
import { ParticleFunctionConstraint } from '../functions';
import { Vector3, FLOAT_MAX, f32, transform } from '../numerics';
import { LiteralNumberProvider, type NumberProvider } from '../numberProviders';
import { type ParticleDefinitionParser } from '../parser';
import { type ParticleSystemState } from '../state';
import { ControlPointTransformProvider, type TransformProvider } from '../transformProviders';
import { LiteralVectorProvider, type VectorProvider } from '../vectorProviders';

export class ConstrainDistance extends ParticleFunctionConstraint {
  private readonly minDistance: NumberProvider;
  private readonly maxDistance: NumberProvider;
  private readonly transformInput: TransformProvider;
  private readonly centerOffset: VectorProvider;
  private readonly globalCenter: boolean;

  constructor(parse: ParticleDefinitionParser) {
    super(parse);
    this.minDistance = parse.numberProvider('m_fMinDistance', new LiteralNumberProvider(0));
    this.maxDistance = parse.numberProvider('m_fMaxDistance', new LiteralNumberProvider(100));
    this.transformInput = parse.transformInput('m_nControlPointNumber', new ControlPointTransformProvider());
    this.centerOffset = parse.vectorProvider('m_CenterOffset', new LiteralVectorProvider(Vector3.zero));
    this.globalCenter = parse.boolean('m_bGlobalCenter', false);
  }

  get storedFields(): bigint { return fieldMask(ParticleField.Position); }

  applyConstraint(particles: ParticleCollection, _frameTime: number, state: ParticleSystemState): boolean {
    const offset = this.centerOffset.nextVector(state);
    const center = this.globalCenter ? offset : transform(offset, this.transformInput.nextTransform(state));
    const min = this.minDistance.nextNumber(state);
    let max = this.maxDistance.nextNumber(state);
    if (max < 0) {
      max = FLOAT_MAX;
    }
    const hasMin = min > 0;
    const minSquared = f32(min * min);
    const maxSquared = f32(max * max);
    let moved = false;
    const current = particles.currentSpan;
    const positions = current.vectors(ParticleField.Position);
    const deltas: Vector3[] = [];
    for (let start = 0; start < current.length; start += 4) {
      const length = Math.min(4, current.length - start);
      let outsideAny = false;
      let atCenter = false;
      for (let lane = 0; lane < length; lane++) {
        deltas[lane] = readVector(positions, start + lane).sub(center);
        const squared = deltas[lane].lengthSquared();
        outsideAny ||= squared < minSquared || squared > maxSquared;
        atCenter ||= squared <= 0;
      }
      if (!outsideAny) {
        continue;
      }
      const reseed = hasMin && atCenter;
      let jitterX = [0, 0, 0, 0];
      let jitterY = [0, 0, 0, 0];
      let jitterZ = [0, 0, 0, 0];
      if (reseed) {
        jitterX = state.threadRandom.nextBetween(-f32(0.001), f32(0.001));
        jitterY = state.threadRandom.nextBetween(-f32(0.001), f32(0.001));
        jitterZ = state.threadRandom.nextBetween(-f32(0.001), f32(0.001));
      }
      for (let lane = 0; lane < length; lane++) {
        let delta = deltas[lane];
        const squared = delta.lengthSquared();
        const outside = squared < minSquared || squared > maxSquared;
        const target = hasMin && squared < minSquared ? min : max;
        if (!outside && !reseed) {
          continue;
        }
        if (reseed) {
          delta = squared <= 0 ? new Vector3(jitterX[lane], jitterY[lane], jitterZ[lane]) : Vector3.splat(delta.x);
        }
        const newSquared = delta.lengthSquared();
        if (newSquared <= 0) {
          continue;
        }
        const position = outside ? center.add(delta.scale(f32(target / f32(Math.sqrt(newSquared))))) : center.add(delta);
        if (!position.equals(readVector(positions, start + lane))) {
          writeVector(positions, start + lane, position);
          moved = true;
        }
      }
    }
    return moved;
  }
}
