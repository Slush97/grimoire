import type { TrippyAnimationStyle, TrippyStyleName } from '../types/mod';

/** Display names for the procedural trippy pattern styles. */
export const TRIPPY_STYLE_LABELS: Record<TrippyStyleName, string> = {
  confetti: 'Confetti',
  liquid: 'Liquid',
  moire: 'Moire',
  kaleido: 'Kaleido',
  holo: 'Holo',
  glitch: 'Glitch',
  thermal: 'Thermal',
  gradient: 'Gradient',
  camo: 'Camo',
  carbon: 'Carbon Fiber',
  galaxy: 'Galaxy',
  halftone: 'Halftone',
  lava: 'Lava',
  vaporwave: 'Vaporwave',
};

/** Display names for the trippy VFX particle animation styles. */
export const TRIPPY_ANIMATION_LABELS: Record<TrippyAnimationStyle, string> = {
  off: 'Off',
  sweep: 'Sweep',
  loop: 'Loop',
  cycle: 'Cycle',
};
