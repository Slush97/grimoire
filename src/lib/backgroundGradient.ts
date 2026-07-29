// Ambient background glow: two large radial gradients bleeding in from the
// top-left and bottom-right corners of the window, behind every page.
//
// Kept as data (a pair of hex colors) rather than a fixed set of ids so a
// custom pick is the same shape as a preset, and one renderer covers both the
// real layer and the little preview tiles in Settings.

export interface BackgroundGradient {
  /** Color of the glow entering from the top-left corner. */
  from: string;
  /** Color of the glow entering from the bottom-right corner. */
  to: string;
}

export interface BackgroundGradientPreset extends BackgroundGradient {
  id: string;
  name: string;
}

export const BACKGROUND_GRADIENT_PRESETS: BackgroundGradientPreset[] = [
  { id: 'ember',   name: 'Ember',   from: '#f97316', to: '#dc2626' },
  { id: 'dusk',    name: 'Dusk',    from: '#8b5cf6', to: '#ec4899' },
  { id: 'abyss',   name: 'Abyss',   from: '#3b82f6', to: '#06b6d4' },
  { id: 'verdant', name: 'Verdant', from: '#10b981', to: '#84cc16' },
  { id: 'nebula',  name: 'Nebula',  from: '#6366f1', to: '#f43f5e' },
  { id: 'gold',    name: 'Gold',    from: '#f59e0b', to: '#eab308' },
  // Slate rather than slate-into-navy: #1e293b over a #0f0f0f base lands about
  // seven points off the background, so the old pairing rendered as a single
  // grey smudge and its swatch was indistinguishable from "No glow".
  { id: 'ash',     name: 'Ash',     from: '#94a3b8', to: '#64748b' },
];

/** Peak alpha at each corner. Low enough that body text over the glow keeps
 *  its contrast, high enough to read as deliberate on a #0f0f0f base. */
const GLOW_ALPHA = 0.3;

/** The app's base background, painted under the glow in preview tiles. */
export const BACKGROUND_BASE = '#0f0f0f';

/** Hex (3- or 6-digit, with or without `#`) to an rgba() string. Anything else
 *  resolves to fully transparent: settings.json is user-editable and the color
 *  picker emits shorthand mid-typing, so a bad value has to degrade to "no
 *  glow" rather than to an invalid declaration that drops the whole layer. */
function rgba(hex: string, alpha: number): string {
  const raw = (hex || '').trim().replace(/^#/, '');
  const expanded = /^[0-9a-f]{3}$/i.test(raw)
    ? raw.split('').map((c) => c + c).join('')
    : raw;
  if (!/^[0-9a-f]{6}$/i.test(expanded)) return 'rgba(0, 0, 0, 0)';
  const [r, g, b] = expanded.match(/.{2}/g)!.map((c) => parseInt(c, 16));
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

interface GlowGeometry {
  /** Peak alpha at each corner. */
  alpha: number;
  /** Radial-gradient size, as percentages of the painted box. */
  size: string;
  /** Where the color has faded out entirely. */
  stop: string;
}

/** The real layer. Radii stay well under half the viewport so the two glows hug
 *  their corners and never meet in the middle: the center of the page stays
 *  neutral, and text over it keeps its contrast. */
const LAYER: GlowGeometry = { alpha: GLOW_ALPHA, size: '55% 50%', stop: '70%' };

/** Swatches identify a preset; they do not simulate it. Reusing the layer's
 *  geometry on an 80x48 tile tints only about a quarter of it and leaves the
 *  rest flat #0f0f0f, so every preset read as the same near-black rectangle
 *  sitting under a row of vivid accent chips. Swatches therefore get much
 *  larger radii and a higher alpha: both colors are legible at thumbnail size
 *  and the two glows meet in the middle instead of hugging opposite corners. */
const SWATCH: GlowGeometry = { alpha: 0.7, size: '120% 110%', stop: '88%' };

function glowLayers(gradient: BackgroundGradient, { alpha, size, stop }: GlowGeometry): string {
  return [
    `radial-gradient(${size} at 0% 0%, ${rgba(gradient.from, alpha)} 0%, transparent ${stop})`,
    `radial-gradient(${size} at 100% 100%, ${rgba(gradient.to, alpha)} 0%, transparent ${stop})`,
  ].join(', ');
}

/** The `background` shorthand for the real, full-window glow layer. */
export function backgroundGradientCss(gradient: BackgroundGradient): string {
  return glowLayers(gradient, LAYER);
}

/** Swatch background: the bolder preview glow over the app's own base color. */
export function backgroundGradientPreviewCss(gradient: BackgroundGradient): string {
  return `${glowLayers(gradient, SWATCH)}, ${BACKGROUND_BASE}`;
}

/** True when both corners match, ignoring hex case. */
export function sameGradient(a: BackgroundGradient | null, b: BackgroundGradient | null): boolean {
  if (!a || !b) return a === b;
  return a.from.toLowerCase() === b.from.toLowerCase() && a.to.toLowerCase() === b.to.toLowerCase();
}

/**
 * Paint (or clear) the glow by writing the layer's background to the document
 * root. Layout renders a single fixed element bound to this variable, so the
 * change lands without a re-render, the same way the accent color works.
 */
export function applyBackgroundGradient(gradient: BackgroundGradient | null | undefined): void {
  const root = document.documentElement;
  if (!gradient) {
    root.style.setProperty('--app-bg-glow', 'none');
    root.style.setProperty('--app-bg-glow-opacity', '0');
    return;
  }
  root.style.setProperty('--app-bg-glow', backgroundGradientCss(gradient));
  root.style.setProperty('--app-bg-glow-opacity', '1');
}
