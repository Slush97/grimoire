// Material oracle: renders one cached hero twice under identical controlled
// lighting, once with the production material (buildDeadlockMaterial) and once
// with a reference fragment shader fed the game's own textures and parameters,
// then reports per-pixel error. See README.md in this folder.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { parseGltfPreview } from '../../src/lib/loadGltfPreview';
import { buildDeadlockMaterial } from '../../src/lib/deadlockMaterial';
import { firstNumber, flag, getMorphic, isNprMaterial, type MorphicExtras } from '../../src/lib/source2NprMaterial';
import {
  captureViewerAmbient, viewerAmbientCube, VIEWER_ENVIRONMENT_INTENSITY, VIEWER_GROUND_COLOR, VIEWER_HEMISPHERE_INTENSITY, VIEWER_SKY_COLOR,
} from '../../src/lib/viewerAmbientLight';
import { ambientLuminanceFit, CITADEL_NPR, directLightNormalization } from '../../src/lib/citadelNprLighting';
import { CitadelRimDepth } from '../../src/lib/citadelRimDepth';
import { source2TintPlan } from '../../src/lib/source2ColorCorrection';
import { resolveBlendMode } from '../../src/lib/source2Preview/blendMode';
import { compileScalarExpr } from '../../src/lib/dynamicScalar';
import { deadlockTone } from '../../src/components/locker/heroViewerTone';

const params = new URLSearchParams(location.search);
const hero = params.get('hero') ?? 'abrams';
const width = Number(params.get('w') ?? 600);
const height = Number(params.get('h') ?? 1000);
const view = params.get('view') ?? 'front';
const exposure = Number(params.get('exposure') ?? 1.3);
const sunIntensity = Number(params.get('sun') ?? 1.4);
const crop = params.get('crop') ?? 'body';
const allSurfaces = params.get('surfaces') === 'all';
// 'citadel' is the game-faithful path, 'classic' the previous preview look.
const ours = params.get('ours') ?? 'citadel';
// The viewer's cool back fill light (Studio), on both sides; 0 disables it.
const fillIntensity = Number(params.get('fill') ?? 1.2);
// Ablations on our side (comma list): hemiOct, trans, si.
const disabled = new Set((params.get('disable') ?? '').split(',').filter(Boolean));
// gameData=1 feeds our material the game's own texture channels (color alpha as
// metalness, normal blue as roughness), i.e. what a lossless export would carry.
// A comma list (color, normal, mr) substitutes only those maps, to locate an export gap.
const gameDataParam = params.get('gameData') ?? '';
const gameParts = new Set(gameDataParam === '1' ? ['color', 'normal', 'mr'] : gameDataParam.split(',').filter(Boolean));
const gameData = gameParts.size > 0;
// Debug: output a single term on both sides (diffuse, rim, emission, spec, ibl).
const term = params.get('term');
const rimDepthOn = params.get('rimDepth') !== '0';
const TERMS: Record<string, [string, string]> = {
  diffuse: ['tDiffuse', 'citadelDiffuse'], rim: ['rim', 'citadelRimLight'], emission: ['tEmission', 'citadelEmission'],
  spec: ['tSpec', 'citadelSpec'], ibl: ['iblSpec', 'citadelIbl'], ambient: ['ambient', 'citadelAmb.rgb'],
  normal: ['(fromGame(N) * 0.5 + 0.5)', '(citadelN * 0.5 + 0.5)'],
};
// Longest edge of the game textures fed to the reference (and to gameData=1). Match the
// GLB's texture size so texel detail is compared like for like.
const texMax = Number(params.get('texMax') ?? 1024);
const envIntensity = Number(params.get('env') ?? VIEWER_ENVIRONMENT_INTENSITY.studio);
const statusEl = document.getElementById('status')!;
const status = (text: string) => { statusEl.textContent = text; };

