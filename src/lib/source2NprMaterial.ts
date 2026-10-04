import * as THREE from 'three';
import CustomShaderMaterial, { type CSMPatchMap } from 'three-custom-shader-material/vanilla';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
// Shared blend-mode resolver (the cycle-free leaf of the source2Preview core).
import { resolveBlendMode } from './source2Preview/blendMode';
import { decodedAlbedoAverage, source2TintPlan, SOURCE2_SATURATION_WEIGHTS } from './source2ColorCorrection';

/**
 * Source 2 NPR (cel / rim / tint) restyle for the Locker hero preview.
 *
 * React-free. Owns reading the `morphic` extras vpkmerge emits, resolving the
 * Source 2 preview texture indices, and building the CSM that layers the
 * Deadlock toon look ON TOP of the existing PMREM IBL + ACES tonemap output (it
 * is additive on the lit result, never a replacement pass).
 *
 * Data contract (mirror of vpkmerge morphic/src/model/glb.rs `morphic_extras`):
 *   material.userData.morphic = {
 *     schema_version: number,         // v2+; absent => v1 (every v2 field optional)
 *     shader:   string,
 *     ints:     { [name]: number },   // F_* feature flags + int params (scalars)
 *     floats:   { [name]: number },   // scalars
 *     vectors:  { [name]: number[] }, // always [x, y, z, w]
 *     textures: { [slot]: number },   // glTF TEXTURE INDEX (not a Texture)
 *     texture_slots:          { [slot]: string },             // v2: slot -> .vtex path
 *     dynamic_params:         { [name]: MorphicDynamicExpr },  // v2: per-frame exprs
 *     dynamic_texture_params: { [slot]: MorphicDynamicExpr },  // v2
 *     render_attributes_used: string[],                        // v2
 *   }
 * three's GLTFLoader copies material.extras into material.userData verbatim, so
 * the param tables arrive for free; only the texture INDICES need resolving into
 * THREE.Texture (resolveMorphicTextures, run at load time while the parser lives).
 */

/**
 * Preview texture slots vpkmerge emits (mirror of SOURCE2_PREVIEW_TEXTURE_SLOTS
 * in vpkmerge morphic/src/model/glb.rs). These are not ordinary glTF PBR
 * bindings; they are resolved into linear data textures for NPR masks, shader
 * approximation, and debug scans.
 *   g_tTintMaskRimLightMask  R = tint enable, G = rim-light constant
 *   g_tNprOutlineMask        where outlines appear
 *   g_tNprTransmissiveColor  NPR transmissive color (deferred in v1)
 */
export const NPR_TEXTURE_SLOTS = [
  'g_tTintMaskRimLightMask',
  'g_tNprOutlineMask',
  'g_tNprTransmissiveColor',
] as const;

export const SOURCE2_PREVIEW_TEXTURE_SLOTS = [
  ...NPR_TEXTURE_SLOTS,
  'g_tGlass',
  'g_tAltTranslucency',
  'g_tJitterMask',
  'g_tSelfIllumMask',
  'g_tSheen',
  // Schema v2 data slots (mirror of vpkmerge glb.rs): genuinely-missing data
  // textures the shader samples but no PBR binding embeds. Keep in exact sync
  // with the Rust list or these textures silently drop (resolve allowlist below).
  'g_tDetail',
  'g_tMasks1',
  'g_tTintMask',
  'g_tPacked1',
] as const;

/**
 * Shape of `userData.morphic`. ints/floats are scalars in the wire format
 * (vpkmerge emits BTreeMap<String, i64/f32>), but the `scalar()` reader also
 * tolerates a single-element array defensively. vectors are always [x, y, z, w].
 * textures[slot] is a glTF texture index; resolvedTextures is filled in by
 * resolveMorphicTextures with per-material Texture clones.
 */
/**
 * A decompiled dynamic material expression (v2 extras). `decompiled === false`
 * means the engine evaluates per-frame bytecode a single static value cannot
 * represent: `source` is empty and `error` names the decompile failure (the
 * blob is still identified by `hash`). A consumer must not trust a static param
 * of the same name when one of these exists.
 */
export interface MorphicDynamicExpr {
  source: string;
  decompiled: boolean;
  byte_len: number;
  attributes: string[];
  hash: string;
  error?: string;
}

export interface MorphicExtras {
  /** Source 2 extras schema version; absent on pre-v2 (v1) GLBs. */
  schema_version?: number;
  shader: string;
  blend_mode?: 'opaque' | 'blend_zwrite' | 'blend' | 'additive';
  self_illum_valid?: boolean;
  ints?: Record<string, number | number[]>;
  floats?: Record<string, number | number[]>;
  vectors?: Record<string, number[]>;
  textures?: Record<string, number>;
  /** v2: full slot -> .vtex path identity for every bound slot (strings, no bytes). */
  texture_slots?: Record<string, string>;
  /** v2: per-frame expressions overriding a static param of the same name. */
  dynamic_params?: Record<string, MorphicDynamicExpr>;
  /** v2: per-frame expressions on a texture slot. */
  dynamic_texture_params?: Record<string, MorphicDynamicExpr>;
  /** v2: entity/scene attributes the expressions read. */
  render_attributes_used?: string[];
  resolvedTextures?: Record<string, THREE.Texture>;
  /** Optional future exporter metadata: linear VTEX header reflectivity by slot. */
  texture_reflectivity?: Record<string, number[]>;
  /** Preview-only decoded top-mip estimate for older exports without that header. */
  preview_albedo_average?: number[];
}

/**
 * App-constant cel / rim coefficients. These correspond to engine __Attribute__
 * vars that are NOT present in any shipped material (so NOT in morphic); they are
 * hand-tuned to match in-game screenshots and exposed as uniforms.
 */
export interface NprTuning {
  bands: number;
  stepSharpness: number;
  wrap: number;
  rimStrength: number;
  rimPower: number;
  rimColor: THREE.Color;
  nprStrength: number;
  /** aoMap intensity multiplier, so the cel posterize does not wash cavities out. */
  aoStrength: number;
  transStrength: number;
  transPower: number;
  /**
   * Hue-preserving cap on the self-illum additive's peak channel. A high authored
   * self-illum scale (familiar eyes cyan at 2.6, inferno at 10) pushes a saturated
   * tint into HDR where the downstream ACES tonemap desaturates it to white (the
   * in-game glow leans on HDR + bloom the preview lacks). Scaling the additive down
   * to this peak keeps the tint's HUE readable. Calibration knob: lower = more
   * saturated but dimmer glow, higher = brighter but whiter.
   */
  selfIllumCap: number;
  /**
   * Chroma boost on the self-illum tint. A pale authored tint (familiar eyes cyan
   * [0.27, 0.88, 1] is luma-heavy) ACES-washes to white in the no-bloom preview even
   * when capped, because its red channel stays high. Pushing saturation > 1 drops the
   * off-hue channel so the glow reads as its color; a neutral/white tint is unchanged.
   * Calibration knob: 1.0 = authored chroma, higher = punchier color.
   */
  selfIllumSat: number;
  /** Lower edge for optional self-illum mask shaping on noisy real masks. */
  selfIllumMaskLow: number;
  /** Upper edge for optional self-illum mask shaping on noisy real masks. */
  selfIllumMaskHigh: number;
  /** Source 2 authored jitter amplitudes are normalized controls, not Three model units. */
  jitterStrength: number;
  keyDir: THREE.Vector3;
}

export interface NprWrapResult {
  /**
   * The CSM. NOTE: this is NOT instanceof THREE.MeshPhysicalMaterial (CSM extends
   * THREE.Material). It carries the base's copied `isMeshStandardMaterial` /
   * `isMeshPhysicalMaterial` flags and proxies `type`, which is what the renderer
   * keys IBL/PMREM on; skinning is mesh-driven (SkinnedMesh.isSkinnedMesh), not
   * material-driven. Do NOT feed this to code that does `instanceof MeshPhysicalMaterial`.
   */
  material: THREE.Material;
  /** Per-material uniforms; mutate uTintColor.value for live recolor without a rebuild. */
  uniforms: Record<string, THREE.IUniform>;
  /** Mask clones THIS wrap created and is responsible for disposing on teardown. */
  ownedTextures: THREE.Texture[];
}

export interface NprSceneSummary {
  meshes: number;
  materials: number;
  morphicMaterials: number;
  nprMaterials: number;
  glassMaterials: number;
  translucentMaterials: number;
  additiveMaterials: number;
  selfIllumMaterials: number;
  jitterMaterials: number;
  sheenMaterials: number;
  unlitMaterials: number;
  backfaceMaterials: number;
  tintRimMasks: number;
  outlineTintMaterials: number;
  glassMasks: number;
  altTranslucencyMasks: number;
  jitterMasks: number;
  selfIllumMasks: number;
  resolvedTextureSlots: Record<string, number>;
  shaders: Record<string, number>;
}

export interface Source2MaterialHintStats {
  materials: number;
  glass: number;
  translucent: number;
  additive: number;
  selfIllum: number;
  unlit: number;
  sheen: number;
  backfaces: number;
  alphaMaps: number;
  emissiveMaps: number;
  jitterDisplacements: number;
}

export interface Source2MaterialHintsResult {
  restore: () => void;
  stats: Source2MaterialHintStats;
}

const DYNAMIC_ALPHA_PARAMS = [
  'g_flOpacityScale1',
  'g_flOpacityScale',
  'TextureOpacity1',
] as const;

export function isTrueGlassMaterial(morphic: MorphicExtras, base?: THREE.Material): boolean {
  const shader = morphic.shader.toLowerCase();
  const physical = base as THREE.MeshPhysicalMaterial | undefined;
  if (hasExplicitAlphaOrAdditiveState(morphic)) return false;
  return (
    flag(morphic, 'F_GLASS') ||
    shader.endsWith('_glass.vfx') ||
    !!(
      physical?.isMeshPhysicalMaterial &&
      ((physical.transmission ?? 0) > 0 || physical.transmissionMap)
    )
  );
}

function hasExplicitAlphaOrAdditiveState(morphic: MorphicExtras): boolean {
  return (
    morphic.blend_mode === 'blend_zwrite' ||
    morphic.blend_mode === 'blend' ||
    morphic.blend_mode === 'additive' ||
    flag(morphic, 'F_TRANSLUCENT') ||
    flag(morphic, 'F_ADVANCED_TRANSLUCENCY') ||
    flag(morphic, 'F_ADDITIVE_BLEND')
  );
}

function hasDynamicTextureOverride(morphic: MorphicExtras, slot: string): boolean {
  return !!morphic.dynamic_texture_params?.[slot];
}

export function hasDynamicAlphaOverride(morphic: MorphicExtras): boolean {
  if (hasDynamicTextureOverride(morphic, 'g_tAltTranslucency')) return true;
  if (hasDynamicTextureOverride(morphic, 'g_tGlass')) return true;
  return DYNAMIC_ALPHA_PARAMS.some((name) => !!morphic.dynamic_params?.[name]);
}

