import * as THREE from 'three';
import type { HideoutLight } from '../types/skinEditor';
import type { ParticleLightState } from './particles/render/lightRenderer';
import { SOURCE2_PARTICLE_SHADOW_GLSL, SOURCE2_PARTICLE_SHADOW_TILES, Source2ParticleShadows } from './source2ParticleShadows';
import { cacheMapUniformValues, flattenMapUniform } from './mapStaticUniforms';

// VRF MIT SceneLight.cs and lighting.barn.slang. Calculations stay in Source
// units, so viewer normalization cannot change the authored light falloff.
// Shared by the lit surfaces and the volumetric fog; SOURCE2_MAP_LIGHT_COUNT
// sizes the arrays.
export const SOURCE2_LIGHT_CORE_GLSL = /* glsl */`
uniform mat4 source2LightFromMap[SOURCE2_MAP_LIGHT_COUNT];
uniform vec3 source2LightColor[SOURCE2_MAP_LIGHT_COUNT];
uniform vec4 source2LightSize[SOURCE2_MAP_LIGHT_COUNT];
uniform vec4 source2LightShearSoft[SOURCE2_MAP_LIGHT_COUNT];
uniform vec4 source2LightFalloff[SOURCE2_MAP_LIGHT_COUNT];
uniform vec4 source2LightShadow[SOURCE2_MAP_LIGHT_COUNT];
uniform vec2 source2LightCone[SOURCE2_MAP_LIGHT_COUNT];
// x: the cookie's atlas layer, or -1 for the soft edge; y: layers; zw: half-texel clamp.
uniform vec4 source2LightCookie[SOURCE2_MAP_LIGHT_COUNT];
// Maps Source positions into the light's illumination box; zero when it has none.
uniform mat4 source2LightBounds[SOURCE2_MAP_LIGHT_COUNT];
#ifdef SOURCE2_LIGHT_COOKIES
uniform sampler2D source2LightCookies;
#endif
#ifdef SOURCE2_LIGHT_COOKIE_MEANS
uniform vec3 source2LightCookieMean[SOURCE2_MAP_LIGHT_COUNT];
#endif
float source2SoftEdge(vec2 ndc, vec2 soft, float shape) {
  vec2 inner = 1.0 - soft;
  vec2 a = abs(ndc);
  if (shape <= 0.0) {
    vec2 fade = vec2(1.0);
    if (soft.x > 0.0) fade.x = 1.0 - smoothstep(inner.x, 1.0, a.x);
    if (soft.y > 0.0) fade.y = 1.0 - smoothstep(inner.y, 1.0, a.y);
    return fade.x * fade.y;
  }
  float roundness = min(shape, 1.0) * 0.875 + 0.125;
  float p = 2.0 / roundness;
  float q = -0.5 * roundness;
  float innerDistance = inner.x * inner.y * pow(max(pow(inner.y * a.x, p) + pow(inner.x * a.y, p), 1.175e-38), q);
  float outerDistance = pow(max(pow(a.x, p) + pow(a.y, p), 1.175e-38), q);
  return innerDistance < outerDistance ? 1.0 - smoothstep(innerDistance, outerDistance, 1.0) : float(outerDistance > 1.0);
}
// A light's color reaching a Source-space point (game units: no Lambert 1/pi),
// and the Source direction toward the light. The arguments are one entry of the
// light arrays below.
vec3 source2LightEval(mat4 fromSource, vec3 lightColor, vec4 size, vec4 beam, vec4 falloff, vec4 shadowMask, vec2 cone,
    vec4 cookie, mat4 bounds, vec3 cookieMean, vec3 sourcePosition, vec4 shadows, out vec3 sourceToLight) {
  sourceToLight = vec3(0.0, 0.0, 1.0);
  if (any(greaterThan(abs((bounds * vec4(sourcePosition, 1.0)).xyz), vec3(1.0)))) return vec3(0.0);
  vec3 local = (fromSource * vec4(sourcePosition, 1.0)).xyz;
  vec3 toLight = -local;
  vec3 tint = vec3(1.0);
  float attenuation = 1.0;
  float visibility = clamp(1.0 - dot(shadows, shadowMask), 0.0, 1.0);
  if (size.w > 1.5) {
    toLight = vec3(-1.0, 0.0, 0.0);
  } else if (size.w > 0.5) {
    float nearPlane = size.z > 0.0 ? 1.0 / size.z : 0.0;
    vec2 center = beam.xy * nearPlane / falloff.x;
    vec3 relative = local + vec3(nearPlane, center);
    vec3 ndc;
    if (nearPlane > 0.0) {
      ndc.xy = (relative.yz * nearPlane / relative.x - center) / size.xy;
      float farPlane = nearPlane + falloff.x;
      ndc.z = farPlane / falloff.x - farPlane * nearPlane / (falloff.x * relative.x);
      float luminaireDistance = length(vec3(nearPlane, center));
      float reference = luminaireDistance + 100.0;
      attenuation = reference * reference / max(dot(relative, relative), luminaireDistance * luminaireDistance);
      toLight = -relative;
    } else {
      ndc.xy = (local.yz - beam.xy * local.x / falloff.x) / size.xy;
      ndc.z = local.x / falloff.x;
      toLight = -vec3(falloff.x, beam.xy);
    }
    if (ndc.z <= 0.0 || ndc.z >= 1.0 || any(greaterThanEqual(abs(ndc.xy), vec2(1.0)))) attenuation = 0.0;
    float nearFade = falloff.z > 0.0 ? 1.0 / falloff.z : 0.0;
    float farFade = falloff.y > 0.0 ? 1.0 / falloff.y : 0.0;
    if (nearPlane > 0.0) {
      if (nearFade > 0.0) nearFade = (nearPlane + falloff.z * falloff.x) / ((nearPlane + falloff.x) * falloff.z);
      if (farFade > 0.0) farFade = (nearPlane + (1.0 - falloff.y) * falloff.x) / (nearPlane * falloff.y);
    }
    if (nearFade > 0.0) attenuation *= smoothstep(0.0, 1.0, ndc.z * nearFade);
    if (farFade > 0.0) attenuation *= smoothstep(0.0, 1.0, (1.0 - ndc.z) * farFade);
    // A cookie replaces the soft edge (lighting.barn.slang).
#if defined(SOURCE2_LIGHT_COOKIE_MEANS)
    if (cookie.x >= 0.0) tint = cookieMean; else
#elif defined(SOURCE2_LIGHT_COOKIES)
    if (cookie.x >= 0.0) {
      vec2 uv = clamp(ndc.xy * vec2(-0.5) + 0.5, cookie.zw, 1.0 - cookie.zw);
      tint = texture2D(source2LightCookies, vec2((cookie.x + uv.x) / cookie.y, uv.y)).rgb;
    } else
#endif
    attenuation *= source2SoftEdge(ndc.xy, beam.zw, falloff.w);
    visibility *= visibility;
  } else {
    float distance = length(local);
    float fade = clamp((falloff.x - distance) / max(falloff.x * falloff.y, 1e-5), 0.0, 1.0);
    attenuation = 10000.0 / max(distance * distance, 1.0) * smoothstep(0.0, 1.0, fade);
    attenuation *= clamp(cone.x + cone.y * (-local.x / max(distance, 1e-5)), 0.0, 1.0);
    // An omni cookie is mapped spherically about the light's frame, its forward
    // axis at the image's center (lighting.barn.slang, negative cookie index).
#if defined(SOURCE2_LIGHT_COOKIE_MEANS)
    if (cookie.x >= 0.0) tint = cookieMean;
#elif defined(SOURCE2_LIGHT_COOKIES)
    if (cookie.x >= 0.0) {
      vec3 ray = local / max(distance, 1e-5);
      vec2 uv = vec2(fract(atan(ray.y, -ray.x) / (2.0 * PI)), acos(clamp(ray.z, -1.0, 1.0)) / PI);
      uv = clamp(uv, cookie.zw, 1.0 - cookie.zw);
      tint = texture2D(source2LightCookies, vec2((cookie.x + uv.x) / cookie.y, uv.y)).rgb;
    }
#endif
    visibility *= visibility;
  }
  // The placement's rotation is orthonormal. Multiplying by its transposed
  // inverse rotates a local direction back into Source world axes.
  sourceToLight = (vec4(normalize(toLight), 0.0) * fromSource).xyz;
  return lightColor * tint * (attenuation * visibility);
}
vec3 source2LightAt(int index, vec3 sourcePosition, vec4 shadows, out vec3 sourceToLight) {
#ifdef SOURCE2_LIGHT_COOKIE_MEANS
  vec3 cookieMean = source2LightCookieMean[index];
#else
  vec3 cookieMean = vec3(1.0);
#endif
  return source2LightEval(source2LightFromMap[index], source2LightColor[index], source2LightSize[index], source2LightShearSoft[index],
    source2LightFalloff[index], source2LightShadow[index], source2LightCone[index], source2LightCookie[index], source2LightBounds[index],
    cookieMean, sourcePosition, shadows, sourceToLight);
}
`;

