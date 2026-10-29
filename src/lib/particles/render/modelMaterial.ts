// Ported from ValveResourceFormat (MIT): Renderer/Shaders/pbr.vert.slang, pbr.frag.slang and
// pbr_features.slang, with common/texcoord_scale_by_model.slang, utils.slang (RotateVector2D),
// Renderer/Renderer/Materials/RenderMaterial.cs (EvalDeadlockColorMatrices, the blend and cull state)
// and ValveResourceFormat/Serialization/VfxEval/VfxEvalFunctions.cs (MatrixColorCorrect2,
// MatrixColorTint2, MatrixColorTint3).
//
// The material a particle model draws with: Deadlock's pbr.vfx, which VRF draws with its pbr shader.
// The unlit path is ported whole (the particle models' override materials are unlit): the colour
// texture with its scroll and transform, the tint mask, colour correction, texture tint and vertex
// colour, self illumination, the translucency and alternate translucency masks with their scroll and
// blend mode, the view angle fade, the opacity scale and alpha test (without its anti-aliasing), and the
// additive scale. A lit pbr material is drawn with its unlit albedo and self illumination, since the
// hero viewer's NPR lighting is not VRF's: a known gap, reported once. Other shaders draw nothing.
//
// GLSL 4.60 to GLSL ES 3.00 as for the spritecard shaders: uniforms set per draw, Source space
// throughout (the model matrix carries the node transform, the view matrix the host's
// Source-to-viewer transform). g_flTime is the host's uptime (`ParticleRendererContext.time`); VRF's
// is the renderer's, which the render oracle holds at 0. Material dynamic expressions are not
// evaluated, as VRF does not. Fog is not applied: Deadlock leaves particles unfogged.

import * as THREE from 'three';
import type { ParticleRendererContext } from './context';
import type { ParticleMaterialData } from './particleModels';
import { ParticleRenderTexture } from './textures';
import type { RenderView } from './view';

const LUMINANCE_WEIGHTS: [number, number, number] = [0.2125, 0.7154, 0.0721];

type Mat = number[];

/** System.Numerics Matrix4x4 product, row-vector convention, row-major storage. */
function multiply(a: Mat, b: Mat): Mat {
  const out = new Array<number>(16).fill(0);
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) for (let k = 0; k < 4; k++) out[r * 4 + c] += a[r * 4 + k] * b[k * 4 + c];
  return out;
}

const transpose = (m: Mat): Mat => [0, 4, 8, 12, 1, 5, 9, 13, 2, 6, 10, 14, 3, 7, 11, 15].map((i) => m[i]);
const scaleMatrix = (x: number, y: number, z: number): Mat => [x, 0, 0, 0, 0, y, 0, 0, 0, 0, z, 0, 0, 0, 0, 1];
const translation = (x: number, y: number, z: number): Mat => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1];

const luminanceNormalised = (() => {
  const length = Math.hypot(...LUMINANCE_WEIGHTS);
  return LUMINANCE_WEIGHTS.map((w) => w / length) as [number, number, number];
})();

/** Matrix4x4.CreateFromAxisAngle. */
function axisAngle(axis: [number, number, number], angle: number): Mat {
  const [x, y, z] = axis;
  const s = Math.sin(angle);
  const c = Math.cos(angle);
  const t = 1 - c;
  return [t * x * x + c, t * x * y + s * z, t * x * z - s * y, 0, t * x * y - s * z, t * y * y + c, t * y * z + s * x, 0,
    t * x * z + s * y, t * y * z - s * x, t * z * z + c, 0, 0, 0, 0, 1];
}

/** The rotation taking the luminance axis onto the Z axis. */
const LUMINANCE_ROTATION = (() => {
  const [x, y, z] = luminanceNormalised;
  const crossed: [number, number, number] = [y * 1 - z * 0, z * 0 - x * 1, x * 0 - y * 0];
  const length = Math.hypot(...crossed);
  const angle = Math.atan2(length, z);
  return axisAngle(crossed.map((v) => v / length) as [number, number, number], angle);
})();