const VERTEX = /* glsl */ `
#include <common>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
varying vec3 vWorldPos; varying vec3 vWorldNormal; varying vec4 vWorldTangent;
varying vec2 vUv0; varying vec2 vUv1; varying vec4 vColor;
void main() {
  #include <beginnormal_vertex>
  #include <morphnormal_vertex>
  #include <skinbase_vertex>
  #include <skinnormal_vertex>
  #include <begin_vertex>
  #include <morphtarget_vertex>
  #include <skinning_vertex>
  vec4 world = modelMatrix * vec4(transformed, 1.0);
  vWorldPos = world.xyz;
  vWorldNormal = normalize(mat3(modelMatrix) * objectNormal);
  vWorldTangent = vec4(normalize(mat3(modelMatrix) * objectTangent), tangent.w);
  vUv0 = uv; vUv1 = uv;
  #ifdef USE_COLOR
    vColor = vec4(color.rgb, 1.0);
  #else
    vColor = vec4(1.0);
  #endif
  gl_Position = projectionMatrix * viewMatrix * world;
}`;

/** Three world axes to the game's Z-up axes, and the 6-face cube reordered to the
 *  game's +X, +Y, +Z, -X, -Y, -Z. */
const toGame = (v: THREE.Vector3) => new THREE.Vector3(v.x, -v.z, v.y);
function gameCube(cube: readonly THREE.Vector3[]): THREE.Vector3[] {
  // three order +X, -X, +Y, -Y, +Z, -Z; game +Y is three -Z, game +Z is three +Y.
  return [cube[0], cube[5], cube[2], cube[1], cube[4], cube[3]].map((v) => v.clone());
}

interface GameTexture { texture: THREE.DataTexture; reflectivity: THREE.Vector4 }
const texCache = new Map<string, Promise<GameTexture | null>>();
function gameTexture(path: string | undefined, srgb: boolean): Promise<GameTexture | null> {
  if (!path) return Promise.resolve(null);
  const key = `${path}|${srgb}`;
  let pending = texCache.get(key);
  if (!pending) {
    pending = fetch(`/@game-tex?path=${encodeURIComponent(`${path}_c`)}&max=${texMax}`).then(async (response) => {
      if (!response.ok) return null;
      const bytes = await response.arrayBuffer();
      const view = new DataView(bytes);
      const w = view.getInt32(0, true);
      const h = view.getInt32(4, true);
      const reflectivity = new THREE.Vector4(view.getFloat32(8, true), view.getFloat32(12, true), view.getFloat32(16, true), view.getFloat32(20, true));
      const texture = new THREE.DataTexture(new Uint8Array(bytes, 24, w * h * 4), w, h, THREE.RGBAFormat);
      texture.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
      texture.magFilter = THREE.LinearFilter;
      texture.minFilter = THREE.LinearMipmapLinearFilter;
      texture.generateMipmaps = true;
      texture.anisotropy = 8;
      texture.flipY = false;
      texture.needsUpdate = true;
      return { texture, reflectivity };
    });
    texCache.set(key, pending);
  }
  return pending;
}

function solid(r: number, g: number, b: number, a = 1): THREE.DataTexture {
  const texture = new THREE.DataTexture(new Uint8Array([r * 255, g * 255, b * 255, a * 255]), 1, 1);
  texture.needsUpdate = true;
  return texture;
}

/** A scalar param as the engine sees it at time 0: a dynamic expression wins over the static value. */
const num = (m: MorphicExtras, name: string, fallback: number) => {
  const dynamic = m.dynamic_params?.[name];
  const compiled = dynamic?.decompiled ? compileScalarExpr(dynamic.source) : null;
  return compiled ? compiled(0) : firstNumber(m, [name], fallback);
};
const vec = (m: MorphicExtras, name: string, fallback: number[]) => m.vectors?.[name] ?? fallback;

/** Faithful-path eligible: opaque NPR pbr.vfx without glass/unlit. */
function eligible(material: THREE.Material): boolean {
  const m = getMorphic(material);
  if (!m || !isNprMaterial(material) || m.shader.toLowerCase() !== 'pbr.vfx') return false;
  if (flag(m, 'F_UNLIT') || flag(m, 'F_ALPHA_TEST')) return false;
  if (allSurfaces) return true;
  if (flag(m, 'F_GLASS') || flag(m, 'F_TRANSLUCENT')) return false;
  return resolveBlendMode(m) === 'opaque';
}

