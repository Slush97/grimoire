/**
 * Source 2 draw-state mapping: morphic extras -> Three.js render state.
 *
 * `resolveSource2DrawState` is pure (no material mutation), so the rules are
 * unit-testable without a GL context. `applySource2DrawState` writes the
 * resolved state onto a mesh+material and returns a restore closure.
 *
 * This is the single source of truth for the additive / translucent / backface
 * draw-state subset. It deliberately does NOT touch opacity scaling, alpha masks,
 * emissive/self-illum color, glass transmission, sheen, or jitter displacement:
 * those are richer material decisions owned by the NPR/unified material builders
 * (`source2NprMaterial.ts` / `deadlockMaterial.ts`). Here we only set blend,
 * depth, cull, tone-mapping-for-unlit, and the mesh-level render order.
 */
import * as THREE from 'three';
import {
  type MorphicExtras,
  flag,
  getMorphic,
  isTrueGlassMaterial,
} from '../source2NprMaterial';
import {
  ADDITIVE_OVERLAY_RENDER_ORDER,
  TRANSLUCENT_OVERLAY_RENDER_ORDER,
  type Source2DrawStateApplication,
  type Source2DrawStatePlan,
} from './types';
import { resolveBlendMode } from './blendMode';

// Re-export so consumers and tests can keep importing it from the draw-state
// module; the implementation lives in the cycle-free leaf `./blendMode`.
export { resolveBlendMode };

/**
 * Pure mapping from morphic extras to the target Three.js draw state. `base` lets
 * the glass discriminator inspect an existing physical material (glass renders
 * through transmission, never alpha blending, so it is excluded from the overlay
 * rules). Opaque, non-backface, non-unlit materials map to `isOverlay: false`
 * with render state left at the GLTFLoader defaults.
 */
export function resolveSource2DrawState(
  morphic: MorphicExtras,
  base?: THREE.Material
): Source2DrawStatePlan {
  const glass = isTrueGlassMaterial(morphic, base);
  const blendMode = resolveBlendMode(morphic);
  const additive = !glass && blendMode === 'additive';
  const translucent = !glass && (blendMode === 'blend' || blendMode === 'blend_zwrite');
  const backfaces = flag(morphic, 'F_RENDER_BACKFACES');
  const unlit = flag(morphic, 'F_UNLIT');

  // Opaque-body defaults: leave the material exactly as GLTFLoader produced it.
  let transparent = false;
  let blending: THREE.Blending = THREE.NormalBlending;
  let depthTest = true;
  let depthWrite = true;
  let renderOrder = 0;

  if (additive) {
    // Additive self-illum overlay: composite over the opaque body, never occlude.
    transparent = true;
    blending = THREE.AdditiveBlending;
    depthTest = true; // depth-tested against the body...
    depthWrite = false; // ...but never writes depth (no self-occlusion / z-fight).
    renderOrder = ADDITIVE_OVERLAY_RENDER_ORDER;
  } else if (translucent) {
    transparent = true;
    // blend_zwrite keeps depthWrite ON (the goo occludes its own interior gear);
    // plain blend turns it off (standard back-to-front transparency).
    depthWrite = blendMode === 'blend_zwrite';
    renderOrder = TRANSLUCENT_OVERLAY_RENDER_ORDER;
  }

  return {
    blendMode,
    glass,
    additive,
    translucent,
    backfaces,
    unlit,
    isOverlay: additive || translucent,
    transparent,
    blending,
    depthTest,
    depthWrite,
    side: backfaces ? THREE.DoubleSide : null,
    toneMapped: unlit ? false : null,
    renderOrder,
    polygonOffset: false,
    polygonOffsetFactor: 0,
    polygonOffsetUnits: 0,
  };
}

/**
 * Apply the resolved Source 2 draw state to one mesh+material, returning a
 * restore closure (or null when the material is plain opaque and nothing was
 * touched). Returns the plan it used so callers can tally stats. `renderOrder` is
 * raised at the mesh level (a Material cannot set draw order); the strongest
 * overlay order among a multi-material mesh wins. Returns `null` (no application)
 * only when the material carries no morphic extras at all.
 */
export function applySource2DrawState(
  mesh: THREE.Mesh,
  material: THREE.Material,
  morphic?: MorphicExtras
): Source2DrawStateApplication | null {
  const extras = morphic ?? getMorphic(material);
  if (!extras) return null;
  const plan = resolveSource2DrawState(extras, material);

  // Plain opaque material with no backface/unlit override: leave it untouched.
  if (!plan.isOverlay && !plan.backfaces && plan.toneMapped === null) {
    return { plan, restore: null };
  }

  const before = {
    transparent: material.transparent,
    blending: material.blending,
    depthTest: material.depthTest,
    depthWrite: material.depthWrite,
    side: material.side,
    toneMapped: material.toneMapped,
    polygonOffset: material.polygonOffset,
    polygonOffsetFactor: material.polygonOffsetFactor,
    polygonOffsetUnits: material.polygonOffsetUnits,
    renderOrder: mesh.renderOrder,
  };

  if (plan.side !== null) material.side = plan.side;
  if (plan.toneMapped !== null) material.toneMapped = plan.toneMapped;

  if (plan.additive) {
    material.transparent = true;
    material.blending = plan.blending;
    material.depthTest = plan.depthTest;
    material.depthWrite = plan.depthWrite;
  } else if (plan.translucent) {
    material.transparent = true;
    material.depthWrite = plan.depthWrite;
  }

  if (plan.polygonOffset) {
    material.polygonOffset = true;
    material.polygonOffsetFactor = plan.polygonOffsetFactor;
    material.polygonOffsetUnits = plan.polygonOffsetUnits;
  }

  if (plan.renderOrder > mesh.renderOrder) {
    mesh.renderOrder = plan.renderOrder;
  }

  material.needsUpdate = true;

  const restore = () => {
    material.transparent = before.transparent;
    material.blending = before.blending;
    material.depthTest = before.depthTest;
    material.depthWrite = before.depthWrite;
    material.side = before.side;
    material.toneMapped = before.toneMapped;
    material.polygonOffset = before.polygonOffset;
    material.polygonOffsetFactor = before.polygonOffsetFactor;
    material.polygonOffsetUnits = before.polygonOffsetUnits;
    mesh.renderOrder = before.renderOrder;
    material.needsUpdate = true;
  };

  return { plan, restore };
}
