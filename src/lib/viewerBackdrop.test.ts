import { describe, expect, it } from 'vitest';
import { backdropCover, backdropDimensions, VIEWER_BACKDROP_LIMITS, ViewerBackdropError } from './viewerBackdrop';

function png(width: number, height: number) {
  const b = new Uint8Array(24); const v = new DataView(b.buffer);
  b.set([137, 80, 78, 71, 13, 10, 26, 10]); v.setUint32(8, 13);
  b.set([73, 72, 68, 82], 12); v.setUint32(16, width); v.setUint32(20, height); return b;
}
function webp(kind: string) {
  const b = new Uint8Array(30); const v = new DataView(b.buffer);
  b.set([...`RIFF`].map((c) => c.charCodeAt(0)));
  v.setUint32(4, 22, true); b.set([...`WEBP${kind}`].map((c) => c.charCodeAt(0)), 8);
  v.setUint32(16, 10, true); return b;
}

describe('local viewer background image bounds', () => {
  it('reads PNG dimensions before decoding', () => {
    expect(backdropDimensions(png(1600, 900), 'image/png')).toEqual({ width: 1600, height: 900 });
  });
  it('reads progressive JPEG after metadata and fill bytes', () => {
    const b = new Uint8Array([0xff, 0xd8, 0xff, 0xff, 0xe1, 0, 4, 0, 0, 0xff, 0xc2, 0, 8, 8, 3, 132, 6, 64, 0]);
    expect(backdropDimensions(b, 'image/jpeg')).toEqual({ width: 1600, height: 900 });
  });
  it('reads extended WebP and rejects animation', () => {
    const b = webp('VP8X'); b.set([63, 6, 0], 24); b.set([131, 3, 0], 27);
    expect(backdropDimensions(b, 'image/webp')).toEqual({ width: 1600, height: 900 });
    b[20] = 2;
    expect(() => backdropDimensions(b, 'image/webp')).toThrow(ViewerBackdropError);
  });
  it('reads lossy and lossless WebP', () => {
    const lossy = webp('VP8 '); lossy.set([0x9d, 1, 0x2a], 23);
    const v = new DataView(lossy.buffer); v.setUint16(26, 1600, true); v.setUint16(28, 900, true);
    expect(backdropDimensions(lossy, 'image/webp')).toEqual({ width: 1600, height: 900 });
    const lossless = webp('VP8L'); lossless[20] = 0x2f;
    new DataView(lossless.buffer).setUint32(21, 1599 | (899 << 14), true);
    expect(backdropDimensions(lossless, 'image/webp')).toEqual({ width: 1600, height: 900 });
  });
  it('handles byte views without reading outside their slice', () => {
    const padded = new Uint8Array(40); padded.set(png(600, 800), 7);
    expect(backdropDimensions(padded.subarray(7, 31), 'image/png')).toEqual({ width: 600, height: 800 });
  });
  it.each([new Uint8Array(), png(0, 1), png(1, 0), new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0xff, 0xff])])(
    'rejects empty, zero-sized and truncated image headers', (b) => {
      expect(() => backdropDimensions(b, b[0] === 0xff ? 'image/jpeg' : 'image/png')).toThrow('locker.pose.backgroundFailed');
    },
  );
  it('rejects excessive dimensions and pixel count independently', () => {
    expect(() => backdropDimensions(png(VIEWER_BACKDROP_LIMITS.dimension + 1, 1), 'image/png')).toThrow('locker.pose.backgroundTooLarge');
    expect(() => backdropDimensions(png(5000, 5000), 'image/png')).toThrow('locker.pose.backgroundTooLarge');
    expect(backdropDimensions(png(4096, 4096), 'image/png')).toEqual({ width: 4096, height: 4096 });
  });
  it('rejects unsupported media types and mismatched signatures', () => {
    expect(() => backdropDimensions(png(20, 20), 'image/svg+xml')).toThrow('locker.pose.backgroundFailed');
    expect(() => backdropDimensions(png(20, 20), 'image/jpeg')).toThrow('locker.pose.backgroundFailed');
  });
});

describe('background cover crop', () => {
  it('centers a landscape image in a portrait viewport', () => {
    expect(backdropCover(2, 1)).toEqual({ x: 0.5, y: 1, offsetX: 0.25, offsetY: 0 });
  });
  it('centers a portrait image in a landscape viewport', () => {
    expect(backdropCover(1, 2)).toEqual({ x: 1, y: 0.5, offsetX: 0, offsetY: 0.25 });
  });
  it.each([0, -1, NaN, Infinity])('avoids invalid UV matrices for aspect %s', (ratio) => {
    expect(backdropCover(ratio, 1)).toEqual({ x: 1, y: 1, offsetX: 0, offsetY: 0 });
    expect(backdropCover(1, ratio)).toEqual({ x: 1, y: 1, offsetX: 0, offsetY: 0 });
  });
});
