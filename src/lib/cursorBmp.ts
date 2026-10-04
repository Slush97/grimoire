const HEADER_BYTES = 54;

/**
 * Encode RGBA pixels the way Deadlock's stock cursors are stored: a 40-byte
 * BITMAPINFOHEADER, 32 bits, BI_RGB, bottom-up BGRA rows. SDL reads the fourth
 * byte as alpha, so transparency survives.
 */
export function encodeCursorBmp(width: number, height: number, rgba: Uint8ClampedArray | Uint8Array): Uint8Array {
  const pixelBytes = width * height * 4;
  const out = new Uint8Array(HEADER_BYTES + pixelBytes);
  const view = new DataView(out.buffer);
  out[0] = 0x42;
  out[1] = 0x4d;
  view.setUint32(2, out.length, true);
  view.setUint32(10, HEADER_BYTES, true);
  view.setUint32(14, 40, true);
  view.setInt32(18, width, true);
  view.setInt32(22, height, true);
  view.setUint16(26, 1, true);
  view.setUint16(28, 32, true);
  view.setUint32(34, pixelBytes, true);
  view.setInt32(38, 2835, true);
  view.setInt32(42, 2835, true);

  for (let y = 0; y < height; y++) {
    const row = HEADER_BYTES + (height - 1 - y) * width * 4;
    for (let x = 0; x < width; x++) {
      const src = (y * width + x) * 4;
      const dst = row + x * 4;
      out[dst] = rgba[src + 2];
      out[dst + 1] = rgba[src + 1];
      out[dst + 2] = rgba[src];
      out[dst + 3] = rgba[src + 3];
    }
  }
  return out;
}
