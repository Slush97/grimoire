import type { Mod } from '../types/mod';

type ReplacementIdentity = Pick<
  Mod,
  'id' | 'gameBananaId' | 'gameBananaFileId' | 'vpkIndex' | 'sha256'
>;

const provenanceKey = (mod: ReplacementIdentity) =>
  `${mod.gameBananaId ?? 'unknown'}:${mod.gameBananaFileId ?? 'unknown'}`;

/**
 * Resolve the local ids that existed before a successful replacement install.
 *
 * Reinstalling the same GameBanana file leaves the old ids stable, so matching
 * by id prevents the fresh copy from being deleted too. Updating to a different
 * file can auto-disable the stale sibling during installation, which changes
 * its local id. In that case vpkIndex and sha256 identify the exact VPK inside
 * the old GameBanana file; provenance alone is safe only when every remaining
 * candidate from that file was targeted.
 */
export function findReplacementTargetIdsAfterInstall(
  installed: readonly ReplacementIdentity[],
  targets: readonly ReplacementIdentity[],
  destinationFileId: number,
): string[] {
  const ids = new Set<string>();
  const targetsByProvenance = new Map<string, ReplacementIdentity[]>();
  for (const target of targets) {
    const key = provenanceKey(target);
    const group = targetsByProvenance.get(key) ?? [];
    group.push(target);
    targetsByProvenance.set(key, group);
  }

  for (const target of targets) {
    if (target.gameBananaFileId === destinationFileId) {
      if (installed.some((candidate) => candidate.id === target.id)) ids.add(target.id);
      continue;
    }

    const candidates = installed.filter(
      (candidate) =>
        candidate.gameBananaId === target.gameBananaId &&
        candidate.gameBananaFileId === target.gameBananaFileId,
    );
    const exactId = candidates.find((candidate) => candidate.id === target.id);
    if (exactId) {
      ids.add(exactId.id);
      continue;
    }

    const indexed = typeof target.vpkIndex === 'number'
      ? candidates.filter((candidate) => candidate.vpkIndex === target.vpkIndex)
      : [];
    if (indexed.length === 1) {
      ids.add(indexed[0].id);
      continue;
    }

    const hashed = target.sha256
      ? candidates.filter((candidate) => candidate.sha256 === target.sha256)
      : [];
    if (hashed.length === 1) {
      ids.add(hashed[0].id);
      continue;
    }

    // Legacy installs may have neither vpkIndex nor sha256. Preserve them when
    // only part of their provenance group was selected; deleting the wrong VPK
    // is worse than leaving a stale copy for the user to resolve manually.
    const targetGroup = targetsByProvenance.get(provenanceKey(target)) ?? [];
    if (candidates.length === targetGroup.length) {
      for (const candidate of candidates) ids.add(candidate.id);
    }
  }

  return [...ids];
}
