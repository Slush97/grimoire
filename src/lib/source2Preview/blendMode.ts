/**
 * The single source of truth for resolving a Source 2 blend mode from morphic
 * extras. Prefers the explicit `blend_mode` extras field and falls back to the
 * shader flags, so v1 GLBs (no `blend_mode`) still resolve and producer/consumer
 * cannot drift.
 *
 * This is a dependency-free leaf: it imports only the `MorphicExtras` *type*
 * (erased at compile time), so the richer modules that own draw state
 * (`source2NprMaterial.ts`, `deadlockMaterial.ts`) can import it without creating
 * an import cycle back through `drawState.ts`.
 */
import type { MorphicExtras } from '../source2NprMaterial';
import type { Source2BlendMode } from './types';

function intFlag(morphic: MorphicExtras, name: string): boolean {
  const v = morphic.ints?.[name];
  const n = Array.isArray(v) ? (v[0] ?? 0) : (v ?? 0);
  return n !== 0;
}

export function resolveBlendMode(morphic: MorphicExtras): Source2BlendMode {
  if (morphic.blend_mode) return morphic.blend_mode;
  if (intFlag(morphic, 'F_ADDITIVE_BLEND')) return 'additive';
  if (intFlag(morphic, 'F_TRANSLUCENT') || intFlag(morphic, 'F_ADVANCED_TRANSLUCENCY')) {
    return 'blend_zwrite';
  }
  return 'opaque';
}