const LIGHTS_GLSL = /* glsl */`
#if NUM_POINT_LIGHTS > 0
uniform mat4 source2LightMapFromViewer;
uniform mat3 source2LightViewerFromMap;
${SOURCE2_LIGHT_CORE_GLSL}
void source2MapLight(int index, vec3 worldPosition, vec4 shadows, out vec3 direction, out vec3 color) {
  vec3 sourcePosition = (source2LightMapFromViewer * vec4(worldPosition, 1.0)).xyz;
  vec3 sourceDirection;
  color = PI * source2LightAt(index, sourcePosition, shadows, sourceDirection);
  direction = normalize((viewMatrix * vec4(source2LightViewerFromMap * sourceDirection, 0.0)).xyz);
}
#ifdef SOURCE2_PARTICLE_LIGHTS
uniform mat4 source2ParticleLightFromMap[SOURCE2_PARTICLE_LIGHT_SLOTS];
uniform vec3 source2ParticleLightColor[SOURCE2_PARTICLE_LIGHT_SLOTS];
uniform vec4 source2ParticleLightFalloff[SOURCE2_PARTICLE_LIGHT_SLOTS];
uniform vec2 source2ParticleLightCone[SOURCE2_PARTICLE_LIGHT_SLOTS];
uniform vec4 source2ParticleLightCookie[SOURCE2_PARTICLE_LIGHT_SLOTS];
#ifdef SOURCE2_PARTICLE_SHADOWS
${SOURCE2_PARTICLE_SHADOW_GLSL}
#endif
// Particle lights are omni lights without baked shadows or an illumination box.
void source2ParticleLight(int index, vec3 worldPosition, out vec3 direction, out vec3 color) {
  vec3 sourcePosition = (source2LightMapFromViewer * vec4(worldPosition, 1.0)).xyz;
  vec3 sourceDirection;
  color = PI * source2LightEval(source2ParticleLightFromMap[index], source2ParticleLightColor[index], vec4(0.0), vec4(0.0),
    source2ParticleLightFalloff[index], vec4(0.0), source2ParticleLightCone[index], source2ParticleLightCookie[index], mat4(0.0),
    vec3(1.0), sourcePosition, vec4(0.0), sourceDirection);
#ifdef SOURCE2_PARTICLE_SHADOWS
  if (any(greaterThan(color, vec3(0.0)))) color *= source2ParticleShadow(index, sourcePosition);
#endif
  direction = normalize((viewMatrix * vec4(source2LightViewerFromMap * sourceDirection, 0.0)).xyz);
}
#endif
#endif
`;

