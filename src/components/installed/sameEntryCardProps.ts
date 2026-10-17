import type { ModEntry } from '../../lib/modEntries';

function sameEntry(previous: ModEntry, next: ModEntry): boolean {
  if (previous === next) return true;
  if (previous.kind !== next.kind || previous.key !== next.key) return false;
  if (previous.kind === 'single' && next.kind === 'single') {
    return previous.mod === next.mod;
  }
  if (previous.kind === 'group' && next.kind === 'group') {
    // All group fields are derived by buildModEntries from these ordered mods.
    return previous.variants.length === next.variants.length &&
      previous.variants.every((mod, index) => mod === next.variants[index]);
  }
  return false;
}

/** Rebuilding the entry list after one mod changes need not redraw every card.
 * Mod identity is preserved by the store; still compare every other prop,
 * including callbacks, so the memo cannot hide updated actions or settings. */
export function sameEntryCardProps<T extends { entry: ModEntry }>(previous: T, next: T): boolean {
  const keys = Object.keys(previous) as (keyof T)[];
  return keys.length === Object.keys(next).length && keys.every((key) =>
    key === 'entry'
      ? sameEntry(previous.entry, next.entry)
      : Object.prototype.hasOwnProperty.call(next, key) && Object.is(previous[key], next[key])
  );
}
