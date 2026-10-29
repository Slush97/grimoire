import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { disposeTexture, parseGltfPreview, materialTextures } from '../../lib/loadGltfPreview';
import type { HideoutSceneInfo } from '../../types/skinEditor';
import { applySource2DynamicLights, createSource2ParticleLights, type Source2CookieAtlas, type Source2ParticleLights } from '../../lib/source2DynamicLights';
import { loadSource2CookieAtlas, source2LightReach } from '../../lib/source2LightCookies';
import { applySource2EnvironmentMaterial } from '../../lib/source2EnvironmentMaterial';
import { SOURCE_TO_GLTF, hideoutDrawTint, hideoutInstanceMatrix, hideoutMaterialTint, hideoutObjectTint, hideoutViewHeading } from '../../lib/hideoutTransform';
import { buildDeadlockMaterial } from '../../lib/deadlockMaterial';
import { getMorphic, applySource2MaterialHints } from '../../lib/source2NprMaterial';
import { applySource2ProbeVolume, parseSource2Volume, source2ViewerToMap, source2MapProbeNormals, type Source2ProbeLighting } from '../../lib/source2ProbeVolume';
import type { ViewerAmbientProbe } from '../../lib/viewerAmbientLight';
import { applySource2Lightmap, applySource2MapProbe, applySource2MapTonemap, source2MapProbeTarget } from '../../lib/source2Lightmap';
import { claimHideoutLoad } from '../../lib/hideoutPreload';
import { HideoutParticleLayer } from './HideoutParticleLayer';
import { HideoutSnapshot, type HideoutRoom } from './HideoutSnapshot';
import { createSource2Sky, loadSource2SkyCube } from '../../lib/source2Atmosphere';
import { HideoutWorldCards } from './HideoutWorldCards';
import { isWorldParticleCard } from '../../lib/mapParticleMaterial';
import { cacheMapStaticUniforms } from '../../lib/mapStaticUniforms';
import { SOURCE2_PARTICLE_SHADOW_LAYER } from '../../lib/source2ParticleShadows';
import { HIDEOUT_ROOM_LAYER, RoomClearance, hideoutCenteringShift, hideoutSeenThroughRoom } from '../../lib/hideoutClearance';

function disposeModels(models: THREE.Object3D[]): void {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  for (const model of models) model.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    geometries.add(object.geometry);
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      materials.add(material);
      for (const texture of materialTextures(material)) textures.add(texture);
      for (const texture of Object.values(getMorphic(material)?.resolvedTextures ?? {})) textures.add(texture);
    }
  });
  geometries.forEach((item) => item.dispose());
  materials.forEach((item) => item.dispose());
  textures.forEach(disposeTexture);
}

/** three culls a skinned mesh by bounds taken once, from whatever pose it first draws in, which a
 *  clip leaves (a pacing ghost walks out of them). Bound every pose the clip reaches instead: the bind
 *  pose and each bone sampled over the clip, widened by a quarter of the bind radius for the body
 *  around the bones. */
function fitClipBounds(root: THREE.Object3D, mixer: THREE.AnimationMixer, clip: THREE.AnimationClip): void {
  const meshes: THREE.SkinnedMesh[] = [];
  root.traverse(object => { if (object instanceof THREE.SkinnedMesh) meshes.push(object); });
  const boxes = meshes.map(mesh => {
    mesh.geometry.computeBoundingBox();
    return mesh.geometry.boundingBox?.clone() ?? new THREE.Box3();
  });
  const point = new THREE.Vector3(), inverse = new THREE.Matrix4();
  for (let sample = 0; sample <= 8; sample++) {
    mixer.setTime(clip.duration * sample / 8);
    root.updateMatrixWorld(true);
    meshes.forEach((mesh, i) => {
      inverse.copy(mesh.matrixWorld).invert();
      for (const bone of mesh.skeleton.bones) boxes[i].expandByPoint(point.setFromMatrixPosition(bone.matrixWorld).applyMatrix4(inverse));
    });
  }
  mixer.setTime(0);
  meshes.forEach((mesh, i) => {
    mesh.geometry.computeBoundingSphere();
    const sphere = boxes[i].getBoundingSphere(new THREE.Sphere());
    sphere.radius += (mesh.geometry.boundingSphere?.radius ?? 0) * 0.25;
    mesh.boundingSphere = sphere;
  });
}

/** Runs after the hero's own material builders, on the materials they produced. */
export function HideoutHeroLighting({ model, probe, revision }: {
  model: THREE.Object3D | null; probe: ViewerAmbientProbe; revision: string;
}) {
  useEffect(() => {
    if (!model || probe.kind !== 'map') return;
    const restore: (() => void)[] = [];
    const seen = new Set<THREE.Material>();
    model.traverse(object => {
      if (!(object instanceof THREE.Mesh)) return;
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
        if (seen.has(material) || !('isMeshStandardMaterial' in material)) continue;
        seen.add(material);
        const compile = material.onBeforeCompile, key = material.customProgramCacheKey;
        applySource2MapProbe(material, probe.lighting.heading);
        applySource2ProbeVolume(material, probe.lighting);
        applySource2DynamicLights(material, { ...probe.lighting, shadows: { kind: 'probe' } });
        restore.push(() => { material.onBeforeCompile = compile; material.customProgramCacheKey = key; material.needsUpdate = true; });
      }
    });
    return () => restore.forEach(reset => reset());
  }, [model, probe, revision]);
  return null;
}