function temperatureColor(kelvin: number): THREE.Color {
  const t = kelvin / 100;
  const channel = (value: number) => Number.isNaN(value) ? 0 : Math.min(255, Math.max(0, value)) / 255;
  return new THREE.Color().setRGB(channel(t > 66 ? 329.69873 * (t - 60) ** -0.13320476 : 255),
    channel(t > 66 ? 288.12216 * (t - 60) ** -0.075514846 : 99.4708 * Math.log(t) - 161.11957),
    channel(t < 66 ? 138.51773 * Math.log(t - 10) - 305.0448 : 255));
}

/** One-hot selector of a light's baked shadow channel (VRF SceneLight.BakedShadowMask).
 *  A bare `new Vector4()` is (0, 0, 0, 1): its w would read the fourth channel as shadow. */
export function source2ShadowChannelMask(channel: number | null): THREE.Vector4 {
  const mask = new THREE.Vector4(0, 0, 0, 0);
  if (channel !== null) mask.setComponent(channel, 1);
  return mask;
}

/** Light cookies packed side by side, one square layer each, in `layers` order, with each
 *  layer's mean linear color. */
export interface Source2CookieAtlas { texture: THREE.Texture; layers: readonly string[]; size: number; means: readonly THREE.Vector3[] }

/** Linear light color times brightness, as the game premultiplies it. */
export function source2LightLinearColor(light: HideoutLight): THREE.Color {
  const color = light.distribution.temperature === null ? new THREE.Color().setRGB(light.color[0] / 255, light.color[1] / 255, light.color[2] / 255) : temperatureColor(light.distribution.temperature);
  return color.convertSRGBToLinear().multiplyScalar(light.distribution.brightness);
}

