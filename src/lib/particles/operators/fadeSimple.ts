// Ported from ValveResourceFormat (MIT): ValveResourceFormat/Particles/Operators/FadeInSimple.cs and
// ValveResourceFormat/Particles/Operators/FadeOutSimple.cs.

import type { ParticleCollection } from '../collection';
import { ParticleField } from '../enums';
import { fieldMask, isScalarField } from '../fields';
import { ParticleFunctionOperator } from '../functions';
import { f32, smoothstep } from '../numerics';
import type { ParticleDefinitionParser } from '../parser';
import type { ParticleSystemState } from '../state';

/**
 * C_OP_FadeInSimple: fades a field in along a smoothstep over a fraction of the particle's lifetime
 * at the start of its life.
 */
export class FadeInSimple extends ParticleFunctionOperator {
  private readonly fadeInTime: number;
  private readonly fieldOutput: number;

  constructor(parse: ParticleDefinitionParser) {
    super(parse);
    this.fadeInTime = parse.float('m_flFadeInTime', 0.25);
    this.fieldOutput = parse.particleField('m_nFieldOutput', ParticleField.Alpha);

    parse.addInitialRead(this.fieldOutput);
  }

  get storedFields(): bigint {
    return fieldMask(this.fieldOutput);
  }

  operate(particles: ParticleCollection, frameTime: number, _state: ParticleSystemState): void {
    if (!isScalarField(this.fieldOutput)) {
      return;
    }

    const current = particles.currentSpan;
    const ages = current.readAges();
    const lifetimes = current.readFloats(ParticleField.LifeDuration);
    const outputs = current.floats(this.fieldOutput);
    const initials = particles.initialSpan.readFloats(this.fieldOutput);

    for (let i = 0; i < outputs.length; i++) {
      const age = ages[i];
      const fadeInLength = f32(this.fadeInTime * lifetimes[i]);
      const fading = Math.max(0, f32(age - frameTime)) < fadeInLength;

      if (!fading) {
        continue;
      }

      // A fading particle has a positive fade length, so the smoothstep's edges cannot meet here
      outputs[i] = f32(smoothstep(0, fadeInLength, age) * initials[i]);
    }
  }
}

/**
 * C_OP_FadeOutSimple: fades a field out along a smoothstep over a fraction of the particle's lifetime
 * at the end of its life, never raising a value another operator already brought down.
 */
export class FadeOutSimple extends ParticleFunctionOperator {
  private readonly fadeOutTime: number;
  private readonly fieldOutput: number;

  constructor(parse: ParticleDefinitionParser) {
    super(parse);
    this.fadeOutTime = parse.float('m_flFadeOutTime', 0.25);
    this.fieldOutput = parse.particleField('m_nFieldOutput', ParticleField.Alpha);

    parse.addInitialRead(this.fieldOutput);
  }

  get storedFields(): bigint {
    return fieldMask(this.fieldOutput);
  }

  operate(particles: ParticleCollection): void {
    const fadeStart = f32(1 - this.fadeOutTime);

    if (!isScalarField(this.fieldOutput)) {
      return;
    }

    const current = particles.currentSpan;
    const ages = current.readAges();
    const lifetimes = current.readFloats(ParticleField.LifeDuration);
    const outputs = current.floats(this.fieldOutput);
    const initials = particles.initialSpan.readFloats(this.fieldOutput);

    for (let i = 0; i < outputs.length; i++) {
      const time = f32(ages[i] / lifetimes[i]);
      const fading = fadeStart < time;

      if (!fading) {
        continue;
      }

      const faded = f32(f32(1 - smoothstep(fadeStart, 1, time)) * initials[i]);
      outputs[i] = Math.min(faded, outputs[i]);
    }
  }
}