export function glassTransmissionTexture(morphic: MorphicExtras): THREE.Texture | null {
  if (hasDynamicTextureOverride(morphic, 'g_tGlass')) return null;
  const glass = morphic.resolvedTextures?.g_tGlass;
  return isMeaningfulMask(glass) ? glass : null;
}

/** Map authored PBR glass to Three's transmission approximation. In the installed
 * glass-enabled Vulkan variant the red mask removes diffuse, preserves specular,
 * and adds scene color. Cloak factors control refraction, not mask opacity. */
export function applyGlassParameters(physical: THREE.MeshPhysicalMaterial, morphic: MorphicExtras): void {
  physical.transmission = flag(morphic, 'F_GLASS') ? 1 : Math.max(physical.transmission ?? 0, 0.85);
  // Preview compatibility: Valve's glass and Three's GGX surface do not produce
  // equivalent highlights at exported roughness 1. A matched historical render
  // isolated this value as the matte-glass regression. Restore the shared gloss
  // ceiling while retaining authored masks, transmission blur and metalness.
  // Blurred volumes retain their authored surface roughness. Applying the sharp
  // glass ceiling to these materials turns the soft volume into a chrome shell.
  if (firstNumber(morphic, ['g_flCloakBlurAmount'], 0) <= 0) {
    physical.roughness = Math.min(physical.roughness, 0.18);
  }
  physical.ior = firstNumber(morphic, ['g_flIOR'], physical.ior ?? 1.5);
  const floats = morphic.floats;
  if (floats?.g_flCloakRefractAmount !== undefined && floats.g_flFullyCloakedRefractFactor1 !== undefined) {
    const refraction = firstNumber(morphic, ['g_flCloakRefractAmount'], 0)
      * firstNumber(morphic, ['g_flFullyCloakedRefractFactor1'], 0)
      * firstNumber(morphic, ['g_flCloakFactor1'], 1);
    // Three thickness zero samples scene color without the invented volume offset.
    // Nonzero Source screen-space refraction remains approximated by the exporter.
    if (refraction === 0) physical.thickness = 0;
  }
}

export function translucentAlphaTexture(morphic: MorphicExtras): THREE.Texture | null {
  if (hasDynamicTextureOverride(morphic, 'g_tAltTranslucency')) return null;
  const alt = morphic.resolvedTextures?.g_tAltTranslucency;
  if (isMeaningfulMask(alt)) return alt;
  if (hasDynamicTextureOverride(morphic, 'g_tGlass')) return null;
  const glass = morphic.resolvedTextures?.g_tGlass;
  return isMeaningfulMask(glass) ? glass : null;
}

export function staticOpacityScale(morphic: MorphicExtras, fallback: number): number | null {
  if (DYNAMIC_ALPHA_PARAMS.some((name) => !!morphic.dynamic_params?.[name])) return null;
  return firstNumber(morphic, ['g_flOpacityScale1', 'TextureOpacity1'], fallback);
}

/**
 * Deadlock-tuned starting constants. keyDir matches the scene key light at
 * [3, 5, 4] so the cel terminator reads consistently with the lit form.
 */
export const DEFAULT_NPR_TUNING: NprTuning = {
  bands: 4,
  stepSharpness: 0.08,
  wrap: 0.5,
  rimStrength: 1.5,
  rimPower: 2.0,
  rimColor: new THREE.Color(0.6, 0.75, 1.0),
  nprStrength: 1.0,
  aoStrength: 1.0,
  transStrength: 0.35,
  transPower: 2.0,
  selfIllumCap: 1.5,
  selfIllumSat: 1.6,
  selfIllumMaskLow: 0.005,
  selfIllumMaskHigh: 0.08,
  jitterStrength: 0.3,
  // Match the viewer's key light so reflected rim and cel shading agree.
  keyDir: new THREE.Vector3(-3, 4, 3).normalize(),
};

// A 1x1 white texture so the mask sampler is ALWAYS bound (never sample an
// unbound sampler). Module-shared, app-lifetime, never disposed. When
// uHasTintMask == 0 the shader ignores its value anyway.
let WHITE_FALLBACK: THREE.DataTexture | null = null;
export function whiteFallback(): THREE.DataTexture {
  if (!WHITE_FALLBACK) {
    WHITE_FALLBACK = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
    WHITE_FALLBACK.colorSpace = THREE.NoColorSpace;
    WHITE_FALLBACK.needsUpdate = true;
  }
  return WHITE_FALLBACK;
}

// Read a param that may be a scalar or a single-element array, with a default.
function scalar(v: number | number[] | undefined, d = 0): number {
  if (v === undefined) return d;
  if (Array.isArray(v)) return v[0] ?? d;
  return v;
}

export function getMorphic(mat: THREE.Material): MorphicExtras | undefined {
  return (mat.userData as { morphic?: MorphicExtras }).morphic;
}

export function flag(morphic: MorphicExtras, name: string): boolean {
  return scalar(morphic.ints?.[name], 0) !== 0;
}

export function requiresVertexColors(morphic: MorphicExtras): boolean {
  return flag(morphic, 'F_VERTEX_COLOR') || flag(morphic, 'F_PAINT_VERTEX_COLORS');
}

export function vectorColor(v: number[] | undefined, fallback: THREE.Color): THREE.Color {
  if (!v) return fallback.clone();
  return new THREE.Color(v[0] ?? fallback.r, v[1] ?? fallback.g, v[2] ?? fallback.b);
}

export function vector3(v: number[] | undefined, fallback = new THREE.Vector3(0, 0, 0)): THREE.Vector3 {
  if (!v) return fallback.clone();
  return new THREE.Vector3(v[0] ?? fallback.x, v[1] ?? fallback.y, v[2] ?? fallback.z);
}

export function transmissiveTint(morphic: MorphicExtras): THREE.Color {
  return vectorColor(
    morphic.vectors?.TextureNprTramsissiveColor1 ??
    morphic.vectors?.TextureNprTransmissiveColor1 ??
    morphic.vectors?.g_vNprTransmissiveColor1 ??
    morphic.vectors?.g_vNprTransmissiveColor,
    new THREE.Color(1, 1, 1)
  );
}

export function firstNumber(morphic: MorphicExtras, names: string[], fallback: number): number {
  for (const name of names) {
    const f = scalar(morphic.floats?.[name], Number.NaN);
    if (Number.isFinite(f)) return f;
    const v = morphic.vectors?.[name]?.[0];
    if (typeof v === 'number' && Number.isFinite(v)) return v;
  }
  return fallback;
}

function textureSize(tex: THREE.Texture | undefined): { width: number; height: number } | null {
  const image = tex?.image as { width?: number; height?: number } | undefined;
  if (!image || typeof image.width !== 'number' || typeof image.height !== 'number') return null;
  return { width: image.width, height: image.height };
}

export function isMeaningfulMask(tex: THREE.Texture | undefined): tex is THREE.Texture {
  const size = textureSize(tex);
  return !!size && size.width > 4 && size.height > 4;
}

/**
 * Resolve the preview texture INDICES on every morphic material in the scene to
 * live THREE.Texture instances, stashed on userData.morphic.resolvedTextures.
 *
 * Called from loadGltfPreview while gltf.parser is still live: getDependency is
 * the only way to turn an extras-referenced glTF texture index into a Texture.
 * getDependency returns the parser's SHARED cached texture (not a per-call clone),
 * so we clone per material before mutating sampler params and before handing it to
 * the wrap: each material then owns its own clone (no shared mutation, no
 * double-dispose). Early-returns when no material carries mask indices, so the
 * non-NPR path adds only one scene traversal.
 */
export async function resolveMorphicTextures(gltf: GLTF): Promise<void> {
  const materials = new Set<THREE.Material>();
  gltf.scene.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    const mat = mesh.material;
    if (!mat) return;
    (Array.isArray(mat) ? mat : [mat]).forEach((m) => materials.add(m));
  });

  for (const material of materials) {
    const morphic = getMorphic(material);
    if (!morphic || morphic.shader.toLowerCase() !== 'pbr.vfx') continue;
    const standard = material as THREE.MeshStandardMaterial;
    if (!standard.color) continue;
    const tint = source2TintPlan(morphic, standard.color);
    if (tint.ownsExportedFactor) standard.color.copy(tint.linearTint);
    if (!morphic.texture_reflectivity?.g_tColor && !morphic.preview_albedo_average) {
      const average = decodedAlbedoAverage(standard.map);
      if (average) morphic.preview_albedo_average = average.toArray();
    }
  }
  const targets = [...materials].filter((m) => getMorphic(m)?.textures);
  if (targets.length === 0) return;

  await Promise.all(
    targets.map(async (mat) => {
      const morphic = getMorphic(mat)!;
      const indices = morphic.textures!;
      const resolved: Record<string, THREE.Texture> = {};
      await Promise.all(
        SOURCE2_PREVIEW_TEXTURE_SLOTS.filter((slot) => typeof indices[slot] === 'number').map(async (slot) => {
          try {
            const shared = (await gltf.parser.getDependency(
              'texture',
              indices[slot]
            )) as THREE.Texture;
            // Clone so each material owns its mask: getDependency caches and may
            // hand the same Texture to several materials (shared atlases), and the
            // index may also be a normal PBR slot elsewhere. Mutating/disposing a
            // shared instance would corrupt or double-free it. The clone shares
            // the image but has its own sampler params and dispose.
            const tex = shared.clone();
            // Masks are LINEAR data (vpkmerge embeds them raw, no color-space
            // conversion). Reading them as sRGB would warp the rim/tint constants.
            tex.colorSpace = THREE.NoColorSpace;
            // Authored masks are full-size spatial textures, so filter them
            // smoothly to avoid shimmer on the turntable.
            tex.minFilter = THREE.LinearMipmapLinearFilter;
            tex.magFilter = THREE.LinearFilter;
            tex.generateMipmaps = true;
            tex.needsUpdate = true;
            resolved[slot] = tex;
          } catch {
            // Missing / undecodable slot stays absent; the shader degrades to
            // ramp + rim only for this material.
          }
        })
      );
      morphic.resolvedTextures = resolved;
    })
  );
}

/**
 * Per-material eligibility gate. Enforces graceful fallback: anything without
 * morphic data, or without F_USE_NPR_LIGHTING === 1, is never wrapped and renders
 * exactly as today. ShaderMaterial / RawShaderMaterial are refused because CSM
 * throws on them (GLTFLoader never produces these, but the guard is cheap).
 */
export function isNprMaterial(mat: THREE.Material): boolean {
  const morphic = getMorphic(mat);
  if (!morphic) return false;
  if (mat.type === 'ShaderMaterial' || mat.type === 'RawShaderMaterial') return false;
  return scalar(morphic.ints?.F_USE_NPR_LIGHTING, 0) === 1;
}

