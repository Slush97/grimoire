// Accent color presets shown in Settings. Each preset is a pair of
// (base, hover) hex values applied to --color-accent and --color-accent-hover
// at runtime, so the whole UI re-themes without a reload.
//
// The default `Ember` is the original orange the app shipped with — picked as
// the base so changing accents feels additive, not lossy.

export interface AccentPreset {
  id: string;
  name: string;
  color: string;
  hover: string;
}

export const ACCENT_PRESETS: AccentPreset[] = [
  { id: 'ember',   name: 'Ember',   color: '#f97316', hover: '#ea580c' },
  { id: 'amber',   name: 'Amber',   color: '#f59e0b', hover: '#d97706' },
  { id: 'crimson', name: 'Crimson', color: '#ef4444', hover: '#dc2626' },
  { id: 'rose',    name: 'Rose',    color: '#ec4899', hover: '#db2777' },
  { id: 'violet',  name: 'Violet',  color: '#8b5cf6', hover: '#7c3aed' },
  { id: 'azure',   name: 'Azure',   color: '#3b82f6', hover: '#2563eb' },
  { id: 'cyan',    name: 'Cyan',    color: '#06b6d4', hover: '#0891b2' },
  { id: 'emerald', name: 'Emerald', color: '#10b981', hover: '#059669' },
];

export const DEFAULT_ACCENT_COLOR = ACCENT_PRESETS[0].color;

function darken(hex: string, amount = 0.12): string {
  const m = hex.replace('#', '').match(/.{2}/g);
  if (!m) return hex;
  const [r, g, b] = m.map((c) => parseInt(c, 16));
  const adj = (v: number) => Math.max(0, Math.min(255, Math.round(v * (1 - amount))));
  return `#${[adj(r), adj(g), adj(b)].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

type Rgb = [number, number, number];

function parseHex(hex: string): Rgb | null {
  const value = (hex || '').trim().replace(/^#/, '');
  const expanded = value.length === 3
    ? value.split('').map((channel) => channel + channel).join('')
    : value;
  if (!/^[\da-f]{6}$/i.test(expanded)) return null;
  return [0, 2, 4].map((offset) => parseInt(expanded.slice(offset, offset + 2), 16)) as Rgb;
}

function toHex(rgb: Rgb): string {
  return `#${rgb.map((channel) => Math.round(channel).toString(16).padStart(2, '0')).join('')}`;
}

function relativeLuminance(rgb: Rgb): number {
  const [r, g, b] = rgb.map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio for two hex colors. Invalid colors return 1. */
export function contrastRatio(foreground: string, background: string): number {
  const fg = parseHex(foreground);
  const bg = parseHex(background);
  if (!fg || !bg) return 1;
  const lighter = Math.max(relativeLuminance(fg), relativeLuminance(bg));
  const darker = Math.min(relativeLuminance(fg), relativeLuminance(bg));
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Readable text/icon color (white or near-black) for a solid swatch of `hex`.
 *
 * Chooses the higher-contrast of the app's near-black and white inks. One of
 * those two candidates always clears WCAG AA for normal text.
 */
export function accentForeground(hex: string): string {
  if (!parseHex(hex)) return '#ffffff';
  const dark = '#0f0f0f';
  const light = '#ffffff';
  return contrastRatio(hex, dark) >= contrastRatio(hex, light) ? dark : light;
}

/**
 * Preserve an accent as-is when it is readable as text, otherwise move it the
 * minimum practical distance toward black or white until it reaches WCAG AA.
 */
export function accentInk(hex: string, background: string): string {
  const source = parseHex(hex);
  const surface = parseHex(background);
  if (!source || !surface) return accentForeground(hex);
  if (contrastRatio(hex, background) >= 4.5) return toHex(source);

  const target: Rgb = relativeLuminance(surface) > 0.5 ? [0, 0, 0] : [255, 255, 255];
  let low = 0;
  let high = 1;
  let best = target;
  for (let i = 0; i < 24; i += 1) {
    const amount = (low + high) / 2;
    const mixed = source.map((channel, index) => channel + (target[index] - channel) * amount) as Rgb;
    if (contrastRatio(toHex(mixed), background) >= 4.5) {
      best = mixed;
      high = amount;
    } else {
      low = amount;
    }
  }
  return toHex(best);
}

/**
 * Write the accent color to the document root as CSS variables. Tailwind's
 * @theme tokens read these at use-site (e.g. `bg-accent`), so every component
 * already wired to `--color-accent` updates without rerendering.
 */
export function applyAccentColor(color: string | null | undefined): void {
  const base = color || DEFAULT_ACCENT_COLOR;
  // Prefer the preset's curated hover (slightly darker, same saturation).
  // For ad-hoc/custom hex values, fall back to a 12% darken so hover states
  // still have visible feedback.
  const preset = ACCENT_PRESETS.find((p) => p.color.toLowerCase() === base.toLowerCase());
  const hover = preset ? preset.hover : darken(base);
  const root = document.documentElement;
  root.style.setProperty('--color-accent', base);
  root.style.setProperty('--color-accent-hover', hover);
  root.style.setProperty('--color-accent-foreground', accentForeground(base));
  // Dark ink is checked against the lightest dark surface; light ink against
  // a white card, so either remains readable throughout its theme.
  root.style.setProperty('--color-accent-ink-dark', accentInk(base, '#242424'));
  root.style.setProperty('--color-accent-ink-light', accentInk(base, '#ffffff'));
}
