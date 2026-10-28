import type { Mod } from '../types/mod';

// IPC returns fresh objects even for untouched mods. Reuse equal records so
// card memoization and derived caches survive scans and full-library mutations.
// Compare at publication time, rather than on every card subscription.
export function reconcileMods(prev: Mod[], next: Mod[]): Mod[] {
  if (prev === next) return prev;
  const prevById = new Map(prev.map((mod) => [mod.id, mod]));
  let unchanged = prev.length === next.length;
  const merged = next.map((mod, index) => {
    const old = prevById.get(mod.id);
    if (old && (old === mod || JSON.stringify(old) === JSON.stringify(mod))) {
      if (unchanged && prev[index] !== old) unchanged = false;
      return old;
    }
    unchanged = false;
    return mod;
  });
  return unchanged ? prev : merged;
}