/**
 * A self-illum material that is NOT NPR-lit (F_USE_NPR_LIGHTING off) but still
 * glows (F_SELF_ILLUM with a real or dynamic scale) - e.g. familiar eyes. The
 * unified builder wraps these too and disables cel/rim (uNprCel = 0), so they get
 * the additive glow without being forced through toon shading (NPR plan D15). The
 * precise scale-first gate runs in buildDeadlockMaterial; this is the cheap
 * candidate filter. Used only on the unified path.
 */
export function isSelfIllumMaterial(mat: THREE.Material): boolean {
  const morphic = getMorphic(mat);
  if (!morphic) return false;
  if (mat.type === 'ShaderMaterial' || mat.type === 'RawShaderMaterial') return false;
  if (scalar(morphic.ints?.F_SELF_ILLUM, 0) !== 1) return false;
  return (
    firstNumber(morphic, ['g_flSelfIllumScale1', 'g_flSelfIllumScale'], 0) > 0.05 ||
    !!morphic.dynamic_params?.g_flSelfIllumScale1
  );
}

/**
 * Pre-light CSB uniform values for a material (g_vAlbedoContrastSaturationBrightness1
 * = [contrast, saturation, brightness]). `has` is 0 (skip the shader branch) when
 * the value is absent or identity [1,1,1], so no-op heroes stay byte-unchanged.
 */
export function albedoCsb(morphic: MorphicExtras): { vec: THREE.Vector3; has: number } {
  const c = morphic.vectors?.g_vAlbedoContrastSaturationBrightness1;
  const identity =
    !!morphic.dynamic_params?.g_vAlbedoContrastSaturationBrightness1 ||
    !c ||
    (Math.abs((c[0] ?? 1) - 1) < 1e-4 &&
      Math.abs((c[1] ?? 1) - 1) < 1e-4 &&
      Math.abs((c[2] ?? 1) - 1) < 1e-4);
  return { vec: new THREE.Vector3(c?.[0] ?? 1, c?.[1] ?? 1, c?.[2] ?? 1), has: identity ? 0 : 1 };
}

/** Header values are already linear. Legacy decoded averages are an explicit
 * estimate, and the missing-texture fallback follows VRF's white default. */
export function albedoReflectivity(morphic: MorphicExtras): THREE.Vector3 {
  const value = morphic.texture_reflectivity?.g_tColor ?? morphic.preview_albedo_average;
  return value && value.length >= 3 && value.slice(0, 3).every(Number.isFinite)
    ? new THREE.Vector3(value[0], value[1], value[2]) : new THREE.Vector3(1, 1, 1);
}

/** Deadlock pbr.vfx applies vertex tint before or after its color correction,
 * according to the authored switch. Missing switches default to after. */
export function citadelColorUniforms(morphic: MorphicExtras): Record<string, THREE.IUniform> {
  const pbr = morphic.shader.toLowerCase() === 'pbr.vfx';
  const glassBlur = firstNumber(morphic, ['g_flCloakBlurAmount'], Number.NaN);
  const staticGlass = pbr && flag(morphic, 'F_GLASS') && Number.isFinite(glassBlur)
    && !['g_flCloakBlurAmount', 'g_flCloakBlurFactorMinRoughness', 'g_flCloakBlurFactorMaxRoughness']
      .some((name) => !!morphic.dynamic_params?.[name]);
  return {
    uVertexColorBeforeCsb: { value: !pbr || flag(morphic, 'g_bApplyTintToVertexColors') ? 1 : 0 },
    uMaskVertexColor: { value: pbr && scalar(morphic.ints?.g_bMaskVertexColorTint1, 1) !== 0 ? 1 : 0 },
    uMaskSource2ColorTint: { value: pbr && scalar(morphic.ints?.g_bMaskColorTint1, 1) !== 0 ? 1 : 0 },
    uAlbedoReflectivity: { value: albedoReflectivity(morphic) },
    uVertexColorStrength: { value: pbr ? firstNumber(morphic, ['g_fVertexColorStrength1'], 1) : 1 },
      uCitadelSpecular: { value: pbr ? 1 : 0 },
      // Authored zero blur is independent of the surface's specular roughness.
      uGlassTransmissionRoughness: { value: pbr && flag(morphic, 'F_GLASS') && morphic.floats?.g_flCloakBlurAmount === 0 ? 0 : -1 },
      uCitadelGlass: { value: staticGlass ? 1 : 0 },
      uCitadelGlassBackfacePass: { value: 0 },
    // Source blur is a screen-UV radius, independent of specular roughness.
    uCitadelGlassBlur: { value: new THREE.Vector3(
      staticGlass ? Math.max(0, glassBlur) : 0,
      firstNumber(morphic, ['g_flCloakBlurFactorMinRoughness'], 1),
      firstNumber(morphic, ['g_flCloakBlurFactorMaxRoughness'], 1),
    ) },
    uNoSpecularAtFullRoughness: {
      value: pbr && flag(morphic, 'F_USE_NPR_LIGHTING') && flag(morphic, 'F_NO_SPECULAR_AT_FULL_ROUGHNESS') ? 1 : 0,
    },
  };
}

/** Keep authored two-sided glass out of Three's optional backface feedback pass.
 * Its main draw remains two-sided; both faces sample the pre-glass scene. */
export function configureCitadelGlassPass(material: THREE.Material, uniforms: Record<string, THREE.IUniform>): void {
  const previous = material.onBeforeRender;
  const twoSided = material.side === THREE.DoubleSide;
  material.onBeforeRender = function (...args) {
    previous.apply(this, args);
    uniforms.uCitadelGlassBackfacePass.value = twoSided && uniforms.uCitadelGlass.value > 0.5 && this.side === THREE.BackSide ? 1 : 0;
  };
}

export interface NprDetailLayer {
  texture: THREE.Texture | null;
  has: number;
  tint: THREE.Color;
  blendFactor: number;
  blendMode: number;
  uvOffset: THREE.Vector2;
  uvScale: THREE.Vector2;
  uvRotation: number;
  uvChannel: number;
}

export interface NprHighlightLayer {
  has: number;
  tint: THREE.Color;
  coverage: number;
  hardness: number;
  brightness: number;
  invert: number;
  positionSource: THREE.Vector3;
  radius: number;
}

const DYNAMIC_DETAIL_PARAMS = [
  'g_flDetailBlendFactor1',
  'TextureDetailBlendFactor',
  'g_nDetailBlendMode',
  'g_vDetailColorTint1',
  'g_flDetailTexCoordRotation1',
  'g_vDetailTexCoordOffset1',
  'g_vDetailTexCoordScale1',
] as const;

const DYNAMIC_HIGHLIGHT_PARAMS = [
  'g_vHighlightTint1',
  'g_flHighlightCoverage1',
  'g_flHighlightHardness1',
  'g_flHighlightTintBrightness1',
  'g_flInvertHighlight1',
  'g_vHighlightPositionWs1',
  'g_flHighlightRadius1',
  'g_flHighlightNormalStrength1',
  'g_vHighlightSphere1',
  'TintCoverage',
  'TintHardness',
  'TintBrightness',
  'TintColor',
  'TintSphere',
] as const;

const HIGHLIGHT_EPS = 1e-4;

function hasDynamicDetailOverride(morphic: MorphicExtras): boolean {
  if (morphic.dynamic_texture_params?.g_tDetail) return true;
  return DYNAMIC_DETAIL_PARAMS.some((name) => morphic.dynamic_params?.[name]);
}

function hasDynamicHighlightOverride(morphic: MorphicExtras): boolean {
  return DYNAMIC_HIGHLIGHT_PARAMS.some((name) => morphic.dynamic_params?.[name]);
}

function finiteVec3(v: number[] | undefined): v is number[] {
  return (
    !!v &&
    Number.isFinite(v[0]) &&
    Number.isFinite(v[1]) &&
    Number.isFinite(v[2])
  );
}

/**
 * Static detail-texture gate (F5). Source 2 detail is only allowed to affect the
 * preview when the exporter resolved a real texture and the material authored an
 * enable flag or non-zero scalar. Placeholder defaults and zero blends stay
 * identity so ordinary materials do not pick up a uniform overlay. Dynamic F5
 * overrides and secondary-UV detail are also identity until this path can safely
 * evaluate expressions and prove that TEXCOORD_1 exists.
 */
export function detailLayer(morphic: MorphicExtras): NprDetailLayer {
  const texture = morphic.resolvedTextures?.g_tDetail;
  const authoredBlend = firstNumber(morphic, ['g_flDetailBlendFactor1', 'TextureDetailBlendFactor'], Number.NaN);
  const detailFlag = flag(morphic, 'F_DETAIL');
  const authored =
    detailFlag ||
    Number.isFinite(authoredBlend) ||
    morphic.ints?.g_nDetailBlendMode !== undefined ||
    morphic.vectors?.g_vDetailColorTint1 !== undefined;
  const blendFactor = Number.isFinite(authoredBlend) ? authoredBlend : detailFlag ? 1 : 0;
  const usesSecondaryUv = flag(morphic, 'g_bUseSecondaryUvForDetail1');
  const hasDynamicOverride = hasDynamicDetailOverride(morphic);
  const enabled =
    isMeaningfulMask(texture) &&
    authored &&
    Math.abs(blendFactor) > 1e-4 &&
    !usesSecondaryUv &&
    !hasDynamicOverride;
  const scale = morphic.vectors?.g_vDetailTexCoordScale1;
  const offset = morphic.vectors?.g_vDetailTexCoordOffset1;
  const rotation = firstNumber(morphic, ['g_flDetailTexCoordRotation1'], 0);
  return {
    texture: enabled ? texture : null,
    has: enabled ? 1 : 0,
    tint: enabled ? vectorColor(morphic.vectors?.g_vDetailColorTint1, new THREE.Color(1, 1, 1)) : new THREE.Color(1, 1, 1),
    blendFactor: enabled ? blendFactor : 0,
    blendMode: enabled ? scalar(morphic.ints?.g_nDetailBlendMode, 0) : 0,
    uvOffset: enabled ? new THREE.Vector2(offset?.[0] ?? 0, offset?.[1] ?? 0) : new THREE.Vector2(0, 0),
    uvScale: enabled ? new THREE.Vector2(scale?.[0] ?? 1, scale?.[1] ?? scale?.[0] ?? 1) : new THREE.Vector2(1, 1),
    uvRotation: enabled ? rotation : 0,
    uvChannel: 0,
  };
}

/**
 * Static highlight gate (F6). Highlight authoring positions are compared in the
 * same post-skinning source space captured by NPR_PATCH_MAP, before model/viewer
 * normalization. Cached defaults often export a tint with zero coverage or
 * hardness, so coverage, radius, tint, and position must all be meaningful
 * before the shader can affect the material.
 */
