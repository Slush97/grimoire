import * as THREE from 'three';
import { Pass } from 'postprocessing';
import type { HideoutLight, HideoutSceneInfo } from '../types/skinEditor';
import type { Source2MapFog } from './source2MapData';
import { source2LightmapNormalMatrix } from './source2Lightmap';
import { SOURCE2_LIGHT_CORE_GLSL, source2LightUniforms, type Source2CookieAtlas } from './source2DynamicLights';

/** Six HDR faces in +X -X +Y -Y +Z -Z order, packed like reflection.bin, in Source axes. */
export async function loadSource2SkyCube(bytes: ArrayBuffer): Promise<THREE.CubeTexture> {
  const { HDRLoader } = await import('three/examples/jsm/loaders/HDRLoader.js');
  const header = new DataView(bytes);
  if (bytes.byteLength < 24) throw new Error('Truncated sky pack.');
  const faces: THREE.DataTexture[] = [];
  let offset = 24;
  for (let i = 0; i < 6; i++) {
    const length = header.getUint32(i * 4, true);
    if (offset + length > bytes.byteLength) throw new Error('Truncated sky face.');
    const face = new HDRLoader().setDataType(THREE.HalfFloatType).parse(bytes.slice(offset, offset + length));
    faces.push(new THREE.DataTexture(face.data, face.width, face.height, THREE.RGBAFormat, THREE.HalfFloatType));
    offset += length;
  }
  if (offset !== bytes.byteLength) throw new Error('Invalid sky pack length.');
  const cube = new THREE.CubeTexture(faces);
  cube.type = THREE.HalfFloatType;
  cube.colorSpace = THREE.LinearSRGBColorSpace;
  cube.minFilter = THREE.LinearFilter;
  cube.magFilter = THREE.LinearFilter;
  cube.generateMipmaps = false;
  cube.needsUpdate = true;
  return cube;
}

/**
 * sky.vfx: the cube along the eye direction, times exp2(brightness bias + render-only bias) and
 * the env_sky tint. Drawn at the far plane behind everything, in linear HDR for the map post.
 */
export function createSource2Sky(cube: THREE.CubeTexture, sky: NonNullable<HideoutSceneInfo['sky']>, heading: number): THREE.Mesh {
  const material = new THREE.ShaderMaterial({
    uniforms: {
      source2Sky: { value: cube },
      source2SkyFromViewer: { value: source2LightmapNormalMatrix(heading) },
      source2SkyScale: { value: new THREE.Vector3(...sky.tint).multiplyScalar(2 ** sky.exposureBias) },
    },
    vertexShader: /* glsl */`
      varying vec3 vSkyDirection;
      void main() {
        vSkyDirection = position;
        vec4 clip = projectionMatrix * vec4(mat3(viewMatrix) * position, 1.0);
        gl_Position = clip.xyww;
      }`,
    fragmentShader: /* glsl */`
      uniform samplerCube source2Sky;
      uniform mat3 source2SkyFromViewer;
      uniform vec3 source2SkyScale;
      varying vec3 vSkyDirection;
      void main() {
        gl_FragColor = vec4(max(textureCube(source2Sky, source2SkyFromViewer * normalize(vSkyDirection)).rgb, 0.0) * source2SkyScale, 1.0);
      }`,
    side: THREE.BackSide, depthWrite: false, toneMapped: false,
  });
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), material);
  mesh.frustumCulled = false;
  mesh.renderOrder = -1e6;
  mesh.name = 'source2-sky';
  return mesh;
}