/** An omni light's cone fade, bias and scale on the cosine to its axis (VRF SceneLight.ComputeAngleFade). */
export function source2ConeFade(outer: number, inner: number): THREE.Vector2 {
  if (outer >= 180) return new THREE.Vector2(1, 0);
  if (outer <= 0) return new THREE.Vector2();
  const cosOuter = Math.min(Math.cos(THREE.MathUtils.degToRad(outer)), 1 - 1e-7);
  const cosInner = inner > 0 ? Math.cos(THREE.MathUtils.degToRad(Math.min(inner, outer - 0.001))) : 1;
  const denominator = Math.min(-1e-7, cosOuter - cosInner);
  return new THREE.Vector2(cosOuter / denominator, 1 / denominator);
}

/** A light's cookie uniform: its atlas layer, the layer count and the half-texel clamp; x -1 for none. */
function cookieUniform(cookies: Source2CookieAtlas | null, file: string | undefined): THREE.Vector4 {
  const layer = cookies && file ? cookies.layers.indexOf(file) : -1;
  return layer < 0 || !cookies ? new THREE.Vector4(-1, 1, 0, 0) : new THREE.Vector4(layer, cookies.layers.length, 0.5 / cookies.size, 0.5 / cookies.size);
}

/** Uniform values for SOURCE2_LIGHT_CORE_GLSL. */
export function source2LightUniforms(lights: readonly HideoutLight[], cookies: Source2CookieAtlas | null, cookieMeans = false) {
  return {
    source2LightFromMap: { value: lights.map(light => new THREE.Matrix4().fromArray(light.distribution.matrix).invert()) },
    source2LightColor: { value: lights.map(source2LightLinearColor) },
    source2LightSize: { value: lights.map(({ distribution: d }) => new THREE.Vector4(...d.size, d.kind === 'sun' ? 2 : d.kind === 'barn' ? 1 : 0)) },
    source2LightShearSoft: { value: lights.map(({ distribution: d }) => new THREE.Vector4(...d.shear, ...d.soft)) },
    source2LightFalloff: { value: lights.map(light => new THREE.Vector4(light.range, light.distribution.skirt, light.distribution.nearSkirt, light.distribution.shape)) },
    source2LightShadow: { value: lights.map(light => source2ShadowChannelMask(light.shadowChannel)) },
    source2LightCone: { value: lights.map(({ distribution: d }) => source2ConeFade(d.outer, d.inner)) },
    source2LightCookie: { value: lights.map(light => cookieUniform(cookies, light.distribution.kind === 'sun' ? undefined : light.cookie)) },
    source2LightBounds: { value: lights.map(light => light.bounds ? new THREE.Matrix4().fromArray(light.bounds).invert() : new THREE.Matrix4().makeScale(0, 0, 0)) },
    ...(cookies && !cookieMeans ? { source2LightCookies: { value: cookies.texture } } : {}),
    ...(cookies && cookieMeans ? { source2LightCookieMean: { value: lights.map(light => cookies.means[light.cookie ? cookies.layers.indexOf(light.cookie) : -1]?.clone() ?? new THREE.Vector3(1, 1, 1)) } } : {}),
  };
}

