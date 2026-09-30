export interface SelectionEntry {
  key: string;
  ids: readonly string[];
}

export function selectEntryRange(
  selected: ReadonlySet<string>,
  entries: readonly SelectionEntry[],
  anchorKey: string | null,
  target: SelectionEntry,
  shiftKey: boolean,
): Set<string> {
  const next = new Set(selected);
  const allSelected = target.ids.every((id) => selected.has(id));
  const anchorIndex = entries.findIndex((entry) => entry.key === anchorKey);
  const targetIndex = entries.findIndex((entry) => entry.key === target.key);
  if (shiftKey && anchorIndex >= 0 && targetIndex >= 0) {
    for (const entry of entries.slice(
      Math.min(anchorIndex, targetIndex), Math.max(anchorIndex, targetIndex) + 1,
    )) {
      entry.ids.forEach((id) => allSelected ? next.delete(id) : next.add(id));
    }
  } else {
    target.ids.forEach((id) => allSelected ? next.delete(id) : next.add(id));
  }
  return next;
}
