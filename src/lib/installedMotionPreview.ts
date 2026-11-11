import type { Mod } from '../types/mod';
import { getEffectiveGlobalType } from './lockerUtils';
import type { MovementFxChoice } from './movementFx';

export type MotionPreviewTarget = { kind: 'movement'; choice: MovementFxChoice }
  // The content hash keeps a replaced file from showing the old clips under the same slot name.
  | { kind: 'animation'; metaKey: string; sha256: string | null };

/** What the Installed preview plays for a mod that changes motion rather than a model: a Door Stuck dash or
 *  heavy melee effect, or an animation mod's clips. */
export function installedMotionTarget(mod: Mod): MotionPreviewTarget | null {
  if (mod.movementFx) return { kind: 'movement', choice: mod.movementFx };
  if (getEffectiveGlobalType(mod) === 'animations') return { kind: 'animation', metaKey: mod.metaKey, sha256: mod.sha256 ?? null };
  return null;
}
