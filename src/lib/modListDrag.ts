import { entryDisabledPreferenceKey, type ModEntry } from './modEntries';
import { installedListEntryKey, UNLISTED_GROUP_ID, type InstalledListGroup } from './installedListGroups';

export type ModListDrag = { kind: 'list'; id: string } | { kind: 'entry'; entry: ModEntry; sourceId: string };

export const listHeaderDragId = (id: string): string => JSON.stringify(['list', id]);
export const listDropId = (id: string): string => JSON.stringify(['target', id]);
export const listSlotId = (id: string): string => JSON.stringify(['slot', id]);
export interface ListDropPosition { groupId: string; beforeKey: string | null }

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

/** Keyboard targets must match the rendered sections, or arrow keys stall on a hidden list with no droppable rect. */
export function listGroupRendered(group: InstalledListGroup, dragging: ModListDrag['kind'] | undefined, showEmpty: boolean): boolean {
  if (group.entries.length > 0) return true;
  return group.id === UNLISTED_GROUP_ID ? dragging === 'entry' : showEmpty || dragging === 'entry';
}

export function canDropListItem(drag: ModListDrag, targetId: string): boolean {
  return drag.kind === 'list' ? targetId !== UNLISTED_GROUP_ID && targetId !== drag.id : true;
}

/** The source card is replaced by the slot while dragging. Other targets append by default. */
export function listDropSlotIndex(entries: readonly ModEntry[], incoming: ModEntry, beforeKey: string | null): number {
  const key = entryDisabledPreferenceKey(incoming);
  const candidates = entries.filter(entry => entryDisabledPreferenceKey(entry) !== key);
  const index = beforeKey === null ? -1 : candidates.findIndex(entry => entryDisabledPreferenceKey(entry) === beforeKey);
  return index < 0 ? candidates.length : index;
}

export interface ListCardRect { left: number; top: number; width: number; height: number }

/** Use layout boxes rather than animated transforms, so the slot cannot chase moving cards. */
export function listPointerIndex(cards: readonly ListCardRect[], point: { x: number; y: number }, rows: boolean): number {
  if (!cards.length) return 0;
  if (point.y > Math.max(...cards.map(card => card.top + card.height))) return cards.length;
  let nearest = 0;
  let bestRow = Infinity;
  let bestColumn = Infinity;
  cards.forEach((card, index) => {
    const rowDistance = Math.max(card.top - point.y, point.y - card.top - card.height, 0);
    const columnDistance = Math.abs(point.x - card.left - card.width / 2);
    if (rowDistance < bestRow || (rowDistance === bestRow && columnDistance < bestColumn)) {
      nearest = index; bestRow = rowDistance; bestColumn = columnDistance;
    }
  });
  const card = cards[nearest];
  const after = rows ? point.y > card.top + card.height / 2 : point.x > card.left + card.width / 2;
  return nearest + Number(after);
}
