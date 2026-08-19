import type { Mod } from '../types/mod';
import { variantGroupKey } from './variantGroups';

export type LocalVariantSelectionIneligibility =
  | 'minimum'
  | 'merged'
  | 'gamebanana'
  | 'placement'
  | 'classification';

/** Mirrors classificationKey in electron/main/services/localVariantGroup.ts:
 * the main-process planner refuses two definite but different Locker axes,
 * while an unclassified VPK inherits the established group profile. */
function classificationKey(mod: Mod): string | undefined {
  if (mod.globalType) return `global:${mod.globalType}`;
  const hero = mod.lockerHero?.trim();
  return hero ? `hero:${hero.toLocaleLowerCase()}` : undefined;
}

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
  // Mirror the two rules resolveLocalVariantGroupProfile enforces in main, so
  // the Group button disables with a hint instead of surfacing a raw IPC error.
  if (mods.some((mod) => !!mod.priorityMod !== !!mods[0].priorityMod)) {
    return { eligible: false, reason: 'placement' };
  }
  const classifications = new Set(
    mods.map(classificationKey).filter((key): key is string => !!key)
  );
  if (classifications.size > 1) {
    return { eligible: false, reason: 'classification' };
  }
  return { eligible: true };
}

/**
 * Installed-page grouping key. Legacy sidecars may have stamped a local group
 * id on a merged output. Keeping that output standalone preserves access to
 * its merge-management and recovery actions instead of hiding it in the
 * variant picker.
 *
 * This deliberately excludes merged outputs from GameBanana grouping too,
 * which plain variantGroupKey (and the pre-variant Installed page) did not.
 * Inert today (merge outputs carry no submission id), but if one ever did,
 * nesting it in a GB variant card would hide the same actions.
 */
export function installedVariantGroupKey(mod: Mod): string | null {
  return mod.merged ? null : variantGroupKey(mod);
}
