import type { SkinPartFinish } from '../types/skinEditor';

export const FINISHES = [
  { name: 'matte', roughness: 0.9, metalness: 0 },
  { name: 'satin', roughness: 0.45, metalness: 0 },
  { name: 'glossy', roughness: 0.12, metalness: 0 },
  { name: 'metal', roughness: 0.18, metalness: 1 },
  { name: 'polished', roughness: 0.04, metalness: 1 },
] as const;

/** The shine presets offered as paint, each drawn as a small lit ball. */
export const PAINT_FINISHES = FINISHES.filter((finish) => ['glossy', 'metal', 'polished'].includes(finish.name));

/** A ball that reads as the finish without words. Token colors only, so it follows the theme. */
export function finishBall(finish: SkinPartFinish): string {
  // Glossy: a dark ball with one crisp highlight. Metal: smooth silver. Chrome: hard mirror bands.
  if (finish.metalness < 0.5) return 'radial-gradient(circle at 32% 28%, var(--color-text-primary) 0 10%, var(--color-text-tertiary) 14%, var(--color-bg-tertiary) 30% 60%, var(--color-bg-primary))';
  return finish.roughness < 0.1
    ? 'linear-gradient(160deg, var(--color-text-primary) 0 22%, var(--color-bg-primary) 42%, var(--color-text-primary) 58%, var(--color-text-tertiary))'
    : 'radial-gradient(circle at 32% 28%, var(--color-text-primary), var(--color-text-secondary) 35%, var(--color-bg-tertiary) 78%, var(--color-text-tertiary))';
}

/** Default self-illumination scale of painted glow: bright enough to bloom in game without washing out. */
export const GLOW_STRENGTH = 4;

/** See-through presets offered as paint: how solid the area stays. */
export const CLEAR_PRESETS = [
  { name: 'hazy', opacity: 0.7 },
  { name: 'half', opacity: 0.45 },
  { name: 'faint', opacity: 0.2 },
] as const;

/** A checkerboard seen through a veil of `opacity`, so the swatch reads as see-through without words. */
export const CHECKER = 'repeating-conic-gradient(var(--color-text-tertiary) 0 25%, var(--color-bg-primary) 0 50%) 0 0 / 8px 8px';

export const sameFinish = (a: SkinPartFinish | null | undefined, b: SkinPartFinish | null | undefined) =>
  !!a && !!b && a.roughness === b.roughness && a.metalness === b.metalness;
