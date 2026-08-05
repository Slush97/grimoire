import { getAssetPath } from '../../lib/assetPath';

export type StageBackground = 'street' | 'sandbox' | 'plain';

/** Native height of the stage captures (both are 2560x1440 screenshots). The
 *  stage's scene/crosshair scale math is anchored to this: at zoom 1 one
 *  capture px is one CSS px, so the simulated screen is CAPTURE_HEIGHT tall. */
export const STAGE_CAPTURE_HEIGHT = 1440;

/**
 * Scenes the crosshair preview can sit on. The two screenshots let you judge
 * contrast against real in-game lighting instead of a flat editor gray;
 * `plain` (no image) keeps the neutral surface for reading exact shape.
 *
 * The images live in `public/crosshair/`. A missing file degrades to the plain
 * surface rather than a broken image (see CrosshairStage's onError).
 */
export const STAGE_BACKGROUNDS: { id: StageBackground; src: string | null }[] = [
  { id: 'street', src: getAssetPath('/crosshair/bg1.jpg') },
  { id: 'sandbox', src: getAssetPath('/crosshair/bg2.jpg') },
  { id: 'plain', src: null },
];
