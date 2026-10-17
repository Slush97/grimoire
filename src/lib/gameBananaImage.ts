import type { GameBananaImage } from '../types/gamebanana';

// GameBanana pre-sizes every screenshot to these widths (file220, file530).
// It skips the 530 variant only when the upload is already narrower than
// 530px, so the original then stands in at that tier and is never the
// multi-megabyte case.
const SMALL_WIDTH = 220;
const MEDIUM_PREFIX = '530-90_';
const SMALL_PREFIX = '220-90_';

/** Device pixel ratio, including Chromium page zoom. Read at call time. */
export function currentPixelRatio(): number {
  const dpr = (globalThis as { devicePixelRatio?: number }).devicePixelRatio;
  return typeof dpr === 'number' && dpr > 0 ? dpr : 1;
}

function smallFrom530(file530?: string): string | undefined {
  return file530?.startsWith(MEDIUM_PREFIX) ? SMALL_PREFIX + file530.slice(MEDIUM_PREFIX.length) : undefined;
}

/**
 * The smallest variant that covers `cssWidth` at `dpr`: file220 when that is
 * enough, otherwise file530. Without a width, the 530 tier. A record that only
 * names file530 (the local catalog stores one URL) still gets its 220 sibling,
 * which GameBanana always generates next to it.
 */
export function pickGameBananaImageFile(image: GameBananaImage, cssWidth?: number, dpr = 1): string {
  const small = image.file220 || smallFrom530(image.file530);
  if (small && cssWidth !== undefined && cssWidth * dpr <= SMALL_WIDTH) return small;
  return image.file530 || image.file || small || '';
}

/**
 * Same choice for a stored thumbnail URL (Installed, Locker, profiles keep the
 * 530 URL). Only ever swaps a 530 URL for its 220 sibling; anything else is
 * returned untouched.
 */
export function sizeGameBananaThumbUrl(url: string, cssWidth: number, dpr = 1): string {
  if (cssWidth * dpr > SMALL_WIDTH) return url;
  const slash = url.lastIndexOf('/');
  if (slash === -1 || !url.startsWith('https://images.gamebanana.com/')) return url;
  const small = smallFrom530(url.slice(slash + 1));
  return small ? url.slice(0, slash + 1) + small : url;
}