/** VfxEvalFunctions.MatrixColorCorrect2: contrast about the colour offset, brightness, then saturation about luminance. */
export function matrixColorCorrect2(csb: [number, number, number], colorOffset: [number, number, number]): Mat {
  const [lx, ly, lz] = luminanceNormalised;
  let result = multiply(multiply(translation(-colorOffset[0], -colorOffset[1], -colorOffset[2]), scaleMatrix(csb[0], csb[0], csb[0])),
    translation(colorOffset[0], colorOffset[1], colorOffset[2]));
  result = multiply(result, scaleMatrix(csb[2], csb[2], csb[2]));
  result = multiply(result, scaleMatrix(lx, ly, lz));
  result = multiply(result, LUMINANCE_ROTATION);
  result = multiply(result, scaleMatrix(csb[1], csb[1], 1));
  result = multiply(result, transpose(LUMINANCE_ROTATION));
  result = multiply(result, scaleMatrix(1 / lx, 1 / ly, 1 / lz));
  return transpose(result);
}

/** VfxEvalFunctions.MatrixColorTint2: a luminance preserving tint. */
function matrixColorTint2(rgb: [number, number, number], strength: number): Mat {
  const max = Math.max(...rgb);
  const min = Math.min(...rgb);
  const saturation = max === 0 ? 0 : (max - min) / max;
  const lumScale = scaleMatrix(...luminanceNormalised);
  const toGray = multiply(lumScale, LUMINANCE_ROTATION);
  const gray = [0, 1, 2].map((c) => rgb[0] * toGray[c] + rgb[1] * toGray[4 + c] + rgb[2] * toGray[8 + c] + toGray[12 + c]);
  const desatXY = 1 - saturation;
  const satFactor = 1 - saturation * saturation * strength;
  let result = multiply(lumScale, LUMINANCE_ROTATION);
  result = multiply(result, translation(-gray[0], -gray[1], 0));
  result = multiply(result, scaleMatrix(desatXY, desatXY, satFactor));
  result = multiply(result, translation(gray[0], gray[1], (1 - satFactor) * gray[2]));
  result = multiply(result, transpose(LUMINANCE_ROTATION));
  result = multiply(result, scaleMatrix(1 / luminanceNormalised[0], 1 / luminanceNormalised[1], 1 / luminanceNormalised[2]));
  return transpose(result);
}

/** VfxEvalFunctions.MatrixColorTint3: 0 multiplies, 1 preserves luminance, 2 is mod2x. */
export function matrixColorTint3(rgb: [number, number, number], strength: number, mode: number): Mat {
  if (mode === 1) return matrixColorTint2(rgb, strength);
  if (mode === 2) return scaleMatrix(rgb[0] * 2, rgb[1] * 2, rgb[2] * 2);
  return scaleMatrix(rgb[0], rgb[1], rgb[2]);
}

function srgbGammaToLinear(c: number): number {
  return c > 0.04045 ? Math.pow(c / 1.055 + 0.0521327, 2.4) : c / 12.92;
}