// cs_volumetric_fog's precomputed shadows: each fog light with baked shadows has a tile (a cube
// face each for an omni) of the map's R16 depth atlas. A tile holds 1 - ndc.z of the light's own
// frustum (VRF SceneLight barn frustum; omni faces as ComputeOmni2Faces, 90 degrees, near 1, far
// 1 + range) at uv = ndc.xy * -0.5 + 0.5, and a point is lit where the stored value is below its
// own, over the 2 by 2 texels around it as the game's textureGather does. Verified against the
// room's geometry for barn and omni tiles (docs/hideout-viewer.md, "Fog shadow atlas mapping").
const SOURCE2_FOG_SHADOW_GLSL = (lightCount: number) => /* glsl */`
uniform usampler2D source2FogShadowAtlas;
// Per light: tile count (0 for none, 1 barn, 6 omni) and the first tile's index.
uniform vec2 source2FogShadowTiles[${lightCount}];
// (width, height, x, y) in atlas uv.
uniform vec4 source2FogShadowRects[${lightCount * 6}];
float source2FogShadow(int index, vec3 sourcePosition) {
  vec2 tiles = source2FogShadowTiles[index];
  if (tiles.x < 0.5) return 1.0;
  vec3 local = (source2LightFromMap[index] * vec4(sourcePosition, 1.0)).xyz;
  vec4 size = source2LightSize[index];
  vec4 beam = source2LightShearSoft[index];
  float range = source2LightFalloff[index].x;
  vec3 ndc;
  int face = 0;
  if (tiles.x < 1.5) {
    float nearPlane = size.z > 0.0 ? 1.0 / size.z : 0.0;
    if (nearPlane > 0.0) {
      vec2 center = beam.xy * nearPlane / range;
      vec3 relative = local + vec3(nearPlane, center);
      float farPlane = nearPlane + range;
      ndc = vec3((relative.yz * nearPlane / relative.x - center) / size.xy, farPlane / range - farPlane * nearPlane / (range * relative.x));
    } else {
      ndc = vec3((local.yz - beam.xy * local.x / range) / size.xy, local.x / range);
    }
  } else {
    // Faces forward, -up, up, left, -left, -forward; (x, y, depth) in each face's view.
    vec3 a = abs(local);
    vec3 view;
    if (a.x >= a.y && a.x >= a.z) { face = local.x > 0.0 ? 0 : 5; view = local.x > 0.0 ? local.yzx : vec3(-local.y, local.z, -local.x); }
    else if (a.y >= a.z) { face = local.y > 0.0 ? 3 : 4; view = local.y > 0.0 ? vec3(-local.x, local.z, local.y) : vec3(local.x, local.z, -local.y); }
    else { face = local.z > 0.0 ? 2 : 1; view = local.z > 0.0 ? vec3(local.y, -local.x, local.z) : vec3(local.y, local.x, -local.z); }
    float farPlane = 1.0 + range;
    ndc = vec3(view.xy / view.z, farPlane / (farPlane - 1.0) - farPlane / ((farPlane - 1.0) * view.z));
  }
  if (ndc.z <= 0.0 || ndc.z >= 1.0) return 1.0;
  vec4 rect = source2FogShadowRects[int(tiles.y) + face];
  vec2 atlasSize = vec2(textureSize(source2FogShadowAtlas, 0));
  vec2 texel = (rect.zw + clamp(ndc.xy * -0.5 + 0.5, 0.0, 1.0) * rect.xy) * atlasSize - 0.5;
  ivec2 base = ivec2(floor(texel));
  ivec2 lo = ivec2(ceil(rect.zw * atlasSize)), hi = ivec2(floor((rect.zw + rect.xy) * atlasSize)) - 1;
  uint reference = uint(clamp(1.0 - ndc.z, 0.0, 1.0) * 65535.0);
  float lit = 0.0;
  for (int k = 0; k < 4; k++) {
    ivec2 at = clamp(base + ivec2(k & 1, k >> 1), lo, hi);
    lit += texelFetch(source2FogShadowAtlas, at, 0).r < reference ? 1.0 : 0.0;
  }
  return lit * 0.25;
}
`;

/** Lights that the game also lets into its fog froxels (`fog` mode on, `fogstrength`). */
export function source2FogLights(lights: readonly HideoutLight[]): HideoutLight[] {
  return lights.filter(light => light.distribution.kind !== 'sun' && light.distribution.brightness > 0 && (light.fogStrength ?? 0) !== 0).slice(0, SOURCE2_FOG_LIGHTS);
}

