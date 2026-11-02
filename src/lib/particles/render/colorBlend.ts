// Ported from ValveResourceFormat (MIT): Renderer/Particles/Renderers/ParticleColorBlend.cs.
//
// Combines a particle's colour with a renderer's colour scale the way m_nColorBlendType asks.
// Colours are in byte units, 0 to 255, and the result is saturated to that range.

import { ParticleColorBlendType } from './enums';

const LUMINANCE_WEIGHTS = [0.2125, 0.7154, 0.0721] as const;

export type Rgb = [number, number, number];
export type Rgba = [number, number, number, number];

/**
 * Brings an authored colour scale into the units `applyColorBlend` combines it in: doubled for the
 * 2x modes, in bytes for the modes that add or replace, and inverted for screen.
 */
export function convertColorScale(type: number, scale: Rgb): Rgb {
  switch (type) {
    case ParticleColorBlendType.PARTICLE_COLOR_BLEND_MULTIPLY2X:
    case ParticleColorBlendType.PARTICLE_COLOR_BLEND_MOD2X:
      return [scale[0] * 2, scale[1] * 2, scale[2] * 2];
    case ParticleColorBlendType.PARTICLE_COLOR_BLEND_ADD:
    case ParticleColorBlendType.PARTICLE_COLOR_BLEND_SUBTRACT:
    case ParticleColorBlendType.PARTICLE_COLOR_BLEND_MAX:
    case ParticleColorBlendType.PARTICLE_COLOR_BLEND_MIN:
    case ParticleColorBlendType.PARTICLE_COLOR_BLEND_REPLACE:
    case ParticleColorBlendType.PARTICLE_COLOR_BLEND_AVERAGE:
      return [scale[0] * 255, scale[1] * 255, scale[2] * 255];
    case ParticleColorBlendType.PARTICLE_COLOR_BLEND_SCREEN:
      return [1 - scale[0], 1 - scale[1], 1 - scale[2]];
    default:
      return scale;
  }
}

/**
 * Combines a byte colour with a scale from `convertColorScale`, writing the result to `out`.
 * `scale[3]` is the alpha scale, which always multiplies.
 */
export function applyColorBlend(type: number, color: Rgba, scale: Rgba, out: Rgba): Rgba {
  for (let i = 0; i < 3; i++) {
    const c = color[i];
    const s = scale[i];
    let v: number;

    switch (type) {
      case ParticleColorBlendType.PARTICLE_COLOR_BLEND_DIVIDE: {
        const q = c / s;
        v = Number.isFinite(q) ? q : 0;
        break;
      }
      case ParticleColorBlendType.PARTICLE_COLOR_BLEND_ADD:
        v = c + s;
        break;
      case ParticleColorBlendType.PARTICLE_COLOR_BLEND_SUBTRACT:
        v = c - s;
        break;
      case ParticleColorBlendType.PARTICLE_COLOR_BLEND_SCREEN:
        v = 255 - (255 - c) * s;
        break;
      case ParticleColorBlendType.PARTICLE_COLOR_BLEND_MAX:
        v = Math.max(c, s);
        break;
      case ParticleColorBlendType.PARTICLE_COLOR_BLEND_MIN:
        v = Math.min(c, s);
        break;
      case ParticleColorBlendType.PARTICLE_COLOR_BLEND_REPLACE:
        v = s;
        break;
      case ParticleColorBlendType.PARTICLE_COLOR_BLEND_AVERAGE:
        v = (c + s) * 0.5;
        break;
      case ParticleColorBlendType.PARTICLE_COLOR_BLEND_NEGATE:
        v = 255 - c * s;
        break;
      case ParticleColorBlendType.PARTICLE_COLOR_BLEND_LUMINANCE:
        v = (scale[0] * LUMINANCE_WEIGHTS[0] + scale[1] * LUMINANCE_WEIGHTS[1] + scale[2] * LUMINANCE_WEIGHTS[2]) * c;
        break;
      default:
        v = c * s;
    }

    out[i] = clampByte(v);
  }

  out[3] = clampByte(color[3] * scale[3]);
  return out;
}

/** A colour in 0 to 1 as saturated bytes (ParticleColorBlend.ToBytes). */
export function toBytes(r: number, g: number, b: number, alpha: number, out: Rgba): Rgba {
  out[0] = saturate(r) * 255;
  out[1] = saturate(g) * 255;
  out[2] = saturate(b) * 255;
  out[3] = saturate(alpha) * 255;
  return out;
}

function saturate(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

function clampByte(x: number): number {
  // Vector4.Clamp lets NaN through as the lower bound
  return x > 255 ? 255 : x >= 0 ? x : 0;
}
