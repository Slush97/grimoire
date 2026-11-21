import type { Mod } from '../types/mod';
import { generalPropModel } from './categoryPaths';
import { getEffectiveGlobalType } from './lockerUtils';

/** The prop model a mod's own files reskin, for the 3D preview of mods that change a prop rather than a hero.
 *  Prop types only come from the VPK's paths, never from its category. */
export function installedPropModel(mod: Mod): string | null {
  const type = getEffectiveGlobalType(mod);
  return (type && generalPropModel(type)) || null;
}

export type PropPreviewTarget = { metaKey: string; cacheKey: string; entry: string };

/**
 * What the preview exports for a prop mod. The cache is keyed by content (sha256), never the
 * pakNN slot name a toggle reuses, and kept apart from the Locker grid's static export.
 */
export function installedPropTarget(mod: Mod): PropPreviewTarget | null {
  const entry = installedPropModel(mod);
  if (!entry || !mod.sha256) return null;
  return { metaKey: mod.metaKey, cacheKey: `${mod.sha256}-animated`, entry };
}
