// Ported from ValveResourceFormat (MIT): ValveResourceFormat/Particles/Operators/InterpolateRadius.cs.

import type { ParticleCollection } from '../collection';
import { ParticleField } from '../enums';
import { fieldMask } from '../fields';
import { ParticleFunctionOperator } from '../functions';
import { clamp, f32, lerp } from '../numerics';
import { LiteralNumberProvider, type NumberProvider } from '../numberProviders';
import type { ParticleDefinitionParser } from '../parser';
import type { ParticleSystemState } from '../state';
import { bias as biasCurve, normalizedAge } from '../utils/particleMath';

/**
 * C_OP_InterpolateRadius ("Radius Scale"): scales the radius from a start to an end scale over a
 * window of the particle's normalized lifetime, with an optional bias.
 */
export class InterpolateRadius extends ParticleFunctionOperator {
  private readonly startTime: number;
  private readonly endTime: number;
  private readonly startScale: NumberProvider;
  private readonly endScale: NumberProvider;
  private readonly easeInAndOut: boolean;

  /** The bias curve's parameter. 0.5 is the identity, and an authored 0 means 0.5. */
  private readonly bias: number;

  constructor(parse: ParticleDefinitionParser) {
    super(parse);
    this.startTime = parse.float('m_flStartTime', 0);
    this.endTime = parse.float('m_flEndTime', 1);
    this.startScale = parse.numberProvider('m_flStartScale', new LiteralNumberProvider(1));
    this.endScale = parse.numberProvider('m_flEndScale', new LiteralNumberProvider(1));
    this.easeInAndOut = parse.boolean('m_bEaseInAndOut', false);

    const authoredBias = parse.float('m_flBias', 0.5);
    this.bias = authoredBias === 0 ? 0.5 : authoredBias;

    parse.addInitialRead(ParticleField.Radius);
  }

  get storedFields(): bigint {
    return fieldMask(ParticleField.Radius);
  }

  operate(particles: ParticleCollection, frameTime: number, state: ParticleSystemState): void {
    if (this.endTime <= this.startTime) {
      return;
    }

    const current = particles.currentSpan;
    const radii = current.floats(ParticleField.Radius);
    const initialRadii = particles.initialSpan.readFloats(ParticleField.Radius);
    const lifetimes = current.readFloats(ParticleField.LifeDuration);
    const ages = current.readAges();

    const startScales = this.startScale.fillNew(current, state);
    const endScales = this.endScale.fillNew(current, state);
    const window = f32(this.endTime - this.startTime);

    for (let i = 0; i < radii.length; i++) {
      const lifetime = lifetimes[i];
      const time = normalizedAge(ages[i], lifetime);
      const frameFraction = f32(frameTime / lifetime);

      // A window shorter than a frame would otherwise fall between two updates, so its far end carries a frame of slack
      const shortWindow = f32(lifetime * window) <= frameTime;
      const windowEnd = shortWindow ? f32(this.startTime + frameFraction) : this.endTime;

      const scaling = lifetime > 0 && time >= this.startTime && time <= f32(frameFraction + windowEnd);

      if (!scaling) {
        continue;
      }

      let timeScale = f32(f32(time - this.startTime) / window);

      if (this.easeInAndOut) {
        // The smoothstep curve without clamping, which the slack past the window's end runs beyond
        timeScale = f32(f32(timeScale * timeScale) * f32(3 - f32(2 * timeScale)));
      } else if (this.bias !== 0.5) {
        timeScale = biasCurve(timeScale, this.bias);
      }

      const start = startScales[i];
      const end = endScales[i];
      let radiusScale = lerp(start, end, timeScale);

      // Clamped between the two scales in whichever order they come
      radiusScale = clamp(radiusScale, Math.min(start, end), Math.max(start, end));

      radii[i] = f32(initialRadii[i] * radiusScale);
    }
  }
}