async function referenceMaterial(base: THREE.Material, fragment: string, shared: Record<string, THREE.IUniform>, defines: Record<string, string>, vertexColors: boolean) {
  const m = getMorphic(base)!;
  const slots = m.texture_slots ?? {};
  const [color, mask, trans, normal, ao, illum, glass, metal] = await Promise.all([
    gameTexture(slots.g_tColor, true), gameTexture(slots.g_tTintMaskRimLightMask, false),
    gameTexture(slots.g_tNprTransmissiveColor, true), gameTexture(slots.g_tNormalRoughness, false),
    gameTexture(slots.g_tAmbientOcclusion, false), gameTexture(slots.g_tSelfIllumMask, false),
    gameTexture(slots.g_tGlass, false),
    resolveBlendMode(m) !== 'opaque' ? gameTexture(slots.g_tMetalness, false) : null,
  ]);
  const csb = vec(m, 'g_vAlbedoContrastSaturationBrightness1', [1, 1, 1]);
  const tint = source2TintPlan(m, new THREE.Color(...(vec(m, 'g_vColorTint1', [1, 1, 1]).slice(0, 3) as [number, number, number])));
  const reflectivity = color?.reflectivity ?? new THREE.Vector4(1, 1, 1, 1);
  const uniforms: Record<string, THREE.IUniform> = {
    ...shared,
    tColor: { value: color?.texture ?? solid(1, 1, 1, 0) },
    tTintRim: { value: mask?.texture ?? solid(1, 1, 1) },
    tTrans: { value: trans?.texture ?? solid(0, 0, 0) },
    tNormalRough: { value: normal?.texture ?? solid(0.5, 0.5, 1) },
    tAO: { value: ao?.texture ?? solid(1, 1, 1) },
    tSelfIllum: { value: illum?.texture ?? solid(1, 1, 1) },
    tGlass: { value: glass?.texture ?? solid(1, 1, 1) },
    tMetal: { value: metal?.texture ?? solid(0, 0, 0) },
    uTranslucent: { value: resolveBlendMode(m) !== 'opaque' ? 1 : 0 },
    uAlphaAngle: { value: num(m, 'g_flAlphaAnglePower1', 0) },
    uGlass: { value: flag(m, 'F_GLASS') ? 1 : 0 },
    uGlassBlur: { value: new THREE.Vector3(num(m, 'g_flCloakBlurAmount', 0),
      num(m, 'g_flCloakBlurFactorMinRoughness', 1), num(m, 'g_flCloakBlurFactorMaxRoughness', 1)) },
    uOpacity: { value: num(m, 'g_flOpacityScale1', 1) },
    uAdditive: { value: resolveBlendMode(m) === 'additive' ? 1 : 0 },
    uUseFrontFaceNormalsForBackFaces: { value: flag(m, 'F_USE_FRONT_FACE_NORMALS_FOR_BACK_FACES') ? 1 : 0 },
    uApplyTintToVertexColors: { value: num(m, 'g_bApplyTintToVertexColors', 0) },
    uMaskVertexColorTint: { value: num(m, 'g_bMaskVertexColorTint1', 1) },
    uVertexColorStrength: { value: num(m, 'g_fVertexColorStrength1', 1) },
    uMaskColorTint: { value: num(m, 'g_bMaskColorTint1', 1) },
    uUseSecondaryUvAO: { value: num(m, 'g_bUseSecondaryUvForAmbientOcclusion', 0) },
    uSelfIllum: { value: flag(m, 'F_SELF_ILLUM') ? 1 : 0 },
    uSecondaryUvSelfIllum: { value: num(m, 'g_bUseSecondaryUvForSelfIllum1', 0) },
    uSIScale: { value: num(m, 'g_flSelfIllumScale1', 0) },
    uSIAlbedoFactor: { value: num(m, 'g_flSelfIllumAlbedoFactor1', 0) },
    uSIFresnelExp: { value: num(m, 'g_flSelfIllumFresnelMaskExponent', 5) },
    uNoSpecFullRough: { value: flag(m, 'F_NO_SPECULAR_AT_FULL_ROUGHNESS') ? 1 : 0 },
    uSITint: { value: new THREE.Vector3(...(vec(m, 'g_vSelfIllumTint1', [1, 1, 1]).slice(0, 3) as [number, number, number])) },
    uSIFresnelTint: { value: new THREE.Vector3(...(vec(m, 'g_vSelfIllumFresnelMaskTint1', [1, 1, 1]).slice(0, 3) as [number, number, number])) },
    uSIFresnelRange: { value: new THREE.Vector2(...(vec(m, 'g_vSelfIllumFresnelMaskRange1', [0, 1]).slice(0, 2) as [number, number])) },
    uSIScroll: { value: new THREE.Vector2(...(vec(m, 'g_vSelfIllumScrollSpeed1', [0, 0]).slice(0, 2) as [number, number])) },
    uAlbedoScroll: { value: new THREE.Vector2(...(vec(m, 'g_vAlbedoScrollSpeed1', [0, 0]).slice(0, 2) as [number, number])) },
    uNormalScroll: { value: new THREE.Vector2(...(vec(m, 'g_vNormalAndRoughnessScrollSpeed1', [0, 0]).slice(0, 2) as [number, number])) },
    uColorTint: { value: tint.matrix },
    uColorTintOffset: { value: tint.offset },
    uCSB: { value: new THREE.Vector3(csb[0], csb[1], csb[2]) },
    uReflectivity: { value: new THREE.Vector3(reflectivity.x, reflectivity.y, reflectivity.z) },
    uTime: { value: 0 },
    uHasVertexColor: { value: vertexColors && flag(m, 'F_VERTEX_COLOR') ? 1 : 0 },
  };
  const blend = resolveBlendMode(m);
  return new THREE.ShaderMaterial({
    vertexShader: VERTEX, fragmentShader: fragment, uniforms, defines: { USE_TANGENT: '', ...defines },
    vertexColors, side: flag(m, 'F_RENDER_BACKFACES') ? THREE.DoubleSide : THREE.FrontSide,
    transparent: flag(m, 'F_GLASS') || blend !== 'opaque',
    depthWrite: flag(m, 'F_GLASS') || blend === 'opaque' || blend === 'blend_zwrite',
    blending: blend === 'additive' ? THREE.AdditiveBlending : THREE.NormalBlending,
  });
}