/**
 * Volume density per Source unit for a fog strength of one. The game scales its froxel extinction
 * by a view constant that no map resource records; this value is fitted to an in-game capture
 * (docs/hideout-viewer.md, "Fog density scale") and applies to every map alike.
 */
export const SOURCE2_FOG_DENSITY_SCALE = 0.01;
const SOURCE2_FOG_VOLUMES = 16;
const SOURCE2_FOG_LIGHTS = 8;
const SOURCE2_FOG_STEPS = 32;

// cs_volumetric_fog and deferred_fogging: density is the strongest box falloff times its
// strength, lit by the baked indirect volume and fog-enabled lights, integrated front to back
// up to the draw distance and faded in from the camera. The result is color * T + inscatter.
// 'march' writes the in-scattered light and the transmittance for one pixel in each 2x2 block, at
// half resolution; FOG_COMPOSITE applies them. 'full' integrates and applies every pixel.
const fogFragment = (lightCount: number, cookies: boolean, shadows: boolean, mode: 'full' | 'march') => /* glsl */`
precision highp float;
precision highp sampler3D;
precision highp usampler2D;
uniform sampler2D inputBuffer;
uniform sampler2D depthBuffer;
uniform sampler3D fogIrradiance;
uniform mat4 projectionInverse;
uniform mat4 cameraWorld;
uniform mat4 sourceFromViewer;
uniform mat4 fogFromSource;
uniform vec4 fogParams;
uniform vec2 fogFade;
uniform vec3 fogTint;
uniform int volumeCount;
uniform mat4 volumeFromSource[${SOURCE2_FOG_VOLUMES}];
uniform vec4 volumeParams[${SOURCE2_FOG_VOLUMES}];
uniform vec4 volumeTint[${SOURCE2_FOG_VOLUMES}];
varying vec2 vUv;
${lightCount ? `#define SOURCE2_MAP_LIGHT_COUNT ${lightCount}
${cookies ? '#define SOURCE2_LIGHT_COOKIE_MEANS' : ''}
${SOURCE2_LIGHT_CORE_GLSL}
uniform float source2FogStrength[${lightCount}];
// A uniform bound keeps this a real loop: unrolled into every march step, the lights made the
// fog the slowest program to link, ahead of the first composed frame.
uniform int source2FogLightCount;` : ''}
${lightCount && shadows ? `#define SOURCE2_FOG_SHADOWS
${SOURCE2_FOG_SHADOW_GLSL(lightCount)}` : ''}

// rgb: the in-scattered radiance, a: the density at p.
vec4 fogSample(vec3 p) {
  float density = 0.0;
  float indirect = fogParams.y;
  vec3 tint = fogTint;
  for (int i = 0; i < ${SOURCE2_FOG_VOLUMES}; i++) {
    if (i >= volumeCount) break;
    vec3 q = (volumeFromSource[i] * vec4(p, 1.0)).xyz;
    if (any(lessThan(q, vec3(0.0))) || any(greaterThan(q, vec3(1.0)))) continue;
    vec3 c = abs(q * 2.0 - 1.0);
    float edge = volumeParams[i].z > 0.5 ? 1.0 - length(c) : 1.0 - max(c.x, max(c.y, c.z));
    float falloff = pow(clamp(edge, 0.0, 1.0), volumeParams[i].y);
    if (falloff <= 0.0) continue;
    density = max(density, clamp(falloff * volumeParams[i].x, 0.0, 1.0));
    if (volumeParams[i].w >= 0.0) indirect = mix(indirect, volumeParams[i].w, falloff);
    tint = mix(tint, volumeTint[i].rgb, falloff * volumeTint[i].w);
  }
  if (density <= 0.0) return vec4(0.0);
  vec3 radiance = texture(fogIrradiance, (fogFromSource * vec4(p, 1.0)).xyz).rgb * indirect;
  // Fog takes each light's surface intensity (no Lambert 1/pi) times its fogstrength.
  ${lightCount ? `for (int i = 0; i < source2FogLightCount; i++) {
    vec3 toLight;
    vec3 light = source2LightAt(i, p, vec4(0.0), toLight) * source2FogStrength[i];
#ifdef SOURCE2_FOG_SHADOWS
    if (any(greaterThan(light, vec3(0.0)))) light *= source2FogShadow(i, p);
#endif
    radiance += light;
  }` : ''}
  return vec4(max(radiance, 0.0) * tint, density);
}

// rgb: the light scattered toward the camera, a: the transmittance, along the ray to the surface at uv.
vec4 fogIntegrate(vec2 uv, float depth) {
  vec4 view = projectionInverse * vec4(uv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
  vec3 world = (cameraWorld * vec4(view.xyz / view.w, 1.0)).xyz;
  vec3 start = (sourceFromViewer * vec4(cameraWorld[3].xyz, 1.0)).xyz;
  vec3 ray = (sourceFromViewer * vec4(world, 1.0)).xyz - start;
  float rayLength = length(ray);
  vec3 direction = ray / max(rayLength, 1e-4);
  float stride = min(rayLength, fogParams.z) / float(${SOURCE2_FOG_STEPS});
  float optical = 0.0;
  vec3 scatter = vec3(0.0);
  for (int i = 0; i < ${SOURCE2_FOG_STEPS}; i++) {
    float t = (float(i) + 0.5) * stride;
    vec4 fog = fogSample(start + direction * t);
    float extinction = fog.a * fogParams.x * stride * clamp((t - fogFade.x) / max(fogFade.y - fogFade.x, 1e-4), 0.0, 1.0);
    scatter += fog.rgb * extinction * exp(-optical);
    optical += extinction;
  }
  return vec4(scatter, exp(-optical));
}

${mode === 'full' ? `void main() {
  vec4 color = texture2D(inputBuffer, vUv);
  float depth = texture2D(depthBuffer, vUv).r;
  // The sky sits on the far plane; the game's deferred fog skips it.
  if (fogParams.w < 0.5 || depth >= 1.0) { gl_FragColor = color; return; }
  vec4 fog = fogIntegrate(vUv, depth);
  gl_FragColor = vec4(color.rgb * fog.a + fog.rgb, color.a);
}` : `void main() {
  ivec2 size = textureSize(depthBuffer, 0);
  ivec2 pixel = min(ivec2(gl_FragCoord.xy) * 2, size - 1);
  float depth = texelFetch(depthBuffer, pixel, 0).r;
  if (fogParams.w < 0.5 || depth >= 1.0) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
  gl_FragColor = fogIntegrate((vec2(pixel) + 0.5) / vec2(size), depth);
}`}
`;