export function highlightLayer(morphic: MorphicExtras): NprHighlightLayer {
  const tint = morphic.vectors?.g_vHighlightTint1;
  const position = morphic.vectors?.g_vHighlightPositionWs1;
  const coverage = firstNumber(morphic, ['g_flHighlightCoverage1'], 0);
  const radius = firstNumber(morphic, ['g_flHighlightRadius1'], 0);
  const tintBrightness = firstNumber(morphic, ['g_flHighlightTintBrightness1'], 1);
  const hardness = firstNumber(morphic, ['g_flHighlightHardness1'], 0);
  const invert = firstNumber(morphic, ['g_flInvertHighlight1'], 0);
  const tintIsMeaningful =
    finiteVec3(tint) &&
    Math.max(Math.abs(tint[0]), Math.abs(tint[1]), Math.abs(tint[2])) > HIGHLIGHT_EPS;
  const enabled =
    coverage > HIGHLIGHT_EPS &&
    radius > HIGHLIGHT_EPS &&
    tintIsMeaningful &&
    finiteVec3(position) &&
    !hasDynamicHighlightOverride(morphic);

  return {
    has: enabled ? 1 : 0,
    tint: enabled ? new THREE.Color(tint[0], tint[1], tint[2]) : new THREE.Color(0, 0, 0),
    coverage: enabled ? coverage : 0,
    hardness: enabled ? hardness : 0,
    brightness: enabled ? tintBrightness : 0,
    invert: enabled ? invert : 0,
    positionSource: enabled ? new THREE.Vector3(position[0], position[1], position[2]) : new THREE.Vector3(0, 0, 0),
    radius: enabled ? radius : 0,
  };
}

/**
 * Cheap runtime smoke summary for dev builds. This answers the first question
 * before touching shader output: did this GLB actually arrive with morphic
 * material extras and the preview texture indices resolved?
 */
export function summarizeNprScene(scene: THREE.Object3D): NprSceneSummary {
  const materials = new Set<THREE.Material>();
  let meshes = 0;
  scene.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    meshes += 1;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    mats.forEach((mat) => {
      if (mat) materials.add(mat);
    });
  });

  const shaders: Record<string, number> = {};
  let morphicMaterials = 0;
  let nprMaterials = 0;
  let glassMaterials = 0;
  let translucentMaterials = 0;
  let additiveMaterials = 0;
  let selfIllumMaterials = 0;
  let jitterMaterials = 0;
  let sheenMaterials = 0;
  let unlitMaterials = 0;
  let backfaceMaterials = 0;
  let tintRimMasks = 0;
  let outlineTintMaterials = 0;
  let glassMasks = 0;
  let altTranslucencyMasks = 0;
  let jitterMasks = 0;
  let selfIllumMasks = 0;
  const resolvedTextureSlots: Record<string, number> = {};
  materials.forEach((mat) => {
    const morphic = getMorphic(mat);
    if (!morphic) return;
    morphicMaterials += 1;
    shaders[morphic.shader || 'unknown'] = (shaders[morphic.shader || 'unknown'] ?? 0) + 1;
    if (isNprMaterial(mat)) nprMaterials += 1;
    if (flag(morphic, 'F_GLASS')) glassMaterials += 1;
    if (flag(morphic, 'F_TRANSLUCENT') || flag(morphic, 'F_ADVANCED_TRANSLUCENCY')) {
      translucentMaterials += 1;
    }
    if (flag(morphic, 'F_ADDITIVE_BLEND')) additiveMaterials += 1;
    if (flag(morphic, 'F_SELF_ILLUM') || morphic.floats?.g_flSelfIllumScale1) {
      selfIllumMaterials += 1;
    }
    if (flag(morphic, 'F_JITTER_VERTICES') || morphic.resolvedTextures?.g_tJitterMask) {
      jitterMaterials += 1;
    }
    if (flag(morphic, 'F_SHEEN')) sheenMaterials += 1;
    if (flag(morphic, 'F_UNLIT')) unlitMaterials += 1;
    if (flag(morphic, 'F_RENDER_BACKFACES')) backfaceMaterials += 1;
    if (morphic.resolvedTextures?.g_tTintMaskRimLightMask) tintRimMasks += 1;
    if (morphic.vectors?.g_vSolidOutlineTint) outlineTintMaterials += 1;
    if (morphic.resolvedTextures?.g_tGlass) glassMasks += 1;
    if (morphic.resolvedTextures?.g_tAltTranslucency) altTranslucencyMasks += 1;
    if (morphic.resolvedTextures?.g_tJitterMask) jitterMasks += 1;
    if (morphic.resolvedTextures?.g_tSelfIllumMask) selfIllumMasks += 1;
    Object.keys(morphic.resolvedTextures ?? {}).forEach((slot) => {
      resolvedTextureSlots[slot] = (resolvedTextureSlots[slot] ?? 0) + 1;
    });
  });

  return {
    meshes,
    materials: materials.size,
    morphicMaterials,
    nprMaterials,
    glassMaterials,
    translucentMaterials,
    additiveMaterials,
    selfIllumMaterials,
    jitterMaterials,
    sheenMaterials,
    unlitMaterials,
    backfaceMaterials,
    tintRimMasks,
    outlineTintMaterials,
    glassMasks,
    altTranslucencyMasks,
    jitterMasks,
    selfIllumMasks,
    resolvedTextureSlots,
    shaders,
  };
}

/**
 * Cheap Source 2 material hints for shader families GLTFLoader cannot represent
 * fully. This deliberately mutates only standard/physical material properties
 * and returns a restore handle so it can be gated independently from the NPR CSM.
 *
 * This is the FLAG-GATED richer-material pass (glass transmission, opacity
 * scaling, alpha masks, self-illum emissive, sheen, jitter). It also sets a
 * draw-state subset (side / transparent / blending / depthWrite) that is
 * intertwined with that work. The authoritative ALWAYS-ON owner of the same
 * draw-state subset -- plus the mesh-level renderOrder this cannot set -- is
 * `src/lib/source2Preview/` (`resolveSource2DrawState`); the two produce the
 * same values and compose (this pass and the always-on pass each operate on the
 * GLTF base material and restore it). Keep them in sync if either changes.
 */
export function applySource2MaterialHints(
  scene: THREE.Object3D,
  debug = false,
  filter: (mat: THREE.Material, morphic: MorphicExtras) => boolean = () => true
): Source2MaterialHintsResult {
  const restore: Array<() => void> = [];
  const seen = new Set<THREE.Material>();
  const stats: Source2MaterialHintStats = {
    materials: 0,
    glass: 0,
    translucent: 0,
    additive: 0,
    selfIllum: 0,
    unlit: 0,
    sheen: 0,
    backfaces: 0,
    alphaMaps: 0,
    emissiveMaps: 0,
    jitterDisplacements: 0,
  };

  scene.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    mats.forEach((mat) => {
      if (!mat || seen.has(mat)) return;
      seen.add(mat);
      const morphic = getMorphic(mat);
      if (!morphic) return;
      if (!filter(mat, morphic)) return;
      const standard = mat as THREE.MeshStandardMaterial;
      if (!standard.isMeshStandardMaterial && !(standard as THREE.MeshPhysicalMaterial).isMeshPhysicalMaterial) {
        return;
      }
      stats.materials += 1;

      const physical = standard as THREE.MeshPhysicalMaterial;
      const isPhysicalMaterial = physical.isMeshPhysicalMaterial === true;
      const before = {
        side: mat.side,
        transparent: mat.transparent,
        opacity: mat.opacity,
        alphaMap: standard.alphaMap,
        alphaTest: standard.alphaTest,
        depthWrite: mat.depthWrite,
        blending: mat.blending,
        toneMapped: mat.toneMapped,
        roughness: standard.roughness,
        metalness: standard.metalness,
        emissive: standard.emissive?.clone(),
        emissiveMap: standard.emissiveMap,
        emissiveIntensity: standard.emissiveIntensity,
        envMapIntensity: standard.envMapIntensity,
        displacementMap: standard.displacementMap,
        displacementScale: standard.displacementScale,
        displacementBias: standard.displacementBias,
        transmission: physical.transmission,
        transmissionMap: physical.transmissionMap,
        thickness: physical.thickness,
        ior: physical.ior,
        clearcoat: physical.clearcoat,
        clearcoatRoughness: physical.clearcoatRoughness,
        sheen: physical.sheen,
        sheenRoughness: physical.sheenRoughness,
        sheenColor: physical.sheenColor?.clone(),
      };

      const glass = isTrueGlassMaterial(morphic, mat);
      const blendMode = resolveBlendMode(morphic);
      const translucent = blendMode === 'blend_zwrite' || blendMode === 'blend';
      const additive = blendMode === 'additive';
      const alphaBlend = !glass && (translucent || additive);
      const selfIllum = flag(morphic, 'F_SELF_ILLUM') || morphic.floats?.g_flSelfIllumScale1 !== undefined;
      const unlit = flag(morphic, 'F_UNLIT');
      const sheen = flag(morphic, 'F_SHEEN');
      const backfaces = flag(morphic, 'F_RENDER_BACKFACES');
      const selfIllumMap = morphic.resolvedTextures?.g_tSelfIllumMask;
      const hasSelfIllumMap =
        (morphic.self_illum_valid ?? isMeaningfulMask(selfIllumMap)) && selfIllumMap !== undefined;
      const selfIllumScale = firstNumber(
        morphic,
        ['g_flSelfIllumScale1', 'g_flSelfIllumScale'],
        Number.NaN
      );
      const selfIllumTintVec = morphic.vectors?.g_vSelfIllumTint1 ?? morphic.vectors?.g_vSelfIllumTint;

      if (glass) stats.glass += 1;
      if (translucent) stats.translucent += 1;
      if (additive) stats.additive += 1;
      if (selfIllum) stats.selfIllum += 1;
      if (unlit) stats.unlit += 1;
      if (sheen) stats.sheen += 1;
      if (backfaces) {
        stats.backfaces += 1;
        mat.side = THREE.DoubleSide;
      }

      if (glass) {
        if (isPhysicalMaterial) {
          applyGlassParameters(physical, morphic);
          physical.transmissionMap = glassTransmissionTexture(morphic);
        }
      }

      if (alphaBlend) {
        const dynamicAlpha = hasDynamicAlphaOverride(morphic);
        const alphaMask = dynamicAlpha ? null : translucentAlphaTexture(morphic);
        mat.transparent = true;
        // Translucent goo skin keeps depthWrite ON so it occludes the opaque
        // interior (Viscous's black gear/"bones"). depthWrite=false x-rayed every
        // interior layer at once, making the bones read as see-through. Additive
        // glow (below) still needs it off.
        mat.depthWrite = blendMode === 'blend_zwrite';
        if (dynamicAlpha) {
          mat.opacity = 1;
          standard.alphaMap = null;
          standard.alphaTest = 0;
        } else {
          const opacity = staticOpacityScale(morphic, 0.62);
          if (opacity !== null) mat.opacity = Math.min(mat.opacity, opacity);
        }
        if (alphaMask) {
          standard.alphaMap = alphaMask;
          standard.alphaTest = Math.max(standard.alphaTest ?? 0, 0.01);
          stats.alphaMaps += 1;
        }
        if (isPhysicalMaterial) {
          physical.transmission = 0;
          physical.transmissionMap = null;
        }
      }

      if (additive) {
        mat.blending = THREE.AdditiveBlending;
        mat.depthWrite = false;
      }

      // Self-illum fires ONLY on a real mask (matches the GLB exporter, which skips
      // placeholder 4x4 default masks). Deadlock emissive = mask * scale * tint:
      // viscous_body/ball carry F_SELF_ILLUM with a placeholder mask, default white
      // tint, and 0.02 scale, which the old gate (tint/scale "present" -> emit,
      // intensity floored to 1) turned into a full white glow -- the milky-white
      // body. viscous_head has the real liquid mask + green tint + 0.629 scale and
      // still glows green. Use the real scale as intensity, not a forced floor of 1.
      if (selfIllum && standard.emissive && hasSelfIllumMap) {
        standard.emissive.copy(vectorColor(selfIllumTintVec, new THREE.Color(1, 1, 1)));
        standard.emissiveIntensity = Number.isFinite(selfIllumScale)
          ? Math.max(selfIllumScale, 0)
          : 1;
        if (!standard.emissiveMap) {
          standard.emissiveMap = selfIllumMap;
          stats.emissiveMaps += 1;
        }
      }

      if (unlit && standard.emissive) {
        standard.emissive.copy(standard.color ?? new THREE.Color(1, 1, 1));
        standard.emissiveIntensity = Math.max(standard.emissiveIntensity ?? 1, 1.2);
        mat.toneMapped = false;
      }

      if (sheen && physical.isMeshPhysicalMaterial) {
        physical.sheen = Math.max(physical.sheen ?? 0, 0.65);
        physical.sheenRoughness = firstNumber(morphic, ['TextureSheenRoughness1', 'g_flSheenRoughness'], physical.sheenRoughness ?? 0.45);
        physical.sheenColor.copy(
          vectorColor(morphic.vectors?.TextureSheenColor1 ?? morphic.vectors?.g_vSheenColorTint1, physical.sheenColor)
        );
      }

      const jitterMask = morphic.resolvedTextures?.g_tJitterMask;
      if (flag(morphic, 'F_JITTER_VERTICES') && isMeaningfulMask(jitterMask)) {
        standard.displacementMap = jitterMask;
        standard.displacementScale = Math.max(standard.displacementScale ?? 0, 0.01);
        standard.displacementBias = standard.displacementBias ?? 0;
        stats.jitterDisplacements += 1;
      }

      mat.needsUpdate = true;
      if (debug) {
        console.info('[source2hints]', mat.name || '(unnamed)', {
          shader: morphic.shader,
          glass,
          translucent,
          additive,
          selfIllum: selfIllum && hasSelfIllumMap,
          unlit,
          sheen,
          backfaces,
          emissiveIntensity: standard.emissiveIntensity,
          opacity: mat.opacity,
          transparent: mat.transparent,
        });
      }
      restore.push(() => {
        mat.side = before.side;
        mat.transparent = before.transparent;
        mat.opacity = before.opacity;
        standard.alphaMap = before.alphaMap;
        standard.alphaTest = before.alphaTest;
        mat.depthWrite = before.depthWrite;
        mat.blending = before.blending;
        mat.toneMapped = before.toneMapped;
        standard.roughness = before.roughness;
        standard.metalness = before.metalness;
        if (before.emissive) standard.emissive.copy(before.emissive);
        standard.emissiveMap = before.emissiveMap;
        standard.emissiveIntensity = before.emissiveIntensity;
        standard.envMapIntensity = before.envMapIntensity;
        standard.displacementMap = before.displacementMap;
        standard.displacementScale = before.displacementScale;
        standard.displacementBias = before.displacementBias;
        if (isPhysicalMaterial) {
          physical.transmission = before.transmission;
          physical.transmissionMap = before.transmissionMap;
          physical.thickness = before.thickness;
          physical.ior = before.ior;
          physical.clearcoat = before.clearcoat;
          physical.clearcoatRoughness = before.clearcoatRoughness;
          physical.sheen = before.sheen;
          physical.sheenRoughness = before.sheenRoughness;
          if (before.sheenColor) physical.sheenColor.copy(before.sheenColor);
        }
        mat.needsUpdate = true;
      });
    });
  });

  return {
    restore: () => {
      restore.forEach((fn) => fn());
    },
    stats,
  };
}

