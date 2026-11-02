import type { ModEntry } from './modEntries';
import { entryInstalledAt, entryName, entrySize, entrySortPriority } from './modEntries';

export type InstalledSortMode = 'priority' | 'recent' | 'name' | 'hero' | 'size';

export function sortInstalledEntries(entries: readonly ModEntry[], mode: InstalledSortMode, heroes: (entry: ModEntry) => readonly string[]): ModEntry[] {
  if (mode === 'priority') return [...entries];
  const compareNames = (left: string, right: string) => left.localeCompare(right, undefined, { sensitivity: 'base' });
  return [...entries].sort((left, right) => {
    if (mode === 'name') return compareNames(entryName(left), entryName(right));
    if (mode === 'size') return entrySize(right) - entrySize(left) || entrySortPriority(left) - entrySortPriority(right);
    if (mode === 'hero') {
      const first = [...heroes(left)].sort(compareNames)[0];
      const second = [...heroes(right)].sort(compareNames)[0];
      if (first && !second) return -1;
      if (!first && second) return 1;
      return (first && second ? compareNames(first, second) : 0) || entrySortPriority(left) - entrySortPriority(right);
    }
    return entryInstalledAt(right).localeCompare(entryInstalledAt(left))
      || entrySortPriority(left) - entrySortPriority(right);
  });
}
