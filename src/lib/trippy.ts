import type { TrippyAnimationStyle, TrippyStyleName } from '../types/mod';

/** i18n keys for the display names of the procedural trippy pattern styles. */
export const TRIPPY_STYLE_LABEL_KEYS: Record<TrippyStyleName, string> = {
  confetti: 'locker.trippy.styles.confetti',
  liquid: 'locker.trippy.styles.liquid',
  moire: 'locker.trippy.styles.moire',
  kaleido: 'locker.trippy.styles.kaleido',
  holo: 'locker.trippy.styles.holo',
  glitch: 'locker.trippy.styles.glitch',
  thermal: 'locker.trippy.styles.thermal',
  gradient: 'locker.trippy.styles.gradient',
  camo: 'locker.trippy.styles.camo',
  carbon: 'locker.trippy.styles.carbon',
  galaxy: 'locker.trippy.styles.galaxy',
  halftone: 'locker.trippy.styles.halftone',
  lava: 'locker.trippy.styles.lava',
  vaporwave: 'locker.trippy.styles.vaporwave',
  moo: 'locker.trippy.styles.moo',
};

/** i18n keys for the display names of the trippy VFX particle animation styles. */
export const TRIPPY_ANIMATION_LABEL_KEYS: Record<TrippyAnimationStyle, string> = {
  off: 'locker.trippy.animations.off',
  sweep: 'locker.trippy.animations.sweep',
  loop: 'locker.trippy.animations.loop',
  cycle: 'locker.trippy.animations.cycle',
};