// Shared GLSL (module constants so every hero reuses one compiled program).
//
// The vertex shader does NOT write csm_Position / csm_Normal. Writing csm_Position
// re-routes <begin_vertex> (transformed = csm_Position) and would reorder relative
// to <skinning_vertex> / <morphtarget_vertex>, risking the rigged spine. Keep this
// to varying passthrough only.
export const NPR_VERTEX = /* glsl */ `
uniform float uTime;
uniform float uHasJitter;
uniform sampler2D uJitterMap;
uniform float uHasJitterMask;
uniform float uJitterSpeedA;
uniform float uJitterSpeedB;
uniform float uJitterStrength;
uniform vec3  uJitterFreqA;
uniform vec3  uJitterFreqB;
uniform vec3  uJitterAmpXA;
uniform vec3  uJitterAmpXB;
uniform vec3  uJitterAmpYA;
uniform vec3  uJitterAmpYB;
uniform vec3  uJitterAmpZA;
uniform vec3  uJitterAmpZB;
varying vec2 vNprUv;
varying vec2 vNprUv2;
varying vec3 vNprSourcePosition;
void main() {
  // Three declares the primary uv attribute unconditionally. USE_UV is no
  // longer emitted for ordinary map materials, so gating on it samples every
  // Source 2 mask at (0,0), flooding Dynamo's whole gun with self illumination.
  vNprUv = uv;
  #ifdef USE_UV1
    vNprUv2 = uv1;
  #else
    vNprUv2 = vNprUv;
  #endif
}
`;

// The user fragment body runs at the TOP of the compiled main(), BEFORE lighting.
// So here we only do the PRE-light tint multiply on csm_DiffuseColor (which CSM
// feeds into diffuseColor for the BRDF) and sample the mask once into a local that
// the post-light patch (NPR_PATCH_MAP, injected after <opaque_fragment>, same
// main() scope) reads for the rim. The cel + rim math itself MUST live in the
// patch, because the lit color does not exist yet at this point.
export const NPR_FRAGMENT = /* glsl */ `
uniform vec3  uKeyDir;
uniform float uBands;
uniform float uStepSharpness;
uniform float uWrap;
uniform float uRimStrength;
uniform float uRimPower;
uniform vec3  uRimColor;
uniform float uRimMaskDefault;
uniform float uNprStrength;
uniform float uCelV2;
uniform float uNprCel;
uniform vec3  uTintColor;
uniform sampler2D uTintRimMask;
uniform float uHasTintMask;
uniform float uApplyVertexColor;
uniform float uVertexColorBeforeCsb;
uniform float uMaskVertexColor;
uniform float uVertexColorStrength;
uniform float uCitadelSpecular;
uniform float uGlassTransmissionRoughness;
uniform float uCitadelGlass;
uniform float uCitadelGlassBackfacePass;
uniform vec3 uCitadelGlassBlur;
uniform float uNoSpecularAtFullRoughness;
uniform float uTime;
uniform sampler2D uSelfIllumMap;
uniform float uHasSelfIllum;
uniform vec2  uSelfIllumScroll;
uniform vec3  uSelfIllumTint;
uniform float uSelfIllumScale;
uniform float uSelfIllumPulse;
uniform float uSelfIllumAlbedoFactor;
uniform float uSelfIllumCap;
uniform float uSelfIllumSat;
uniform float uSelfIllumMaskShaping;
uniform float uSelfIllumMaskLow;
uniform float uSelfIllumMaskHigh;
uniform vec3  uAlbedoCSB;
uniform vec3  uAlbedoReflectivity;
uniform mat3  uSource2ColorTint;
uniform vec3  uSource2ColorTintOffset;
uniform float uMaskSource2ColorTint;
uniform float uHasAlbedoCSB;
uniform sampler2D uNprTransmissiveColor;
uniform vec3  uNprTransmissiveTint;
uniform float uHasTransmissive;
uniform float uTransStrength;
uniform float uTransPower;
uniform sampler2D uDetailMap;
uniform float uHasDetail;
uniform vec3  uDetailTint;
uniform float uDetailBlendFactor;
uniform float uDetailBlendMode;
uniform vec2  uDetailUvOffset;
uniform vec2  uDetailUvScale;
uniform float uDetailUvRotation;
uniform float uDetailUvChannel;
uniform float uHasJitter;
uniform sampler2D uJitterMap;
uniform float uHasJitterMask;
uniform float uJitterSpeedA;
uniform float uJitterSpeedB;
uniform float uJitterStrength;
uniform vec3  uJitterFreqA;
uniform vec3  uJitterFreqB;
uniform vec3  uJitterAmpXA;
uniform vec3  uJitterAmpXB;
uniform vec3  uJitterAmpYA;
uniform vec3  uJitterAmpYB;
uniform vec3  uJitterAmpZA;
uniform vec3  uJitterAmpZB;
uniform float uHasHighlight;
uniform vec3  uHighlightTint;
uniform float uHighlightCoverage;
uniform float uHighlightHardness;
uniform float uHighlightBrightness;
uniform float uHighlightInvert;
uniform vec3  uHighlightPositionSource;
uniform float uHighlightRadius;
varying vec2 vNprUv;
varying vec2 vNprUv2;
varying vec3 vNprSourcePosition;

// Soft-quantize a 0..1 value into uBands steps, softening only the riser so band
// terminators do not alias at preview resolution.
float celQuantize(float x, float bands, float sharp) {
  float scaled = x * bands;
  float lower = floor(scaled);
  float f = scaled - lower;
  float soft = smoothstep(0.5 - sharp, 0.5 + sharp, f);
  return (lower + soft) / bands;
}

// MatrixColorCorrect2 in linear RGB: contrast about texture reflectivity,
// brightness, then its luminance-axis saturation transform. No clamp.
vec3 applyAlbedoCSB(vec3 c, vec3 csb, vec3 reflectivity) {
  c = (c - reflectivity) * csb.x + reflectivity;
  c *= csb.z;
  float l = dot(c, vec3(${SOURCE2_SATURATION_WEIGHTS.map((v) => v.toPrecision(12)).join(', ')}));
  return mix(vec3(l), c, csb.y);
}

vec2 rotateDetailUv(vec2 uv, float angle) {
  float s = sin(angle);
  float c = cos(angle);
  vec2 p = uv - vec2(0.5);
  return vec2(c * p.x - s * p.y, s * p.x + c * p.y) + vec2(0.5);
}

vec2 detailUv() {
  vec2 uv = uDetailUvChannel > 0.5 ? vNprUv2 : vNprUv;
  uv = uv * uDetailUvScale + uDetailUvOffset;
  if (abs(uDetailUvRotation) > 0.0001) {
    uv = rotateDetailUv(uv, uDetailUvRotation);
  }
  return uv;
}

void main() {
  // nprMask is declared in main() scope, so it is also visible at the post-light
  // patch site (same main() block, later in the chunk chain).
  if (uCitadelGlassBackfacePass > 0.5) discard;
  vec4 nprMask = uHasTintMask > 0.5 ? texture2D(uTintRimMask, vNprUv) : vec4(1.0);
  vec3 nprDetail = vec3(0.0);
  float tintEnable = uHasTintMask > 0.5 ? nprMask.r : 0.0;
  // Gate real vertex albedo separately from tint-mask-only COLOR_0. Preserve
  // Source's authored tint placement, mask and strength instead of raising black
  // vertex colors through a later contrast correction.
  #if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA )
    float vertexColorAmount = (uMaskVertexColor > 0.5 ? nprMask.r : 1.0) * uVertexColorStrength;
    if (uApplyVertexColor > 0.5 && uVertexColorBeforeCsb > 0.5) {
      csm_DiffuseColor.rgb *= mix(vec3(1.0), vColor.rgb, vertexColorAmount);
    }
    #ifdef USE_COLOR_ALPHA
      if (uApplyVertexColor > 0.5) csm_DiffuseColor.a *= vColor.a;
    #endif
  #endif
  if (uHasAlbedoCSB > 0.5) {
    csm_DiffuseColor.rgb = applyAlbedoCSB(csm_DiffuseColor.rgb, uAlbedoCSB, uAlbedoReflectivity);
  }
  float source2TintAmount = uMaskSource2ColorTint > 0.5 ? nprMask.r : 1.0;
  csm_DiffuseColor.rgb = mix(csm_DiffuseColor.rgb,
    uSource2ColorTint * csm_DiffuseColor.rgb + uSource2ColorTintOffset, source2TintAmount);
  // Live recolor is linear and independent of the authored texture tint.
  csm_DiffuseColor.rgb = mix(csm_DiffuseColor.rgb, csm_DiffuseColor.rgb * uTintColor, tintEnable);
  #if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA )
    if (uApplyVertexColor > 0.5 && uVertexColorBeforeCsb <= 0.5) {
      csm_DiffuseColor.rgb *= mix(vec3(1.0), vColor.rgb, vertexColorAmount);
    }
  #endif
  // Detail (F5): apply only when CPU-side authoring + placeholder gates enabled
  // it. Add-self-illum mode is deferred to the post-light emission branch below.
  if (uHasDetail > 0.5) {
    nprDetail = texture2D(uDetailMap, detailUv()).rgb * uDetailTint;
    if (uDetailBlendMode < 0.5) {
      csm_DiffuseColor.rgb += nprDetail * uDetailBlendFactor;
    } else if (uDetailBlendMode > 1.5) {
      csm_DiffuseColor.rgb = mix(
        csm_DiffuseColor.rgb,
        csm_DiffuseColor.rgb * nprDetail * 2.0,
        clamp(uDetailBlendFactor, 0.0, 1.0)
      );
    }
  }

  // Authored glass self illumination tints the surface before lighting and
  // absorption. A constant mask is valid data, even for a small authored scale.
  if (uCitadelGlass > 0.5 && uHasSelfIllum > 0.5) {
    float glassIllumMask = texture2D(uSelfIllumMap, fract(vNprUv + uSelfIllumScroll * uTime)).r;
    vec3 glassIllumColor = mix(uSelfIllumTint, uSelfIllumTint * csm_DiffuseColor.rgb, uSelfIllumAlbedoFactor);
    csm_DiffuseColor.rgb = mix(csm_DiffuseColor.rgb, glassIllumColor,
      glassIllumMask * clamp(uSelfIllumScale * uSelfIllumPulse, 0.0, 1.0));
  }

}
`;

