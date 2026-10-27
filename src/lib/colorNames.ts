export type ColorFamily = 'red' | 'orange' | 'brown' | 'yellow' | 'green' | 'teal' | 'blue' | 'purple' | 'pink' | 'white' | 'gray' | 'black';

/** The everyday name for a color, so a painted area can be called "Blue" instead of "#3b82f6". */
export function colorFamily(hex: string): ColorFamily {
  const value = Number.parseInt(hex.replace('#', ''), 16);
  const [r, g, b] = [(value >> 16) & 255, (value >> 8) & 255, value & 255].map((channel) => channel / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const light = (max + min) / 2;
  const chroma = max - min;
  const saturation = chroma === 0 ? 0 : chroma / (1 - Math.abs(2 * light - 1));
  if (light < 0.12) return 'black';
  if (saturation < 0.15 || chroma < 0.08) return light > 0.75 ? 'white' : light < 0.3 ? 'black' : 'gray';
  if (light > 0.92) return 'white';
  const hue = max === r ? ((g - b) / chroma + 6) % 6 * 60 : max === g ? ((b - r) / chroma + 2) * 60 : ((r - g) / chroma + 4) * 60;
  if (hue < 15 || hue >= 340) return light < 0.3 ? 'brown' : 'red';
  if (hue < 42) return light < 0.4 ? 'brown' : 'orange';
  if (hue < 70) return light < 0.3 ? 'brown' : 'yellow';
  if (hue < 160) return 'green';
  if (hue < 195) return 'teal';
  if (hue < 255) return 'blue';
  if (hue < 290) return 'purple';
  return 'pink';
}
