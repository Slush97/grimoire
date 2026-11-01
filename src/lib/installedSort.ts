import type { ModEntry } from './modEntries';
import { entryInstalledAt, entryName, entrySortPriority } from './modEntries';

export type InstalledSortMode = 'priority' | 'recent' | 'name' | 'hero' | 'updated';

function updatedAt(entry: ModEntry): string {
  const mods = entry.kind === 'single' ? [entry.mod] : entry.variants;
  return mods.reduce((latest, mod) => mod.updatedAt && mod.updatedAt > latest ? mod.updatedAt : latest, '');
}

export function sortInstalledEntries(entries: readonly ModEntry[], mode: InstalledSortMode, heroes: (entry: ModEntry) => readonly string[]): ModEntry[] {
  if (mode === 'priority') return [...entries];
  const compareNames = (left: string, right: string) => left.localeCompare(right, undefined, { sensitivity: 'base' });
  return [...entries].sort((left, right) => {
    if (mode === 'name') return compareNames(entryName(left), entryName(right));
    if (mode === 'hero') {
      const first = [...heroes(left)].sort(compareNames)[0];
      const second = [...heroes(right)].sort(compareNames)[0];
      if (first && !second) return -1;
      if (!first && second) return 1;
      return (first && second ? compareNames(first, second) : 0) || entrySortPriority(left) - entrySortPriority(right);
    }
    return (mode === 'updated' ? updatedAt(right).localeCompare(updatedAt(left)) : 0)
      || entryInstalledAt(right).localeCompare(entryInstalledAt(left))
      || entrySortPriority(left) - entrySortPriority(right);
  });
}