/** While loading, `info` arrives with the metadata, before any room geometry,
 *  so the map's post pipeline can wrap the hero's first frames. */
export type HideoutStatus = { kind: 'loading'; info?: HideoutSceneInfo } | { kind: 'ready'; info: HideoutSceneInfo; failedLoads: number } | { kind: 'failed' };

/** Largest gap, in viewer units (the hero is two tall), between the spawn and the floor surface
 * under the hero that the room closes by moving its floor onto the hero's. */
const HIDEOUT_FLOOR_SNAP = 0.05;

/** Link every program the first room frame needs, off the render loop. Three
 *  keys programs on the scene's lights and on whether a render target is bound
 *  (output color space and tone mapping), so compiling the room alone, with no
 *  target, misses both the hero's relink for the room lights and the post and
 *  transmission passes' variants; those then link synchronously on first use. */
async function precompileWithRoom(gl: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, room: THREE.Object3D, postprocess: boolean): Promise<void> {
  const target = postprocess ? new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType }) : null;
  const previous = gl.getRenderTarget();
  scene.add(room);
  let ready: Promise<unknown>;
  try {
    if (target) gl.setRenderTarget(target);
    ready = gl.compileAsync(scene, camera);
  } finally {
    gl.setRenderTarget(previous);
    room.removeFromParent();
    target?.dispose();
  }
  await ready;
}

/** The same, for a room already in the scene under a hidden wrapper: shown only while the compile is
 *  issued, so its lights count, then hidden until the programs are linked. */
async function precompileInPlace(gl: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, wrapper: THREE.Object3D, postprocess: boolean): Promise<void> {
  const target = postprocess ? new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType }) : null;
  const previous = gl.getRenderTarget();
  const visible = wrapper.visible;
  wrapper.visible = true;
  let ready: Promise<unknown>;
  try {
    if (target) gl.setRenderTarget(target);
    ready = gl.compileAsync(scene, camera);
  } finally {
    gl.setRenderTarget(previous);
    wrapper.visible = visible;
    target?.dispose();
  }
  await ready;
}