/** Swap the GLB maps for the game's channels: albedo, hemi-oct normal, and a
 *  metal-roughness map built from color alpha (metal) and normal blue (roughness). */
async function substituteGameData(original: THREE.Material, material: THREE.MeshStandardMaterial) {
  const slots = getMorphic(original)?.texture_slots ?? {};
  const [color, normal] = await Promise.all([gameTexture(slots.g_tColor, true), gameTexture(slots.g_tNormalRoughness, false)]);
  if (color && gameParts.has('color')) {
    // A fresh texture: a clone would share the reference's pixel source.
    const image = color.texture.image as { data: Uint8Array; width: number; height: number };
    const map = new THREE.DataTexture(image.data.map((v, i) => (i % 4 === 3 ? 255 : v)), image.width, image.height);
    map.colorSpace = THREE.SRGBColorSpace;
    map.wrapS = map.wrapT = THREE.RepeatWrapping;
    map.minFilter = THREE.LinearMipmapLinearFilter;
    map.generateMipmaps = true;
    map.anisotropy = 8;
    map.needsUpdate = true;
    material.map = map;
  }
  if (normal && gameParts.has('normal')) material.normalMap = normal.texture;
  if ((color || normal) && gameParts.has('mr')) {
    // Metal (color alpha) in blue and roughness (normal blue) in green, sampled
    // nearest into the larger of the two resolutions.
    const sources = [color, normal].filter((t): t is GameTexture => !!t).map((t) => t.texture.image as { data: Uint8Array; width: number; height: number });
    const w = Math.max(...sources.map((t) => t.width)), h = Math.max(...sources.map((t) => t.height));
    const at = (img: { data: Uint8Array; width: number; height: number } | undefined, x: number, y: number, c: number, fallback: number) => {
      if (!img) return fallback;
      const sx = Math.floor((x / w) * img.width), sy = Math.floor((y / h) * img.height);
      return img.data[(sy * img.width + sx) * 4 + c];
    };
    const cimg = color?.texture.image as { data: Uint8Array; width: number; height: number } | undefined;
    const nimg = normal?.texture.image as { data: Uint8Array; width: number; height: number } | undefined;
    const mr = new Uint8Array(w * h * 4);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        mr[i + 1] = at(nimg, x, y, 2, 255);
        mr[i + 2] = at(cimg, x, y, 3, 0);
        mr[i + 3] = 255;
      }
    }
    const tex = new THREE.DataTexture(mr, w, h);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.anisotropy = 8;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.generateMipmaps = true;
    tex.needsUpdate = true;
    material.metalnessMap = tex;
    material.roughnessMap = tex;
    material.metalness = 1;
    material.roughness = 1;
  }
  material.needsUpdate = true;
}

