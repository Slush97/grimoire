import * as THREE from 'three';

/**
 * Deadlock (Citadel) NPR hero lighting, as the game's pbr.vfx forward pass
 * evaluates it for materials with F_USE_NPR_LIGHTING.
 *
 * The engine drives this lighting with scene-wide settings that no hero
 * material carries; they ship in the game's NPR settings material
 * (materials/dev/npr_dummy.vmat). `CITADEL_NPR` mirrors those values.
 *
 * Behavior in short (all in the shader below, in three.js world space):
 *  - Albedo: color texture after the authored correction and tint. Color alpha is
 *    metalness. Self-illum blends the albedo toward its glow color where masked.
 *  - Ambient ("bounce"): NOT the normal's irradiance. A stepped half-Lambert
 *    toward the primary light picks a direction between straight down, the
 *    horizontal direction to the camera and straight up. The ambient cube is
 *    sampled there, then its luminance is replaced by a fixed target (up 1.0,
 *    sides 0.5, down 0.1, divided by exposure) while keeping its hue. Heroes
 *    therefore read the same in every map. An optional transmissive color adds
 *    upward ambient on the dark side.
 *  - Direct lights: wrapped, power-stepped diffuse (a soft two-tone terminator),
 *    blended a quarter of the way back to Lambert. Specular stays a regular GGX
 *    lobe (stepped specular is off in the shipped settings).
 *  - Rim: view-grazing wrap, only on upward facing normals, scaled by the rim
 *    mask (tint mask green) and AO, colored by the incoming light, NOT by albedo.
 *    A depth test then keeps it only where the scene a little above and outward
 *    of the surface is clearly farther away, i.e. on the hero's silhouette, not
 *    inside folds.
 *  - Reflections: environment radiance times a split-sum response, rescaled by the
 *    ratio of the NPR ambient to the probe's own ambient luminance, with a
 *    specular occlusion term from AO.
 *  - Emission: albedo (after the self-illum blend) times mask times scale.
 *
 * Light units: the game's light colors carry no 1/PI, so a three.js light of
 * irradiance E maps to E / PI here. The ambient cube uses the same convention.
 */
export const CITADEL_NPR = {
  diffuseStepSharpness: 0.9,
  directLightWrap: 0.8,
  diffusePbrBlend: 0.25,
  exposureTargets: [1.0, 0.5, 0.1] as const,
  dfaoInfluenceRange: [0.4, 1.0] as const,
  primaryLightCameraWeight: 0.35,
  rimLightWrap: 0.7,
  rimLightFalloff: 0.7,
  rimLightStrength: 2.0,
  rimLightUpRamp: 0.2,
  outlineThickness: 0.1,
  outlineDark: [0.039216, 0.003922, 0.003922, 0.74902] as const,
  outlineBright: [0.039216, 0.003922, 0.003922, 0.74902] as const,
  /** Rim depth occlusion, in game units (the GLB's model units). */
  rimOcclusionSampleDistance: 0.5,
  rimOcclusionToleranceMin: 2.5,
  rimOcclusionToleranceRange: 0.5,
} as const;

/** Power-step: an S curve around 0.5 whose steepness grows with `sharpness`. */
export function powerStep(value: number, sharpness: number): number {
  const k = 1 / (1 - sharpness);
  const hi = value > 0.5;
  const m = hi ? 1 - value : value;
  const edge = Math.pow(0.5, 1 - k) * Math.pow(Math.max(m, 0), k);
  return hi ? 1 - edge : edge;
}

/** The wrapped, stepped direct-light response before normalization. */
export function wrappedStepResponse(nDotL: number, wrap: number, sharpness: number): number {
  const w = Math.min(1, Math.max(0, 2 * (nDotL + wrap) - 1.5));
  return powerStep(w, sharpness);
}

/**
 * Energy normalization for the stepped direct light: the wrapped response lights
 * more of the sphere than Lambert, so it is scaled by Lambert's sphere integral
 * over its own. With the shipped settings this is 0.625.
 */
export function directLightNormalization(wrap: number = CITADEL_NPR.directLightWrap, sharpness: number = CITADEL_NPR.diffuseStepSharpness): number {
  const steps = 4096;
  let stepped = 0;
  for (let i = 0; i < steps; i++) {
    const mu = -1 + (2 * (i + 0.5)) / steps;
    stepped += wrappedStepResponse(Math.max(mu, -1), wrap, sharpness) * (2 / steps);
  }
  // Sphere integrals with the common 2*PI factored out: Lambert integrates to 1/2.
  return 0.5 / stepped;
}