/** Most particle lights a map-lit material evaluates. */
export const SOURCE2_PARTICLE_LIGHT_SLOTS = SOURCE2_PARTICLE_SHADOW_TILES;

/**
 * Lights placed by map particles (the fire, candles), lit through the map's light model with their
 * cone and cookie. Every map-lit material shares these uniforms, rewritten each frame by `update`.
 */
export interface Source2ParticleLights {
  readonly uniforms: {
    source2ParticleLightFromMap: { value: THREE.Matrix4[] }; source2ParticleLightColor: { value: THREE.Vector3[] };
    source2ParticleLightFalloff: { value: THREE.Vector4[] }; source2ParticleLightCone: { value: THREE.Vector2[] };
    source2ParticleLightCookie: { value: THREE.Vector4[] };
    source2ParticleShadowAtlas: { value: THREE.Texture }; source2ParticleShadowTile: { value: THREE.Vector4[] };
    source2ParticleLightSource: { value: THREE.Vector3[] };
  };
  /** The same uniforms as materials receive them: the arrays flattened once per update instead of
   *  by three on every draw that uses them. */
  readonly shaderUniforms: Record<string, THREE.IUniform>;
  /** The cookie atlas the room samples, and the atlas file of each particle cookie path. */
  cookies: Source2CookieAtlas | null;
  cookieFiles: Readonly<Record<string, string>>;
  update(states: readonly ParticleLightState[]): void;
  /** Renders the shadow of each shadowed light that is new or has moved, as the room stands in `scene`. */
  renderShadows(gl: THREE.WebGLRenderer, scene: THREE.Scene, sourceFromViewer: THREE.Matrix4): void;
  dispose(): void;
}

/** How far a shadowed particle light moves, in Source units, before its shadow is rendered again. */
const SHADOW_MOVE = 4;