// Applies the half-resolution fog. Each pixel blends the four nearest marched blocks by distance,
// keeping only blocks whose surface lies within 5% of its own depth, so the fog of a wall never
// bleeds onto the hero in front of it; with none that close it takes the closest block.
const FOG_COMPOSITE = /* glsl */`
precision highp float;
uniform sampler2D inputBuffer;
uniform sampler2D depthBuffer;
uniform sampler2D fogBuffer;
uniform mat4 projectionInverse;
uniform vec4 fogParams;
varying vec2 vUv;
float viewDistance(float depth, vec2 uv) {
  vec4 view = projectionInverse * vec4(uv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
  return -view.z / view.w;
}
void main() {
  vec4 color = texture2D(inputBuffer, vUv);
  ivec2 size = textureSize(depthBuffer, 0);
  float depth = texelFetch(depthBuffer, ivec2(gl_FragCoord.xy), 0).r;
  if (fogParams.w < 0.5 || depth >= 1.0) { gl_FragColor = color; return; }
  ivec2 blocks = textureSize(fogBuffer, 0);
  vec2 position = (gl_FragCoord.xy - 0.5) * 0.5;
  ivec2 base = ivec2(floor(position));
  vec2 t = position - vec2(base);
  float surface = viewDistance(depth, vUv);
  vec4 sum = vec4(0.0);
  float weights = 0.0;
  vec4 closest = vec4(0.0, 0.0, 0.0, 1.0);
  float closestDifference = 1e30;
  for (int j = 0; j < 2; j++) {
    for (int i = 0; i < 2; i++) {
      ivec2 block = clamp(base + ivec2(i, j), ivec2(0), blocks - 1);
      ivec2 pixel = min(block * 2, size - 1);
      float blockDepth = texelFetch(depthBuffer, pixel, 0).r;
      vec4 fog = texelFetch(fogBuffer, block, 0);
      float difference = blockDepth >= 1.0 ? 1e30 : abs(viewDistance(blockDepth, (vec2(pixel) + 0.5) / vec2(size)) - surface) / max(surface, 1e-4);
      float weight = (i == 0 ? 1.0 - t.x : t.x) * (j == 0 ? 1.0 - t.y : t.y) * max(0.0, 1.0 - difference * 20.0);
      sum += fog * weight;
      weights += weight;
      if (difference < closestDifference) { closestDifference = difference; closest = fog; }
    }
  }
  vec4 fog = weights > 1e-4 ? sum / weights : closest;
  gl_FragColor = vec4(color.rgb * fog.a + fog.rgb, color.a);
}
`;