/** Luminance weights the game uses for its ambient renormalization. */
const LUMA = new THREE.Vector3(0.2125, 0.7154, 0.0721);

/**
 * A first-order luminance fit of a 6-face ambient cube (three.js world axes,
 * order +X, -X, +Y, -Y, +Z, -Z): dot(vec4(n, 1), fit) approximates the cube's
 * luminance at normal n. The game compares reflections against this kind of
 * probe luminance.
 */
export function ambientLuminanceFit(cube: readonly THREE.Vector3[]): THREE.Vector4 {
  const l = cube.map((c) => c.dot(LUMA));
  const mean = l.reduce((sum, v) => sum + v, 0) / 6;
  return new THREE.Vector4((l[0] - l[1]) / 2, (l[2] - l[3]) / 2, (l[4] - l[5]) / 2, mean);
}

export function citadelNprUniforms(enabled: boolean): Record<string, THREE.IUniform> {
  return {
    uCitadelLighting: { value: enabled ? 1 : 0 },
    // Preview exposure the display multiplies by; the ambient targets divide by it.
    uCitadelExposure: { value: 1.3 },
    uCitadelOoNormalization: { value: directLightNormalization() },
    uCitadelAmbientFit: { value: new THREE.Vector4(0, 0, 0, 1) },
    uCitadelHemiOctNormals: { value: 0 },
    uCitadelSelfIllumFresnel: { value: new THREE.Vector4(1, 1, 1, 5) },
    uCitadelSelfIllumFresnelRange: { value: new THREE.Vector2(0, 1) },
    uCitadelSelfIllumOn: { value: 0 },
    uCitadelSelfIllumScale: { value: 0 },
    // Hero depth for the rim occlusion test; off until the viewer provides it.
    uCitadelDepth: { value: null },
    uCitadelDepthOn: { value: 0 },
    uCitadelDepthNearFar: { value: new THREE.Vector2(0.1, 100) },
    uCitadelDepthSize: { value: new THREE.Vector2(1, 1) },
    uCitadelProjection: { value: new THREE.Matrix4() },
    // World units per game unit (the viewer scales heroes to a fixed size).
    uCitadelUnit: { value: 1 },
  };
}

const f = (v: number) => v.toFixed(6);

/**
 * GLSL helpers. Requires the uniforms above, the NPR ambient cube uniforms
 * (uNprAmbientCube, uNprAmbientCubeOn) and uKeyDir from the material patch.
 */