const VERTEX = /* glsl */ `
precision highp float;
precision highp int;

uniform mat4 modelMatrix;
uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;

uniform vec4 uTint; // the node's tint (gamma) and alpha
uniform vec3 uModelScale;
uniform ivec4 uScaleTexCoordAxis; // U, V, U2, V2: 0 none, 1 X, 2 Y, 3 Z
uniform ivec4 uScaleTexCoordOrigin;
uniform bool uVertexColor;

in vec3 position;
in vec3 normal;
in vec2 uv;
in vec2 uv1;
in vec4 color;

out vec3 vNormalOut;
out vec4 vTexCoord;
out vec4 vVertexColorOut;

vec3 SrgbGammaToLinear(vec3 c)
{
    return mix(c / 12.92, pow(c / 1.055 + vec3(0.0521327), vec3(2.4)), step(vec3(0.04045), c));
}

float ScaleTexCoordByModel(float texCoord, int axis, float origin)
{
    if (axis == 0 || texCoord < 0.0)
    {
        return texCoord;
    }

    return (texCoord - origin) * uModelScale[axis - 1] + origin;
}

void main()
{
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    vNormalOut = normalize(mat3(modelMatrix) * normal);

    vVertexColorOut.rgb = SrgbGammaToLinear(uTint.rgb);
    vVertexColorOut.a = uTint.a;

    if (uVertexColor)
    {
        vVertexColorOut *= vec4(SrgbGammaToLinear(color.rgb), color.a);
    }

    vTexCoord = vec4(uv, uv1);

    // Only UV1 counts its V origin from the bottom edge
    vTexCoord.x = ScaleTexCoordByModel(vTexCoord.x, uScaleTexCoordAxis.x, float(uScaleTexCoordOrigin.x) * 0.5);
    vTexCoord.y = ScaleTexCoordByModel(vTexCoord.y, uScaleTexCoordAxis.y, 1.0 - float(uScaleTexCoordOrigin.y) * 0.5);
    vTexCoord.z = ScaleTexCoordByModel(vTexCoord.z, uScaleTexCoordAxis.z, float(uScaleTexCoordOrigin.z) * 0.5);
    vTexCoord.w = ScaleTexCoordByModel(vTexCoord.w, uScaleTexCoordAxis.w, float(uScaleTexCoordOrigin.w) * 0.5);
}
`;

