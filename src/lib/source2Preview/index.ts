/**
 * Source 2 preview renderer core: the always-on draw-state pass.
 *
 * Barrel for the small renderer core extracted from `HeroPoseViewer.tsx`. The
 * host mounts `compileSource2DrawState` unconditionally so any morphic material
 * gets correct Source 2 blend / depth / cull / render-order, independent of the
 * NPR / unified / bloom dev flags.
 */
export {
  resolveBlendMode,
  resolveSource2DrawState,
  applySource2DrawState,
} from './drawState';
export { compileSource2DrawState } from './compileScene';
export { summarizeSource2Scene, type Source2SceneSummary } from './debugSummary';
export {
  ADDITIVE_OVERLAY_RENDER_ORDER,
  TRANSLUCENT_OVERLAY_RENDER_ORDER,
  type Source2BlendMode,
  type Source2DrawStatePlan,
  type Source2DrawStateApplication,
  type Source2CompileStats,
  type Source2CompileResult,
} from './types';