export function HideoutScene({ scale, floor, onStatus, onProbe, onRoomArrive, onSnapshotShown, onLoadStage, postprocess = false, snapshotHint, active = true }: {
  scale: number; floor: number; postprocess?: boolean;
  /** Names this viewer's saved room frame (see HideoutSnapshot). Post-processed scenes only. */
  snapshotHint?: string;
  /** False keeps the loaded room resident but hidden, with the scene's lighting left to another scene. */
  active?: boolean;
  /** Called just before the shown room first draws, while the frame before it is still on screen. */
  onRoomArrive?: () => void;
  /** Called when the saved room frame first draws in place of the loading room. */
  onSnapshotShown?: () => void;
  /** Called as the room's load passes each of its marks (see hideoutProgress). */
  onLoadStage?: (stage: string) => void;
  onStatus: (status: HideoutStatus) => void;
  onProbe: (probe: ViewerAmbientProbe) => void;
}) {
  const { gl, camera } = useThree();
  // Read the scene at use time: the effect mutates it, which R3F sanctions.
  const getThree = useThree(state => state.get);
  const [group, setGroup] = useState<THREE.Group | null>(null);
  const [particleScene, setParticleScene] = useState<{ info: HideoutSceneInfo; root: THREE.Group; lights: Source2ParticleLights } | null>(null);
  const [snapshotSource, setSnapshotSource] = useState<{ key: string; bytes: Promise<ArrayBuffer | null> } | null>(null);
  const [room, setRoom] = useState<HideoutRoom | null>(null);
  const [roomClearance, setRoomClearance] = useState<RoomClearance | null>(null);
  // Bounds the viewer camera (Controls) once the room is in the scene to be measured.
  useEffect(() => {
    // A hidden room bounds nothing: another scene is showing.
    if (!group || !roomClearance || !active) return;
    const scene = getThree().scene;
    roomClearance.invalidate();
    scene.userData.hideoutClearance = roomClearance;
    return () => { if (scene.userData.hideoutClearance === roomClearance) delete scene.userData.hideoutClearance; };
  }, [group, roomClearance, getThree, active]);
  // Its distances are in viewer units, which follow the hero's scale: another hero measures again.
  useEffect(() => { roomClearance?.invalidate(); }, [roomClearance, scale, floor]);
  // The hero's normalization scale usually arrives after the room starts
  // loading. Scale-dependent state is updated in place instead of reloading.
  const placement = useRef({ scale, floor });
  const scaled = useRef<((scale: number, floor: number) => void) | null>(null);
  useEffect(() => {
    placement.current = { scale, floor };
    scaled.current?.(scale, floor);
  }, [scale, floor]);
  // Only the first load claims a preload by its hint; a later hint (another hero) must not reload the room.
  const firstHint = useRef(snapshotHint);
  // What the room hands the viewer, kept so it can hand it again when the room becomes active.
  const activeRef = useRef(active);
  const arrival = useRef({ onRoomArrive, onLoadStage });
  useEffect(() => { arrival.current = { onRoomArrive, onLoadStage }; }, [onRoomArrive, onLoadStage]);
  const published = useRef<{ environment: THREE.Texture | null; probe: ViewerAmbientProbe | null; status: HideoutStatus | null }>({ environment: null, probe: null, status: null });
  // A room loaded while hidden was not compiled: programs key on the scene's lights, and another
  // scene's lights were in it. It links when first shown, hidden until then.
  const uncompiled = useRef(false);
  const [compiling, setCompiling] = useState(false);
  const wrapper = useRef<THREE.Group>(null);
  // The room never moves within its placement, so its 2,400 objects keep their matrices instead of
  // three composing and multiplying each of them every frame (over a millisecond). The wrapper
  // changes only with the hero's scale and floor, which recomputes the room's world matrices once.
  // The scene keeps updating its own matrix: the hero's cloth writes bones the fast way only below
  // an updating chain, and a frozen scene sent every hero's cloth down the slow path.
  useEffect(() => {
    const shown = wrapper.current;
    if (!group || !shown) return;
    const frozen: THREE.Object3D[] = [shown];
    group.traverse(object => { if (object.userData.hideoutStatic) frozen.push(object); });
    for (const object of frozen) { object.updateMatrix(); object.matrixAutoUpdate = false; }
    return () => { for (const object of frozen) object.matrixAutoUpdate = true; };
  }, [group]);
  // The looping props (the ghosts, the projector), advanced while the room shows.
  const mixers = useRef<THREE.AnimationMixer[]>([]);
  useFrame((_, delta) => {
    if (!activeRef.current) return;
    for (const mixer of mixers.current) mixer.update(delta);
  });
  const placementMatrix = useRef(new THREE.Matrix4());
  useFrame(() => {
    const shown = wrapper.current;
    if (!shown || shown.matrixAutoUpdate) return;
    placementMatrix.current.compose(shown.position, shown.quaternion, shown.scale);
    if (placementMatrix.current.equals(shown.matrix)) return;
    shown.matrix.copy(placementMatrix.current);
    // At once: a flag would be cleared by any updateWorldMatrix call (the world cards make one)
    // before it reached the room.
    shown.updateMatrixWorld(true);
  }, -1);
  // Every map-lit material takes its lights from the map's light model, in the scene's first point
  // light slots. A hero effect's three.js light would sort ahead of them and push the map's last
  // lights out of their slots (lit again by three, at their raw intensity), and every new light count
  // links the room's programs again; hero effects keep theirs hidden while this is set.
  useEffect(() => {
    if (!active) return;
    const viewerScene = getThree().scene;
    viewerScene.userData.source2MapLit = true;
    return () => { delete viewerScene.userData.source2MapLit; };
  }, [active, getThree]);
  useEffect(() => {
    activeRef.current = active;
    const viewerScene = getThree().scene;
    const { environment, probe, status } = published.current;
    if (!active) {
      if (environment && viewerScene.environment === environment) viewerScene.environment = null;
      return;
    }
    if (environment) {
      viewerScene.environment = environment;
      viewerScene.environmentIntensity = 1;
    }
    if (probe) onProbe(probe);
    if (status) onStatus(status);
    if (!uncompiled.current) return;
    uncompiled.current = false;
    setCompiling(true);
    let cancelled = false, done = false;
    // Two frames first, so the hero's materials have taken the map lighting handed over above.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const shown = wrapper.current;
      if (cancelled || !shown) return;
      void precompileInPlace(gl, viewerScene, camera, shown, postprocess).catch(() => {}).finally(() => {
        done = true;
        if (cancelled) return;
        arrival.current.onRoomArrive?.();
        setCompiling(false);
      });
    }));
    // Interrupted (hidden again, say): it links on the next showing.
    return () => { cancelled = true; if (!done) { uncompiled.current = true; setCompiling(false); } };
  }, [active, getThree, onProbe, onStatus, gl, camera, postprocess]);
  useEffect(() => {
    const viewerScene = getThree().scene;
    let cancelled = false;
    let finished = false;
    const models: THREE.Object3D[] = [];
    const materialBuilds: (() => void)[] = [];
    const hintRestores: (() => void)[] = [];
    const ownedMaterials = new Set<THREE.Material>();
    const ownedLights: THREE.PointLight[] = [];
    const ownedMixers: THREE.AnimationMixer[] = [];
    let publishedFromViewer: THREE.Matrix4 | null = null;
    let lightmap: THREE.DataTexture | null = null;
    let direction: THREE.Texture | null = null;
    let shadows: THREE.Texture | null = null;
    let mapReflection: THREE.WebGLRenderTarget | null = null;
    let probeIrradiance: THREE.Data3DTexture | null = null;
    let probeShadows: THREE.Data3DTexture | null = null;
    let sky: THREE.Mesh | null = null;
    let cookies: Source2CookieAtlas | null = null;
    let clearance: RoomClearance | null = null;
    // The map particles' lights (the fire, candles), filled by the particle layer each frame.
    const particleLights = createSource2ParticleLights();
    const dispose = () => {
      ownedMixers.forEach(mixer => mixer.stopAllAction());
      if (mixers.current === ownedMixers) mixers.current = [];
      materialBuilds.forEach(dispose => dispose());
      hintRestores.forEach(restore => restore());
      disposeModels(models); ownedMaterials.forEach((material) => material.dispose()); ownedLights.forEach((light) => light.dispose()); lightmap?.dispose(); if (direction) disposeTexture(direction);
      if (shadows) disposeTexture(shadows);
      if (mapReflection && viewerScene.environment === mapReflection.texture) viewerScene.environment = null;
      mapReflection?.dispose(); probeIrradiance?.dispose(); probeShadows?.dispose(); cookies?.texture.dispose(); particleLights.dispose();
      if (sky) { (sky.material as THREE.ShaderMaterial).uniforms.source2Sky.value.dispose(); (sky.material as THREE.Material).dispose(); sky.geometry.dispose(); }
      if (viewerScene.userData.source2SourceFromViewer === publishedFromViewer) delete viewerScene.userData.source2SourceFromViewer;
      if (cookies && viewerScene.userData.source2CookieAtlas === cookies) delete viewerScene.userData.source2CookieAtlas;
      clearance?.dispose();
    };
    const status = (value: HideoutStatus) => { published.current.status = value; if (activeRef.current) onStatus(value); };
    const probe = (value: ViewerAmbientProbe) => { published.current.probe = value; if (activeRef.current) onProbe(value); };
    status({ kind: 'loading' });
    probe({ kind: 'pending' });
    void (async () => {
      const started = performance.now();
      const marks: Record<string, number> = { startedAt: started };
      const mark = (name: string) => { marks[name] = performance.now() - started; arrival.current.onLoadStage?.(name); };
      // Usually preloaded as the viewer opened (HeroPoseViewer), decoded in a worker.
      const load = claimHideoutLoad(postprocess ? firstHint.current : undefined);
      const spawn = await load.info;
      // The anchor moves once the room's clearance is measured (below). It moves on this object,
      // which the map post and particle layer already hold, so neither reloads.
      const info = { ...spawn, heading: hideoutViewHeading(spawn.heading) };
      const metadataReady = performance.now();
      if (cancelled) return;
      setSnapshotSource({ key: info.key, bytes: load.snapshot });
      status({ kind: 'loading', info });
      const root = new THREE.Group();
      const bundle = load.bundle.then(bytes => { mark('bundleFetched'); return parseGltfPreview(bytes, { imageBitmaps: true }); })
        .then(gltf => { mark('bundleParsed'); return gltf; });
      // Observe early failures while the other resource requests are still pending.
      void bundle.catch(() => {});
      const resource = (file: string, failure: string) => fetch(`grimoire-hero://s/${info.key}/${file}`).then(response => {
        if (!response.ok) throw new Error(failure);
        return response.blob();
      });
      // Each looping prop is a skinned model of its own beside the static bundle.
      const animatedLoads = new Map([...new Set(info.instances.flatMap(instance => instance.animation ? [instance.model] : []))]
        .map(file => [file, resource(file, 'Hideout animated prop could not be read.').then(blob => blob.arrayBuffer())
          .then(bytes => parseGltfPreview(bytes, { imageBitmaps: true }))] as const));
      for (const load of animatedLoads.values()) void load.catch(() => {});
      // The lightmap's masks only feed room materials.
      const maskBlobs = info.lighting.kind === 'baked' && info.lighting.encoding.kind === 'sh2-luminance' ? Promise.all([
        resource(info.lighting.encoding.direction, 'Hideout lightmap direction could not be read.'),
        resource(info.lighting.encoding.shadows, 'Hideout baked shadows could not be read.'),
      ]) : null;
      void maskBlobs?.catch(() => {});
      const anchor = new THREE.Vector3(...info.anchor).applyMatrix4(SOURCE_TO_GLTF);
      // Shared by every map-lit material's uniforms and the map post's fog
      // march, so it follows the hero's scale in place from the first frame.
      const sourceFromViewer = source2ViewerToMap(info, placement.current.scale, placement.current.floor);
      scaled.current = (scale, floor) => sourceFromViewer.copy(source2ViewerToMap(info, scale, floor));
      publishedFromViewer = sourceFromViewer;
      viewerScene.userData.source2SourceFromViewer = sourceFromViewer;
      let normalization = new THREE.Vector4(0, 0, 0, 0);
      const reflection = await load.reflection;
      if (reflection) {
        mapReflection = source2MapProbeTarget(reflection.faces, gl);
        const [x, y, z, w] = reflection.normalization;
        const direction = new THREE.Vector3(x, y, z).applyMatrix3(source2MapProbeNormals(info.heading).invert());
        normalization = new THREE.Vector4(direction.x, direction.y, direction.z, w);
      }
      mark('reflectionReady');
      // Fog-only lights reach surfaces through the lightmap.
      const lights = info.lights.filter(light => !light.fogOnly).map((light) => ({ ...light, point: new THREE.Vector3(...light.position).applyMatrix4(SOURCE_TO_GLTF) }))
        .filter((light) => light.distribution.brightness > 0)
        .sort((a, b) => b.candela / Math.max(1, b.point.distanceToSquared(anchor)) - a.candela / Math.max(1, a.point.distanceToSquared(anchor)));
      // Generous room-space bounds around the spawn: the hero is scaled into the room, and a
      // light left out here would be missing from the hero.
      const heroBounds = new THREE.Box3().setFromCenterAndSize(anchor.clone().add(new THREE.Vector3(0, 3, 0)), new THREE.Vector3(8, 6, 8));
      const heroLights = lights.filter(light => light.distribution.kind === 'sun' || source2LightReach(light).intersectsBox(heroBounds));
      // Cookies decode on this thread, so they wait for the room's bundle unless a cookie
      // light reaches the hero.
      const loadCookies = () => loadSource2CookieAtlas(info).then(atlas => { cookies = atlas; return atlas; });
      let cookiesLoad = heroLights.some(light => light.cookie && light.distribution.kind !== 'sun') ? loadCookies() : null;
      const heroCookies = cookiesLoad ? await cookiesLoad : null;
      if (cancelled) return;
      let probeLighting: Source2ProbeLighting | null = null;
      const probeBytes = await load.probes;
      if (info.probes.kind === 'atlas' && probeBytes) {
        const [irradiance, shadow] = probeBytes;
        mark('probesFetched');
        probeIrradiance = parseSource2Volume(irradiance, true);
        probeShadows = shadow ? parseSource2Volume(shadow, false) : null;
        probeLighting = { heading: info.heading, normalization, irradiance: probeIrradiance, shadows: probeShadows, volumes: info.probes.volumes, encoding: info.probes.encoding,
          sourceFromViewer, normalFromViewer: source2MapProbeNormals(info.heading), lights: heroLights, slots: lights.length,
          cookies: heroCookies, particles: particleLights };
      }
      if (cancelled) return;
      // Hand the hero its map lighting now, so its material rebuild has
      // settled before the combined precompile below.
      if (mapReflection) {
        published.current.environment = mapReflection.texture;
        if (activeRef.current) {
          viewerScene.environment = mapReflection.texture;
          viewerScene.environmentIntensity = 1;
        }
      }
      if (probeLighting) {
        const primaryDirection = new THREE.Vector3(...info.primaryLightDirection).transformDirection(SOURCE_TO_GLTF)
          .applyAxisAngle(new THREE.Vector3(0, 1, 0), -THREE.MathUtils.degToRad(info.heading));
        probe({ kind: 'map', lighting: probeLighting, primaryDirection });
      } else probe({ kind: 'fallback' });
      mark('probesDecoded');
      const lightmapData = await load.lightmap;
      if (info.lighting.kind === 'baked' && lightmapData) {
        lightmap = new THREE.DataTexture(lightmapData.data, lightmapData.width, lightmapData.height, THREE.RGBAFormat, THREE.FloatType);
        lightmap.colorSpace = THREE.LinearSRGBColorSpace;
        lightmap.channel = 3;
        lightmap.flipY = false;
        lightmap.repeat.set(...info.lighting.uvScale);
        lightmap.minFilter = THREE.LinearFilter;
        lightmap.magFilter = THREE.LinearFilter;
        lightmap.needsUpdate = true;
        mark('lightmapDecoded');
        if (maskBlobs) {
          const [directionBlob, shadowBlob] = await maskBlobs;
          direction = new THREE.Texture(await createImageBitmap(directionBlob, { colorSpaceConversion: 'none' }));
          direction.colorSpace = THREE.NoColorSpace;
          direction.flipY = false;
          direction.minFilter = THREE.LinearFilter;
          direction.magFilter = THREE.LinearFilter;
          direction.needsUpdate = true;
          shadows = new THREE.Texture(await createImageBitmap(shadowBlob, { colorSpaceConversion: 'none' }));
          shadows.flipY = false;
          shadows.minFilter = THREE.LinearFilter;
          shadows.needsUpdate = true;
          mark('lightmapMasksDecoded');
        }
      }
      if (info.sky) {
        const response = await fetch(`grimoire-hero://s/${info.key}/${info.sky.file}`);
        if (!response.ok) throw new Error('Hideout sky could not be read.');
        sky = createSource2Sky(await loadSource2SkyCube(await response.arrayBuffer()), info.sky, info.heading);
        mark('skyDecoded');
      }
      const loaded = new Map<string, THREE.Object3D>();
      const preparedMaterials = new Map<string, THREE.Material>();
      const unresolvedMaterials = new Set<string>();
      let failedLoads = 0;
      const gltf = await bundle;
      cookiesLoad ??= loadCookies();
      const roomCookies = await cookiesLoad;
      if (cancelled) return;
      particleLights.cookies = roomCookies;
      particleLights.cookieFiles = info.particles.lightCookies ?? {};
      const resourcesReady = performance.now();
      models.push(gltf.scene);
      const animatedModels = new Map<string, GLTF>();
      for (const [file, load] of animatedLoads) {
        const model = await load.catch(() => null);
        if (model) { animatedModels.set(file, model); models.push(model.scene); }
      }
      if (cancelled) return;
      for (const scene of [gltf.scene, ...[...animatedModels.values()].map(model => model.scene)]) {
        hintRestores.push(applySource2MaterialHints(scene, false, (_material, data) => !data.shader.startsWith('environment_') && data.shader !== 'pbr.vfx').restore);
      }
      gltf.scene.traverse((object) => {
        const association = gltf.parser.associations.get(object);
        if (association?.primitives !== undefined) object.userData.hideoutPrimitive = association.primitives;
        const name: unknown = object.userData.hideoutModel;
        if (typeof name === 'string') loaded.set(name, object);
      });
      if (cancelled) return;
      // Instances past the room's reach wait for the clearance test below: only those seen from
      // the hero through the room's openings (the city and the Maelstrom tower) are kept.
      const distant: { instance: HideoutSceneInfo['instances'][number]; holder: THREE.Group; clone: THREE.Object3D; bounds: THREE.Box3 }[] = [];
      const place = (instance: HideoutSceneInfo['instances'][number], holder: THREE.Group, clone: THREE.Object3D) => {
        // Only a placed prop plays: one culled past the room's reach never draws.
        const clip: unknown = clone.userData.hideoutClip;
        if (clip instanceof THREE.AnimationClip) {
          const mixer = new THREE.AnimationMixer(clone);
          mixer.clipAction(clip).play();
          ownedMixers.push(mixer);
          fitClipBounds(clone, mixer, clip);
        }
        clone.traverse((object) => {
          if (!(object instanceof THREE.Mesh)) return;
          object.castShadow = true;
          object.receiveShadow = true;
          object.userData.hideoutTint = instance.tint;
          // The draw call's own tint and alpha (the chimney breast's red), when the exporter wrote them.
          const drawTint = hideoutDrawTint(object.geometry.userData.morphic_tint);
          const prepare = (original: THREE.Material) => {
            const key = `${original.uuid}:${instance.tint.join(',')}:${drawTint?.join(',') ?? ''}:${object.geometry.hasAttribute('uv3')}:${instance.opacity ?? 1}`;
            const cached = preparedMaterials.get(key);
            if (cached) return cached;
            const data = original.userData;
            original.userData = {};
            let material: THREE.Material;
            try { material = original.clone(); } finally { original.userData = data; }
            material.userData = data;
            material.onBeforeCompile = original.onBeforeCompile;
            material.customProgramCacheKey = original.customProgramCacheKey;
            material.opacity *= (instance.opacity ?? 1) * (drawTint?.[3] ?? 1);
            if (material.opacity < 1) material.transparent = true;
            ownedMaterials.add(material);
            if (!getMorphic(original)) {
              material.visible = false;
              unresolvedMaterials.add(original.name);
              return material;
            }
            if (material instanceof THREE.MeshStandardMaterial) {
              const morphic = getMorphic(original);
              const tint = morphic && hideoutMaterialTint(morphic);
              if (tint) material.color.copy(tint);
              material.color.multiply(hideoutObjectTint(instance.tint, drawTint));
              if (mapReflection) {
                material.envMap = mapReflection.texture;
                material.envMapIntensity = 1;
              }
              if (lightmap && object.geometry.hasAttribute('uv3')) {
                material.lightMap = lightmap;
                material.envMapIntensity = mapReflection ? 1 : 0;
                material.onBeforeCompile = (shader) => {
                  shader.fragmentShader = shader.fragmentShader
                    .replace('#include <lights_fragment_maps>', 'irradiance = vec3(0.0);\n#include <lights_fragment_maps>\niblIrradiance = vec3(0.0);');
                };
                material.customProgramCacheKey = () => 'hideout-baked-dc-v1';
                if (direction) applySource2Lightmap(material, { direction, heading: info.heading, exposure: info.exposure,
                  reflections: true, linearOutput: postprocess });
              }
              if (morphic?.shader === 'pbr.vfx' && !isWorldParticleCard(material) && !object.geometry.hasAttribute('uv3')) {
                const built = buildDeadlockMaterial(material, undefined, null, 'authored');
                materialBuilds.push(built.dispose);
                material = built.material;
                built.uniforms.uCelV2.value = 1;
                built.uniforms.uCitadelLighting.value = 1;
                built.uniforms.uCitadelExposure.value = info.exposure;
                built.uniforms.uCitadelEnvironmentCeiling.value = 1;
                built.uniforms.uNprAmbientCubeOn.value = probeLighting ? 1 : 0;
                if (probeLighting) built.uniforms.uCitadelAmbientFit.value.copy(probeLighting.normalization);
                const primary = new THREE.Vector3(...info.primaryLightDirection).transformDirection(SOURCE_TO_GLTF)
                  .applyAxisAngle(new THREE.Vector3(0, 1, 0), -THREE.MathUtils.degToRad(info.heading));
                built.uniforms.uKeyDir.value.copy(primary);
              }
              if (mapReflection) applySource2MapProbe(material, info.heading);
              if (material instanceof THREE.MeshStandardMaterial) applySource2EnvironmentMaterial(material, sourceFromViewer);
              const probeLit = !!probeLighting && !object.geometry.hasAttribute('uv3');
              if (probeLit && probeLighting) applySource2ProbeVolume(material, probeLighting);
              // A physical (glass) material's extra samplers leave no texture unit for the cookies.
              applySource2DynamicLights(material, { lights, sourceFromViewer, cookies: (material as THREE.MeshPhysicalMaterial).isMeshPhysicalMaterial ? null : roomCookies,
                normalFromViewer: source2MapProbeNormals(info.heading), shadows: object.geometry.hasAttribute('uv3') && shadows ? { kind: 'lightmap', texture: shadows }
                  : probeLit ? { kind: 'probe' } : { kind: 'none' }, particles: particleLights,
                // Probe-lit props already sample the probe volumes and leave no texture unit for it.
                particleShadows: object.geometry.hasAttribute('uv3') && !(material as THREE.MeshPhysicalMaterial).isMeshPhysicalMaterial });
            }
            if (!postprocess && info.tonemap) applySource2MapTonemap(material, info.tonemap, info.exposure);
            materialBuilds.push(cacheMapStaticUniforms(material));
            preparedMaterials.set(key, material);
            return material;
          };
          object.material = Array.isArray(object.material) ? object.material.map(prepare) : prepare(object.material);
        });
        root.add(holder);
      };
      for (const instance of info.instances) {
        const animatedModel = instance.animation ? animatedModels.get(instance.model) : undefined;
        const source = instance.animation ? animatedModel?.scene : loaded.get(instance.model);
        if (!source) { failedLoads++; continue; }
        const holder = new THREE.Group();
        holder.applyMatrix4(hideoutInstanceMatrix(instance.matrix));
        const clone = animatedModel ? cloneSkinned(source) : source.clone(true);
        if (animatedModel) {
          clone.userData.hideoutClip = animatedModel.animations.find(item => item.name === instance.animation?.clip) ?? animatedModel.animations[0];
          clone.traverse(object => { object.userData.hideoutAnimated = true; });
        }
        if (instance.primitive !== null) {
          const remove: THREE.Object3D[] = [];
          let selected = false;
          clone.traverse((object) => {
            if (!(object instanceof THREE.Mesh)) return;
            if (object.userData.hideoutPrimitive === instance.primitive) selected = true;
            else remove.push(object);
          });
          remove.forEach((object) => object.removeFromParent());
          if (!selected) { failedLoads++; continue; }
        }
        holder.add(clone);
        holder.updateMatrixWorld(true);
        const bounds = new THREE.Box3().setFromObject(holder);
        if (bounds.distanceToPoint(anchor) > 65) distant.push({ instance, holder, clone, bounds });
        else place(instance, holder, clone);
      }
      mark('instancesReady');
      if (!root.children.length) throw new Error('No nearby hideout geometry loaded.');
      lights.forEach((source) => {
        const color = new THREE.Color().setRGB(source.color[0] / 255, source.color[1] / 255, source.color[2] / 255).convertSRGBToLinear();
        const light = new THREE.PointLight(color, source.candela, source.range * 0.0254, 2);
        light.position.copy(source.point);
        light.castShadow = false;
        light.shadow.mapSize.set(512, 512);
        light.shadow.camera.near = 0.05;
        light.shadow.camera.far = Math.max(0.1, source.range * 0.0254);
        light.shadow.autoUpdate = false;
        light.shadow.needsUpdate = true;
        light.shadow.bias = -0.0005;
        light.shadow.normalBias = 0.025;
        root.add(light);
        ownedLights.push(light);
      });
      root.position.copy(anchor).negate();
      const oriented = new THREE.Group();
      oriented.userData.source2MapKey = info.key;
      oriented.rotation.y = -THREE.MathUtils.degToRad(info.heading);
      oriented.add(root);
      if (sky) oriented.add(sky);
      if (cancelled) return;
      const unscaled = ownedLights.map(light => ({ light, intensity: light.intensity, distance: light.distance, far: light.shadow.camera.far }));
      const applyPlacement = (scale: number, floor: number) => {
        sourceFromViewer.copy(source2ViewerToMap(info, scale, floor));
        for (const { light, intensity, distance, far } of unscaled) {
          light.intensity = intensity * scale * scale;
          light.distance = distance * scale;
          light.shadow.camera.far = far * scale;
          light.shadow.needsUpdate = true;
        }
      };
      applyPlacement(placement.current.scale, placement.current.floor);
      scaled.current = applyPlacement;
      // The hero stands at the viewer's origin. Measure the room around it (HIDEOUT_ROOM_LAYER
      // bounds the camera; opaque surfaces hide what lies beyond), then center the hero between
      // the surfaces behind the camera and ahead of it along the view axis, and keep the distant
      // instances it can see through the room's openings.
      const enableRoomLayers = (object: THREE.Object3D) => object.traverse(child => {
        // A moving prop neither bounds the camera nor casts the particle lights' shadows.
        if (!(child instanceof THREE.Mesh) || child.userData.hideoutAnimated) return;
        const materials = Array.isArray(child.material) ? child.material : [child.material];
        if (materials.some(isWorldParticleCard)) return;
        child.layers.enable(HIDEOUT_ROOM_LAYER);
        // Opaque room geometry shadows the particle lights and hides what lies beyond; glass,
        // blended or transmissive, does neither.
        if (!materials.some(material => material.transparent || ((material as THREE.MeshPhysicalMaterial).transmission ?? 0) > 0)) child.layers.enable(SOURCE2_PARTICLE_SHADOW_LAYER);
      });
      enableRoomLayers(root);
      const measured = new RoomClearance();
      clearance = measured;
      const probeScene = new THREE.Scene();
      const probeRoom = new THREE.Group();
      probeScene.add(probeRoom);
      probeRoom.add(oriented);
      const reach = (camera as THREE.PerspectiveCamera).far;
      const measureRoom = (layer: number) => {
        probeRoom.scale.setScalar(placement.current.scale);
        probeRoom.position.set(0, placement.current.floor, 0);
        probeScene.updateMatrixWorld(true);
        measured.measure(gl, probeScene, new THREE.Vector3(), reach, layer);
      };
      try {
        measureRoom(HIDEOUT_ROOM_LAYER);
        const shift = hideoutCenteringShift(measured.distance(new THREE.Vector3(0, 0, 1)), measured.distance(new THREE.Vector3(0, 0, -1)));
        if (shift !== 0) {
          const shifted = new THREE.Vector3(0, placement.current.floor, -shift).applyMatrix4(sourceFromViewer);
          info.anchor = [shifted.x, shifted.y, shifted.z];
          root.position.copy(shifted.applyMatrix4(SOURCE_TO_GLTF)).negate();
          applyPlacement(placement.current.scale, placement.current.floor);
        }
        mark('roomCentered');
        measureRoom(SOURCE2_PARTICLE_SHADOW_LAYER);
        // The spawn stands about half an inch above the floor surface. The straight-down distance
        // from the hero puts the surface itself under its feet; a larger gap is something else under
        // the hero, not the floor, and is left alone.
        const gap = placement.current.floor + measured.distance(new THREE.Vector3(0, -1, 0), false);
        if (gap !== 0 && Math.abs(gap) < HIDEOUT_FLOOR_SNAP) {
          const grounded = new THREE.Vector3(0, placement.current.floor - gap, 0).applyMatrix4(sourceFromViewer);
          info.anchor = [grounded.x, grounded.y, grounded.z];
          root.position.copy(grounded.applyMatrix4(SOURCE_TO_GLTF)).negate();
          applyPlacement(placement.current.scale, placement.current.floor);
          probeScene.updateMatrixWorld(true);
        }
        for (const { instance, holder, clone, bounds } of distant) {
          if (!hideoutSeenThroughRoom(measured, bounds.clone().applyMatrix4(root.matrixWorld))) continue;
          place(instance, holder, clone);
          enableRoomLayers(holder);
        }
        mark('distantPlaced');
      } finally {
        probeRoom.remove(oriented);
        // The viewer's camera measures again from its own orbit target.
        measured.invalidate();
      }
      const materialsReady = performance.now();
      mark('materialsReady');
      if (activeRef.current) await precompileWithRoom(gl, viewerScene, camera, oriented, postprocess);
      else uncompiled.current = true;
      mark('compiled');
      if (import.meta.env.VITE_GRIMOIRE_VIEWER_BENCH === '1') viewerScene.userData.source2MapTimings = { ...marks,
        metadataMs: metadataReady - started, resourcesMs: resourcesReady - metadataReady,
        materialsMs: materialsReady - resourcesReady, compileMs: performance.now() - materialsReady,
      };
      // The benchmark holds the room back to compare its saved frame against it.
      if (import.meta.env.VITE_GRIMOIRE_VIEWER_BENCH === '1') while ((window as { __benchHoldRoom?: boolean }).__benchHoldRoom) await new Promise(resolve => setTimeout(resolve, 50));
      if (cancelled) return;
      // The saved room frame holds the static room only: not the particle
      // layer's meshes, added later under the same root, nor the animated
      // world cards. Both appear with the real room.
      const meshes: THREE.Object3D[] = [];
      oriented.traverse(object => {
        if (!(object instanceof THREE.Mesh)) return;
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        if (materials.some(isWorldParticleCard)) object.userData.hideoutWorldCard = true;
        else if (object.userData.hideoutAnimated) return;
        else meshes.push(object);
      });
      // The fog takes each cookie's mean color from here (Source2FogPass).
      if (cookies) viewerScene.userData.source2CookieAtlas = cookies;
      // Everything placed so far is static (the freezing effect above); map particles join later.
      // The looping props' rigs keep moving.
      oriented.traverse(object => { if (!object.userData.hideoutAnimated) object.userData.hideoutStatic = true; });
      if (activeRef.current) arrival.current.onRoomArrive?.();
      mixers.current = ownedMixers;
      setRoom({ meshes, lights: [...ownedLights] });
      setGroup(oriented);
      setParticleScene({ info, root, lights: particleLights });
      setRoomClearance(measured);
      status({ kind: 'ready', info, failedLoads: failedLoads + unresolvedMaterials.size });
    })().catch(() => {
      if (cancelled) return;
      if (mapReflection && viewerScene.environment === mapReflection.texture) viewerScene.environment = null;
      published.current.environment = null;
      status({ kind: 'failed' }); probe({ kind: 'fallback' });
    }).finally(() => {
      finished = true;
      if (cancelled) dispose();
    });
    return () => { cancelled = true; scaled.current = null; published.current = { environment: null, probe: null, status: null }; if (finished) dispose(); };
  }, [gl, getThree, camera, onStatus, onProbe, postprocess]);
  return <>
    {active && postprocess && snapshotHint && snapshotSource && <HideoutSnapshot sceneKey={snapshotSource.key} bytes={snapshotSource.bytes} hint={snapshotHint} scale={scale} floor={floor} room={group ? room : null} onShown={onSnapshotShown} />}
    {group && <group ref={wrapper} scale={scale} position={[0, floor, 0]} visible={active && !compiling}><primitive object={group} />
      {particleScene && <HideoutParticleLayer info={particleScene.info} parent={particleScene.root} lights={particleScene.lights} active={active} />}
      {particleScene && <HideoutWorldCards parent={particleScene.root} />}
    </group>}
  </>;
}