const FRAGMENT = /* glsl */ `
precision highp float;
precision highp int;
precision highp sampler2D;

in vec3 vNormalOut;
in vec4 vTexCoord;
in vec4 vVertexColorOut;

out vec4 fragColor;

uniform float g_flTime;
uniform vec3 g_vCameraDirWs;

uniform sampler2D g_tColor;
uniform sampler2D g_tTintMask;
uniform sampler2D g_tAltTranslucency;
uniform sampler2D g_tSelfIllumMask;

uniform mat4 g_mAlbedoColorCorrect;
uniform mat4 g_mTextureColorTint;
uniform bool g_bMaskColorTint1;
uniform bool g_bMaskVertexColorTint1;
uniform bool g_bApplyTintToVertexColors;
uniform float g_fVertexColorStrength1;

uniform vec2 g_vAlbedoScrollSpeed1;
uniform float g_flAlbedoScrollQuantize1;
uniform vec2 g_vAlbedoTexcoordScale1;
uniform float g_flAlbedoTexcoordRotation1;
uniform vec2 g_vAlbedoTexcoordOffset1;
uniform vec2 g_vSelfIllumTexcoordScale1;
uniform float g_flSelfIllumTexcoordRotation1;
uniform vec2 g_vSelfIllumTexcoordOffset1;

uniform float g_flAlphaAnglePower1;
uniform float g_flOpacityScale1;
uniform float g_flAlphaTestReference1;
uniform int g_nTranslucencyBlendMode1;
uniform bool g_bUseSecondaryUvForTranslucency;
uniform bool g_bUseSecondaryUvForAltTranslucency;
uniform vec2 g_vTranslucentScrollSpeed0_1;
uniform float g_flTranslucentScrollQuantize0_1;
uniform vec2 g_vTranslucentScrollSpeed1_1;
uniform float g_flTranslucentScrollQuantize1_1;

uniform vec3 g_vSelfIllumTint1;
uniform float g_flSelfIllumScale1;
uniform float g_flSelfIllumAlbedoFactor1;
uniform bool g_bUseSecondaryUvForSelfIllum1;
uniform vec2 g_vSelfIllumScrollSpeed1;
uniform float g_flSelfIllumScrollQuantize1;

uniform float g_flUnlitAdditiveScale1;

float GetScrollTime(float quantize)
{
    return (quantize != 0.0) ? (floor(g_flTime / quantize + 0.5) * quantize) : g_flTime;
}

vec2 ScrollTexCoord(vec2 texCoord, vec2 speed, float quantize)
{
    return texCoord + fract(speed * GetScrollTime(quantize));
}

vec2 SelectTexCoord(bool useSecondary)
{
    return useSecondary ? vTexCoord.zw : vTexCoord.xy;
}

vec2 RotateVector2D(vec2 vectorInput, float rotation)
{
    rotation = radians(rotation);
    float sinRot = sin(rotation);
    float cosRot = cos(rotation);
    return vec2(dot(vec2(cosRot, -sinRot), vectorInput), dot(vec2(sinRot, cosRot), vectorInput));
}

vec2 RotateVector2D(vec2 vectorInput, float rotation, vec2 scale, vec2 offset)
{
    return scale * RotateVector2D(vectorInput - vec2(0.5), rotation) + vec2(0.5) + offset;
}

vec2 GetAlbedoTexCoord()
{
    vec2 texCoord = ScrollTexCoord(vTexCoord.xy, g_vAlbedoScrollSpeed1, g_flAlbedoScrollQuantize1);

#if F_ENABLE_TEXTURE_TRANSFORMS == 1
    texCoord = RotateVector2D(texCoord, g_flAlbedoTexcoordRotation1, g_vAlbedoTexcoordScale1, g_vAlbedoTexcoordOffset1);
#endif

    return texCoord;
}

void main()
{
    vec3 normal = normalize(gl_FrontFacing ? vNormalOut : -vNormalOut);
    vec2 albedoTexCoord = GetAlbedoTexCoord();
    vec4 color = texture(g_tColor, albedoTexCoord);
    float tintMask = texture(g_tTintMask, albedoTexCoord).x;

    float vertexColorAmount = (g_bMaskVertexColorTint1 ? tintMask : 1.0) * g_fVertexColorStrength1;
    vec3 albedo = color.rgb;

    if (g_bApplyTintToVertexColors)
    {
        albedo = mix(albedo, albedo * vVertexColorOut.rgb, vertexColorAmount);
    }

    albedo = (vec4(albedo, 1.0) * g_mAlbedoColorCorrect).rgb;
    albedo = mix(albedo, (vec4(albedo, 1.0) * g_mTextureColorTint).rgb, g_bMaskColorTint1 ? tintMask : 1.0);

    if (!g_bApplyTintToVertexColors)
    {
        albedo = mix(albedo, albedo * vVertexColorOut.rgb, vertexColorAmount);
    }

    vec3 illumTint = vec3(1.0);
    float illumMask = 1.0;
    float illumScale = 0.0;

#if F_SELF_ILLUM == 1
    vec2 selfIllumTexCoord = ScrollTexCoord(SelectTexCoord(g_bUseSecondaryUvForSelfIllum1), g_vSelfIllumScrollSpeed1, g_flSelfIllumScrollQuantize1);
#if F_ENABLE_TEXTURE_TRANSFORMS == 1
    selfIllumTexCoord = RotateVector2D(selfIllumTexCoord, g_flSelfIllumTexcoordRotation1, g_vSelfIllumTexcoordScale1, g_vSelfIllumTexcoordOffset1);
#endif
    illumMask = texture(g_tSelfIllumMask, selfIllumTexCoord).x;
    illumScale = g_flSelfIllumScale1;
    illumTint = mix(g_vSelfIllumTint1, g_vSelfIllumTint1 * albedo, g_flSelfIllumAlbedoFactor1);
#endif

    float illumAmount = illumMask * clamp(illumScale, 0.0, 1.0);
    vec3 matAlbedo = mix(albedo, illumTint, illumAmount);
    vec3 illumColor = matAlbedo * (illumMask * illumScale);
    float opacity = 1.0;

#if FADED_OPACITY == 1
#if F_ADVANCED_TRANSLUCENCY == 1
    vec2 translucencyTexCoord = ScrollTexCoord(SelectTexCoord(g_bUseSecondaryUvForTranslucency), g_vTranslucentScrollSpeed0_1, g_flTranslucentScrollQuantize0_1);
    vec2 altTranslucencyTexCoord = ScrollTexCoord(SelectTexCoord(g_bUseSecondaryUvForAltTranslucency), g_vTranslucentScrollSpeed1_1, g_flTranslucentScrollQuantize1_1);

    float translucency = texture(g_tColor, translucencyTexCoord).a;
    float altTranslucency = texture(g_tAltTranslucency, altTranslucencyTexCoord).x;

    float alpha = (g_nTranslucencyBlendMode1 == 0)
        ? (translucency * altTranslucency)
        : ((g_nTranslucencyBlendMode1 == 1) ? clamp(translucency + altTranslucency, 0.0, 1.0) : clamp(translucency - altTranslucency, 0.0, 1.0));
#else
    float alpha = color.a;
#endif

    // Fades the surface by how squarely it faces the camera; a negative power fades the silhouette
    vec2 angleScaleBias = (g_flAlphaAnglePower1 < 0.0) ? vec2(-1.0, 1.0) : vec2(1.0, 0.0);
    float angleFade = pow(max(0.001, angleScaleBias.x * abs(dot(g_vCameraDirWs, normal)) + angleScaleBias.y), abs(g_flAlphaAnglePower1));

    opacity = vVertexColorOut.a * alpha * angleFade;

#if F_TRANSLUCENT == 1
    opacity *= g_flOpacityScale1;
#endif
#elif F_ALPHA_TEST == 1
    opacity = color.a;
#endif

#if F_ALPHA_TEST == 1
    if (opacity < g_flAlphaTestReference1)
    {
        discard;
    }
    opacity = 1.0;
#endif

#if F_UNLIT == 1
    vec3 outputColor = matAlbedo * ((F_ADDITIVE_BLEND == 1) ? g_flUnlitAdditiveScale1 : 1.0);
#else
    vec3 outputColor = matAlbedo + illumColor;
#endif

#if F_ADDITIVE_BLEND == 1
    outputColor *= opacity;
#endif

    fragColor = vec4(outputColor, opacity);
}
`;

