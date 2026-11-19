import type { Mod } from '../types/mod';
import { variantGroupKey } from './variantGroups';

export type LocalVariantSelectionIneligibility =
  | 'minimum'
  | 'merged'
  | 'gamebanana'
  | 'local-required'
  | 'placement';

export type LocalVariantSelectionEligibility =
  | { eligible: true }
  | { eligible: false; reason: LocalVariantSelectionIneligibility };

/** Import origin is independent of embedded or associated GameBanana identity. */
export function isLocalMod(mod: Pick<Mod, 'gameBananaId' | 'localGroupId' | 'localImport'>): boolean {
  return mod.localImport ?? (!!mod.localGroupId || !(typeof mod.gameBananaId === 'number' && mod.gameBananaId > 0));
}

/** Merged outputs keep their own recovery and source-management controls. */
export function canGroupMod(mod: Pick<Mod, 'merged'>): boolean {
  return !mod.merged;
}

/** Custom attachments are independent files, even if their imprint names the parent. */
export function isAttachedLocalVariant<T extends Pick<Mod, 'localImport' | 'localGroupId'>>(mod: T, mods: readonly T[]): boolean {
  return mod.localImport === true && !!mod.localGroupId
    && mods.some(peer => peer.localGroupId === mod.localGroupId && peer.localImport === false);
}

export function canJoinLocalVariantGroup(mod: Pick<Mod, 'gameBananaId' | 'localGroupId' | 'localImport' | 'merged'>): boolean {
  return canGroupMod(mod) && isLocalMod(mod);
}

type VariantOrigin = Pick<Mod, 'gameBananaId' | 'localGroupId' | 'localImport' | 'sourceSection'>;

/** A downloaded submission can own local attachments, never another downloaded submission. */
export function localVariantOriginIneligibility(mods: readonly VariantOrigin[]): 'gamebanana' | 'local-required' | null {
  const downloaded = mods.filter(mod => !isLocalMod(mod));
  const submissions = new Set(downloaded.map(mod => `${mod.sourceSection ?? 'Mod'}:${mod.gameBananaId}`));
  if (submissions.size > 1) return 'gamebanana';
  if (downloaded.length > 0 && downloaded.length === mods.length) return 'local-required';
  return null;
}

/** Pure policy used by the Installed multi-select action and its disabled hint. */
export function localVariantSelectionEligibility(
  mods: readonly Mod[]
): LocalVariantSelectionEligibility {
  if (mods.length < 2) return { eligible: false, reason: 'minimum' };
  // Merged outputs keep their own source-management and recovery actions.
  if (mods.some((mod) => !!mod.merged)) return { eligible: false, reason: 'merged' };
  // Mirror the placement rule resolveLocalVariantGroupProfile enforces in main, so
  // the Group button disables with a hint instead of surfacing a raw IPC error.
  if (mods.some((mod) => !!mod.priorityMod !== !!mods[0].priorityMod)) {
    return { eligible: false, reason: 'placement' };
  }
  const originReason = localVariantOriginIneligibility(mods);
  if (originReason) return { eligible: false, reason: originReason };
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
