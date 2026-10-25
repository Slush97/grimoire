import { entryDisabledPreferenceKey, type ModEntry } from './modEntries';
import { installedListEntryKey, UNLISTED_GROUP_ID, type InstalledListGroup } from './installedListGroups';

export type ModListDrag = { kind: 'list'; id: string } | { kind: 'entry'; entry: ModEntry; sourceId: string };

export const listHeaderDragId = (id: string): string => JSON.stringify(['list', id]);
export const listDropId = (id: string): string => JSON.stringify(['target', id]);

export function buildListDragItems(groups: readonly InstalledListGroup[]): Map<string, ModListDrag> {
  const items = new Map<string, ModListDrag>();
  for (const group of groups) {
    if (group.id !== UNLISTED_GROUP_ID) items.set(listHeaderDragId(group.id), { kind: 'list', id: group.id });
    for (const entry of group.entries) {
      items.set(installedListEntryKey(group.id, entry), { kind: 'entry', entry, sourceId: group.id });
    }
  }
  return items;
}

export function canDropListItem(drag: ModListDrag, targetId: string): boolean {
  return drag.kind === 'list' ? targetId !== UNLISTED_GROUP_ID && targetId !== drag.id : targetId !== drag.sourceId;
}

/** Match the page's current display order without changing mod load order. */
export function listDropSlotIndex(entries: readonly ModEntry[], incoming: ModEntry, order: ReadonlyMap<string, number>): number | null {
  const key = entryDisabledPreferenceKey(incoming);
  if (entries.some((entry) => entryDisabledPreferenceKey(entry) === key)) return null;
  const position = order.get(incoming.key);
  if (position === undefined) return entries.length;
  const index = entries.findIndex((entry) => (order.get(entry.key) ?? Infinity) > position);
  return index < 0 ? entries.length : index;
}