const reported = new Set<string>();

/** The uniform defaults pbr.frag declares, before the material's params. */
const DEFAULT_FLOATS: Record<string, number> = {
  g_fVertexColorStrength1: 1, g_flAlbedoScrollQuantize1: 0, g_flAlbedoTexcoordRotation1: 0, g_flSelfIllumTexcoordRotation1: 0,
  g_flAlphaAnglePower1: 0, g_flOpacityScale1: 1, g_flAlphaTestReference1: 0.5, g_flTranslucentScrollQuantize0_1: 0,
  g_flTranslucentScrollQuantize1_1: 0, g_flSelfIllumScale1: 0, g_flSelfIllumAlbedoFactor1: 1, g_flSelfIllumScrollQuantize1: 0,
  g_flUnlitAdditiveScale1: 1,
};
const DEFAULT_VEC2: Record<string, [number, number]> = {
  g_vAlbedoScrollSpeed1: [0, 0], g_vAlbedoTexcoordScale1: [1, 1], g_vAlbedoTexcoordOffset1: [0, 0], g_vSelfIllumTexcoordScale1: [1, 1],
  g_vSelfIllumTexcoordOffset1: [0, 0], g_vTranslucentScrollSpeed0_1: [0, 0], g_vTranslucentScrollSpeed1_1: [0, 0], g_vSelfIllumScrollSpeed1: [0, 0],
};
const DEFAULT_BOOLS: Record<string, boolean> = {
  g_bMaskColorTint1: true, g_bMaskVertexColorTint1: true, g_bApplyTintToVertexColors: false, g_bUseSecondaryUvForTranslucency: false,
  g_bUseSecondaryUvForAltTranslucency: false, g_bUseSecondaryUvForSelfIllum1: false,
};
/** The textures the shader samples, whether each is read from sRGB, and the default a material without one binds. */
const TEXTURES: [string, boolean, string][] = [
  ['g_tColor', true, 'materials/default/default_color.vtex'],
  ['g_tTintMask', false, 'materials/default/default_mask.vtex'],
  ['g_tAltTranslucency', false, 'materials/default/default_mask.vtex'],
  ['g_tSelfIllumMask', false, 'materials/default/default_mask.vtex'],
];

