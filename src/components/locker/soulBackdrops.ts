import * as THREE from 'three';

/**
 * Curated dark backdrops baked behind the model in the soul-container import
 * preview + saved thumbnail, so cards have depth instead of floating on
 * transparency. Each entry paints a 2D gradient that becomes a CanvasTexture
 * for `scene.background`. The modal picks one at random per import (and can
 * reroll); a negative index means no backdrop.
 *
 * Each backdrop is a multi-stop glow (core -> mid -> deep) finished with a
 * soft vignette, so the model reads as lit from a colored source against a
 * darkened frame rather than a flat fill.
 */
type BackdropDraw = (ctx: CanvasRenderingContext2D, w: number, h: number) => void;
type Stop = [offset: number, color: string];

/** Radial glow from (cx, cy). `spread` scales the gradient radius vs the diagonal. */
const radial = (cx: number, cy: number, stops: Stop[], spread = 0.78): BackdropDraw =>
  (ctx, w, h) => {
    const g = ctx.createRadialGradient(w * cx, h * cy, 0, w * cx, h * cy, Math.hypot(w, h) * spread);
    for (const [offset, color] of stops) g.addColorStop(offset, color);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  };

/** Top-to-bottom linear gradient. */
const linear = (stops: Stop[]): BackdropDraw => (ctx, w, h) => {
  const g = ctx.createLinearGradient(0, 0, 0, h);
  for (const [offset, color] of stops) g.addColorStop(offset, color);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
};

/** Darken the corners so the lit center pops; applied over every backdrop. */
const vignette = (ctx: CanvasRenderingContext2D, w: number, h: number, strength = 0.5): void => {
  const g = ctx.createRadialGradient(
    w / 2, h * 0.45, Math.min(w, h) * 0.18,
    w / 2, h * 0.5, Math.hypot(w, h) * 0.62
  );
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, `rgba(0,0,0,${strength})`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
};

const withVignette = (draw: BackdropDraw, strength?: number): BackdropDraw => (ctx, w, h) => {
  draw(ctx, w, h);
  vignette(ctx, w, h, strength);
};

const SOUL_BACKDROPS: BackdropDraw[] = [
  // Charcoal spotlight (neutral, lets any model color sit cleanly)
  withVignette(radial(0.5, 0.42, [[0, '#34343a'], [0.5, '#18181b'], [1, '#0a0a0b']])),
  // Warm ember rising from below
  withVignette(radial(0.5, 0.88, [[0, '#5e3717'], [0.4, '#2a160a'], [1, '#080605']], 0.85)),
  // Cool abyss blue
  withVignette(radial(0.5, 0.4, [[0, '#1f3a58'], [0.5, '#0d1a2a'], [1, '#05080d']])),
  // Violet soul
  withVignette(radial(0.5, 0.42, [[0, '#3d2160'], [0.5, '#1c0f30'], [1, '#080510']])),
  // Deep forest
  withVignette(radial(0.5, 0.46, [[0, '#17402e'], [0.5, '#0b1f17'], [1, '#050b08']])),
  // Crimson dusk
  withVignette(radial(0.5, 0.46, [[0, '#5e1a22'], [0.45, '#2a0d12'], [1, '#0c0608']])),
  // Teal nebula (off-center light)
  withVignette(radial(0.42, 0.38, [[0, '#0f5050'], [0.45, '#0a2626'], [1, '#04090a']])),
  // Amber halo (echoes the app accent)
  withVignette(radial(0.5, 0.5, [[0, '#7a4410'], [0.42, '#3a2208'], [1, '#0b0805']])),
  // Indigo-to-rose dawn (vertical)
  withVignette(linear([[0, '#241a3a'], [0.55, '#1a0f1e'], [1, '#08060a']]), 0.4),
  // Ice steel (cold neutral wash)
  withVignette(radial(0.5, 0.36, [[0, '#2c3a44'], [0.5, '#141a1f'], [1, '#070a0c']])),
];

export const SOUL_BACKDROP_COUNT = SOUL_BACKDROPS.length;

/** Build a CanvasTexture for the backdrop at `index`, or null if out of range. */
export function makeBackdropTexture(index: number): THREE.CanvasTexture | null {
  const draw = SOUL_BACKDROPS[index];
  if (!draw) return null;
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  draw(ctx, canvas.width, canvas.height);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}
