/**
 * The user's own accent colors and background glows, kept as swatches beside
 * the presets. The pickers share these rules, so a color and a two-color glow
 * behave the same way.
 */

/** How many of the user's own swatches a picker keeps. With the presets and the
 *  pipette this still fits one row in Settings. */
export const MAX_CUSTOM_SWATCHES = 3;

export interface SwatchRules<T> {
  same: (a: T, b: T) => boolean;
  isPreset: (value: T) => boolean;
}

function has<T>(list: readonly T[], value: T, rules: SwatchRules<T>): boolean {
  return list.some((entry) => rules.same(entry, value));
}

/** Newest kept: a list over the limit loses its oldest entries. */
function capped<T>(list: T[]): T[] {
  return list.slice(Math.max(0, list.length - MAX_CUSTOM_SWATCHES));
}

/**
 * The swatches to show: the stored ones, plus the active value when it is the
 * user's own and not stored yet. That covers a custom pick made before
 * swatches existed, which settings hold only as the active value.
 */
export function customSwatches<T>(stored: readonly T[] | null | undefined, active: T | null | undefined, rules: SwatchRules<T>): T[] {
  const list: T[] = [];
  for (const entry of stored ?? []) {
    if (!rules.isPreset(entry) && !has(list, entry, rules)) list.push(entry);
  }
  if (active != null && !rules.isPreset(active) && !has(list, active, rules)) list.push(active);
  return capped(list);
}

/**
 * The swatches after the user applies `next` from the picker, where `previous`
 * was active when the picker opened. Tweaking one of their own swatches changes
 * it in place. Anything else adds a swatch, so trying a preset never loses a
 * color. A preset or an existing swatch is only selected, never added again.
 */
export function applyCustomSwatch<T>(swatches: readonly T[], previous: T | null | undefined, next: T, rules: SwatchRules<T>): T[] {
  if (rules.isPreset(next) || has(swatches, next, rules)) return [...swatches];
  if (previous != null && has(swatches, previous, rules)) {
    return swatches.map((entry) => (rules.same(entry, previous) ? next : entry));
  }
  return capped([...swatches, next]);
}

export function removeCustomSwatch<T>(swatches: readonly T[], target: T, rules: SwatchRules<T>): T[] {
  return swatches.filter((entry) => !rules.same(entry, target));
}

export function sameSwatches<T>(a: readonly T[], b: readonly T[], rules: SwatchRules<T>): boolean {
  return a.length === b.length && a.every((entry, index) => rules.same(entry, b[index]));
}
