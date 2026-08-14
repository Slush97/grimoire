import type { Mod } from '../types/mod';

type ReplacementIdentity = Pick<Mod, 'id' | 'gameBananaId' | 'gameBananaFileId'>;

/**
 * Resolve the local ids that existed before a successful replacement install.
 *
 * Reinstalling the same GameBanana file leaves the old ids stable, so matching
 * by id prevents the fresh copy from being deleted too. Updating to a different
 * file can auto-disable the stale sibling during installation, which changes
 * its local id; in that case its old GameBanana file id is the stable identity.
 */
export function findReplacementTargetIdsAfterInstall(
  installed: readonly ReplacementIdentity[],
  targets: readonly ReplacementIdentity[],
  destinationFileId: number,
): string[] {
  const ids = new Set<string>();

  for (const target of targets) {
    if (target.gameBananaFileId === destinationFileId) {
      if (installed.some((candidate) => candidate.id === target.id)) ids.add(target.id);
      continue;
    }

    for (const candidate of installed) {
      if (
        candidate.gameBananaId === target.gameBananaId &&
        candidate.gameBananaFileId === target.gameBananaFileId
      ) {
        ids.add(candidate.id);
      }
    }
  }

  return [...ids];
}
