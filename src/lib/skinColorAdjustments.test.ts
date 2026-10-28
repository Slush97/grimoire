import { describe, expect, it } from 'vitest';
import { adjustSkinPixels, ORIGINAL_SKIN_COLOR, hasSkinPartEdit, meanLuminance, repaintSkinPixels } from './skinColorAdjustments';
import { skinEditExportSchema, skinEditSaveSchema } from './skinEditSchema';

describe('skin texture adjustment', () => {
  it('paints around the picked color, keeping shading and packed alpha, exactly like vpkmerge', () => {
    // Same texels and expected bytes as vpkmerge's repaint_lifts_dark_pixels_keeps_detail_and_alpha.
    const pixels = new Uint8Array([0, 0, 0, 17, 128, 128, 128, 128, 255, 255, 255, 239]);
    repaintSkinPixels(pixels, '#c86432');
    expect([...pixels]).toEqual([150, 75, 37, 17, 200, 100, 50, 128, 250, 125, 62, 239]);
    repaintSkinPixels(pixels, '#000000');
    expect([...pixels]).toEqual([0, 0, 0, 17, 0, 0, 0, 128, 0, 0, 0, 239]);
  });
  it('gives a dark area the picked color, not a darker one', () => {
    const pixels = new Uint8Array([30, 30, 30, 255, 30, 30, 30, 255, 0, 0, 0, 255]);
    repaintSkinPixels(pixels, '#ef4444', meanLuminance(pixels, new Uint8Array([255, 255, 0])));
    expect([...pixels.slice(0, 8)]).toEqual([239, 68, 68, 255, 239, 68, 68, 255]);
  });
  it('keeps neutral pixels exact, shifts hues, and preserves every alpha byte', () => {
    const pixels = new Uint8Array([255, 0, 0, 19, 0, 255, 0, 128, 80, 80, 80, 0]);
    const original = pixels.slice();
    adjustSkinPixels(pixels, ORIGINAL_SKIN_COLOR);
    expect(pixels).toEqual(original);
    adjustSkinPixels(pixels, { hue: 120, saturation: 1, brightness: 0.5 });
    expect([...pixels]).toEqual([0, 128, 0, 19, 0, 0, 128, 128, 40, 40, 40, 0]);
  });
  it('desaturates the source without replacing it with the picker hue', () => {
    const pixels = new Uint8ClampedArray([40, 80, 160, 255]);
    adjustSkinPixels(pixels, { hue: -180, saturation: 0, brightness: 1.5 });
    expect([...pixels]).toEqual([240, 240, 240, 255]);
    expect(hasSkinPartEdit({ material: 'coat', hidden: false, tint: null, adjustments: ORIGINAL_SKIN_COLOR })).toBe(false);
    expect(hasSkinPartEdit({ material: 'coat', hidden: false, tint: null, adjustments: { ...ORIGINAL_SKIN_COLOR, hue: 1 } })).toBe(true);
  });
  it('rejects invalid edit ranges and empty skin names at the IPC boundary', () => {
    const source = { heroName: 'Abrams', skinSources: [], fingerprint: 'a'.repeat(64), edits: [{ material: 'coat.vmat', hidden: false, tint: null, adjustments: { hue: 181, saturation: 1, brightness: 1 } }] };
    expect(skinEditExportSchema.safeParse(source).success).toBe(false);
    expect(skinEditSaveSchema.safeParse({ ...source, edits: [], name: ' ' }).success).toBe(false);
  });
  it('retains a transparency-only edit and validates its mode and opacity at the IPC boundary', () => {
    const edit = { material: 'gun.vmat', hidden: false, tint: null, surface: { mode: 'ghost', opacity: 0.35 } };
    const source = { heroName: 'Abrams', skinSources: [], fingerprint: 'a'.repeat(64), edits: [edit] };
    expect(skinEditExportSchema.parse(source).edits[0].surface).toEqual(edit.surface);
    expect(hasSkinPartEdit({ ...edit, surface: { mode: 'ghost', opacity: 0 } })).toBe(true);
    for (const opacity of [-0.1, 1.1, NaN, Infinity]) {
      expect(skinEditExportSchema.safeParse({ ...source, edits: [{ ...edit, surface: { mode: 'ghost', opacity } }] }).success).toBe(false);
    }
    expect(skinEditExportSchema.safeParse({ ...source, edits: [{ ...edit, surface: { mode: 'glass', opacity: 0.35 } }] }).success).toBe(false);
  });
});