// The post-light pass: injected right after <opaque_fragment>, where gl_FragColor
// holds the IBL + direct lit LINEAR color and tonemapping has not run yet. We do
// the cel posterize + rim here and write gl_FragColor directly. We never reference
// csm_FragColor, so CSM does not inject its own opaque_fragment mix (it only does
// so when the user fragment uses csm_FragColor), and csm_UnlitFac stays 0. ACES
// tonemaps our result downstream exactly like the PBR path.
export const NPR_PATCH_MAP: CSMPatchMap = {
  '*': {
    // CSM has already expanded Three's transmission chunk at this point.
    // Keep Three's sampling/projection primitives, but use the authored glass
    // coverage and view-dependent absorption instead of its volume BRDF tint.
    'vec4 transmitted = getIBLVolumeRefraction(': {
      type: 'fs',
      value: /* glsl */ `
      vec4 transmitted;
      if (uCitadelGlass > 0.5) {
        vec3 glassExit = pos + getVolumeTransmissionRay(n, v, material.thickness, material.ior, modelMatrix);
        vec4 glassClip = projectionMatrix * viewMatrix * vec4(glassExit, 1.0);
        vec2 glassUv = glassClip.xy / glassClip.w * 0.5 + 0.5;
        float glassRadius = clamp(uCitadelGlassBlur.x * mix(uCitadelGlassBlur.y, uCitadelGlassBlur.z, material.roughness), 0.0, 1.0);
        // Citadel glass combo 280 uses point-clamped mip-zero framebuffer taps,
        // not Three's bicubic volume sampler. Keep thin opaque interiors sharp.
        ivec2 glassSize = textureSize(transmissionSamplerMap, 0);
        ivec2 glassPixel = clamp(ivec2(clamp(glassUv, 0.0, 1.0) * vec2(glassSize)), ivec2(0), glassSize - 1);
        vec4 glassScene = texelFetch(transmissionSamplerMap, glassPixel, 0);
        if (glassRadius > 0.0) {
          // Decoded static combo 280: center plus eight equal-weight offsets.
          // The viewer does not yet export Citadel's validity/depth or noise map.
          vec2 glassOffsets[8] = vec2[8](
            vec2(-0.0876, 0.9703), vec2(0.4802, 0.5651),
            vec2(0.1851, 0.1580), vec2(-0.2616, -0.0617),
            vec2(-0.5477, -0.6603), vec2(-0.5325, 0.0711),
            vec2(-0.0751, -0.8954), vec2(0.6384, -0.4054));
          for (int glassTap = 0; glassTap < 8; glassTap++) {
            vec2 tapUv = clamp(glassUv + glassOffsets[glassTap] * glassRadius, 0.0, 1.0);
            ivec2 tapPixel = clamp(ivec2(tapUv * vec2(glassSize)), ivec2(0), glassSize - 1);
            glassScene += texelFetch(transmissionSamplerMap, tapPixel, 0);
          }
          glassScene /= 9.0;
        }
          // Preview lighting calibration for authored blurred volumes: our photo
          // backdrop is LDR, unlike the engine's lit HDR scene-color buffer.
          // Preserve black interior silhouettes rather than adding opaque glow.
          // This exposure approximation leaves sharp glass unchanged.
          if (glassRadius > 0.0) glassScene.rgb *= 12.0;
          vec3 glassAbsorption = min(vec3(1.0), pow(max(diffuseColor.rgb, vec3(0.01)), vec3(1.0 / max(dot(n, v), 0.01))));
        // The existing mix applies coverage a second time, matching G squared.
        // Surface specular is accumulated separately and remains unchanged.
        transmitted.rgb = glassScene.rgb * glassAbsorption * (1.0 - metalnessFactor) * material.transmission;
        float glassAlphaWeight = dot(glassAbsorption, vec3(1.0 / 3.0)) * (1.0 - metalnessFactor);
        transmitted.a = 1.0 - (1.0 - glassScene.a) * glassAlphaWeight;
      } else {
        transmitted = getIBLVolumeRefraction(`,
    },
    'material.attenuationColor, material.attenuationDistance );': {
      type: 'fs',
      value: 'material.attenuationColor, material.attenuationDistance );\n      }',
    },
    // CSM expands transmission_fragment before applying custom patches. Match
    // the refraction call in that expanded chunk, rather than its removed include.
    'n, v, material.roughness,': {
      type: 'fs',
      value: 'n, v, uGlassTransmissionRoughness >= 0.0 ? uGlassTransmissionRoughness : material.roughness,',
    },
    '#include <lights_fragment_maps>': THREE.ShaderChunk.lights_fragment_maps.replace(
      'getIBLRadiance( geometryViewDir, geometryNormal, material.roughness )',
      // A soft shared reflection probe prevents the studio's individual lights
      // becoming white specks on glass; direct highlights remain independent.
      'getIBLRadiance( geometryViewDir, geometryNormal, uCitadelGlass > 0.5 ? max(material.roughness, 0.45) : material.roughness )'
    ),
    '#include <lights_fragment_end>': {
      type: 'fs',
      value: /* glsl */ `
      #include <lights_fragment_end>
      if (uCitadelSpecular > 0.5) {
        // Citadel suppresses the neutral dielectric lobe on near-black albedo.
        // Apply the same attenuation to both Three specular accumulators so the
        // metallic IBL path is covered without altering diffuse illumination.
        float citadelSpecularFactor = clamp(max(max(diffuseColor.r, diffuseColor.g), diffuseColor.b) * 25.0, 0.0, 1.0);
        reflectedLight.directSpecular *= citadelSpecularFactor;
        reflectedLight.indirectSpecular *= citadelSpecularFactor;
      }
      if (uNoSpecularAtFullRoughness > 0.5 && roughnessFactor >= 1.0) {
        reflectedLight.directSpecular = vec3(0.0);
        reflectedLight.indirectSpecular = vec3(0.0);
      }
      if (uNprCel > 0.5 && uCelV2 > 0.5) {
        vec3 nprDirect = reflectedLight.directDiffuse;
        float nprDirectLum = dot(nprDirect, vec3(0.2126, 0.7152, 0.0722));
        // Band the lighting factor, then restore albedo. Quantizing the lit
        // color itself makes a dark material lose light under the same lamp.
        float nprAlbedoLum = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
        float nprLightLum = nprDirectLum / max(nprAlbedoLum, 1e-4);
        float nprDirectQ = celQuantize(clamp(nprLightLum, 0.0, 1.0), uBands, uStepSharpness) * nprAlbedoLum;
        vec3 nprDirectCel = nprDirect * (
          nprDirectLum > 1e-4 ? clamp(nprDirectQ / nprDirectLum, 0.0, 4.0) : 1.0
        );
        reflectedLight.directDiffuse = mix(nprDirect, nprDirectCel, uNprStrength);
      }
    `,
    },
    '#include <displacementmap_vertex>': {
      type: 'vs',
      value: /* glsl */ `
      #include <displacementmap_vertex>
      if (uHasJitter > 0.5) {
        float jitterMask = uHasJitterMask > 0.5 ? texture2D(uJitterMap, vNprUv).r : 1.0;
        vec3 jitterWaveA = sin(transformed * uJitterFreqA + vec3(uTime * uJitterSpeedA * 6.2831853));
        vec3 jitterWaveB = sin(transformed * uJitterFreqB + vec3(uTime * uJitterSpeedB * 6.2831853));
        vec3 jitterOffset = vec3(
          dot(jitterWaveA, uJitterAmpXA) + dot(jitterWaveB, uJitterAmpXB),
          dot(jitterWaveA, uJitterAmpYA) + dot(jitterWaveB, uJitterAmpYB),
          dot(jitterWaveA, uJitterAmpZA) + dot(jitterWaveB, uJitterAmpZB)
        );
        transformed += jitterOffset * jitterMask * uJitterStrength;
      }
      vNprSourcePosition = transformed;
    `,
    },
    '#include <opaque_fragment>': /* glsl */ `
      #include <opaque_fragment>
      {
        vec3 nprLit = gl_FragColor.rgb;
        // Glass removes surface diffuse before adding scene color. Keep the
        // preview cel/rim approximation off that transmitted color and its
        // preserved specular, including partially masked glass.
        float nprSurfaceWeight = 1.0;
        #ifdef USE_TRANSMISSION
          nprSurfaceWeight = 1.0 - clamp(material.transmission, 0.0, 1.0);
        #endif
        // Three's final normal already includes normal maps, flat-shading and
        // backface handling, all in view space. Transform the world key direction
        // into that same space once, so orbiting cannot rotate the light gate.
        vec3 nprN = normal;
        vec3 nprV = normalize(vViewPosition);
        vec3 nprL = normalize((viewMatrix * vec4(uKeyDir, 0.0)).xyz);

        // Cel posterize + rim are NPR-only. A non-NPR material (uNprCel = 0, e.g.
        // familiar eyes: F_USE_NPR_LIGHTING off but F_SELF_ILLUM on) passes its lit
        // color through untouched and receives only the additive self-illum below,
        // so it is never forced through cel shading (NPR plan D15).
        vec3 nprCel = nprLit;
        float nprRim = 0.0;
        if (uNprCel > 0.5) {
          // Posterize luminance while preserving hue so the IBL color shaping
          // survives. Clamp the rescale so near-black pixels do not amplify noise.
          if (uCelV2 <= 0.5) {
            float nprLum = dot(nprLit, vec3(0.2126, 0.7152, 0.0722));
            float nprQ = celQuantize(clamp(nprLum, 0.0, 1.0), uBands, uStepSharpness);
            nprCel = mix(nprLit, nprLit * (nprLum > 1e-4 ? clamp(nprQ / nprLum, 0.0, 4.0) : 1.0), nprSurfaceWeight);
          }
          // The preview uses an opaque key-light gate, rim mask G and AO R.
          // A broad view-Fresnel lobe bleaches front-facing vertical cloth.
          // Scene light/up-ramp constants remain a preview approximation.
          float nprRimMaskG = uHasTintMask > 0.5 ? nprMask.g : uRimMaskDefault;
          // Rim lighting is a separate additive lobe in Citadel glass. Coverage
          // removes diffuse, not this lobe; use lit albedo rather than tinting
          // the transmitted scene. Scene rim globals remain a preview approximation.
          // Preview approximation: key-light wrap and world-up ramp avoid the
          // broad opaque washout observed with the former view-Fresnel gate.
          // Decoded glass confirms mask/AO inputs, but its camera-relative rim
          // operand does not establish this opaque lighting approximation.
          float lightWrap = 1.0 + uWrap;
          // The decoded glass wrap uses camera-to-surface direction. Keep the
          // visually calibrated opaque key-light approximation separate.
          float rimDot = uCitadelGlass > 0.5 ? -dot(nprN, nprV) : dot(nprN, nprL);
          float lightRim = pow(clamp((rimDot + uWrap) / (lightWrap * lightWrap), 0.0, 1.0), uRimPower);
          vec3 worldUpView = normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);
          float upRamp = clamp(dot(nprN, worldUpView), 0.0, 1.0);
          float opaqueRimAo = 1.0;
          #ifdef USE_AOMAP
            opaqueRimAo = clamp(ambientOcclusion, 0.0, 1.0);
          #endif
          // Retain the verified glass path independently of opaque AO changes.
          nprRim = lightRim * upRamp * nprRimMaskG * uRimStrength * (uCitadelGlass > 0.5 ? 1.0 : opaqueRimAo);
        }

        vec3 nprRimTint = mix(uRimColor, reflectedLight.directDiffuse + reflectedLight.indirectDiffuse, 1.0 - nprSurfaceWeight);
        vec3 nprOut = nprCel + nprRimTint * nprRim;

        if (uHasTransmissive > 0.5) {
          vec3 trans = texture2D(uNprTransmissiveColor, vNprUv).rgb * uNprTransmissiveTint;
          float backWrap = clamp(0.5 - 0.5 * dot(nprN, nprL), 0.0, 1.0);
          float graze = pow(clamp(1.0 - abs(dot(nprN, nprV)), 0.0, 1.0), uTransPower);
          float backLight = backWrap * graze * uTransStrength;
          nprOut += trans * backLight;
        }

        if (uHasHighlight > 0.5) {
          float highlightCoverage = clamp(uHighlightCoverage, 0.0, 1.0);
          float highlightHardness = clamp(uHighlightHardness, 0.0, 1.0);
          float highlightRadius = max(uHighlightRadius, 0.0001);
          float highlightDist = clamp(distance(vNprSourcePosition, uHighlightPositionSource) / highlightRadius, 0.0, 1.0);
          float highlightSoftStart = highlightCoverage * (1.0 - mix(1.0, 0.02, highlightHardness));
          float highlightMask = 1.0 - smoothstep(highlightSoftStart, highlightCoverage, highlightDist);
          if (uHighlightInvert > 0.5) {
            highlightMask = 1.0 - highlightMask;
          }
          float highlightAmount = clamp(highlightMask * clamp(uHighlightBrightness, 0.0, 2.0) * 0.5, 0.0, 0.65);
          nprOut = mix(nprOut, nprOut + clamp(uHighlightTint, vec3(0.0), vec3(4.0)), highlightAmount);
        }

        // Self-illum has to be added here, after Three has built gl_FragColor.
        // CSM's emissive hook initializes totalEmissiveRadiance before the custom
        // fragment body runs, so mutating csm_Emissive there compiles but is too
        // late to affect outgoingLight in MeshStandard/Physical.
        if (uHasSelfIllum > 0.5) {
          vec2 siUv = fract(vNprUv + uSelfIllumScroll * uTime);
          float rawSiMask = texture2D(uSelfIllumMap, siUv).r;
          float siMask = rawSiMask;
          if (uSelfIllumMaskShaping > 0.5) {
            float baseMax = max(max(csm_DiffuseColor.r, csm_DiffuseColor.g), csm_DiffuseColor.b);
            float baseMin = min(min(csm_DiffuseColor.r, csm_DiffuseColor.g), csm_DiffuseColor.b);
            float baseChroma = baseMax - baseMin;
            float baseWarmth = csm_DiffuseColor.r - max(csm_DiffuseColor.g, csm_DiffuseColor.b);
            float baseLuma = dot(csm_DiffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
            float warmLine = smoothstep(0.0002, 0.003, baseWarmth);
            float brightLine = smoothstep(0.006, 0.028, baseLuma) * smoothstep(0.0008, 0.006, baseChroma);
            float detailGate = smoothstep(0.0008, 0.01, length(fwidth(csm_DiffuseColor.rgb)));
            float headRegion = smoothstep(70.0, 78.0, vNprSourcePosition.z) *
              (1.0 - smoothstep(8.0, 16.0, abs(vNprSourcePosition.x)));
            float inkGate = max(warmLine, brightLine) * detailGate * (1.0 - headRegion);
            siMask = clamp(rawSiMask * rawSiMask * 8192.0 * inkGate, 0.0, 1.0);
          }
          vec3 siColor = uCitadelGlass > 0.5 ? csm_DiffuseColor.rgb : mix(uSelfIllumTint, csm_DiffuseColor.rgb, uSelfIllumAlbedoFactor);
          float siLuma = dot(siColor, vec3(0.2126, 0.7152, 0.0722));
          siColor = max(mix(vec3(siLuma), siColor, uSelfIllumSat), 0.0);
          vec3 siAdd = siColor * (siMask * uSelfIllumScale);
          if (uHasDetail > 0.5 && uDetailBlendMode > 0.5 && uDetailBlendMode < 1.5) {
            siAdd += nprDetail * (uDetailBlendFactor * siMask * uSelfIllumScale);
          }
          float siPeak = max(max(siAdd.r, siAdd.g), siAdd.b);
          if (siPeak > uSelfIllumCap) siAdd *= uSelfIllumCap / siPeak;
          siAdd *= uSelfIllumPulse;
          nprOut += siAdd;
        }

        gl_FragColor.rgb = mix(gl_FragColor.rgb, nprOut, uNprStrength);
      }
    `,
  },
};

