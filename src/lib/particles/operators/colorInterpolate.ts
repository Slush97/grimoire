// Ported from ValveResourceFormat (MIT): ValveResourceFormat/Particles/Operators/ColorInterpolate.cs.

import { readVector, writeVector } from '../buffer';
import type { ParticleCollection } from '../collection';
import { ParticleField } from '../enums';
import { fieldMask, isVectorField } from '../fields';
import { ParticleFunctionOperator } from '../functions';
import { Vector3, f32, lerpV, remap, saturate, smoothstep } from '../numerics';
import type { ParticleDefinitionParser } from '../parser';
import type { ParticleSystemState } from '../state';

export class ColorInterpolate extends ParticleFunctionOperator {
  private readonly colorFade: Vector3;
  private readonly fadeStartTime: number;
  private readonly fadeEndTime: number;
  private readonly fieldOutput: number;
  private readonly easeInOut: boolean;

  constructor(parse: ParticleDefinitionParser) {
    super(parse);
    this.colorFade = parse.color24('m_ColorFade', Vector3.one);
    this.fadeStartTime = parse.float('m_flFadeStartTime', 0);
    this.fadeEndTime = parse.float('m_flFadeEndTime', 1);
    this.fieldOutput = parse.particleField('m_nFieldOutput', ParticleField.Color);
    this.easeInOut = parse.boolean('m_bEaseInOut', true);
    parse.addInitialRead(this.fieldOutput);
  }

  get storedFields(): bigint {
    return fieldMask(this.fieldOutput);
  }

  operate(particles: ParticleCollection, _frameTime: number, _state: ParticleSystemState, strength: number): void {
    if (this.fadeEndTime === this.fadeStartTime) {
      return;
    }
    if (!isVectorField(this.fieldOutput)) {
      return;
    }
    const current = particles.currentSpan;
    const lifetimes = current.readFloats(ParticleField.LifeDuration);
    const colors = current.vectors(this.fieldOutput);
    const initialColors = particles.initialSpan.readVectors(this.fieldOutput);
    const fractions = current.readAges();
    for (let i = 0; i < fractions.length; i++) {
      fractions[i] = fractions[i] / lifetimes[i];
      fractions[i] = fractions[i] - this.fadeStartTime;
      fractions[i] = fractions[i] / f32(this.fadeEndTime - this.fadeStartTime);
      fractions[i] = saturate(fractions[i]);
      if (this.easeInOut) {
        let easing = f32(fractions[i] * -2);
        easing = f32(easing + 3);
        easing = f32(easing * fractions[i]);
        fractions[i] = easing * fractions[i];
      }
    }
    for (let i = 0; i < current.length; i++) {
      const initialColor = readVector(initialColors, i);
      let color = readVector(colors, i);
      if (lifetimes[i] > 0) {
        color = lerpV(initialColor, this.colorFade, fractions[i]);
      }
      writeVector(colors, i, ParticleFunctionOperator.blendByStrengthV(initialColor, color, strength));
    }
  }

  static fadeFraction(normalizedAge: number, start: number, end: number, easeInOut: boolean): number {
    return easeInOut ? smoothstep(start, end, normalizedAge) : saturate(remap(normalizedAge, start, end));
  }
}
