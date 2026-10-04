import type { MergedModSource, Mod } from '../types/mod';

/**
 * The mods that stand on their own: everything except Locker-managed
 * artifacts (the applied hero-card and sound VPKs, managed from the Locker)
 * and the VPKs a merge absorbed, which the merged mod represents. Installed
 * shows these as cards, and both Installed and Browse classify and apply
 * updates over this set, so an absorbed source is never flagged or deleted
 * on its own. Absorbed sources are matched by identity, not filename alone,
 * because recyclable pakNN slots can later hold unrelated enabled mods.
 */
export function visibleInstalledMods(mods: readonly Mod[]): Mod[] {
  const absorbedSources: MergedModSource[] = [];
  for (const mod of mods) absorbedSources.push(...(mod.merged?.sources ?? []));
  return mods.filter(
    (mod) =>
      !mod.lockerCosmetics &&
      !mod.lockerSounds &&
      !absorbedSources.some((source) => matchesAbsorbedSource(mod, source)),
  );
}

function matchesAbsorbedSource(mod: Mod, source: MergedModSource): boolean {
  if (mod.enabled || mod.fileName !== source.fileName) return false;

  const sourceSha = source.sha256AtMergeTime?.toLowerCase();
  const modSha = mod.sha256?.toLowerCase();
  if (sourceSha && modSha) return sourceSha === modSha;

  if (typeof source.gameBananaId === 'number' && typeof mod.gameBananaId === 'number') {
    if (source.gameBananaId !== mod.gameBananaId) return false;
    if (typeof source.gameBananaFileId === 'number' && typeof mod.gameBananaFileId === 'number') {
      return source.gameBananaFileId === mod.gameBananaFileId;
    }
  }

  // A disabled VPK at the exact recorded source filename is physically the
  // absorbed source (filenames are unique within a folder), and enabled mods
  // were already excluded above, so a recycled pakNN slot can't reach here.
  // Fold it in unless sha or gbId positively proved a different mod; a
  // hand-placed VPK with no recorded identity must not leave a stray card.
  return true;
}