export class ModelMaterial {
  readonly material: THREE.RawShaderMaterial;
  private readonly uniforms: Record<string, THREE.IUniform>;
  private readonly textures: [string, ParticleRenderTexture][] = [];
  private readonly white: THREE.DataTexture;

  constructor(data: ParticleMaterialData, context: ParticleRendererContext, vertexColors: boolean) {
    const ints = data.intParams;
    const feature = (name: string) => (ints[name] ?? 0) !== 0 ? 1 : 0;
    const unlit = feature('F_UNLIT');
    const translucent = feature('F_TRANSLUCENT');
    const alphaTest = feature('F_ALPHA_TEST');
    const additive = feature('F_ADDITIVE_BLEND');
    const supported = data.shader === 'pbr.vfx';

    if ((!supported || !unlit) && !reported.has(data.name)) {
      reported.add(data.name);
      console.warn(`[particles] ${data.name}: ${supported ? 'lit pbr is drawn unlit' : `shader ${data.shader} is not drawn`}`);
    }

    const defines = {
      F_UNLIT: unlit,
      F_TRANSLUCENT: translucent,
      F_ALPHA_TEST: alphaTest,
      F_ADVANCED_TRANSLUCENCY: feature('F_ADVANCED_TRANSLUCENCY'),
      F_ADDITIVE_BLEND: additive,
      F_ENABLE_TEXTURE_TRANSFORMS: feature('F_ENABLE_TEXTURE_TRANSFORMS'),
      F_SELF_ILLUM: feature('F_SELF_ILLUM'),
      // Translucency runs the alpha through the view angle fade, and unlit alpha test tests the faded value
      FADED_OPACITY: translucent === 1 || (unlit === 1 && alphaTest === 1) ? 1 : 0,
    };

    this.white = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1, THREE.RGBAFormat);
    this.white.needsUpdate = true;

    const float = (name: string) => data.floatParams[name] ?? DEFAULT_FLOATS[name] ?? 0;
    const vec2 = (name: string) => {
      const value = data.vectorParams[name];
      const fallback = DEFAULT_VEC2[name] ?? [0, 0];
      return new THREE.Vector2(value?.[0] ?? fallback[0], value?.[1] ?? fallback[1]);
    };
    const bool = (name: string) => (name in ints ? ints[name] !== 0 : DEFAULT_BOOLS[name] ?? false);
    const vec3 = (name: string, fallback: [number, number, number]) => {
      const value = data.vectorParams[name];
      return value ? [value[0], value[1], value[2]] as [number, number, number] : fallback;
    };

    // EvalDeadlockColorMatrices: pbr's unsuffixed pair reads layer 1's params. The colour texture's
    // average colour pivots the contrast; the bundle does not carry it, so it is taken as white, which
    // only matters for a contrast other than 1.
    const colorCorrect = matrixColorCorrect2(vec3('g_vAlbedoContrastSaturationBrightness1', [1, 1, 1]), [1, 1, 1]);
    const tint = vec3('g_vColorTint1', [1, 1, 1]).map(srgbGammaToLinear) as [number, number, number];
    const colorTint = matrixColorTint3(tint, 0.85, ints.g_nTextureColorTintMode1 ?? 0);

    const axis = ['g_nScaleTexCoordUByModelScaleAxis', 'g_nScaleTexCoordVByModelScaleAxis', 'g_nScaleTexCoord2UByModelScaleAxis', 'g_nScaleTexCoord2VByModelScaleAxis'];
    const origin = ['g_nScaleTexCoordUByModelScaleOrigin', 'g_nScaleTexCoordVByModelScaleOrigin', 'g_nScaleTexCoord2UByModelScaleOrigin', 'g_nScaleTexCoord2VByModelScaleOrigin'];
    const originDefaults = [0, 2, 0, 2];

