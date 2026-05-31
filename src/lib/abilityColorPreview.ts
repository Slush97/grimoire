/**
 * CSS previews for ability-color recolors, kept in sync with vpkmerge's engine so
 * the swatch the user sees matches what gets baked (hero_recolor.rs):
 *  - single hue  -> a flat hsl chip
 *  - rainbow     -> the full wheel, rotated/scaled by the spectrum tuning
 *  - gradient    -> a custom ramp sampled along the SHORTEST hue arc (matching
 *                   PrismGradient::sample), so a wrap-crossing gradient (e.g. pink
 *                   -> orange) reads through red, not the long way through cyan.
 *
 * The bake keeps each effect's own brightness; these chips use a fixed lightness,
 * so the hue path + saturation match exactly while brightness is approximate.
 */

export interface GStop {
  pos: number;
  hue: number;
  sat: number;
}

export interface GradientPreset {
  name: string;
  label: string;
  stops: GStop[];
}

/** Built-in gradients. Hues mirror vpkmerge's `PrismGradient::preset`. */
export const GRADIENT_PRESETS: ReadonlyArray<GradientPreset> = [
  { name: 'fire', label: 'Fire', stops: [{ pos: 0, hue: 0, sat: 1 }, { pos: 0.5, hue: 25, sat: 1 }, { pos: 1, hue: 50, sat: 1 }] },
  { name: 'ice', label: 'Ice', stops: [{ pos: 0, hue: 190, sat: 1 }, { pos: 0.5, hue: 215, sat: 0.9 }, { pos: 1, hue: 205, sat: 0.25 }] },
  { name: 'toxic', label: 'Toxic', stops: [{ pos: 0, hue: 110, sat: 1 }, { pos: 0.5, hue: 90, sat: 1 }, { pos: 1, hue: 72, sat: 1 }] },
  { name: 'sunset', label: 'Sunset', stops: [{ pos: 0, hue: 280, sat: 1 }, { pos: 0.5, hue: 325, sat: 0.95 }, { pos: 1, hue: 30, sat: 1 }] },
  { name: 'ocean', label: 'Ocean', stops: [{ pos: 0, hue: 175, sat: 1 }, { pos: 0.5, hue: 205, sat: 1 }, { pos: 1, hue: 235, sat: 1 }] },
  { name: 'neon', label: 'Neon', stops: [{ pos: 0, hue: 300, sat: 1 }, { pos: 0.5, hue: 240, sat: 1 }, { pos: 1, hue: 180, sat: 1 }] },
  { name: 'gold', label: 'Gold', stops: [{ pos: 0, hue: 25, sat: 1 }, { pos: 0.5, hue: 45, sat: 1 }, { pos: 1, hue: 55, sat: 0.55 }] },
  { name: 'void', label: 'Void', stops: [{ pos: 0, hue: 270, sat: 1 }, { pos: 0.5, hue: 305, sat: 1 }, { pos: 1, hue: 240, sat: 1 }] },
];

/** Default 3-stop custom gradient (purple -> teal -> gold). */
export const DEFAULT_CUSTOM_STOPS: GStop[] = [
  { pos: 0, hue: 280, sat: 1 },
  { pos: 0.5, hue: 190, sat: 1 },
  { pos: 1, hue: 50, sat: 1 },
];

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

/** (hue, sat) at spectral position `t`, shortest-arc hue interp. Mirrors the Rust
 *  `PrismGradient::sample`, so previews track the bake. */
function sampleHueSat(stops: GStop[], t: number): { hue: number; sat: number } {
  const tt = clamp(t, 0, 1);
  if (tt <= stops[0].pos) return { hue: stops[0].hue, sat: stops[0].sat };
  const last = stops[stops.length - 1];
  if (tt >= last.pos) return { hue: last.hue, sat: last.sat };
  for (let i = 0; i < stops.length - 1; i++) {
    const a = stops[i];
    const b = stops[i + 1];
    if (tt >= a.pos && tt <= b.pos) {
      const f = (tt - a.pos) / Math.max(1e-9, b.pos - a.pos);
      let dh = b.hue - a.hue;
      if (dh > 180) dh -= 360;
      else if (dh < -180) dh += 360;
      return { hue: a.hue + dh * f, sat: a.sat + (b.sat - a.sat) * f };
    }
  }
  return { hue: last.hue, sat: last.sat };
}