/**
 * Wrap an NPR-eligible material with a CSM that layers the Deadlock cel ramp,
 * rim, and tint mask on the lit PBR output. Returns null when the material is not
 * NPR-eligible (caller skips it, leaving it untouched).
 *
 * The base instance is passed through to CSM v6, which copies the base's own
 * props (including the `isMeshStandardMaterial` / `isMeshPhysicalMaterial` flags
 * the renderer keys IBL/PMREM on) and proxies `type`. The result is NOT
 * instanceof MeshPhysicalMaterial, but IBL and skinning still work (skinning is
 * mesh-driven). Emissive (g_flSelfIllumScale1 / g_vSelfIllumTint1) is NOT
 * re-applied: it is already baked into KHR_materials_emissive_strength on the base.
 */
export function wrapMaterialWithNpr(
  base: THREE.Material,
  tuning: NprTuning = DEFAULT_NPR_TUNING,
  tintOverride: THREE.Color | null = null
): NprWrapResult | null {
  if (!isNprMaterial(base)) return null;
  const morphic = getMorphic(base)!;
  const standard = base as THREE.MeshStandardMaterial & { __nprPrevColor?: THREE.Color };
  const tintPlan = source2TintPlan(morphic, standard.__nprPrevColor ?? standard.color);
  if (tintPlan.ownsExportedFactor) {
    standard.__nprPrevColor ??= tintPlan.linearTint.clone();
    standard.color.setRGB(1, 1, 1);
  }


  const sharedTintMask = morphic.resolvedTextures?.g_tTintMaskRimLightMask ?? morphic.resolvedTextures?.g_tTintMask ?? null;
  const tintMask = sharedTintMask?.clone() ?? null;
  const sharedTransmissive = morphic.resolvedTextures?.g_tNprTransmissiveColor;
  const transmissiveMap = isMeaningfulMask(sharedTransmissive) ? sharedTransmissive.clone() : null;
  if (transmissiveMap) {
    transmissiveMap.colorSpace = THREE.SRGBColorSpace;
    transmissiveMap.needsUpdate = true;
  }
  // The authored tint has its own matrix after correction. This uniform is
  // only the independent, live recolor override.
  const tintColor = tintOverride ?? new THREE.Color(1, 1, 1);

  // Self-illum: only a REAL mask animates (placeholder 4x4 gate, same as the hints
  // path). g_tSelfIllumMask scrolls at g_vSelfIllumScrollSpeed, tinted+scaled.
  const selfIllumMap = morphic.resolvedTextures?.g_tSelfIllumMask;
  const hasSelfIllum = isMeaningfulMask(selfIllumMap);
  if (selfIllumMap) {
    // Scroll wraps via fract(), so the sampler must repeat or the seam smears.
    selfIllumMap.wrapS = THREE.RepeatWrapping;
    selfIllumMap.wrapT = THREE.RepeatWrapping;
    selfIllumMap.needsUpdate = true;
  }
  const siScroll = morphic.vectors?.g_vSelfIllumScrollSpeed1 ?? morphic.vectors?.g_vSelfIllumScrollSpeed;
  const siTint = vectorColor(
    morphic.vectors?.g_vSelfIllumTint1 ?? morphic.vectors?.g_vSelfIllumTint,
    new THREE.Color(0, 0, 0)
  );
  // Use the real scale (viscous_head = 0.629); never floor to 1 (milky-white guard).
  const siScale = firstNumber(morphic, ['g_flSelfIllumScale1', 'g_flSelfIllumScale'], 0);
  const detail = detailLayer(morphic);
  const detailMap = detail.texture ? detail.texture.clone() : null;
  if (detailMap) {
    detailMap.colorSpace = THREE.SRGBColorSpace;
    detailMap.wrapS = THREE.RepeatWrapping;
    detailMap.wrapT = THREE.RepeatWrapping;
    detailMap.needsUpdate = true;
  }
  const legacyJitterMask = morphic.resolvedTextures?.g_tJitterMask;
  const jitterMap = isMeaningfulMask(legacyJitterMask) ? legacyJitterMask.clone() : null;
  if (jitterMap) {
    jitterMap.wrapS = THREE.RepeatWrapping;
    jitterMap.wrapT = THREE.RepeatWrapping;
    jitterMap.needsUpdate = true;
  }
  const hasJitter = flag(morphic, 'F_JITTER_VERTICES');

  // The GLB exporter bakes viscous_head's emissive (texture + green factor) into the
  // base; the lit pass would emit it before our patch runs -> double-green. When the
  // NPR path owns the (scrolling) glow, zero the base emissive BEFORE the CSM copies
  // base props. unwrapNprBase restores it on teardown. Stamped on the base instance.
  if (hasSelfIllum) {
    const std = base as THREE.MeshStandardMaterial & { __nprPrevEmissiveIntensity?: number };
    std.__nprPrevEmissiveIntensity = std.emissiveIntensity;
    std.emissiveIntensity = 0;
  }

  const uniforms: Record<string, THREE.IUniform> = {
    uKeyDir: { value: tuning.keyDir.clone() },
    uBands: { value: tuning.bands },
    uStepSharpness: { value: tuning.stepSharpness },
    uWrap: { value: tuning.wrap },
    uRimStrength: { value: tuning.rimStrength },
    uRimPower: { value: tuning.rimPower },
    uRimColor: { value: tuning.rimColor.clone() },
    uRimMaskDefault: { value: 1.0 },
    uNprStrength: { value: tuning.nprStrength },
    uCelV2: { value: 0.0 },
    // Legacy wrap only runs on NPR-lit materials (isNprMaterial gate), so cel is
    // always on here; the shared GLSL requires the uniform regardless.
    uNprCel: { value: 1.0 },
    uTintColor: { value: tintColor },
    uTintRimMask: { value: tintMask ?? whiteFallback() },
    uHasTintMask: { value: tintMask ? 1.0 : 0.0 },
    uApplyVertexColor: { value: requiresVertexColors(morphic) ? 1.0 : 0.0 },
    ...citadelColorUniforms(morphic),
    uSource2ColorTint: { value: tintPlan.matrix },
    uSource2ColorTintOffset: { value: tintPlan.offset },
    uTime: { value: 0 },
    uSelfIllumMap: { value: hasSelfIllum ? selfIllumMap : whiteFallback() },
    uHasSelfIllum: { value: hasSelfIllum ? 1.0 : 0.0 },
    uSelfIllumScroll: { value: new THREE.Vector2(siScroll?.[0] ?? 0, siScroll?.[1] ?? 0) },
    uSelfIllumTint: { value: siTint },
    uSelfIllumScale: { value: siScale },
    uSelfIllumPulse: { value: 1.0 },
    // Parity with the unified path: the shared GLSL references these uniforms, so
    // the legacy wrap must declare them too or the material fails to compile.
    uSelfIllumAlbedoFactor: { value: firstNumber(morphic, ['g_flSelfIllumAlbedoFactor1'], 0) },
    uSelfIllumCap: { value: tuning.selfIllumCap },
    uSelfIllumSat: { value: tuning.selfIllumSat },
    uSelfIllumMaskShaping: { value: 0.0 },
    uSelfIllumMaskLow: { value: tuning.selfIllumMaskLow },
    uSelfIllumMaskHigh: { value: tuning.selfIllumMaskHigh },
    uAlbedoCSB: { value: albedoCsb(morphic).vec },
    uHasAlbedoCSB: { value: albedoCsb(morphic).has },
    uNprTransmissiveColor: { value: transmissiveMap ?? whiteFallback() },
    uNprTransmissiveTint: { value: transmissiveTint(morphic) },
    uHasTransmissive: { value: transmissiveMap ? 1.0 : 0.0 },
    uTransStrength: { value: tuning.transStrength },
    uTransPower: { value: tuning.transPower },
    uDetailMap: { value: detailMap ?? whiteFallback() },
    uHasDetail: { value: detailMap ? 1.0 : 0.0 },
    uDetailTint: { value: detail.tint },
    uDetailBlendFactor: { value: detail.blendFactor },
    uDetailBlendMode: { value: detail.blendMode },
    uDetailUvOffset: { value: detail.uvOffset },
    uDetailUvScale: { value: detail.uvScale },
    uDetailUvRotation: { value: detail.uvRotation },
    uDetailUvChannel: { value: detail.uvChannel },
    uHasJitter: { value: hasJitter ? 1.0 : 0.0 },
    uJitterMap: { value: jitterMap ?? whiteFallback() },
    uHasJitterMask: { value: jitterMap ? 1.0 : 0.0 },
    uJitterSpeedA: { value: firstNumber(morphic, ['g_flJitterSpeedA1', 'g_flJitterSpeedA'], 0) },
    uJitterSpeedB: { value: firstNumber(morphic, ['g_flJitterSpeedB1', 'g_flJitterSpeedB'], 0) },
    uJitterStrength: { value: tuning.jitterStrength },
    uJitterFreqA: { value: vector3(morphic.vectors?.g_vJitterFrequenciesA1 ?? morphic.vectors?.g_vJitterFrequenciesA) },
    uJitterFreqB: { value: vector3(morphic.vectors?.g_vJitterFrequenciesB1 ?? morphic.vectors?.g_vJitterFrequenciesB) },
    uJitterAmpXA: { value: vector3(morphic.vectors?.g_vJitterAmplitudesXA1 ?? morphic.vectors?.g_vJitterAmplitudesXA) },
    uJitterAmpXB: { value: vector3(morphic.vectors?.g_vJitterAmplitudesXB1 ?? morphic.vectors?.g_vJitterAmplitudesXB) },
    uJitterAmpYA: { value: vector3(morphic.vectors?.g_vJitterAmplitudesYA1 ?? morphic.vectors?.g_vJitterAmplitudesYA) },
    uJitterAmpYB: { value: vector3(morphic.vectors?.g_vJitterAmplitudesYB1 ?? morphic.vectors?.g_vJitterAmplitudesYB) },
    uJitterAmpZA: { value: vector3(morphic.vectors?.g_vJitterAmplitudesZA1 ?? morphic.vectors?.g_vJitterAmplitudesZA) },
    uJitterAmpZB: { value: vector3(morphic.vectors?.g_vJitterAmplitudesZB1 ?? morphic.vectors?.g_vJitterAmplitudesZB) },
    uHasHighlight: { value: 0.0 },
    uHighlightTint: { value: new THREE.Color(0, 0, 0) },
    uHighlightCoverage: { value: 0.0 },
    uHighlightHardness: { value: 0.0 },
    uHighlightBrightness: { value: 0.0 },
    uHighlightInvert: { value: 0.0 },
    uHighlightPositionSource: { value: new THREE.Vector3(0, 0, 0) },
    uHighlightRadius: { value: 0.0 },
  };

  const csm = new CustomShaderMaterial({
    baseMaterial: base as THREE.MeshPhysicalMaterial,
    vertexShader: NPR_VERTEX,
    fragmentShader: NPR_FRAGMENT,
    uniforms,
    patchMap: NPR_PATCH_MAP,
  });
  configureCitadelGlassPass(csm as unknown as THREE.Material, uniforms);

  // These clones are the only GPU resources this wrap created (the base material
  // and its standard maps are owned by disposeScene). Fallback samplers point at
  // the shared white texture, which must NOT be disposed.
  const ownedTextures = tintMask ? [tintMask] : [];
  if (transmissiveMap) ownedTextures.push(transmissiveMap);
  if (detailMap) ownedTextures.push(detailMap);
  if (jitterMap) ownedTextures.push(jitterMap);
  return { material: csm as unknown as THREE.Material, uniforms, ownedTextures };
}

