// Ported from ValveResourceFormat (MIT): ValveResourceFormat/Particles/Operators/FadeAndKill.cs.

import type { ParticleCollection } from '../collection';
import { ParticleField } from '../enums';
import { fieldMask } from '../fields';
import { ParticleFunctionOperator } from '../functions';
import { f32, smoothstep } from '../numerics';
import type { ParticleDefinitionParser } from '../parser';
import type { ParticleSystemState } from '../state';
import { normalizedAge } from '../utils/particleMath';

/**
 * C_OP_FadeAndKill ("Alpha Fade and Decay"): fades alpha in over one window of the particle's life and
 * out over another, and kills the particle once it outlives its lifetime.
 */
export class FadeAndKill extends ParticleFunctionOperator {
  private readonly startFadeInTime: number;
  private readonly endFadeInTime: number;
  private readonly startFadeOutTime: number;
  private readonly endFadeOutTime: number;
  private readonly startAlpha: number;
  private readonly endAlpha: number;
  private readonly forcePreserveParticleOrder: boolean;

  constructor(parse: ParticleDefinitionParser) {
    super(parse);
    let startIn = parse.float('m_flStartFadeInTime', 0);
    let endIn = parse.float('m_flEndFadeInTime', 0.5);
    let startOut = parse.float('m_flStartFadeOutTime', 0.5);
    let endOut = parse.float('m_flEndFadeOutTime', 1);

    endIn = Math.max(endIn, startIn);
    endOut = Math.max(endOut, startOut);

    if (startIn > startOut) {
      [startIn, startOut] = [startOut, startIn];
    }

    if (endIn > endOut) {
      [endIn, endOut] = [endOut, endIn];
    }

    this.startFadeInTime = startIn;
    this.endFadeInTime = endIn;
    this.startFadeOutTime = startOut;
    this.endFadeOutTime = endOut;
    this.startAlpha = parse.float('m_flStartAlpha', 1);
    this.endAlpha = parse.float('m_flEndAlpha', 0);
    this.forcePreserveParticleOrder = parse.boolean('m_bForcePreserveParticleOrder', false);

    parse.addInitialRead(ParticleField.Alpha);
  }

  get isOrderImportant(): boolean {
    return this.forcePreserveParticleOrder;
  }

  get storedFields(): bigint {
    return fieldMask(ParticleField.Alpha);
  }

  operate(particles: ParticleCollection, _frameTime: number, _state: ParticleSystemState, strength: number): void {
    const current = particles.currentSpan;
    const ages = current.readAges();

    const lifetimes = current.readFloats(ParticleField.LifeDuration);
    const alphas = current.floats(ParticleField.Alpha);
    const initialAlphas = particles.initialSpan.readFloats(ParticleField.Alpha);

    for (let i = 0; i < alphas.length; i++) {
      // The particle ends when it outlives its lifetime, which is not the same instant as the end of
      // the fade-out: a fade-out that finishes early leaves it alive and faded
      if (lifetimes[i] < ages[i]) {
        particles.kill(i);
        continue;
      }

      const time = normalizedAge(ages[i], lifetimes[i]);
      const alpha = this.fadedAlpha(time, initialAlphas[i], alphas[i]);

      alphas[i] = FadeAndKill.blendByStrength(alphas[i], alpha, strength);
    }
  }

  /** The alpha at `time` through the particle's life, inside the fade-out window or else the fade-in window, and `alpha` outside both. */
  protected fadedAlpha(time: number, initialAlpha: number, alpha: number): number {
    if (time >= this.startFadeOutTime && time < this.endFadeOutTime) {
      const fadeOut = smoothstep(this.startFadeOutTime, this.endFadeOutTime, time);
      return f32(initialAlpha * f32(f32(fadeOut * f32(this.endAlpha - 1)) + 1));
    }

    if (time >= this.startFadeInTime && time < this.endFadeInTime) {
      const fadeIn = smoothstep(this.startFadeInTime, this.endFadeInTime, time);
      return f32(initialAlpha * f32(f32(fadeIn * f32(1 - this.startAlpha)) + this.startAlpha));
    }

    return alpha;
  }
}
