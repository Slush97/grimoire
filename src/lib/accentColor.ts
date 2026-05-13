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
}
