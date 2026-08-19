import type { Mod } from '../types/mod';

type ProfileGroupingMod = Pick<Mod, 'gameBananaId' | 'localGroupId'>;

/**
 * Display identity for one saved profile row resolved against this install.
 * Explicit local grouping is authoritative even when an imported/imprinted
 * member also carries GameBanana provenance, matching variantGroupKey.
 */
export function profileModDisplayGroupKey(
  profileGameBananaId: number | undefined,
  installedMod: ProfileGroupingMod | undefined,
  sha256: string | undefined,
  fileName: string,
): string {
  const localGroupId = installedMod?.localGroupId?.trim();
  if (localGroupId) return `localgroup:${localGroupId}`;

  const gameBananaId = profileGameBananaId ?? installedMod?.gameBananaId;
  if (typeof gameBananaId === 'number' && gameBananaId > 0) {
    return `gamebanana:${gameBananaId}`;
  }
  return sha256 ? `sha:${sha256}` : `file:${fileName}`;
}
