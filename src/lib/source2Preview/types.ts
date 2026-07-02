/**
 * Shared types + constants for the Source 2 preview renderer core
 * (`src/lib/source2Preview/`).
 *
 * This module is the always-on counterpart to the flag-gated NPR/unified
 * material passes in `source2NprMaterial.ts` / `deadlockMaterial.ts`. It owns the
 * Source 2 *draw state* (blend / depth / cull / render-order) so that any
 * material carrying `userData.morphic` composites correctly even when every dev
 * flag (NPR, unified, source2 hints, bloom) is off. See
 * `docs/3d-preview-fidelity-plan.md` and the vpkmerge VRF renderer gap report.
 */
import type * as THREE from 'three';
import type { MorphicExtras } from '../source2NprMaterial';

/** The Source 2 blend-mode union, mirrored from the morphic extras wire shape. */
export type Source2BlendMode = NonNullable<MorphicExtras['blend_mode']>;

/**
 * Mesh `renderOrder` for additive self-illum overlays (Inferno arm/head glow,
 * Hornet/Vindicta `ghost_glow`): drawn last, after the opaque body AND after
 * translucent overlays, so additive color always composites on top. Additive is
 * order-independent in color, but a stable late order keeps it visually behind
 * nothing and avoids surprises when several overlays stack.
 */
export const ADDITIVE_OVERLAY_RENDER_ORDER = 10;

/**
 * Mesh `renderOrder` for translucent (`blend` / `blend_zwrite`) overlays: after
 * the opaque pass, before additive overlays.
 */
export const TRANSLUCENT_OVERLAY_RENDER_ORDER = 8;

/**
 * The target Three.js draw state resolved from a material's morphic extras. Pure
 * data: `resolveSource2DrawState` produces it without touching any material, so
 * it is trivially unit-testable. `side` / `toneMapped` are `null` when the rule
 * does not dictate them (leave whatever GLTFLoader produced).
 */
export interface Source2DrawStatePlan {
  blendMode: Source2BlendMode;
  glass: boolean;
  additive: boolean;
  translucent: boolean;
  backfaces: boolean;
  unlit: boolean;
  /** Whether this material is an overlay that must be applied (vs. left opaque). */
  isOverlay: boolean;
  transparent: boolean;
  blending: THREE.Blending;
  depthTest: boolean;
  depthWrite: boolean;
  /** `THREE.Side` to force, or null to leave the existing side. */
  side: THREE.Side | null;
  /** `false` to disable tone mapping (unlit), or null to leave it. */
  toneMapped: boolean | null;
  /** Mesh-level draw order; 0 for opaque (the piece a Material cannot set). */
  renderOrder: number;
  polygonOffset: boolean;
  polygonOffsetFactor: number;
  polygonOffsetUnits: number;
}

/** Result of applying draw state to one mesh+material: the plan used and an
 * optional restore (null when the material was opaque and left untouched). */
export interface Source2DrawStateApplication {
  plan: Source2DrawStatePlan;
  restore: (() => void) | null;
}

/** Per-scene compilation counts (a smoke summary, surfaced to the debug panel). */
export interface Source2CompileStats {
  meshes: number;
  morphicMaterials: number;
  additive: number;
  translucent: number;
  backfaces: number;
  unlit: number;
  glass: number;
}

/** Handle returned by `compileSource2DrawState`: restore reverts every mutation. */
export interface Source2CompileResult {
  restore: () => void;
  stats: Source2CompileStats;
}
