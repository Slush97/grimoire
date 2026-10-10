import type { ModConflict } from './api';
import type { Mod } from '../types/mod';

export function searchConflicts(
  conflicts: readonly ModConflict[],
  mods: ReadonlyMap<string, Pick<Mod, 'name' | 'fileName'>>,
  query: string,
) {
  const needle = query.trim().toLowerCase();
  return conflicts.flatMap((conflict) => {
    const files = conflict.files ?? [];
    const modA = mods.get(conflict.modA);
    const modB = mods.get(conflict.modB);
    const matchesMod = [
      conflict.modAName, conflict.modBName,
      modA?.name, modB?.name, modA?.fileName, modB?.fileName,
    ].some((value) => value?.toLowerCase().includes(needle));
    if (!needle || matchesMod) return [{ conflict, files, fileMatch: false }];
    const matchingFiles = files.filter((file) => file.toLowerCase().includes(needle));
    return matchingFiles.length > 0 ? [{ conflict, files: matchingFiles, fileMatch: true }] : [];
  });
}