/**
 * Reverse CSM's in-place mutation of a base material. three-custom-shader-material,
 * when handed a material INSTANCE (not a class), patches that instance's
 * onBeforeCompile + customProgramCacheKey rather than a copy, stashing the
 * originals on `__csm`. So restoring mesh.material to the base is NOT enough to
 * toggle the cel shader off -- the base still compiles the NPR program. This puts
 * the original compile hooks back and forces a recompile.
 */
export function unwrapNprBase(mat: THREE.Material): void {
  const m = mat as THREE.Material & {
    __csm?: { prevOnBeforeCompile?: THREE.Material['onBeforeCompile'] };
    __nprPrevEmissiveIntensity?: number;
    __nprPrevColor?: THREE.Color;
  };
  if (m.__nprPrevColor) {
    (mat as THREE.MeshStandardMaterial).color.copy(m.__nprPrevColor);
    delete m.__nprPrevColor;
  }
  // Restore the baked emissive the NPR self-illum path zeroed (see wrapMaterialWithNpr).
  if (m.__nprPrevEmissiveIntensity !== undefined) {
    (mat as THREE.MeshStandardMaterial).emissiveIntensity = m.__nprPrevEmissiveIntensity;
    delete m.__nprPrevEmissiveIntensity;
  }
  if (!m.__csm) return;
  mat.onBeforeCompile = m.__csm.prevOnBeforeCompile ?? (() => { });
  delete m.__csm;
  // CSM set customProgramCacheKey as an own property; drop it to fall back to the
  // prototype default (it is non-optional on Material, hence the record cast).
  delete (mat as unknown as Record<string, unknown>).customProgramCacheKey;
  mat.needsUpdate = true;
}
