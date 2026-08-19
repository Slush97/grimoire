import type { RestoreLocalVariantGroupReplacementArgs } from '../types/electron';

type GroupedUpdateSource = {
  id?: string;
  localGroupId?: string;
};

type InstalledReplacement = GroupedUpdateSource & {
  id: string;
  gameBananaId?: number;
  gameBananaFileId?: number;
};

/**
 * Build the narrow main-process request used during an update. Every replaced
 * VPK must have belonged to the same explicit local group; a mixed grouped /
 * ungrouped provenance set is deliberately left alone rather than sweeping an
 * unrelated GameBanana sibling into the group.
 */
export function planLocalVariantUpdateRestore(
  replaced: readonly GroupedUpdateSource[],
  installedAfterDownload: readonly InstalledReplacement[],
  cleanupIds: readonly string[],
  expectedGameBananaId: number,
  replacementGameBananaFileId: number,
): RestoreLocalVariantGroupReplacementArgs | null {
  if (replaced.length === 0) return null;
  const groupIds = new Set(replaced.map((source) => source.localGroupId?.trim() ?? ''));
  if (groupIds.size !== 1) return null;
  const groupId = [...groupIds][0];
  if (!groupId) return null;

  const cleanup = new Set(cleanupIds);
  const source = installedAfterDownload.find(
    (mod) => cleanup.has(mod.id) && mod.localGroupId === groupId,
  );
  if (!source) return null;
  if (typeof source.gameBananaFileId !== 'number') return null;

  const replacementModIds = installedAfterDownload
    .filter(
      (mod) =>
        !cleanup.has(mod.id) &&
        mod.gameBananaId === expectedGameBananaId &&
        mod.gameBananaFileId === replacementGameBananaFileId,
    )
    .map((mod) => mod.id);
  if (replacementModIds.length === 0) return null;

  return {
    sourceModId: source.id,
    sourceGameBananaFileId: source.gameBananaFileId,
    replacementModIds,
    expectedGameBananaId,
    replacementGameBananaFileId,
  };
}
