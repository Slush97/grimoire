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
  if (finish.metalness < 0.5) return 'radial-gradient(circle at 32% 28%, var(--color-text-primary) 0 12%, var(--color-text-tertiary) 24%, var(--color-bg-tertiary) 65%)';
  return finish.roughness < 0.1
    ? 'linear-gradient(160deg, var(--color-text-primary) 0 22%, var(--color-bg-primary) 42%, var(--color-text-primary) 58%, var(--color-text-tertiary))'
    : 'radial-gradient(circle at 32% 28%, var(--color-text-primary), var(--color-text-secondary) 35%, var(--color-bg-tertiary) 78%, var(--color-text-tertiary))';
}

export const sameFinish = (a: SkinPartFinish | null | undefined, b: SkinPartFinish | null | undefined) =>
  !!a && !!b && a.roughness === b.roughness && a.metalness === b.metalness;