/** CSS `linear-gradient` for a stop list, sampled at 12 steps along the shortest
 *  hue arc so it follows the same path the engine bakes. rotation/sat/brightness
 *  layer on top, mirroring `prism --hue-offset/--saturation/--brightness`. */
export function gradientCss(
  stops: GStop[],
  rotation: number,
  satScale: number,
  brightScale: number
): string {
  const l = clamp(Math.round(55 * brightScale), 12, 92);
  const steps = 12;
  const parts: string[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const { hue, sat } = sampleHueSat(stops, t);
    const h = ((Math.round(hue + rotation) % 360) + 360) % 360;
    const s = clamp(Math.round(85 * sat * satScale), 0, 100);
    parts.push(`hsl(${h}, ${s}%, ${l}%) ${Math.round(t * 100)}%`);
  }
  return `linear-gradient(135deg, ${parts.join(', ')})`;
}

/** CSS for the full rainbow prism, rotated/scaled by the spectrum tuning. */
export function rainbowCss(rotation: number, satScale: number, brightScale: number): string {
  const s = clamp(Math.round(85 * satScale), 0, 100);
  const l = clamp(Math.round(55 * brightScale), 12, 92);
  const stops = [0, 60, 120, 180, 240, 300, 360]
    .map((d) => `hsl(${((Math.round(rotation + d) % 360) + 360) % 360}, ${s}%, ${l}%)`)
    .join(', ');
  return `linear-gradient(135deg, ${stops})`;
}

/** A flat hue chip (single-color mode). */
export function hueSwatch(hue: number, saturation: number, brightness: number): string {
  const s = clamp(Math.round(72 * saturation), 0, 100);
  const l = clamp(Math.round(52 * brightness), 8, 92);
  return `hsl(${Math.round(hue)}, ${s}%, ${l}%)`;
}

/** The `--gradient` spec sent to vpkmerge: a preset name, or `pos:hue:sat,...`. */
export function gradientSpecOf(preset: string, customStops: GStop[]): string {
  if (preset !== 'custom') return preset;
  return customStops.map((s) => `${s.pos}:${Math.round(s.hue)}:${s.sat}`).join(',');
}

/** The stops backing the current gradient selection (preset or custom editor). */
export function selectedGradientStops(preset: string, customStops: GStop[]): GStop[] {
  if (preset === 'custom') return customStops;
  return GRADIENT_PRESETS.find((g) => g.name === preset)?.stops ?? GRADIENT_PRESETS[0].stops;
}

/** Resolve a persisted/applied gradient spec into its stops (preset or custom). */
export function stopsForSpec(spec: string | undefined | null): GStop[] {
  const parsed = parseGradientSpec(spec ?? undefined);
  return selectedGradientStops(parsed.preset, parsed.stops);
}

/** Parse a gradient spec back into (preset, stops) for the editor / preview. */
export function parseGradientSpec(spec: string | undefined): { preset: string; stops: GStop[] } {
  if (spec && GRADIENT_PRESETS.some((g) => g.name === spec)) {
    return { preset: spec, stops: DEFAULT_CUSTOM_STOPS };
  }
  if (spec) {
    const stops = spec
      .split(',')
      .map((part) => part.split(':').map(Number))
      .filter((n) => n.length >= 2 && n.every((x) => Number.isFinite(x)))
      .map(([pos, hue, sat]) => ({ pos, hue, sat: sat ?? 1 }));
    if (stops.length >= 2) return { preset: 'custom', stops };
  }
  return { preset: GRADIENT_PRESETS[0].name, stops: DEFAULT_CUSTOM_STOPS };
}

/** A human label for an applied gradient spec (preset label or "Custom"). */
export function gradientLabelOf(spec: string | undefined | null): string {
  if (spec && GRADIENT_PRESETS.some((g) => g.name === spec)) {
    return GRADIENT_PRESETS.find((g) => g.name === spec)?.label ?? spec;
  }
  return 'Custom';
}
