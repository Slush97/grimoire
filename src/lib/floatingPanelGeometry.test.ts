import { describe, expect, it } from 'vitest';
import { centerPanelSize, containPanel, resizePanel, snapPanel, validPanelBox, validPanelPosition } from './floatingPanelGeometry';

const area = { x: 200, y: 100, width: 800, height: 600 };
const panel = { x: 500, y: 300, width: 200, height: 160 };

describe('floating panel geometry', () => {
  it('treats all four offset boundaries as walls', () => {
    expect(containPanel({ ...panel, x: -100, y: -100 }, area)).toEqual({ ...panel, x: 200, y: 100 });
    expect(containPanel({ ...panel, x: 2000, y: 2000 }, area)).toEqual({ ...panel, x: 800, y: 540 });
  });

  it('keeps growth and shrinkage centered until containment is requested', () => {
    expect(centerPanelSize(panel, { width: 400, height: 200 })).toEqual({ x: 400, y: 280, width: 400, height: 200 });
    expect(centerPanelSize(panel, { width: 100, height: 80 })).toEqual({ x: 550, y: 340, width: 100, height: 80 });
  });

  it('only snaps with Shift, independently on both axes', () => {
    const near = { ...panel, x: 208, y: 529 };
    expect(snapPanel(near, area, false)).toEqual({ box: near, guides: {} });
    expect(snapPanel(near, area, true)).toEqual({ box: { ...near, x: 200, y: 540 }, guides: { x: 200, y: 700 } });
    expect(snapPanel({ ...near, x: 225 }, area, true).guides).toEqual({ y: 700 });
  });

  it('aligns center with center, and chooses the nearest target', () => {
    expect(snapPanel({ ...panel, x: 524, y: 344 }, area, true)).toEqual({
      box: { ...panel, x: 500, y: 320 }, guides: { x: 600, y: 400 },
    });
    expect(snapPanel({ ...panel, x: 525, y: 345 }, area, true).guides).toEqual({});
    expect(snapPanel({ ...panel, x: 510, y: 311 }, area, true)).toEqual({
      box: { ...panel, x: 500, y: 320 }, guides: { x: 600, y: 400 },
    });
    expect(snapPanel({ ...panel, x: 791, y: 109 }, area, true).guides).toEqual({ x: 1000, y: 100 });
  });

  it('allows centered resize overflow and then settles with minimum movement', () => {
    const atWall = { ...panel, x: 200, y: 100 };
    const resized = resizePanel(atWall, 50, 30, false, { width: 100, height: 100 }, area, 'center');
    expect(resized).toEqual({ x: 150, y: 70, width: 300, height: 220 });
    expect(containPanel(resized, area)).toEqual({ ...resized, x: 200, y: 100 });
  });

  it('supports the left grip and caps size even if minimums exceed the area', () => {
    expect(resizePanel(panel, -50, 30, true, { width: 100, height: 100 }, area, 'center')).toEqual({ x: 450, y: 270, width: 300, height: 220 });
    const resized = resizePanel(panel, 1000, 1000, false, { width: 900, height: 900 }, area, 'center');
    expect(resized.width).toBe(800);
    expect(resized.height).toBe(600);
    expect(containPanel(resized, area)).toEqual(area);
  });

  it('fits a previously larger panel into a smaller or empty area', () => {
    expect(containPanel(panel, { x: 240, y: 140, width: 50, height: 20 })).toEqual({ x: 240, y: 140, width: 50, height: 20 });
    expect(containPanel(panel, { x: 240, y: 140, width: 0, height: 0 })).toEqual({ x: 240, y: 140, width: 0, height: 0 });
  });

  it('resizes from either bottom corner while fixing the opposite top corner', () => {
    const min = { width: 100, height: 80 };
    expect(resizePanel(panel, 40, 30, false, min, area)).toEqual({ ...panel, width: 240, height: 190 });
    expect(resizePanel(panel, -40, 30, true, min, area)).toEqual({ x: 460, y: 300, width: 240, height: 190 });
    const expanded = resizePanel(panel, -1000, 1000, true, min, area);
    expect(expanded).toEqual({ x: -100, y: 300, width: 800, height: 600 });
    expect(containPanel(expanded, area)).toEqual(area);
    expect(resizePanel(panel, 1000, 1000, false, min, area)).toEqual({ x: 500, y: 300, width: 800, height: 600 });
    expect(resizePanel(panel, 1000, -1000, true, min, area)).toEqual({ x: 600, y: 300, width: 100, height: 80 });
  });

  it('accepts legacy saved positions and rejects malformed or nonfinite geometry', () => {
    expect(validPanelPosition({ x: 20, y: 30 })).toBe(true);
    expect(validPanelBox(panel)).toBe(true);
    for (const value of [null, {}, { x: '20', y: 30 }, { x: NaN, y: 0 }, { x: 0, y: Infinity }]) expect(validPanelPosition(value)).toBe(false);
    for (const value of [{ ...panel, width: -1 }, { ...panel, height: 0 }, { ...panel, width: Infinity }]) expect(validPanelBox(value)).toBe(false);
  });
});