function cubeUvDefines(envMap: THREE.Texture): Record<string, string> {
  const imageHeight = (envMap.image as { height: number }).height;
  const maxMip = Math.log2(imageHeight) - 2;
  const texelHeight = 1 / imageHeight;
  const texelWidth = 1 / (3 * Math.max(Math.pow(2, maxMip), 7 * 16));
  return {
    ENVMAP_TYPE_CUBE_UV: '', CUBEUV_TEXEL_WIDTH: texelWidth.toFixed(10),
    CUBEUV_TEXEL_HEIGHT: texelHeight.toFixed(10), CUBEUV_MAX_MIP: `${maxMip.toFixed(1)}`,
  };
}

/** Display transform used for the comparison: preview exposure, Deadlock's
 *  Hable curve, sRGB encode. */
const tonemap = params.get('tonemap') !== '0';
function display(v: number): number {
  const t = tonemap ? deadlockTone(v * exposure) : Math.min(1, Math.max(0, v));
  return t <= 0.0031308 ? 12.92 * t : 1.055 * Math.pow(t, 1 / 2.4) - 0.055;
}

function toImage(pixels: Float32Array, map: (i: number, c: number) => number): string {
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  const image = ctx.createImageData(width, height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const src = ((height - 1 - y) * width + x) * 4;
      const dst = (y * width + x) * 4;
      for (let c = 0; c < 3; c++) image.data[dst + c] = Math.round(255 * Math.min(1, Math.max(0, map(src, c))));
      image.data[dst + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  return canvas.toDataURL('image/png');
}

async function run() {
  const renderer = new THREE.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true });
  (window as unknown as { __renderer: unknown }).__renderer = renderer;
  renderer.setSize(width, height);
  renderer.toneMapping = THREE.NoToneMapping;
  const fragment = await (await fetch('/@reference')).text();
  const gltf = await parseGltfPreview(await (await fetch(`/@hero-cache/${hero}_vanilla/model-rigged.glb`)).arrayBuffer());
  const scene = new THREE.Scene();
  // A shared, opaque neutral backdrop exercises transmission without Three's
  // private white/half-alpha fallback for transparent canvas backgrounds.
  const transmissionBackdrop = allSurfaces ? new THREE.Color(0.5, 0.5, 0.5) : null;
  scene.background = transmissionBackdrop;
  scene.add(gltf.scene);
  gltf.scene.updateMatrixWorld(true);

  // Lighting: the studio room for reflections and the ambient probe, one key light.
  const pmrem = new THREE.PMREMGenerator(renderer);
  const room = new RoomEnvironment();
  const envRT = pmrem.fromScene(room, 0.04);
  scene.environment = envRT.texture;
  scene.environmentIntensity = envIntensity;
  const sh = await captureViewerAmbient(renderer, room);
  const cube = viewerAmbientCube(sh, VIEWER_ENVIRONMENT_INTENSITY.studio, true);
  const keyDir = new THREE.Vector3(-3, 4, 3).normalize();
  const key = new THREE.DirectionalLight(0xffffff, sunIntensity);
  key.position.copy(keyDir);
  scene.add(key);
  const fillDir = new THREE.Vector3(3, 2, -3).normalize();
  const fillColor = new THREE.Color(0.65, 0.78, 1);
  const fill = new THREE.DirectionalLight(fillColor, fillIntensity);
  fill.position.copy(fillDir);
  scene.add(fill);
  // The hemisphere light only feeds three's own ambient (the classic look); the
  // game-faithful path reads the ambient cube, which already folds it in.
  scene.add(new THREE.HemisphereLight(VIEWER_SKY_COLOR, VIEWER_GROUND_COLOR, VIEWER_HEMISPHERE_INTENSITY));

  // Frame the bind pose.
  const box = new THREE.Box3().setFromObject(gltf.scene, true);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const camera = new THREE.PerspectiveCamera(20, width / height, 0.01, 1000);
  const yaw = { front: 0, back: Math.PI, left: -Math.PI / 2, right: Math.PI / 2 }[view] ?? 0;
  let target = center.clone();
  let span = size.y;
  if (crop === 'face') { target = new THREE.Vector3(center.x, box.max.y - size.y * 0.09, center.z); span = size.y * 0.2; }
  if (crop === 'torso') { target = new THREE.Vector3(center.x, box.max.y - size.y * 0.32, center.z); span = size.y * 0.42; }
  const distance = (span * 0.55) / Math.tan(THREE.MathUtils.degToRad(10));
  camera.position.copy(target).add(new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw)).multiplyScalar(distance));
  camera.lookAt(target);
  camera.updateMatrixWorld(true);
  const cameraBack = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 2).normalize();
  const primary = keyDir.clone().lerp(cameraBack, CITADEL_NPR.primaryLightCameraWeight).normalize();

  const fit = ambientLuminanceFit(cube);
  const gameFit = new THREE.Vector4(fit.x, -fit.z, fit.y, fit.w).multiplyScalar(1 / Math.PI);
  const shared: Record<string, THREE.IUniform> = {
    tScene: { value: null }, uSceneSize: { value: new THREE.Vector2(width, height) },
    uBounce: { value: 1 }, uDiffStepSharp: { value: CITADEL_NPR.diffuseStepSharpness }, uDiffPbrBlend: { value: CITADEL_NPR.diffusePbrBlend },
    uDirectDiffuse: { value: 1 }, uWrap: { value: CITADEL_NPR.directLightWrap }, uOoNorm: { value: directLightNormalization() },
    uDirectSpec: { value: 0 }, uSpecSteps: { value: 4 }, uSpecStepSharp: { value: 0.956 }, uSpecTint: { value: 0.628 },
    uSpecRoughBias: { value: 0.011 }, uSpecReflectance: { value: 0.04 },
    uExposureCtl: { value: 1 }, uExposureCtlPbrBlend: { value: 0 }, uRim: { value: 1 },
    uRimWrap: { value: CITADEL_NPR.rimLightWrap }, uRimFalloff: { value: CITADEL_NPR.rimLightFalloff }, uRimStrength: { value: CITADEL_NPR.rimLightStrength },
    uDfao: { value: new THREE.Vector2(...CITADEL_NPR.dfaoInfluenceRange) }, uRimUpRamp: { value: new THREE.Vector2(CITADEL_NPR.rimLightUpRamp, CITADEL_NPR.rimLightUpRamp) },
    uExposureTargets: { value: new THREE.Vector3(...CITADEL_NPR.exposureTargets) }, uPrimaryDir: { value: toGame(primary) },
    uSunDir: { value: toGame(keyDir) }, uSunColor: { value: new THREE.Vector3(1, 1, 1).multiplyScalar(sunIntensity / Math.PI) },
    uFillDir: { value: toGame(fillDir) },
    uFillColor: { value: new THREE.Vector3(fillColor.r, fillColor.g, fillColor.b).multiplyScalar(fillIntensity / Math.PI) },
    uAmbientCube: { value: gameCube(cube) }, uExposure: { value: exposure }, uProbeLumSH: { value: gameFit },
    envMap: { value: envRT.texture }, uEnvIntensity: { value: envIntensity },
    tDepth: { value: null }, uDepthNearFar: { value: new THREE.Vector2(camera.near, camera.far) }, uDepthSize: { value: new THREE.Vector2(width, height) },
    uUnit: { value: 1 }, uRimOccDist: { value: CITADEL_NPR.rimOcclusionSampleDistance }, uRimOccTolMin: { value: CITADEL_NPR.rimOcclusionToleranceMin },
    uRimOccTolRange: { value: CITADEL_NPR.rimOcclusionToleranceRange }, uRimDepthOcc: { value: rimDepthOn ? 1 : 0 },
    uViewProj: { value: new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse) },
  };
  const defines: Record<string, string> = cubeUvDefines(envRT.texture);
  if (term && TERMS[term]) defines.REF_TERM = TERMS[term][0];

  // Build both material sets per mesh slot, plus an id pass for per-material stats.
  const slots: { mesh: THREE.Mesh; index: number; original: THREE.Material; ours: THREE.Material; ref: THREE.Material; id: THREE.Material; name: string; use: boolean }[] = [];
  const meshes: THREE.Mesh[] = [];
  gltf.scene.traverse((o) => { if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh); });
  const black = new THREE.MeshBasicMaterial({ color: 0x000000 });
  let materialIndex = 0;
  const names: string[] = [];
  for (const mesh of meshes) {
    const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (let index = 0; index < list.length; index++) {
      const original = list[index];
      const use = eligible(original);
      const id = ++materialIndex;
      names[id] = original.name;
      let oursMaterial: THREE.Material = black;
      let ref: THREE.Material = black;
      if (use) {
        const built = buildDeadlockMaterial(original);
        built.uniforms.uCelV2.value = 1;
        built.uniforms.uCitadelLighting.value = ours === 'citadel' ? 1 : 0;
        built.uniforms.uNprAmbientCubeOn.value = 1;
        built.uniforms.uNprAmbientCube.value = cube.map((v) => v.clone());
        built.uniforms.uNprExposure.value.set(0.5 * Math.PI, 0.15);
        built.uniforms.uCitadelExposure.value = exposure;
        built.uniforms.uCitadelAmbientFit.value = fit.clone().multiplyScalar(1 / Math.PI);
        built.uniforms.uKeyDir.value = keyDir.clone();
        if (disabled.has('hemiOct')) built.uniforms.uCitadelHemiOctNormals.value = 0;
        if (disabled.has('trans')) built.uniforms.uCitadelHasTransmissive.value = 0;
        if (disabled.has('si')) built.uniforms.uCitadelSelfIllumOn.value = 0;
        if (gameData) await substituteGameData(original, built.material as THREE.MeshStandardMaterial);
        const flipY = params.get('flipY') === '1';
        if ((term && TERMS[term]) || flipY) {
          const previous = built.material.onBeforeCompile;
          built.material.onBeforeCompile = (shader, renderer) => {
            previous.call(built.material, shader, renderer);
            if (term && TERMS[term]) shader.fragmentShader = shader.fragmentShader.replace('nprOut = citadelOut;', `nprOut = ${TERMS[term][1]};`);
            if (flipY) shader.fragmentShader = shader.fragmentShader.replace('return vec3(n.x, -n.y, n.z);', 'return vec3(n.x, n.y, n.z);');
          };
          built.material.customProgramCacheKey = () => `oracle-${term}-${flipY}`;
        }
        oursMaterial = built.material;
        ref = await referenceMaterial(original, fragment, shared, defines, !!mesh.geometry.getAttribute('color'));
      }
      const idMaterial = new THREE.MeshBasicMaterial({ color: new THREE.Color((id & 255) / 255, use ? 1 : 0, 0), side: original.side });
      slots.push({ mesh, index, original, ours: oursMaterial, ref, id: idMaterial, name: original.name, use });
    }
  }

  const rt = new THREE.WebGLRenderTarget(width, height, { type: THREE.FloatType, samples: 0 });
  const opaqueRT = new THREE.WebGLRenderTarget(width, height, { type: THREE.FloatType, samples: 0 });
  // Separate opaque depth captures keep a production depth bug measurable.
  const rimDepth = new CitadelRimDepth();
  const referenceDepth = new CitadelRimDepth();
  if (rimDepthOn) {
    for (const slot of slots) {
      if (Array.isArray(slot.mesh.material)) slot.mesh.material[slot.index] = slot.ref;
      else slot.mesh.material = slot.ref;
    }
    referenceDepth.render(renderer, gltf.scene, camera);
    shared.tDepth.value = referenceDepth.texture;
    for (const slot of slots) {
      if (Array.isArray(slot.mesh.material)) slot.mesh.material[slot.index] = slot.ours;
      else slot.mesh.material = slot.ours;
    }
    rimDepth.render(renderer, gltf.scene, camera);
    for (const slot of slots) {
      const uniforms = (slot.ours as THREE.Material & { uniforms?: Record<string, THREE.IUniform> }).uniforms;
      if (slot.use && uniforms) rimDepth.bind(uniforms, camera, gltf.scene);
    }
  }
  const renderPass = (pick: 'ours' | 'ref' | 'id'): Float32Array => {
    scene.background = pick === 'id' ? null : transmissionBackdrop;
    for (const slot of slots) {
      const material = slot[pick];
      if (Array.isArray(slot.mesh.material)) slot.mesh.material[slot.index] = material;
      else slot.mesh.material = material;
    }
    if (pick === 'ref' && allSurfaces) {
      // An independent framebuffer copy of the reference's opaque scene. Glass
      // reference shaders consume it; they do not sample production's output.
      const hidden = new Map<THREE.Material, boolean>();
      for (const slot of slots) {
        if (!slot.ref.transparent) continue;
        hidden.set(slot.ref, slot.ref.visible);
        slot.ref.visible = false;
      }
      renderer.setRenderTarget(opaqueRT);
      renderer.setClearColor(0x000000, 0);
      renderer.clear();
      renderer.render(scene, camera);
      hidden.forEach((visible, material) => { material.visible = visible; });
      shared.tScene.value = opaqueRT.texture;
    }
    renderer.setRenderTarget(rt);
    renderer.setClearColor(0x000000, 0);
    renderer.clear();
    renderer.render(scene, camera);
    const out = new Float32Array(width * height * 4);
    renderer.readRenderTargetPixels(rt, 0, 0, width, height, out);
    renderer.setRenderTarget(null);
    return out;
  };
  status('rendering');
  const idPixels = renderPass('id');
  const refPixels = renderPass('ref');
  const oursPixels = renderPass('ours');

  // Metrics over eligible pixels.
  const lum = (p: Float32Array, i: number) => 0.2126 * p[i] + 0.7152 * p[i + 1] + 0.0722 * p[i + 2];
  const per = new Map<string, { n: number; refLum: number; absLin: number; sq8: number; abs8: number }>();
  const total = { n: 0, refLum: 0, absLin: 0, sq8: 0, abs8: 0 };
  for (let i = 0; i < width * height * 4; i += 4) {
    if (idPixels[i + 1] < 0.5 || idPixels[i + 3] < 0.5) continue;
    const id = Math.round(idPixels[i] * 255);
    const name = names[id];
    const stat = per.get(name) ?? { n: 0, refLum: 0, absLin: 0, sq8: 0, abs8: 0 };
    let sq = 0, ab = 0, lin = 0;
    for (let c = 0; c < 3; c++) {
      const d = 255 * (display(oursPixels[i + c]) - display(refPixels[i + c]));
      sq += d * d; ab += Math.abs(d);
      lin += Math.abs(oursPixels[i + c] - refPixels[i + c]);
    }
    for (const s of [stat, total]) { s.n++; s.refLum += lum(refPixels, i); s.absLin += lin / 3; s.sq8 += sq / 3; s.abs8 += ab / 3; }
    per.set(name, stat);
  }
  const summarize = (s: typeof total) => ({
    pixels: s.n,
    rmse8: +Math.sqrt(s.sq8 / Math.max(1, s.n)).toFixed(2),
    mae8: +(s.abs8 / Math.max(1, s.n)).toFixed(2),
    relLinear: +(s.absLin / Math.max(1e-9, s.refLum)).toFixed(4),
  });
  const result = {
    hero, view, crop, ours, allSurfaces, rimDepth: rimDepthOn, exposure, sunIntensity, fillIntensity, gameData, disabled: [...disabled],
    total: summarize(total),
    materials: Object.fromEntries([...per.entries()].sort((a, b) => b[1].n - a[1].n).map(([name, s]) => [name, summarize(s)])),
    excluded: slots.filter((s) => !s.use).map((s) => s.name),
    images: {
      ref: toImage(refPixels, (i, c) => display(refPixels[i + c])),
      ours: toImage(oursPixels, (i, c) => display(oursPixels[i + c])),
      diff: toImage(oursPixels, (i, c) => Math.abs(display(oursPixels[i + c]) - display(refPixels[i + c])) * 4),
    },
  };
  const images = document.getElementById('images')!;
  for (const [label, src] of Object.entries(result.images)) {
    const figure = document.createElement('figure');
    figure.innerHTML = `<figcaption>${label}</figcaption><img src="${src}">`;
    images.appendChild(figure);
  }
  status(JSON.stringify({ ...result, images: undefined }, null, 1));
  (window as unknown as { __oracle: unknown }).__oracle = result;
}

run().catch((error: unknown) => {
  status(`failed: ${error instanceof Error ? error.stack : String(error)}`);
  (window as unknown as { __oracle: unknown }).__oracle = { error: String(error) };
});
