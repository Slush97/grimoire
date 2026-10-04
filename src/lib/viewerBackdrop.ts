export const VIEWER_BACKDROP_LIMITS = { bytes: 12 * 1024 * 1024, pixels: 16 * 1024 * 1024, dimension: 8192 };
export const VIEWER_BACKDROP_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;

export class ViewerBackdropError extends Error {
  readonly key: 'locker.pose.backgroundFailed' | 'locker.pose.backgroundTooLarge';
  constructor(key: 'locker.pose.backgroundFailed' | 'locker.pose.backgroundTooLarge') { super(key); this.key = key; }
}

/** Read dimensions before handing a local image to a decoder or allocating a GPU texture. */
export function backdropDimensions(bytes: Uint8Array, type: string): { width: number; height: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const fail = () => { throw new ViewerBackdropError('locker.pose.backgroundFailed'); };
  const ascii = (offset: number, text: string) => [...text].every((c, i) => bytes[offset + i] === c.charCodeAt(0));
  let width = 0, height = 0;
  if (type === 'image/png' && bytes.length >= 24
    && [137, 80, 78, 71, 13, 10, 26, 10].every((b, i) => bytes[i] === b)
    && view.getUint32(8) === 13 && ascii(12, 'IHDR')) {
    width = view.getUint32(16); height = view.getUint32(20);
  } else if (type === 'image/jpeg' && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let at = 2;
    while (at < bytes.length) {
      if (bytes[at++] !== 0xff) fail();
      while (bytes[at] === 0xff) at++;
      const marker = bytes[at++];
      if (marker === 0xda || marker === 0xd9) break;
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      if (at + 2 > bytes.length) fail();
      const length = view.getUint16(at);
      if (length < 2 || at + length > bytes.length) fail();
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
        if (length < 8) fail();
        height = view.getUint16(at + 3); width = view.getUint16(at + 5); break;
      }
      at += length;
    }
  } else if (type === 'image/webp' && bytes.length >= 30 && ascii(0, 'RIFF') && ascii(8, 'WEBP')) {
    const uint24 = (at: number) => bytes[at] + bytes[at + 1] * 256 + bytes[at + 2] * 65536;
    if (ascii(12, 'VP8X') && view.getUint32(16, true) >= 10) {
      // Animated images require a separate playback/budget contract.
      if ((bytes[20] & 2) !== 0) fail();
      width = uint24(24) + 1; height = uint24(27) + 1;
    } else if (ascii(12, 'VP8 ') && ascii(23, '\u009d\u0001\u002a')) {
      width = view.getUint16(26, true) & 0x3fff; height = view.getUint16(28, true) & 0x3fff;
    } else if (ascii(12, 'VP8L') && bytes[20] === 0x2f) {
      const dimensions = view.getUint32(21, true);
      width = (dimensions & 0x3fff) + 1; height = ((dimensions >>> 14) & 0x3fff) + 1;
    }
  }
  if (!width || !height) fail();
  if (width > VIEWER_BACKDROP_LIMITS.dimension || height > VIEWER_BACKDROP_LIMITS.dimension
    || width * height > VIEWER_BACKDROP_LIMITS.pixels) throw new ViewerBackdropError('locker.pose.backgroundTooLarge');
  return { width, height };
}

/** Centered UV crop. Sampling a smaller portion fills the viewport without stretching. */
export function backdropCover(imageAspect: number, viewportAspect: number) {
  if (!(imageAspect > 0) || !(viewportAspect > 0) || !Number.isFinite(imageAspect) || !Number.isFinite(viewportAspect)) {
    return { x: 1, y: 1, offsetX: 0, offsetY: 0 };
  }
  const x = Math.min(1, viewportAspect / imageAspect);
  const y = Math.min(1, imageAspect / viewportAspect);
  return { x, y, offsetX: (1 - x) / 2, offsetY: (1 - y) / 2 };
}