export function createSource2ParticleLights(): Source2ParticleLights {
  const slots = Array.from({ length: SOURCE2_PARTICLE_LIGHT_SLOTS });
  const frame = new THREE.Matrix4(), color = new THREE.Color();
  const shadows = new Source2ParticleShadows();
  // Until a shadow is rendered the atlas is unused (every tile's w is 0); a placeholder stands in.
  const placeholder = new THREE.DataTexture(new Uint8Array(4), 1, 1);
  placeholder.needsUpdate = true;
  let current: readonly ParticleLightState[] = [];
  const rendered = slots.map(() => ({ position: new THREE.Vector3(), range: 0 }));
  const uniforms: Source2ParticleLights['uniforms'] = {
    source2ParticleLightFromMap: { value: slots.map(() => new THREE.Matrix4()) },
    source2ParticleLightColor: { value: slots.map(() => new THREE.Vector3()) },
    source2ParticleLightFalloff: { value: slots.map(() => new THREE.Vector4()) },
    source2ParticleLightCone: { value: slots.map(() => new THREE.Vector2(1, 0)) },
    source2ParticleLightCookie: { value: slots.map(() => new THREE.Vector4(-1, 1, 0, 0)) },
    source2ParticleShadowAtlas: { value: placeholder }, source2ParticleShadowTile: { value: shadows.tiles },
    source2ParticleLightSource: { value: shadows.sources },
  };
  const shaderUniforms: Record<string, THREE.IUniform> = {};
  for (const [name, uniform] of Object.entries(uniforms)) shaderUniforms[name] = { value: flattenMapUniform(uniform.value) ?? uniform.value };
  const flatten = () => {
    for (const [name, uniform] of Object.entries(uniforms)) {
      const flat = shaderUniforms[name];
      if (!(flat.value instanceof Float32Array)) { flat.value = uniform.value; continue; }
      const values = uniform.value as (THREE.Matrix4 | THREE.Vector4 | THREE.Vector3 | THREE.Vector2)[];
      const width = flat.value.length / values.length;
      for (let i = 0; i < values.length; i++) {
        const value = values[i];
        if (value instanceof THREE.Matrix4) flat.value.set(value.elements, i * width);
        else value.toArray(flat.value, i * width);
      }
    }
  };
  const lights: Source2ParticleLights = {
    uniforms, shaderUniforms, cookies: null, cookieFiles: {},
    update(states) {
      current = states;
      for (let slot = 0; slot < SOURCE2_PARTICLE_LIGHT_SLOTS; slot++) {
        const state = states[slot];
        // An unused slot has no color and no range, which the light model leaves dark.
        if (!state) {
          uniforms.source2ParticleLightColor.value[slot].set(0, 0, 0);
          uniforms.source2ParticleLightFalloff.value[slot].set(0, 0, 0, 0);
          continue;
        }
        // The transform's rows are the light's forward, left and up axes (VRF ParticleLightPool).
        frame.makeBasis(state.direction, state.left, state.up).setPosition(state.position);
        uniforms.source2ParticleLightFromMap.value[slot].copy(frame).invert();
        // VRF SceneLight.ComputeOmni2Color: the gamma colour, decoded, times the brightness.
        color.setRGB(state.color[0], state.color[1], state.color[2], THREE.SRGBColorSpace);
        const brightness = state.linearBrightness * state.brightnessScale;
        uniforms.source2ParticleLightColor.value[slot].set(color.r * brightness, color.g * brightness, color.b * brightness);
        uniforms.source2ParticleLightFalloff.value[slot].set(state.range, state.fallOff, 0, 0);
        uniforms.source2ParticleLightCone.value[slot].copy(source2ConeFade(state.spotOuterAngle, state.spotInnerAngle));
        uniforms.source2ParticleLightCookie.value[slot].copy(cookieUniform(lights.cookies, state.cookie ? lights.cookieFiles[state.cookie] : undefined));
      }
      flatten();
    },
    renderShadows(gl, scene, sourceFromViewer) {
      for (let slot = 0; slot < SOURCE2_PARTICLE_LIGHT_SLOTS; slot++) {
        const state = current[slot], last = rendered[slot];
        if (!state?.castShadows || state.range <= 0) { shadows.clear(slot); continue; }
        if (shadows.tiles[slot].w > 0 && last.range === state.range && last.position.distanceTo(state.position) < SHADOW_MOVE) continue;
        shadows.render(gl, scene, slot, state.position, state.range, sourceFromViewer);
        last.position.copy(state.position);
        last.range = state.range;
        uniforms.source2ParticleShadowAtlas.value = shadows.atlas.texture;
      }
      flatten();
    },
    dispose() {
      shadows.dispose();
      placeholder.dispose();
    },
  };
  return lights;
}

/**
 * Lights a material with the map's lights. They take over the scene's first `slots` point lights
 * (the map's own point lights stand there, so three keys every program on them), and the material
 * evaluates `lights`, the leading ones that can reach it, in those slots. Both counts are
 * compile-time constants, so the slots it skips compile away.
 */
