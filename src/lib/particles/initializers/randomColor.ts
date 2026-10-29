// Ported from ValveResourceFormat (MIT): ValveResourceFormat/Particles/Initializers/RandomColor.cs and
// ValveResourceFormat/Particles/ParticleColorBlendModeExtensions.cs.

import { writeVector } from '../buffer';
import type { ParticleCollection } from '../collection';
import { ParticleColorBlendMode, ParticleField } from '../enums';
import { fieldMask, isVectorField } from '../fields';
import { ParticleFunctionInitializer } from '../functions';
import { Vector3, distanceSquared, f32, lerpV, maxV, minV } from '../numerics';
import type { ParticleDefinitionParser } from '../parser';
import type { ParticleSpan } from '../span';
import type { ParticleSystemState } from '../state';
import { lightTint } from '../utils/particleMath';

/** C_INIT_RandomColor: a random color between two colors, optionally tinted by the light at a control point. */
export class RandomColor extends ParticleFunctionInitializer {
  private readonly colorMin: Vector3;
  private readonly colorMax: Vector3;
  private readonly tintMin: Vector3;
  private readonly tintMax: Vector3;
  private readonly tintPercentage: number;
  private readonly tintControlPoint: number;
  private readonly updateThreshold: number;
  private readonly lightAmplification: number;
  private readonly tintBlendMode: number;
  private readonly fieldOutput: number;

  private sampledPosition = Vector3.zero;

  constructor(parse: ParticleDefinitionParser) {
    super(parse);
    this.colorMin = parse.color24('m_ColorMin', Vector3.one);
    this.colorMax = parse.color24('m_ColorMax', Vector3.one);
    this.tintMin = parse.color24('m_TintMin', Vector3.zero);
    this.tintMax = parse.color24('m_TintMax', Vector3.one);
    this.tintPercentage = parse.float('m_flTintPerc', 0);
    this.tintControlPoint = parse.int32('m_nTintCP', 0);
    this.updateThreshold = parse.float('m_flUpdateThreshold', 32);
    this.lightAmplification = parse.float('m_flLightAmplification', 1);
    this.tintBlendMode = parse.enum('m_nTintBlendMode', ParticleColorBlendMode, ParticleColorBlendMode.PARTICLEBLEND_DEFAULT);
    this.fieldOutput = parse.particleField('m_nFieldOutput', ParticleField.Color);
  }

  get writtenFields(): bigint {
    return fieldMask(this.fieldOutput);
  }

  protected initializeCall(run: ParticleSpan, _particles: ParticleCollection, state: ParticleSystemState): void {
    const colors = isVectorField(this.fieldOutput) ? run.vectors(this.fieldOutput) : null;
    const tint = this.tint(state);

    for (let i = 0; i < run.length; i++) {
      const color = state.random.nextBetweenV(this.colorMin, this.colorMax);
      this.writeColor(colors, i, color, tint);
    }
  }

  protected initializeBlocks(run: ParticleSpan, _particles: ParticleCollection, state: ParticleSystemState): void {
    const colors = isVectorField(this.fieldOutput) ? run.vectors(this.fieldOutput) : null;
    const tint = this.tint(state);

    // One draw per block of four from the thread generator, a value per particle
    for (const { offset, block } of run.blocks()) {
      const draws = state.threadRandom.next();

      for (let i = 0; i < block.length; i++) {
        const color = lerpV(this.colorMin, this.colorMax, draws[i]);
        this.writeColor(colors, offset + i, color, tint);
      }
    }
  }

  /** The tint of the light at the tint control point, or zero when nothing is tinted. */
  private tint(state: ParticleSystemState): Vector3 {
    if (this.tintPercentage <= 0) {
      return Vector3.zero;
    }

    return lightTint(this.sampleLight(state), this.tintMin, this.tintMax, this.lightAmplification);
  }

  private writeColor(colors: Float32Array | null, index: number, color: Vector3, tint: Vector3): void {
    if (this.tintPercentage > 0) {
      const tinted = blend(this.tintBlendMode, color, tint);
      color = minV(lerpV(color, tinted, this.tintPercentage), Vector3.one);
    }

    if (colors !== null) {
      writeVector(colors, index, color);
    }
  }

  reset(): void {
    this.sampledPosition = Vector3.zero;
  }

  /** The light at the tint control point; a parent's sample at the same control point is reused. */
  private sampleLight(state: ParticleSystemState): Vector3 {
    const parent = state.parentSystem;

    if (parent !== null && parent.tintCacheControlPoint === this.tintControlPoint) {
      return parent.tintCacheColor;
    }

    const position = state.getControlPoint(this.tintControlPoint).position;

    if (
      state.tintCacheControlPoint !== this.tintControlPoint ||
      distanceSquared(position, this.sampledPosition) >= f32(this.updateThreshold * this.updateThreshold)
    ) {
      state.tintCacheColor = state.lighting.sampleAmbientLight(position);
      state.tintCacheControlPoint = this.tintControlPoint;
      this.sampledPosition = position;
    }

    return state.tintCacheColor;
  }
}

/** Combines a colour with a tint the way a ParticleColorBlendMode_t field asks. DEFAULT replaces. */
function blend(mode: number, color: Vector3, tint: Vector3): Vector3 {
  switch (mode) {
    case ParticleColorBlendMode.PARTICLEBLEND_OVERLAY:
      return new Vector3(overlay(color.x, tint.x), overlay(color.y, tint.y), overlay(color.z, tint.z));
    case ParticleColorBlendMode.PARTICLEBLEND_DARKEN:
      return minV(color, tint);
    case ParticleColorBlendMode.PARTICLEBLEND_LIGHTEN:
      return maxV(color, tint);
    case ParticleColorBlendMode.PARTICLEBLEND_MULTIPLY:
      return color.mul(tint);
    default:
      return tint;
  }
}

function overlay(color: number, tint: number): number {
  return tint < 0.5 ? f32(f32(2 * color) * tint) : f32(1 - f32(f32(2 * f32(1 - color)) * f32(1 - tint)));
}
