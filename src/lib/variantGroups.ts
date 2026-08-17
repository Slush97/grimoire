import type { Mod } from '../types/mod';

/**
 * The single grouping authority shared by the Installed page and the Locker:
 * which installed files are variants of the same mod?
 *
 * Two files group together when they answer this with the same string.
 * GameBanana mods group by their submission id (several files from one mod
 * page). Locally imported mods have no submission, so they group by the opaque
 * `localGroupId` minted when a multi-VPK archive is imported. Anything else
 * (a standalone local import) returns null and stays a single card.
 *
 * The `gb:` / `local:` prefixes keep the two namespaces from ever colliding.
 */
export function variantGroupKey(mod: Mod): string | null {
  if (typeof mod.gameBananaId === 'number' && mod.gameBananaId > 0) {
    return `gb:${mod.gameBananaId}`;
  }
  if (mod.localGroupId) {
    return `local:${mod.localGroupId}`;
  }
  return null;
}