const FOG_VERTEX = /* glsl */`
varying vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 1.0, 1.0);
}
`;

function boxFromSource(matrix: readonly number[], min: readonly number[], max: readonly number[]): THREE.Matrix4 {
  const size = new THREE.Vector3(max[0] - min[0], max[1] - min[1], max[2] - min[2]);
  if (Math.min(size.x, size.y, size.z) <= 0) throw new Error('Invalid fog bounds.');
  return new THREE.Matrix4().makeScale(1 / size.x, 1 / size.y, 1 / size.z)
    .multiply(new THREE.Matrix4().makeTranslation(-min[0], -min[1], -min[2]))
    .multiply(new THREE.Matrix4().fromArray(matrix).invert());
}

/**
 * The map's volumetric fog as a composer pass ahead of the Source 2 tonemap. It reads the
 * composer depth and the viewer-to-Source matrix the hideout scene publishes on its scene.
 */
export class Source2FogPass extends Pass {
  private readonly material: THREE.ShaderMaterial;
  private readonly view: () => { scene: THREE.Scene; camera: THREE.Camera };

  private readonly fogLights: HideoutLight[];
  private cookies: Source2CookieAtlas | null = null;
  private readonly shadowPlaceholder: THREE.DataTexture | null;

  constructor(fog: Source2MapFog, irradiance: THREE.Data3DTexture, lights: readonly HideoutLight[], view: () => { scene: THREE.Scene; camera: THREE.Camera }) {
    super('Source2FogPass');
    this.view = view;
    this.needsDepthTexture = true;
    const volumes = fog.volumes.slice(0, SOURCE2_FOG_VOLUMES);
    const fogLights = source2FogLights(lights);
    this.fogLights = fogLights;
    const cookieLights = fogLights.some(light => light.distribution.kind !== 'sun' && light.cookie);
    const pad = <T>(items: T[], fill: () => T, count: number) => [...items, ...Array.from({ length: count - items.length }, fill)];
    const shadowed = fogLights.some(light => light.fogShadowTiles);
    // The atlas arrives after the fog is drawing (setShadowAtlas); until then no light is shadowed.
    this.shadowPlaceholder = shadowed ? source2FogShadowTexture(new Uint16Array(1), 1, 1) : null;
    let firstTile = 0;
    const shadowTiles = fogLights.map(light => {
      const count = light.fogShadowTiles?.length ?? 0;
      const tiles = new THREE.Vector2(count === 1 || count === 6 ? count : 0, firstTile);
      firstTile += count;
      return tiles;
    });
    const shadowRects = pad(fogLights.flatMap(light => (light.fogShadowTiles ?? []).map(rect => new THREE.Vector4(...rect))), () => new THREE.Vector4(), fogLights.length * 6);
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        inputBuffer: { value: null }, depthBuffer: { value: null }, fogIrradiance: { value: irradiance },
        projectionInverse: { value: new THREE.Matrix4() }, cameraWorld: { value: new THREE.Matrix4() }, sourceFromViewer: { value: new THREE.Matrix4() },
        fogFromSource: { value: boxFromSource(fog.matrix, fog.min, fog.max) },
        fogParams: { value: new THREE.Vector4(SOURCE2_FOG_DENSITY_SCALE * fog.strength, fog.indirectStrength, fog.drawDistance, 0) },
        fogFade: { value: new THREE.Vector2(...fog.fadeIn) },
        fogTint: { value: new THREE.Vector3(...fog.tint) },
        volumeCount: { value: volumes.length },
        volumeFromSource: { value: pad(volumes.map(v => boxFromSource(v.matrix, v.min, v.max)), () => new THREE.Matrix4(), SOURCE2_FOG_VOLUMES) },
        volumeParams: { value: pad(volumes.map(v => new THREE.Vector4(v.strength, v.falloffExponent, v.shape, v.indirectStrength ?? -1)), () => new THREE.Vector4(), SOURCE2_FOG_VOLUMES) },
        volumeTint: { value: pad(volumes.map(v => new THREE.Vector4(...(v.tint ?? [1, 1, 1]), v.tint ? 1 : 0)), () => new THREE.Vector4(), SOURCE2_FOG_VOLUMES) },
        // The game's froxels are far coarser than a cookie's detail, so the fog takes each
        // cookie's mean color. It arrives with the room (scene.userData.source2CookieAtlas);
        // until then a cookie light leaves the fog dark.
        ...(fogLights.length ? { ...source2LightUniforms(fogLights, null), source2LightCookieMean: { value: fogLights.map(() => new THREE.Vector3()) }, source2FogLightCount: { value: fogLights.length }, source2FogStrength: { value: fogLights.map(l => l.fogStrength ?? 0) } } : {}),
        ...(this.shadowPlaceholder ? { source2FogShadowAtlas: { value: this.shadowPlaceholder }, source2FogShadowTiles: { value: shadowTiles.map(() => new THREE.Vector2()) },
          source2FogShadowRects: { value: shadowRects } } : {}),
      },
      vertexShader: FOG_VERTEX, fragmentShader: fogFragment(fogLights.length, cookieLights, !!this.shadowPlaceholder, 'full'), depthTest: false, depthWrite: false,
    });
    const u = this.material.uniforms;
    this.march = new THREE.ShaderMaterial({ uniforms: u, vertexShader: FOG_VERTEX,
      fragmentShader: fogFragment(fogLights.length, cookieLights, !!this.shadowPlaceholder, 'march'), depthTest: false, depthWrite: false });
    this.composite = new THREE.ShaderMaterial({
      uniforms: { inputBuffer: u.inputBuffer, depthBuffer: u.depthBuffer, projectionInverse: u.projectionInverse, fogParams: u.fogParams, fogBuffer: { value: this.blocks.texture } },
      vertexShader: FOG_VERTEX, fragmentShader: FOG_COMPOSITE, depthTest: false, depthWrite: false });
    this.fullscreenMaterial = this.material;
    this.shadowTiles = shadowTiles;
  }

  private readonly shadowTiles: THREE.Vector2[];
  private readonly march: THREE.ShaderMaterial;
  private readonly composite: THREE.ShaderMaterial;
  /** The half-resolution fog, one texel per 2x2 block of pixels. */
  private readonly blocks = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: false });
  private halfResolution = false;

  /** Marches the fog at half resolution: about a quarter of its cost, softer only along depth edges. */
  setHalfResolution(half: boolean): void {
    this.halfResolution = half;
  }

  override setSize(width: number, height: number): void {
    this.blocks.setSize(Math.ceil(width / 2), Math.ceil(height / 2));
  }

  /** Shadows the fog lights with the map's precomputed shadow atlas (source2FogShadowTexture). */
  setShadowAtlas(atlas: THREE.Texture): void {
    const u = this.material.uniforms;
    if (!u.source2FogShadowAtlas) return;
    u.source2FogShadowAtlas.value = atlas;
    u.source2FogShadowTiles.value = this.shadowTiles;
  }

  override setDepthTexture(depthTexture: THREE.Texture): void {
    this.material.uniforms.depthBuffer.value = depthTexture;
  }

  override render(renderer: THREE.WebGLRenderer, inputBuffer: THREE.WebGLRenderTarget, outputBuffer: THREE.WebGLRenderTarget | null): void {
    const u = this.material.uniforms;
    const { scene, camera } = this.view();
    const map: unknown = scene.userData.source2SourceFromViewer;
    const cookies = (scene.userData.source2CookieAtlas as Source2CookieAtlas | undefined) ?? null;
    if (cookies !== this.cookies && u.source2LightCookie) {
      this.cookies = cookies;
      const next = source2LightUniforms(this.fogLights, cookies, true);
      u.source2LightCookie.value = next.source2LightCookie.value;
      if (next.source2LightCookieMean) u.source2LightCookieMean.value = next.source2LightCookieMean.value;
    }
    u.inputBuffer.value = inputBuffer.texture;
    if (map instanceof THREE.Matrix4) {
      u.projectionInverse.value.copy(camera.projectionMatrixInverse);
      u.cameraWorld.value.copy(camera.matrixWorld);
      u.sourceFromViewer.value.copy(map);
    }
    u.fogParams.value.w = map instanceof THREE.Matrix4 ? 1 : 0;
    if (this.halfResolution) {
      this.fullscreenMaterial = this.march;
      renderer.setRenderTarget(this.blocks);
      renderer.render(this.scene, this.camera);
      this.fullscreenMaterial = this.composite;
    } else this.fullscreenMaterial = this.material;
    renderer.setRenderTarget(this.renderToScreen ? null : outputBuffer);
    renderer.render(this.scene, this.camera);
  }

  override dispose(): void {
    this.shadowPlaceholder?.dispose();
    this.material.dispose();
    this.march.dispose();
    this.composite.dispose();
    this.blocks.dispose();
    super.dispose();
  }
}

