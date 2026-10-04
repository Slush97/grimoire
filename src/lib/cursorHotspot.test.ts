import { describe, expect, it } from 'vitest';
import { detectCursorHotspot } from './cursorHotspot';

function paint(width: number, height: number, inside: (x: number, y: number) => boolean) {
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (inside(x, y)) rgba[(y * width + x) * 4 + 3] = 255;
    }
  }
  return detectCursorHotspot(width, height, rgba);
}

const near = (actual: { x: number; y: number }, x: number, y: number, slack = 2) => {
  expect(Math.abs(actual.x - x), `x ${actual.x} vs ${x}`).toBeLessThanOrEqual(slack);
  expect(Math.abs(actual.y - y), `y ${actual.y} vs ${y}`).toBeLessThanOrEqual(slack);
};

describe('detectCursorHotspot', () => {
  it('finds the tip of an arrow wherever it sits in the frame', () => {
    // Stock-shaped arrow: tip, straight left side, diagonal right side.
    const arrow = (ox: number, oy: number) => (x: number, y: number) =>
      x >= ox && y >= oy && x - ox <= (y - oy) * 0.75 && y - oy <= 40 - (x - ox) * 0.4;
    near(paint(48, 58, arrow(0, 0)), 0, 0);
    near(paint(48, 58, arrow(9, 6)), 9, 6);
  });

  it('finds a fingertip pointing straight up', () => {
    const hand = (x: number, y: number) =>
      (x >= 26 && x <= 34 && y >= 4 && y <= 30) || (x >= 12 && x <= 46 && y >= 26 && y <= 58);
    near(paint(60, 60, hand), 30, 4, 4);
  });

  it('ignores a tail cut off by the image edge and a ping bubble', () => {
    // A pointed wand running off the bottom-right corner.
    const wand = (x: number, y: number) => Math.abs(x - y) <= Math.min(10, (x + y - 8) * 0.6);
    near(paint(57, 58, wand), 4, 4, 3);
    const withBubble = (x: number, y: number) => wand(x, y) || (x >= 38 && x <= 55 && y <= 10);
    near(paint(57, 58, withBubble), 4, 4, 3);
  });

  it('does not mistake a straight diagonal wand for a reticle', () => {
    near(paint(48, 48, (x, y) => Math.abs(x - y) <= 3), 0, 0, 3);
  });

  it('aims with the middle of a crosshair or ring', () => {
    near(paint(41, 41, (x, y) => Math.abs(x - 20) <= 1 || Math.abs(y - 20) <= 1), 20, 20, 0);
    const ring = (x: number, y: number) => Math.abs(Math.hypot(x - 30, y - 24) - 16) <= 2;
    near(paint(64, 64, ring), 30, 24, 1);
  });

  it('aims with the middle of round art with no corner', () => {
    const blob = (x: number, y: number) => ((x - 20) / 18) ** 2 + ((y - 30) / 12) ** 2 <= 1 || Math.hypot(x - 34, y - 22) <= 8;
    const hit = paint(48, 48, blob);
    expect(hit.x).toBeGreaterThan(10);
    expect(hit.y).toBeGreaterThan(15);
  });

  it('falls back to the top-left corner for empty or fully opaque art', () => {
    expect(paint(32, 32, () => false)).toEqual({ x: 0, y: 0 });
    expect(paint(32, 32, () => true)).toEqual({ x: 0, y: 0 });
  });
});