    this.uniforms = {
      uTint: { value: new THREE.Vector4(1, 1, 1, 1) },
      uModelScale: { value: new THREE.Vector3(1, 1, 1) },
      uScaleTexCoordAxis: { value: axis.map((name) => ints[name] ?? 0) },
      uScaleTexCoordOrigin: { value: origin.map((name, i) => ints[name] ?? originDefaults[i]) },
      uVertexColor: { value: vertexColors && (feature('F_VERTEX_COLOR') === 1 || feature('F_PAINT_VERTEX_COLORS') === 1) },
      g_flTime: { value: 0 },
      g_vCameraDirWs: { value: new THREE.Vector3(1, 0, 0) },
      g_mAlbedoColorCorrect: { value: new THREE.Matrix4().fromArray(colorCorrect) },
      g_mTextureColorTint: { value: new THREE.Matrix4().fromArray(colorTint) },
      g_vSelfIllumTint1: { value: new THREE.Vector3(...vec3('g_vSelfIllumTint1', [1, 1, 1]).map(srgbGammaToLinear)) },
      g_nTranslucencyBlendMode1: { value: ints.g_nTranslucencyBlendMode1 ?? 0 },
    };

    for (const name of Object.keys(DEFAULT_FLOATS)) this.uniforms[name] = { value: float(name) };
    for (const name of Object.keys(DEFAULT_VEC2)) this.uniforms[name] = { value: vec2(name) };
    for (const name of Object.keys(DEFAULT_BOOLS)) this.uniforms[name] = { value: bool(name) };

    for (const [name, srgbRead, fallback] of TEXTURES) {
      const path = data.textureParams[name] ?? fallback;
      const texture = new ParticleRenderTexture(path, srgbRead, false, context.textures);
      this.textures.push([name, texture]);
      this.uniforms[name] = { value: this.white };
    }

    this.material = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      defines,
      uniforms: this.uniforms,
      toneMapped: false,
      fog: false,
      visible: supported,
    });

    // RenderMaterial: translucency blends the unpremultiplied colour, additively when the material adds
    // (its compiled blend's destination is One), and writes no depth; F_RENDER_BACKFACES draws both faces
    const blends = translucent === 1 || additive === 1 || data.intAttributes.translucent === 1;
    this.material.transparent = blends;
    this.material.depthWrite = !blends && feature('F_DISABLE_DEPTH_WRITE') === 0;
    this.material.side = feature('F_RENDER_BACKFACES') === 1 ? THREE.DoubleSide : THREE.FrontSide;
    this.material.depthTest = feature('F_DISABLE_Z_BUFFERING') === 0;

    if (blends) {
      this.material.blending = THREE.CustomBlending;
      this.material.blendEquation = THREE.AddEquation;
      this.material.blendSrc = THREE.SrcAlphaFactor;
      this.material.blendDst = additive === 1 ? THREE.OneFactor : THREE.OneMinusSrcAlphaFactor;
      this.material.blendSrcAlpha = null;
      this.material.blendDstAlpha = null;
      this.material.blendEquationAlpha = null;
    } else {
      this.material.blending = THREE.NoBlending;
    }
  }

  setTint(tint: [number, number, number], alpha: number): void {
    (this.uniforms.uTint.value as THREE.Vector4).set(tint[0], tint[1], tint[2], alpha);
  }

  setModelScale(scale: [number, number, number]): void {
    (this.uniforms.uModelScale.value as THREE.Vector3).set(scale[0], scale[1], scale[2]);
  }

  /** The per frame constants, and textures that arrived since the last frame. */
  update(view: RenderView, context: ParticleRendererContext): void {
    this.uniforms.g_flTime.value = context.time;
    (this.uniforms.g_vCameraDirWs.value as THREE.Vector3).set(view.forward.x, view.forward.y, view.forward.z);

    for (const [name, texture] of this.textures) {
      texture.resolve(context.maxAnisotropy);
      this.uniforms[name].value = texture.texture ?? this.white;
    }
  }

  dispose(): void {
    for (const [, texture] of this.textures) texture.dispose();
    this.white.dispose();
    this.material.dispose();
  }
}
