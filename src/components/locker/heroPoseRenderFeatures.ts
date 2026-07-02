// Rigged (animated, skinned) preview is gated off for now: the idle clip is WIP
// and too many heroes fall back to a default A-pose, so the static `--pose` menu
// pose stays the default. Cloth remains off in released builds.
const USE_RIGGED_PREVIEW: boolean = false;

export interface HeroPoseDevFlags {
  unified: boolean;
  celV2: boolean;
  cloth: boolean;
  bloom: boolean;
  nprDebug: boolean;
  matDebug: boolean;
}

export interface HeroPoseRenderFeatures {
  unifiedEnabled: boolean;
  celV2Enabled: boolean;
  clothPreviewEnabled: boolean;
  bloomEnabled: boolean;
  riggedPreviewEnabled: boolean;
  source2ShaderHintsEnabled: boolean;
  nprDebugEnabled: boolean;
  source2SkipNpr: boolean;
  nprMaterialsEnabled: boolean;
}

// `unified` is the single material-styling driver: it builds each material via
// buildDeadlockMaterial (Source 2 hints + NPR cel/rim/tint collapsed into one
// pass). The standalone Source 2 / NPR toggles were removed; both renderers now
// mount iff unified is on. Turn unified off to compare against the raw GLB.
export function resolveHeroPoseRenderFeatures(
  flags: HeroPoseDevFlags,
  trippySpriteActive: boolean
): HeroPoseRenderFeatures {
  const clothPreviewEnabled = flags.cloth;
  const unifiedEnabled = flags.unified;

  return {
    unifiedEnabled,
    celV2Enabled: flags.celV2,
    clothPreviewEnabled,
    bloomEnabled: flags.bloom,
    riggedPreviewEnabled: USE_RIGGED_PREVIEW || clothPreviewEnabled,
    source2ShaderHintsEnabled: unifiedEnabled,
    nprDebugEnabled: flags.nprDebug,
    source2SkipNpr: unifiedEnabled && !trippySpriteActive,
    // Trippy/tattoo paint replaces the material maps, but unified still owns the
    // Source 2 shader path: self-illum masks, CelV2, and pulse uniforms live there.
    nprMaterialsEnabled: unifiedEnabled,
  };
}
