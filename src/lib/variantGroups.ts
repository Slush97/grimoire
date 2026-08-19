import type { Mod } from '../types/mod';

/**
 * The single grouping authority shared by the Installed page and the Locker:
 * which installed files are variants of the same mod?
 *
 * Two files group together when they answer this with the same string.
 * An explicit local group is authoritative, including for a locally imported
 * VPK whose embedded metadata identifies a GameBanana submission. Without an
 * explicit group, GameBanana mods group by submission id (several files from
 * one mod page). Anything else returns null and stays a single card.
 *
 * The `gb:` / `local:` prefixes keep the two namespaces from ever colliding.
 */
export function variantGroupKey(mod: Mod): string | null {
  if (mod.localGroupId) {
    return `local:${mod.localGroupId}`;
  }
  if (typeof mod.gameBananaId === 'number' && mod.gameBananaId > 0) {
    return `gb:${mod.gameBananaId}`;
  }
  return null;
}
