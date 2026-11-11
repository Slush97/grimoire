import type * as THREE from 'three';
import { compileScalarExpr } from './dynamicScalar';
import type { MorphicExtras } from './source2NprMaterial';

/**
 * pbr.vfx's alt texture: `g_tAltColor_Reveal` holds a second albedo in RGB and a
 * reveal mask in alpha, and `g_flAltTextureAmount` wipes it over `g_tColor`.
 * Violet's brush is inked this way while she has ammo, Solomon's pieces turn black
 * and Nurse Harrow takes her ult look through the same slot.
 *
 * The equation is the shipped pixel shader's (pbr.vfx, VCS 72, decompiled with
 * VRF; written up in vpkmerge docs/source2-preview-data-contract.md).
 */

/**
 * What the engine reports for a hero standing in the preview: a full magazine, no
 * reload under way. An attribute missing here leaves its expression unevaluated,
 * so the material keeps its authored static amount.
 */
export const SOURCE2_REST_ATTRIBUTES: Readonly<Record<string, number>> = {
  $AmmoPercent: 1,
  $ReloadProgress: 0,
};

export interface Source2AltReveal {
  /** RGB is the alt albedo (sRGB), alpha the reveal mask (linear). */
  texture: THREE.Texture;
  /** 0 keeps the color texture, 1 replaces it everywhere. */
  amount: number;
  softness: number;
}

function float(morphic: MorphicExtras, name: string, fallback: number): number {
  const raw = morphic.floats?.[name];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** `g_flAltTextureAmount` at rest: its expression where one evaluates, else the static value. */
export function source2AltRevealAmount(morphic: MorphicExtras): number {
  const dynamic = morphic.dynamic_params?.g_flAltTextureAmount;
  const authored = float(morphic, 'g_flAltTextureAmount', 0);
  const expression = dynamic?.decompiled ? compileScalarExpr(dynamic.source, SOURCE2_REST_ATTRIBUTES) : null;
  return Math.max(0, Math.min(1, expression ? expression(0) : authored));
}

/** The reveal a material shows at rest, or null when its color texture is all that renders. */
export function source2AltReveal(morphic: MorphicExtras): Source2AltReveal | null {
  const texture = morphic.resolvedTextures?.g_tAltColor_Reveal;
  if (!texture || morphic.shader.toLowerCase() !== 'pbr.vfx') return null;
  const amount = source2AltRevealAmount(morphic);
  if (amount <= 0) return null;
  // The shader's default softness; its authoring range is 0 to 0.5.
  return { texture, amount, softness: Math.max(0, Math.min(0.5, float(morphic, 'g_flAltTextureRevealSoftness', 0.05))) };
}

/** How much of the alt albedo one texel shows, for a reveal mask value in 0..1. */
export function source2AltRevealFactor(amount: number, softness: number, mask: number): number {
  if (amount <= 0) return 0;
  if (amount >= 1) return 1;
  const threshold = Math.max(1e-4, Math.min(0.9999, mask)) * (1 - 2 * softness) + softness;
  const distance = amount - threshold;
  if (softness <= 0) return distance > 0 ? 1 : 0;
  const t = Math.max(0, Math.min(1, (distance + softness) / (2 * softness)));
  return t * t * (3 - 2 * t);
}

/** Declarations for the fragment shader. Compiled in with NPR_ALT_REVEAL. */
export const SOURCE2_ALT_REVEAL_PARS_GLSL = /* glsl */ `
#ifdef NPR_ALT_REVEAL
uniform sampler2D uAltRevealMap;
uniform vec2 uAltReveal; // amount, softness
float source2AltRevealFactor(float mask) {
  if (uAltReveal.x >= 1.0) return 1.0;
  float threshold = clamp(mask, 0.0001, 0.9999) * (1.0 - 2.0 * uAltReveal.y) + uAltReveal.y;
  float distance = uAltReveal.x - threshold;
  if (uAltReveal.y <= 0.0) return distance > 0.0 ? 1.0 : 0.0;
  return smoothstep(-uAltReveal.y, uAltReveal.y, distance);
}
#endif
`;