export const CITADEL_NPR_GLSL = /* glsl */ `
uniform float uCitadelLighting;
uniform float uCitadelExposure;
uniform float uCitadelOoNormalization;
uniform vec4 uCitadelAmbientFit;
uniform float uCitadelHemiOctNormals;
uniform vec4 uCitadelSelfIllumFresnel;
uniform vec2 uCitadelSelfIllumFresnelRange;
uniform float uCitadelSelfIllumOn;
uniform float uCitadelSelfIllumScale;
uniform sampler2D uCitadelDepth;
uniform float uCitadelDepthOn;
uniform vec2 uCitadelDepthNearFar;
uniform vec2 uCitadelDepthSize;
uniform mat4 uCitadelProjection;
uniform float uCitadelUnit;

const float CITADEL_STEP_SHARPNESS = ${f(CITADEL_NPR.diffuseStepSharpness)};
const float CITADEL_WRAP = ${f(CITADEL_NPR.directLightWrap)};
const float CITADEL_PBR_BLEND = ${f(CITADEL_NPR.diffusePbrBlend)};
const vec3 CITADEL_TARGETS = vec3(${CITADEL_NPR.exposureTargets.map(f).join(', ')});
const float CITADEL_CAMERA_WEIGHT = ${f(CITADEL_NPR.primaryLightCameraWeight)};
const float CITADEL_RIM_WRAP = ${f(CITADEL_NPR.rimLightWrap)};
const float CITADEL_RIM_FALLOFF = ${f(CITADEL_NPR.rimLightFalloff)};
const float CITADEL_RIM_STRENGTH = ${f(CITADEL_NPR.rimLightStrength)};
const float CITADEL_RIM_UP = ${f(CITADEL_NPR.rimLightUpRamp)};
const vec3 CITADEL_LUMA = vec3(0.2125, 0.7154, 0.0721);
const vec3 CITADEL_RIM_OCCLUSION = vec3(${f(CITADEL_NPR.rimOcclusionSampleDistance)}, ${f(CITADEL_NPR.rimOcclusionToleranceMin)}, ${f(CITADEL_NPR.rimOcclusionToleranceRange)});

bool citadelLighting() {
  return uCitadelLighting > 0.5 && uNprLighting > 0.5 && uCelV2 > 0.5;
}

float citadelPowerStep(float x, float sharpness) {
  float k = 1.0 / (1.0 - sharpness);
  bool hi = x > 0.5;
  float m = hi ? 1.0 - x : x;
  float edge = pow(0.5, 1.0 - k) * pow(max(m, 0.0), k);
  return hi ? 1.0 - edge : edge;
}

// Tangent-space normal from a hemi-octahedral two-channel encoding (R+G, R-G).
// Source normal maps keep Y pointing down, so green flips for three's frame.
vec3 citadelHemiOctNormal(vec2 rg) {
  float x = rg.x + rg.y - 1.003922;
  float y = rg.x - rg.y;
  vec3 n = normalize(vec3(x, y, 1.0 - abs(x) - abs(y)));
  return vec3(n.x, -n.y, n.z);
}

// Direct light: wrapped and stepped, normalized, then a quarter back to Lambert.
float citadelDirectDiffuse(float nDotL) {
  float lambert = clamp(nDotL, 0.0, 1.0);
  float w = clamp(2.0 * (lambert + CITADEL_WRAP) - 1.5, 0.0, 1.0);
  return mix(uCitadelOoNormalization * citadelPowerStep(w, CITADEL_STEP_SHARPNESS), lambert, CITADEL_PBR_BLEND);
}

// GGX with the game's normalization (no 1/PI: its light units carry none) and
// its small multiple-scattering boost.
vec3 citadelDirectSpecular(vec3 n, vec3 l, vec3 v, float roughness, vec3 f0) {
  float nDotL = clamp(dot(n, l), 0.0, 1.0);
  float nDotV = clamp(dot(n, v), 0.0, 1.0);
  vec3 h = normalize(l + v);
  float nDotH = dot(h, n);
  float a = roughness * roughness;
  float a2 = a * a;
  float d = (nDotH * a2 - nDotH) * nDotH + 1.0;
  float vis = 0.5 / max(1e-5, nDotL * (nDotV * (1.0 - a) + a) + nDotV * (nDotL * (1.0 - a) + a));
  float lobe = a2 / max(1e-8, d * d) * vis * nDotL;
  vec3 fresnel = f0 + (1.0 - f0) * pow(max(0.0, 1.0 - clamp(dot(l, h), 0.0, 1.0)), 5.0);
  return fresnel * lobe * (1.0 + f0 * (2.0 * a2 * nDotV));
}

vec3 citadelCube(vec3 d) {
  // Neutral until the viewer's ambient probe is ready.
  if (uNprAmbientCubeOn < 0.5) return vec3(1.0);
  vec3 w = d * d;
  return w.x * (d.x >= 0.0 ? uNprAmbientCube[0] : uNprAmbientCube[1]) +
    w.y * (d.y >= 0.0 ? uNprAmbientCube[2] : uNprAmbientCube[3]) +
    w.z * (d.z >= 0.0 ? uNprAmbientCube[4] : uNprAmbientCube[5]);
}

vec3 citadelXyY(vec3 c) {
  vec3 xyz = vec3(dot(c, vec3(0.4124, 0.3576, 0.1805)), dot(c, vec3(0.2126, 0.7152, 0.0722)), dot(c, vec3(0.0193, 0.1192, 0.9505)));
  float sum = xyz.x + xyz.y + xyz.z;
  return sum > 0.0 ? vec3(xyz.xy / sum, xyz.y) : vec3(0.0);
}

// Keep the sample's hue (pulled toward the cube's average hue when it is darker
// than average) but force its luminance to the target.
vec3 citadelExposeAmbient(vec3 sampled, vec3 average, float targetY) {
  vec3 s = citadelXyY(sampled);
  vec2 xy = mix(average.xy, s.xy, clamp(s.z / max(average.z, 1e-8), 0.0, 1.0));
  if (xy.y <= 0.0 || targetY <= 0.0) return vec3(0.0);
  vec3 xyz = vec3(xy.x, xy.y, 1.0 - xy.x - xy.y) * (targetY / xy.y);
  return vec3(dot(xyz, vec3(3.2406, -1.5372, -0.4986)), dot(xyz, vec3(-0.9689, 1.8758, 0.0415)), dot(xyz, vec3(0.0557, -0.2040, 1.0570)));
}

vec3 citadelCameraBack() {
  return normalize(vec3(viewMatrix[0][2], viewMatrix[1][2], viewMatrix[2][2]));
}

// Ambient for one pixel. Returns rgb plus the band (0.25 shadow .. 0.75 lit).
vec4 citadelAmbient(vec3 worldN, vec3 worldToCamera, vec3 worldKey, float ao, vec3 transmissive) {
  vec3 primary = normalize(mix(worldKey, citadelCameraBack(), CITADEL_CAMERA_WEIGHT));
  float h = 0.5 + 0.5 * dot(primary, worldN);
  float x = clamp(h * ao * 2.0 - 0.5, 0.0, 1.0);
  float fx = fract(x);
  float stepped = (x - fx) + citadelPowerStep(fx, CITADEL_STEP_SHARPNESS);
  float band = (stepped + 0.5) * 0.5;
  vec3 horizontal = vec3(worldToCamera.x, 0.0, worldToCamera.z);
  horizontal = dot(horizontal, horizontal) > 1e-8 ? normalize(horizontal) : vec3(0.0, 0.0, 1.0);
  vec3 dir = band < 0.5
    ? mix(vec3(0.0, -1.0, 0.0), horizontal, stepped + 0.5)
    : mix(horizontal, vec3(0.0, 1.0, 0.0), stepped - 0.5);
  dir = normalize(dir);
  vec3 average = citadelXyY((uNprAmbientCube[0] + uNprAmbientCube[1] + uNprAmbientCube[2] +
    uNprAmbientCube[3] + uNprAmbientCube[4] + uNprAmbientCube[5]) / 6.0);
  vec3 d2 = dir * dir;
  float targetY = dot(vec3(CITADEL_TARGETS.y, dir.y > 0.0 ? CITADEL_TARGETS.x : CITADEL_TARGETS.z, CITADEL_TARGETS.y), d2) / uCitadelExposure;
  vec3 ambient = citadelExposeAmbient(citadelCube(dir), average, targetY);
  vec3 up = citadelExposeAmbient(uNprAmbientCube[2], average, CITADEL_TARGETS.x / uCitadelExposure);
  return vec4(ambient + up * transmissive * (1.0 - band), band);
}

float citadelSceneDepth(vec2 uv) {
  float d = texture2D(uCitadelDepth, uv).x;
  float near = uCitadelDepthNearFar.x, far = uCitadelDepthNearFar.y;
  return (near * far) / (far - (far - near) * d);
}

// 1 where the depth a little up and out from the surface is clearly behind it
// (a silhouette), 0 where more of the hero is there.
float citadelRimOcclusion(vec3 viewPosition, vec3 worldN) {
  if (uCitadelDepthOn < 0.5) return 1.0;
  vec3 offset = normalize(mix(worldN, vec3(0.0, 1.0, 0.0), 0.5)) * (CITADEL_RIM_OCCLUSION.x * uCitadelUnit);
  vec4 clip = uCitadelProjection * vec4(viewPosition + (viewMatrix * vec4(offset, 0.0)).xyz, 1.0);
  vec2 uv = clip.xy / clip.w * 0.5 + 0.5;
  float there = citadelSceneDepth(uv);
  float here = citadelSceneDepth(gl_FragCoord.xy / uCitadelDepthSize);
  return smoothstep(0.0, 1.0, clamp((there - (CITADEL_RIM_OCCLUSION.y * uCitadelUnit + here)) /
    (CITADEL_RIM_OCCLUSION.z * uCitadelUnit), 0.0, 1.0));
}

float citadelRim(vec3 worldN, vec3 worldToCamera, float ao, float rimMask) {
  float width = 1.0 + CITADEL_RIM_WRAP;
  float grazing = pow(clamp((CITADEL_RIM_WRAP - dot(worldN, worldToCamera)) / (width * width), 0.0, 1.0), CITADEL_RIM_FALLOFF);
  return grazing * step(CITADEL_RIM_UP, worldN.y) * CITADEL_RIM_STRENGTH * ao * rimMask;
}

// Ambient occlusion with the albedo-dependent multiple bounce fit.
vec3 citadelMultiBounce(float ao, vec3 albedo) {
  vec3 a = 2.0404 * albedo - 0.3324;
  vec3 b = -4.7951 * albedo + 0.6417;
  vec3 c = 2.7552 * albedo + 0.6903;
  return ((ao * a + b) * ao + c) * ao;
}

vec2 citadelEnvBrdf(float roughness, float nDotV) {
  const vec4 c0 = vec4(-1.0, -0.0275, -0.572, 0.022);
  const vec4 c1 = vec4(1.0, 0.0425, 1.04, -0.04);
  vec4 r = roughness * c0 + c1;
  float a004 = min(r.x * r.x, exp2(-9.28 * nDotV)) * r.x + r.y;
  return vec2(-1.04, 1.04) * a004 + r.zw;
}
`;
