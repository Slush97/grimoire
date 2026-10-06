import { describe, expect, it } from 'vitest';
import { encodeCursorBmp } from './cursorBmp';

describe('encodeCursorBmp', () => {
  it('writes a 32-bit bottom-up BGRA bitmap', () => {
    // 2x2: top row red, green; bottom row blue, half-transparent white.
    const rgba = new Uint8Array([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 128]);
    const bmp = encodeCursorBmp(2, 2, rgba);
    const view = new DataView(bmp.buffer);

    expect(String.fromCharCode(bmp[0], bmp[1])).toBe('BM');
    expect(view.getUint32(2, true)).toBe(54 + 16);
    expect(view.getUint32(10, true)).toBe(54);
    expect(view.getInt32(18, true)).toBe(2);
    expect(view.getInt32(22, true)).toBe(2);
    expect(view.getUint16(28, true)).toBe(32);
    expect(view.getUint32(30, true)).toBe(0);
    expect([...bmp.subarray(54)]).toEqual([
      255, 0, 0, 255, 255, 255, 255, 128,
      0, 0, 255, 255, 0, 255, 0, 255,
    ]);
  });
});