/** An R16 depth atlas as an unfiltered integer texture, as the fog's shadow test reads it. */
export function source2FogShadowTexture(data: Uint16Array, width: number, height: number): THREE.DataTexture {
  const texture = new THREE.DataTexture(data, width, height, THREE.RedIntegerFormat, THREE.UnsignedShortType);
  texture.internalFormat = 'R16UI';
  texture.minFilter = THREE.NearestFilter;
  texture.magFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.flipY = false;
  texture.unpackAlignment = 2;
  texture.needsUpdate = true;
  return texture;
}

/** The map's precomputed shadow atlas, a one-slice VTV1 volume of raw R16 texels (component kind 3). */
export function parseSource2FogShadowAtlas(bytes: ArrayBuffer): THREE.DataTexture {
  if (bytes.byteLength < 20) throw new Error('Truncated shadow atlas header.');
  const header = new DataView(bytes);
  const width = header.getUint32(4, true), height = header.getUint32(8, true), depth = header.getUint32(12, true), kind = header.getUint32(16, true);
  if (header.getUint32(0, true) !== 0x31565456 || kind !== 3 || depth !== 1 || !width || !height || width > 8192 || height > 8192) throw new Error('Unsupported shadow atlas.');
  if (bytes.byteLength !== 20 + width * height * 2) throw new Error('Invalid shadow atlas size.');
  return source2FogShadowTexture(new Uint16Array(bytes, 20, width * height), width, height);
}
