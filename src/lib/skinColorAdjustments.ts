import type { SkinColorAdjustments, SkinPartEdit } from '../types/skinEditor';

export const ORIGINAL_SKIN_COLOR: SkinColorAdjustments = { hue: 0, saturation: 1, brightness: 1 };

export function hasColorAdjustments(value: SkinColorAdjustments | undefined): boolean {
  return !!value && (value.hue !== 0 || value.saturation !== 1 || value.brightness !== 1);
}

export function hasSkinPartEdit(edit: SkinPartEdit): boolean {
  return edit.hidden || edit.tint !== null || !!edit.finish || !!edit.surface || (edit.pattern?.intensity ?? 0) > 0 || hasColorAdjustments(edit.adjustments);
}

/** Paint the entire color texture while keeping some of its light and dark detail. */
export function repaintSkinPixels(pixels: Uint8ClampedArray | Uint8Array, hex: string): void {
  const target = [1, 3, 5].map((index) => Number.parseInt(hex.slice(index, index + 2), 16));
  for (let i = 0; i < pixels.length; i += 4) {
    const luminance = (0.2126 * pixels[i] + 0.7152 * pixels[i + 1] + 0.0722 * pixels[i + 2]) / 255;
    const shade = 0.65 + 0.35 * luminance;
    for (let channel = 0; channel < 3; channel++) pixels[i + channel] = Math.round(target[channel] * shade);
  }
}

export function adjustSkinPixels(pixels: Uint8ClampedArray | Uint8Array, value: SkinColorAdjustments): void {
  if (!hasColorAdjustments(value)) return;
  for (let i = 0; i < pixels.length; i += 4) {
    const r = pixels[i] / 255, g = pixels[i + 1] / 255, b = pixels[i + 2] / 255;
    const peak = Math.max(r, g, b), delta = peak - Math.min(r, g, b);
    let hue = delta === 0 ? 0 : peak === r ? (g - b) / delta : peak === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
    hue = ((hue / 6 + value.hue / 360) % 1 + 1) % 1;
    const saturation = Math.min(1, (peak === 0 ? 0 : delta / peak) * value.saturation);
    const brightness = Math.min(1, peak * value.brightness);
    const chroma = brightness * saturation;
    const x = chroma * (1 - Math.abs(hue * 6 % 2 - 1));
    const m = brightness - chroma;
    const rgb = hue < 1 / 6 ? [chroma, x, 0] : hue < 2 / 6 ? [x, chroma, 0] : hue < 3 / 6 ? [0, chroma, x]
      : hue < 4 / 6 ? [0, x, chroma] : hue < 5 / 6 ? [x, 0, chroma] : [chroma, 0, x];
    for (let channel = 0; channel < 3; channel++) pixels[i + channel] = Math.round((rgb[channel] + m) * 255);
  }
}