export function applySource2DynamicLights(material: THREE.Material, options: {
  lights: HideoutLight[]; sourceFromViewer: THREE.Matrix4; normalFromViewer: THREE.Matrix3;
  shadows: { kind: 'lightmap'; texture: THREE.Texture } | { kind: 'probe' } | { kind: 'none' };
  cookies?: Source2CookieAtlas | null; slots?: number;
  /** Lights placed by map particles, evaluated after the map's lights. */
  particles?: Source2ParticleLights | null;
  /** Whether the particle lights' dynamic shadows are read (one more sampler). */
  particleShadows?: boolean;
}): () => void {
  const count = options.lights.length;
  const slots = Math.max(options.slots ?? count, count);
  if (!slots) return () => {};
  const compile = material.onBeforeCompile, key = material.customProgramCacheKey;
  const cookies = count ? options.cookies ?? null : null;
  const shadows = count ? options.shadows.kind : 'none';
  const particles = count ? options.particles ?? null : null;
  const particleShadows = !!particles && !!options.particleShadows;
  const uniforms = count ? {
    source2LightMapFromViewer: { value: options.sourceFromViewer }, source2LightViewerFromMap: { value: options.normalFromViewer.clone().invert() },
    ...source2LightUniforms(options.lights, cookies), ...particles?.shaderUniforms,
  } : {};
  // The authored arrays never change; three would flatten them again on every draw.
  cacheMapUniformValues(uniforms);
  material.onBeforeCompile = (shader, renderer) => {
    compile.call(material, shader, renderer);
    Object.assign(shader.uniforms, uniforms);
    if (options.shadows.kind === 'lightmap' && shadows === 'lightmap') shader.uniforms.source2DynamicShadows = { value: options.shadows.texture };
    const shadow = shadows === 'lightmap' ? 'texture2D(source2DynamicShadows, vLightMapUv)' : shadows === 'probe' ? 'source2ProbeShadow' : 'vec4(0.0)';
    const glsl = count ? `#define SOURCE2_MAP_LIGHT_COUNT ${count}\n${cookies ? '#define SOURCE2_LIGHT_COOKIES\n' : ''}`
      + `${particles ? `#define SOURCE2_PARTICLE_LIGHTS\n#define SOURCE2_PARTICLE_LIGHT_SLOTS ${SOURCE2_PARTICLE_LIGHT_SLOTS}\n` : ''}`
      + `${particleShadows ? '#define SOURCE2_PARTICLE_SHADOWS\n' : ''}`
      + `${LIGHTS_GLSL}\n${shadows === 'lightmap' ? 'uniform sampler2D source2DynamicShadows;' : ''}` : '';
    const worldPosition = 'cameraPosition + (vec4(-vViewPosition, 0.0) * viewMatrix).xyz';
    const light = count ? `source2MapLight(i, ${worldPosition}, ${shadow}, directLight.direction, directLight.color);` : '';
    let fragment = shader.fragmentShader
      .replace('#include <lights_fragment_begin>', THREE.ShaderChunk.lights_fragment_begin)
      .replaceAll('#pragma unroll_loop_start', '')
      .replaceAll('#pragma unroll_loop_end', '')
      .replace('#include <common>', `#include <common>\n${glsl}`);
    // Particle lights run as extra passes of the point light loop, past three's own lights.
    if (particles) fragment = fragment
      .replaceAll('for ( int i = 0; i < NUM_POINT_LIGHTS; i ++ ) {', 'for ( int i = 0; i < NUM_POINT_LIGHTS + SOURCE2_PARTICLE_LIGHT_SLOTS; i ++ ) {')
      .replaceAll('pointLight = pointLights[ i ];', 'if ( i < NUM_POINT_LIGHTS ) pointLight = pointLights[ i ];');
    shader.fragmentShader = fragment
      .replaceAll('getPointLightInfo( pointLight, geometryPosition, directLight );', `
        ${particles ? `if (i >= NUM_POINT_LIGHTS) {
          source2ParticleLight(i - NUM_POINT_LIGHTS, ${worldPosition}, directLight.direction, directLight.color);
          directLight.visible = any(greaterThan(directLight.color, vec3(0.0)));
        } else ` : ''}if (i < ${count}) {
          ${light}
          directLight.visible = any(greaterThan(directLight.color, vec3(0.0)));
        } else if (i < ${slots}) {
          directLight.color = vec3(0.0);
          directLight.visible = false;
        } else {
          getPointLightInfo( pointLight, geometryPosition, directLight );
        }
      `);
  };
  material.customProgramCacheKey = () => `${key.call(material)}:source2-dynamic-v5:${count}:${slots}:${shadows}:${!!cookies}:${!!particles}:${particleShadows}`;
  material.needsUpdate = true;
  return () => { material.onBeforeCompile = compile; material.customProgramCacheKey = key; material.needsUpdate = true; };
}
