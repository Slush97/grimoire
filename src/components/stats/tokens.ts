/**
 * Stats design tokens. Mirrors the CSS variables defined in src/index.css so
 * that recharts and other code that takes raw color strings stays in sync
 * with Tailwind utility classes elsewhere in the stats UI.
 *
 * If you change a value here, update the matching --color-stats-* var, and
 * vice versa. Keep both in lockstep.
 */

export const STATS_COLORS = {
  win: '#4ade80',
  loss: '#f87171',
  neutral: '#a1a1aa',
  chartGrid: '#2d2d2d',
  chartAxis: '#8a8a94',
  accent: '#f97316',
  bgCard: '#1a1a1a',
  bgInset: '#242424',
} as const

/**
 * Fallback rank-tier ramp for badge levels 1–11 (Initiate → Eternus).
 * The deadlock-api badge_distribution endpoint provides per-bucket colors
 * we prefer when present; this ramp covers cases where we render a badge
 * without that endpoint (e.g. PlayerHeader's current rank pill).
 */
export const RANK_TIER_COLORS: Record<number, string> = {
  1: '#9ca3af',  // Initiate — gray
  2: '#a1887f',  // Seeker — bronze
  3: '#cd7f32',  // Alchemist — copper
  4: '#c0c0c0',  // Arcanist — silver
  5: '#84cc16',  // Ritualist — emerald
  6: '#3b82f6',  // Emissary — sapphire
  7: '#a855f7',  // Archon — amethyst
  8: '#f97316',  // Oracle — flame
  9: '#ef4444',  // Phantom — ruby
  10: '#fbbf24', // Ascendant — gold
  11: '#06b6d4', // Eternus — cyan
}

/**
 * Sample-size thresholds for filtering noisy aggregates. Used as defaults;
 * UI may expose a slider for the user to override on meta views.
 */
export const MIN_MATCHES = {
  /** Personal hero stats — hide heroes with fewer matches from "top heroes". */
  personalHero: 5,
  /** Social tables (mate/enemy) — hide one-off encounters. */
  social: 3,
  /** Global meta (counters/synergies/combos) — filter low-N noise. */
  globalMeta: 50,
} as const

/**
 * Typography scale for stats KPIs. Used as Tailwind class strings so
 * components stay consistent without re-deriving sizes everywhere.
 */
export const STAT_TYPE = {
  hero: 'text-4xl font-bold tracking-tight tabular-nums',
  large: 'text-2xl font-semibold tabular-nums',
  medium: 'text-lg font-semibold tabular-nums',
  small: 'text-sm tabular-nums',
  label: 'text-xs uppercase tracking-wider text-text-tertiary font-medium',
} as const

/**
 * Map a numeric delta to a semantic color. MMR change, win-rate vs baseline,
 * etc. Returns one of the stats palette values.
 */
export function deltaColor(delta: number): string {
  if (delta > 0) return STATS_COLORS.win
  if (delta < 0) return STATS_COLORS.loss
  return STATS_COLORS.neutral
}

/**
 * Format a signed delta with sign prefix and fixed precision.
 * Examples: formatDelta(12) → "+12", formatDelta(-3.5, 1) → "-3.5"
 */
export function formatDelta(delta: number, fractionDigits = 0): string {
  const sign = delta > 0 ? '+' : ''
  return `${sign}${delta.toFixed(fractionDigits)}`
}
