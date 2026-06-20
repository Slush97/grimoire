import * as THREE from 'three';
import CustomShaderMaterial, { type CSMPatchMap } from 'three-custom-shader-material/vanilla';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';

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
  rimStrength: 0.6,
  rimPower: 3.0,
  rimColor: new THREE.Color(0.6, 0.75, 1.0),
  nprStrength: 1.0,
  aoStrength: 1.0,
  transStrength: 0.35,
  transPower: 2.0,
  selfIllumCap: 1.5,
  selfIllumSat: 1.6,
  keyDir: new THREE.Vector3(3, 5, 4).normalize(),
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
    !c ||
    (Math.abs((c[0] ?? 1) - 1) < 1e-4 &&
      Math.abs((c[1] ?? 1) - 1) < 1e-4 &&
      Math.abs((c[2] ?? 1) - 1) < 1e-4);
  return { vec: new THREE.Vector3(c?.[0] ?? 1, c?.[1] ?? 1, c?.[2] ?? 1), has: identity ? 0 : 1 };
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
      const fallbackBlendMode = flag(morphic, 'F_ADDITIVE_BLEND')
        ? 'additive'
        : flag(morphic, 'F_TRANSLUCENT') || flag(morphic, 'F_ADVANCED_TRANSLUCENCY')
          ? 'blend_zwrite'
          : 'opaque';
      const blendMode = morphic.blend_mode ?? fallbackBlendMode;
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
        standard.roughness = Math.min(standard.roughness ?? 1, 0.18);
        standard.metalness = Math.min(standard.metalness ?? 0, 0.05);
        standard.envMapIntensity = Math.max(standard.envMapIntensity ?? 1, 1.35);
        if (isPhysicalMaterial) {
          physical.transmission = Math.max(physical.transmission ?? 0, 0.85);
          physical.thickness = Math.max(physical.thickness ?? 0, 0.12);
          physical.ior = firstNumber(morphic, ['g_flIOR'], physical.ior ?? 1.5);
          physical.clearcoat = Math.max(physical.clearcoat ?? 0, 0.45);
          physical.clearcoatRoughness = Math.min(physical.clearcoatRoughness ?? 0.25, 0.18);
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
varying vec2 vNprUv;
varying vec2 vNprUv2;
varying vec3 vNprSourcePosition;
void main() {
  #ifdef USE_UV
    vNprUv = uv;
  #else
    vNprUv = vec2(0.0);
  #endif
  #ifdef USE_UV2
    vNprUv2 = uv2;
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
uniform float uTime;
uniform sampler2D uSelfIllumMap;
uniform float uHasSelfIllum;
uniform vec2  uSelfIllumScroll;
uniform vec3  uSelfIllumTint;
uniform float uSelfIllumScale;
uniform float uSelfIllumAlbedoFactor;
uniform float uSelfIllumCap;
uniform float uSelfIllumSat;
uniform vec3  uAlbedoCSB;
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

// Pre-light albedo contrast/saturation/brightness (g_vAlbedoContrastSaturationBrightness1
// = [contrast, saturation, brightness]). Source 2 pbr.vfx order: brightness, then
// saturation (lerp from luma), then contrast (lerp about mid-grey). Linear, no clamp -
// the tonemap downstream handles overbright (viscous brightness 1.6).
vec3 applyAlbedoCSB(vec3 c, vec3 csb) {
  c *= csb.z;
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(vec3(l), c, csb.y);
  c = mix(vec3(0.5), c, csb.x);
  return c;
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
  vec4 nprMask = uHasTintMask > 0.5 ? texture2D(uTintRimMask, vNprUv) : vec4(1.0);
  vec3 nprDetail = vec3(0.0);
  float tintEnable = uHasTintMask > 0.5 ? nprMask.r : 0.0;
  // Vertex color as albedo, but ONLY when the material declares it (F_VERTEX_COLOR /
  // F_PAINT_VERTEX_COLORS). three's GLTFLoader turns USE_COLOR on for ANY mesh that
  // ships a COLOR_0 attribute, but on Deadlock tint-MASK materials
  // (g_bMaskVertexColorTint1) that COLOR_0 is a tint mask, frequently authored as
  // (0,0,0) "no tint here" - multiplying albedo by it blacks the mesh out (Celeste's
  // dress ships COLOR_0 = (0,0,0,0)). uApplyVertexColor is 1 only for true
  // vertex-color-albedo materials, so a mask-only COLOR_0 is left alone.
  #if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA )
    if (uApplyVertexColor > 0.5) csm_DiffuseColor *= vColor;
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
  // uTintColor defaults to white (identity); it is driven only by an external
  // recolor override. The authoring tint g_vColorTint1 is already baked into the
  // base color factor by vpkmerge, so it must NOT be re-applied here.
  csm_DiffuseColor.rgb = mix(csm_DiffuseColor.rgb, csm_DiffuseColor.rgb * uTintColor, tintEnable);
  // CSB (NPR plan D2): pre-light albedo shaping. Gated so [1,1,1] heroes are
  // byte-unchanged. Runs after the recolor tint (engine order: tint then CSB) and
  // before lighting, so the self-illum albedo mix downstream sees the shaped albedo.
  if (uHasAlbedoCSB > 0.5) {
    csm_DiffuseColor.rgb = applyAlbedoCSB(csm_DiffuseColor.rgb, uAlbedoCSB);
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
    '#include <lights_fragment_end>': {
      type: 'fs',
      value: /* glsl */ `
      #include <lights_fragment_end>
      if (uNprCel > 0.5 && uCelV2 > 0.5) {
        vec3 nprDirect = reflectedLight.directDiffuse;
        float nprDirectLum = dot(nprDirect, vec3(0.2126, 0.7152, 0.0722));
        float nprDirectQ = celQuantize(clamp(nprDirectLum, 0.0, 1.0), uBands, uStepSharpness);
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
      vNprSourcePosition = transformed;
    `,
    },
    '#include <opaque_fragment>': /* glsl */ `
      #include <opaque_fragment>
      {
        vec3 nprLit = gl_FragColor.rgb;
        #ifdef FLAT_SHADED
          vec3 nprN = normalize(cross(dFdx(vViewPosition), dFdy(vViewPosition)));
        #else
          vec3 nprN = normalize(vNormal);
        #endif
        vec3 nprV = normalize(vViewPosition);
        vec3 nprL = normalize(uKeyDir);

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
            nprCel = nprLit * (nprLum > 1e-4 ? clamp(nprQ / nprLum, 0.0, 4.0) : 1.0);
          }
          // Rim: fresnel edge, gated to the lit hemisphere, modulated by mask G (or
          // the default when no mask).
          float nprRimMaskG = uHasTintMask > 0.5 ? nprMask.g : uRimMaskDefault;
          float nprFres = pow(clamp(1.0 - abs(dot(nprN, nprV)), 0.0, 1.0), uRimPower);
          float nprGate = smoothstep(-uWrap, 1.0, dot(nprN, nprL));
          nprRim = nprFres * nprGate * nprRimMaskG * uRimStrength;
        }

        vec3 nprOut = nprCel + uRimColor * nprRim;

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

        // Self-illum (NPR plan D5/F2): scale-first, additive glow. Color is the
        // tint<->albedo blend per g_flSelfIllumAlbedoFactor1 (familiar eyes glow
        // their cyan tint at factor 0; viscous_head glows its green albedo at
        // factor 1; inferno body mixes fire albedo + tint). diffuseColor.rgb holds
        // the per-texel BASE albedo (unlit) here - correct for emission, which is
        // view/shadow-independent. uHasSelfIllum is now scale-driven;
        // a placeholder mask resolves to solid white (full coverage) on the CPU
        // side. The GLB-baked base emissive is zeroed so this is the sole glow owner.
        if (uHasSelfIllum > 0.5) {
          vec2 siUv = fract(vNprUv + uSelfIllumScroll * uTime);
          float siMask = texture2D(uSelfIllumMap, siUv).r;
          vec3 siColor = mix(uSelfIllumTint, diffuseColor.rgb, uSelfIllumAlbedoFactor);
          // Chroma boost: a pale authored tint (familiar eyes cyan [0.27,0.88,1] is
          // luma-heavy) ACES-washes to white even when capped, because its red channel
          // stays high. Push saturation about the luma axis so the off-hue channel drops
          // and it reads as its color; a neutral/white tint (luma == channels) is left as
          // is. Clamp >= 0 since over-saturation can drive a channel negative.
          float siLuma = dot(siColor, vec3(0.2126, 0.7152, 0.0722));
          siColor = max(mix(vec3(siLuma), siColor, uSelfIllumSat), 0.0);
          vec3 siAdd = siColor * (siMask * uSelfIllumScale);
          if (uHasDetail > 0.5 && uDetailBlendMode > 0.5 && uDetailBlendMode < 1.5) {
            siAdd += nprDetail * (uDetailBlendFactor * siMask * uSelfIllumScale);
          }
          // Hue-preserving cap: a high authored self-illum scale (familiar eyes cyan
          // at 2.6, inferno at 10) pushes a saturated tint into HDR where the
          // downstream ACES tonemap desaturates it to white (the in-game glow leans on
          // HDR + bloom the preview lacks). Scale the whole additive down by its peak
          // channel so the tint HUE survives the tonemap - trades unreachable HDR
          // brightness for a readable color. Subtler glows (peak <= cap) are untouched.
          float siPeak = max(max(siAdd.r, siAdd.g), siAdd.b);
          if (siPeak > uSelfIllumCap) siAdd *= uSelfIllumCap / siPeak;
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

  const tintMask = morphic.resolvedTextures?.g_tTintMaskRimLightMask ?? null;
  const sharedTransmissive = morphic.resolvedTextures?.g_tNprTransmissiveColor;
  const transmissiveMap = isMeaningfulMask(sharedTransmissive) ? sharedTransmissive.clone() : null;
  if (transmissiveMap) {
    transmissiveMap.colorSpace = THREE.SRGBColorSpace;
    transmissiveMap.needsUpdate = true;
  }
  // Default to white (identity). g_vColorTint1 is already baked into the base
  // color factor by vpkmerge; re-reading it here would double-apply the tint.
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
    uTime: { value: 0 },
    uSelfIllumMap: { value: hasSelfIllum ? selfIllumMap : whiteFallback() },
    uHasSelfIllum: { value: hasSelfIllum ? 1.0 : 0.0 },
    uSelfIllumScroll: { value: new THREE.Vector2(siScroll?.[0] ?? 0, siScroll?.[1] ?? 0) },
    uSelfIllumTint: { value: siTint },
    uSelfIllumScale: { value: siScale },
    // Parity with the unified path: the shared GLSL references these uniforms, so
    // the legacy wrap must declare them too or the material fails to compile.
    uSelfIllumAlbedoFactor: { value: firstNumber(morphic, ['g_flSelfIllumAlbedoFactor1'], 0) },
    uSelfIllumCap: { value: tuning.selfIllumCap },
    uSelfIllumSat: { value: tuning.selfIllumSat },
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

  // These clones are the only GPU resources this wrap created (the base material
  // and its standard maps are owned by disposeScene). Fallback samplers point at
  // the shared white texture, which must NOT be disposed.
  const ownedTextures = tintMask ? [tintMask] : [];
  if (transmissiveMap) ownedTextures.push(transmissiveMap);
  if (detailMap) ownedTextures.push(detailMap);
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
  };
  // Restore the baked emissive the NPR self-illum path zeroed (see wrapMaterialWithNpr).
  if (m.__nprPrevEmissiveIntensity !== undefined) {
    (mat as THREE.MeshStandardMaterial).emissiveIntensity = m.__nprPrevEmissiveIntensity;
    delete m.__nprPrevEmissiveIntensity;
  }
  if (!m.__csm) return;
  mat.onBeforeCompile = m.__csm.prevOnBeforeCompile ?? (() => {});
  delete m.__csm;
  // CSM set customProgramCacheKey as an own property; drop it to fall back to the
  // prototype default (it is non-optional on Material, hence the record cast).
  delete (mat as unknown as Record<string, unknown>).customProgramCacheKey;
  mat.needsUpdate = true;
}

export interface NprOutlineParams {
  /** True when the mesh is outline-eligible (real outline tint present, not disabled). */
  enabled: boolean;
  /** Why disabled: '' when enabled, else the gate that closed it. */
  reason: '' | 'no-outline-tint' | 'disabled-flag';
  /** Shell color: g_vSolidOutlineTint + g_vSolidOutlineAdditive. */
  tint: THREE.Color;
  /** Inverted-hull push distance in object space, clamped to OUTLINE_*_THICKNESS. */
  thickness: number;
}

// Inverted-hull thickness bounds (object space). The default matches the small
// shell the in-game outline reads as; the max keeps a pathological authored value
// (e.g. one in engine units) from inflating into a giant shell that detaches from
// the body. We deliberately do NOT convert engine units (that would be guessing a
// Source 2 constant); we only bound the value to a visually safe range.
export const OUTLINE_DEFAULT_THICKNESS = 0.02;
export const OUTLINE_MIN_THICKNESS = 0.002;
export const OUTLINE_MAX_THICKNESS = 0.05;

/**
 * Pure outline eligibility + parameters from a material's morphic extras (F8).
 * Split out of buildOutlineShell so eligibility / tint / thickness are testable
 * without constructing a real mesh + skeleton. Eligibility keys on the PRESENCE of
 * g_vSolidOutlineTint (the real outline data confirmed in vpkmerge fixtures);
 * F_DISABLE_NPR_OUTLINE opts out. Thickness is clamped (see OUTLINE_*_THICKNESS).
 */
export function outlineParams(morphic: MorphicExtras): NprOutlineParams {
  const tintVec = morphic.vectors?.g_vSolidOutlineTint;
  if (!tintVec) {
    return {
      enabled: false,
      reason: 'no-outline-tint',
      tint: new THREE.Color(0, 0, 0),
      thickness: OUTLINE_DEFAULT_THICKNESS,
    };
  }
  const addVec = morphic.vectors?.g_vSolidOutlineAdditive;
  const tint = new THREE.Color(
    (tintVec[0] ?? 0) + (addVec?.[0] ?? 0),
    (tintVec[1] ?? 0) + (addVec?.[1] ?? 0),
    (tintVec[2] ?? 0) + (addVec?.[2] ?? 0)
  );
  if (scalar(morphic.ints?.F_DISABLE_NPR_OUTLINE, 0) === 1) {
    return { enabled: false, reason: 'disabled-flag', tint, thickness: OUTLINE_DEFAULT_THICKNESS };
  }
  const raw =
    scalar(morphic.floats?.g_flOverrideNprOutlineThickness, OUTLINE_DEFAULT_THICKNESS) ||
    OUTLINE_DEFAULT_THICKNESS;
  const thickness = Math.min(Math.max(raw, OUTLINE_MIN_THICKNESS), OUTLINE_MAX_THICKNESS);
  return { enabled: true, reason: '', tint, thickness };
}

/**
 * Build the inverted-hull solid-color outline shell for a mesh, or null when the
 * mesh is not outline-eligible. Faithful to Source 2's method (vpkmerge strips
 * the engine shells from the export, so they are regenerated here). The shell is
 * added as a child of `mesh` so it inherits the mesh transform; for a SkinnedMesh
 * it binds the SAME skeleton + bindMatrix so it deforms with the body. Returns a
 * teardown that removes the shell and disposes ONLY the outline material
 * (geometry + skeleton are shared with the real mesh).
 *
 * Gated behind USE_NPR_OUTLINE in the viewer (default off): the skinned-shell
 * binding is the highest-risk piece, so it ships independently of ramp/rim/tint.
 * Eligibility keys on the PRESENCE of g_vSolidOutlineTint (the real outline data
 * confirmed in vpkmerge fixtures); F_DISABLE_NPR_OUTLINE, when present, opts out.
 */
export function buildOutlineShell(mesh: THREE.Mesh): (() => void) | null {
  const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  const base = mats[0];
  const morphic = base ? getMorphic(base) : undefined;
  if (!morphic) return null;
  const params = outlineParams(morphic);
  if (!params.enabled) return null;

  const outlineMat = new CustomShaderMaterial({
    baseMaterial: new THREE.MeshBasicMaterial({ side: THREE.BackSide }),
    vertexShader: /* glsl */ `
      uniform float uThickness;
      void main() { csm_Position = position + normal * uThickness; }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uOutlineTint;
      void main() { csm_FragColor = vec4(uOutlineTint, 1.0); }
    `,
    uniforms: {
      uThickness: { value: params.thickness },
      uOutlineTint: { value: params.tint },
    },
  });

  const skinned = mesh as THREE.SkinnedMesh;
  let shell: THREE.Mesh;
  if (skinned.isSkinnedMesh) {
    const s = new THREE.SkinnedMesh(mesh.geometry, outlineMat as unknown as THREE.Material);
    // Same skeleton + bindMatrix so the shell deforms with the body. The hull is
    // expanded in object space before skinning, so it follows the bones.
    s.bind(skinned.skeleton, skinned.bindMatrix);
    shell = s;
  } else {
    shell = new THREE.Mesh(mesh.geometry, outlineMat as unknown as THREE.Material);
  }
  shell.frustumCulled = false;
  mesh.add(shell);

  return () => {
    mesh.remove(shell);
    // Geometry + skeleton are SHARED with the real mesh; dispose only the material.
    outlineMat.dispose();
  };
}
