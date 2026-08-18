import type { Mod } from '../types/mod';
import { variantGroupKey } from './variantGroups';

export type LocalVariantSelectionIneligibility = 'minimum' | 'merged' | 'gamebanana';

export type LocalVariantSelectionEligibility =
  | { eligible: true }
  | { eligible: false; reason: LocalVariantSelectionIneligibility };

/**
 * Whether a mod may become a member of a user-managed local variant group.
 * Merged outputs must remain standalone because their card owns the contents,
 * unmerge, and share-code recovery actions. A standalone GameBanana file has a
 * server-owned grouping identity, but an existing explicit local group remains
 * user-managed if a re-import later discovers GameBanana provenance.
 */
export function canJoinLocalVariantGroup(mod: Mod): boolean {
  const hasGameBananaIdentity =
    typeof mod.gameBananaId === 'number' && mod.gameBananaId > 0;
  return !mod.merged && (!!mod.localGroupId || !hasGameBananaIdentity);
}

/** Pure policy used by the Installed multi-select action and its disabled hint. */
export function localVariantSelectionEligibility(
  mods: readonly Mod[]
): LocalVariantSelectionEligibility {
  if (mods.length < 2) return { eligible: false, reason: 'minimum' };
  // Report this before provenance so a mixed selection containing a merged
  // output tells the user how to recover it (unmerge), not merely that it is
  // outside the local-only set.
  if (mods.some((mod) => !!mod.merged)) return { eligible: false, reason: 'merged' };
  if (mods.some((mod) => !canJoinLocalVariantGroup(mod))) {
    return { eligible: false, reason: 'gamebanana' };
  }
  return { eligible: true };
}

/**
 * Installed-page grouping key. Legacy sidecars may have stamped a local group
 * id on a merged output. Keeping that output standalone preserves access to
 * its merge-management and recovery actions instead of hiding it in the
 * variant picker.
 */
export function installedVariantGroupKey(mod: Mod): string | null {
  return mod.merged ? null : variantGroupKey(mod);
}
