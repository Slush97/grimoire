// GameBanana pre-sizes every screenshot to these widths (file220, file530).
// It skips the 530 variant only when the upload is already narrower than
// 530px, so the original then stands in at that tier and is never the
// multi-megabyte case.
const SMALL_WIDTH = 220;
const MEDIUM_PREFIX = '530-90_';
const SMALL_PREFIX = '220-90_';

// Typical screenshot shape. object-cover fills the box's height too, so a box
// taller than this needs a wider source than its own width.
const SCREENSHOT_ASPECT = 16 / 9;

/** Device pixel ratio, including Chromium page zoom. Read at call time. */
export function currentPixelRatio(): number {
  const dpr = (globalThis as { devicePixelRatio?: number }).devicePixelRatio;
  return typeof dpr === 'number' && dpr > 0 ? dpr : 1;
}

/**
 * Swaps a GameBanana 530 thumbnail URL for its 220 sibling (always generated
 * next to it) when 220 covers a `cssWidth` x `cssHeight` cover box at `dpr`.
 * Anything else is returned untouched.
 */
export function sizeGameBananaThumbUrl(url: string, cssWidth: number, dpr = 1, cssHeight = 0): string {
  if (Math.max(cssWidth, cssHeight * SCREENSHOT_ASPECT) * dpr > SMALL_WIDTH) return url;
  const slash = url.lastIndexOf('/');
  if (slash === -1 || !url.startsWith('https://images.gamebanana.com/')) return url;
  const name = url.slice(slash + 1);
  return name.startsWith(MEDIUM_PREFIX) ? url.slice(0, slash + 1) + SMALL_PREFIX + name.slice(MEDIUM_PREFIX.length) : url;
}
