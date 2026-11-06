import type { Mod } from '../types/mod';
import { getEffectiveGlobalType } from './lockerUtils';

/** Game models of the props a mod can reskin. Mirrors the entries in electron soulContainerModels. */
export const SOUL_CONTAINER_MODEL = 'models/props_gameplay/soul_container/soul_container.vmdl_c';
export const SPIRIT_URN_MODEL = 'models/props_gameplay/idol_urn/idol_urn.vmdl_c';
export const SINNERS_SACRIFICE_MODEL = 'models/props_gameplay/sinners_sacrifice_vault/sinners_sacrifice.vmdl_c';

/** Last segment of a GameBanana category path, normalized ("Other > Sinner’s Sacrifice" -> "sinner's sacrifice"). */
function categoryLeaf(name: string | undefined): string {
  return (name?.split('>').pop() ?? '').trim().toLowerCase().replace(/[‘’]/g, "'");
}

/** The prop model a mod reskins, for the 3D preview of mods that change a prop rather than a hero. */
export function installedPropModel(mod: Mod): string | null {
  const type = getEffectiveGlobalType(mod);
  if (type === 'soul-container') return SOUL_CONTAINER_MODEL;
  if (type === 'spirit-urn') return SPIRIT_URN_MODEL;
  if (categoryLeaf(mod.categoryName) === "sinner's sacrifice") return SINNERS_SACRIFICE_MODEL;
  return null;
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
