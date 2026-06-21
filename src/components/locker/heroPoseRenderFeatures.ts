// Rigged (animated, skinned) preview is gated off for now: the idle clip is WIP
// and too many heroes fall back to a default A-pose, so the static `--pose` menu
// pose stays the default. Cloth remains off in released builds.
const USE_RIGGED_PREVIEW: boolean = false;

export interface HeroPoseDevFlags {
  npr: boolean;
  nprOutline: boolean;
  source2: boolean;
  unified: boolean;
  celV2: boolean;
  cloth: boolean;
  bloom: boolean;
  nprDebug: boolean;
  matDebug: boolean;
}

export interface HeroPoseRenderFeatures {
  nprPreviewEnabled: boolean;
  nprOutlineEnabled: boolean;
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

export function resolveHeroPoseRenderFeatures(
  flags: HeroPoseDevFlags,
  trippySpriteActive: boolean
): HeroPoseRenderFeatures {
  const clothPreviewEnabled = flags.cloth;
  const unifiedEnabled = flags.unified;
  const source2ShaderHintsEnabled = flags.source2 || unifiedEnabled;

  return {
    nprPreviewEnabled: flags.npr,
    nprOutlineEnabled: flags.nprOutline,
    unifiedEnabled,
    celV2Enabled: flags.celV2,
    clothPreviewEnabled,
    bloomEnabled: flags.bloom,
    riggedPreviewEnabled: USE_RIGGED_PREVIEW || clothPreviewEnabled,
    source2ShaderHintsEnabled,
    nprDebugEnabled: flags.nprDebug,
    source2SkipNpr: unifiedEnabled && !trippySpriteActive,
    nprMaterialsEnabled: (flags.npr || unifiedEnabled) && !trippySpriteActive,
  };
}
