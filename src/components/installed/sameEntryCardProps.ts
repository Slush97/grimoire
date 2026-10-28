import type { ModEntry } from '../../lib/modEntries';
import type { ModList } from '../../lib/modLists';

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
export function sameEntryCardProps<T extends { entry: ModEntry; lists?: readonly ModList[]; listIds?: readonly string[] }>(previous: T, next: T): boolean {
  const keys = Object.keys(previous) as (keyof T)[];
  return keys.length === Object.keys(next).length && keys.every((key) =>
    Object.prototype.hasOwnProperty.call(next, key) && (key === 'entry' ? sameEntry(previous.entry, next.entry)
      : key === 'listIds' ? sameValues(previous.listIds, next.listIds)
        : key === 'lists' ? sameListMenu(previous.lists, next.lists)
          : Object.is(previous[key], next[key]))
  );
}

function sameValues(previous: readonly string[] | undefined, next: readonly string[] | undefined): boolean {
  return previous === next || (!!previous && !!next && previous.length === next.length && previous.every((value, index) => value === next[index]));
}

function sameListMenu(previous: readonly ModList[] | undefined, next: readonly ModList[] | undefined): boolean {
  return previous === next || (!!previous && !!next && previous.length === next.length && previous.every((list, index) => {
    const other = next[index];
    return list.id === other.id && list.name === other.name && list.icon === other.icon;
  }));
}
