/**
 * Shared three.js scene assembly for hero pose 3D, used by BOTH the offscreen
 * card-snapshot bake and the dev pose-authoring live preview so they frame and
 * light a hero IDENTICALLY. The logic here is the framework-agnostic core lifted
 * from HeroPoseViewer (model normalize, IBL probe, vertex-color enable, dispose);
 * the live viewer still has its own r3f copies for now and should migrate onto
 * this module in a later cleanup (tracked as a follow-up, not this slice).
 *
 * Everything is plain three.js (no React / r3f) so an offscreen one-shot
 * renderer can call it directly; the authoring preview applies the same leaf
 * helpers from inside r3f.
 *
 * INVARIANTS (carry these to every consumer):
 *  - ONE WebGLRenderer/context per surface. Never one-per-card: the Locker grid
 *    blew past the ~16-context cap and blanked cards white (the soul-grid bug).
 *    The bake renders all heroes through a single reused offscreen context.
 *  - Dispose what you create: call disposeScene(model) + renderer.dispose() +
 *    the loadIblEnvironment dispose handle on teardown.
 *  - Renderer setup to match the live viewer: ACESFilmicToneMapping, exposure
 *    0.8, and (for the bake) alpha:true so a missing backdrop is transparent.
 *  - CSP already allows blob:/grimoire-hero:/data: in the packaged build, so GLB
 *    loads + data-URL backdrops work in binaries too (see the packaged-3D-CSP note).
 */
import * as THREE from 'three';
import { HDRCubeTextureLoader } from 'three/examples/jsm/loaders/HDRCubeTextureLoader.js';
import { getAssetPath } from './assetPath';
import type { HeroCameraFraming } from '../types/portrait';

/** Vertical field of view (deg) for the snapshot/preview camera; matches the
 *  live viewer so authored distances read the same everywhere. */
export const HERO_CARD_FOV = 40;

/** The framing a hero gets when it has no authored entry: dead-on, model fit to
 *  frame, camera at radius 3.2 (the live viewer's default position [0,0,3.2]). */
export const DEFAULT_CAMERA_FRAMING: HeroCameraFraming = {
  yawDeg: 0,
  pitchDeg: 0,
  distance: 3.2,
  target: [0, 0, 0],
};

/** Key + fill directionals layered on top of the IBL probe (must mirror the
 *  live viewer's JSX lights exactly so the bake matches the preview). */
const KEY_LIGHT = { position: [3, 5, 4] as const, intensity: 1.1, color: 0xfff3e0 };
const FILL_LIGHT = { position: [-4, 2, -3] as const, intensity: 0.4, color: 0xcfe0ff };
const AMBIENT_INTENSITY = 0.12;

// Six faces of a real Deadlock skybox IBL probe baked to Radiance .hdr by
// `vpkmerge cubemap`. Order is the loader's expected [+X,-X,+Y,-Y,+Z,-Z].
export const IBL_FACES = [
  getAssetPath('/ibl/px.hdr'),
  getAssetPath('/ibl/nx.hdr'),
  getAssetPath('/ibl/py.hdr'),
  getAssetPath('/ibl/ny.hdr'),
  getAssetPath('/ibl/pz.hdr'),
  getAssetPath('/ibl/nz.hdr'),
];

/** Load the IBL environment for a given renderer/context. Returns the PMREM
 *  texture to assign to `scene.environment`, plus a dispose handle. The PMREM
 *  target is bound to the passed renderer's context, so call once per surface. */
export function loadIblEnvironment(
  renderer: THREE.WebGLRenderer
): Promise<{ texture: THREE.Texture; dispose: () => void }> {
  return new Promise((resolve, reject) => {
    const pmrem = new THREE.PMREMGenerator(renderer);
    new HDRCubeTextureLoader().setDataType(THREE.HalfFloatType).load(
      IBL_FACES,
      (cube) => {
        const envRT = pmrem.fromCubemap(cube);
        cube.dispose();
        pmrem.dispose();
        resolve({ texture: envRT.texture, dispose: () => envRT.dispose() });
      },
      undefined,
      (err) => {
        pmrem.dispose();
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    );
  });
}

/** Bounding-box normalization: scale so the largest dimension is 2.0 units and
 *  recenter on the origin (so framing distances are hero-independent). */
export function normalizeModel(object: THREE.Object3D): { scale: number; center: THREE.Vector3 } {
  const box = new THREE.Box3().setFromObject(object);
  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  box.getSize(size);
  box.getCenter(center);
  const maxDim = Math.max(size.x, size.y, size.z);
  return { scale: maxDim > 0 ? 2.0 / maxDim : 1, center };
}

/** Enable per-vertex COLOR multiply wherever the attribute exists (skin tone /
 *  accents render flat white otherwise). Pure material-flag toggle. */
export function enableVertexColors(object: THREE.Object3D): void {
  object.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry?.attributes.color) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of mats) {
      const sm = m as THREE.MeshStandardMaterial;
      if (sm && !sm.vertexColors) {
        sm.vertexColors = true;
        sm.needsUpdate = true;
      }
    }
  });
}

/** Free a loaded scene's GPU resources (geometry, materials, textures, skeletons). */
export function disposeScene(root: THREE.Object3D): void {
  root.traverse((obj) => {
    const skinned = obj as THREE.SkinnedMesh;
    if (skinned.isSkinnedMesh && skinned.skeleton) skinned.skeleton.dispose?.();
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.geometry?.dispose();
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of mats) {
      const sm = m as THREE.MeshStandardMaterial;
      [sm.map, sm.normalMap, sm.roughnessMap, sm.metalnessMap, sm.emissiveMap, sm.aoMap].forEach(
        (t) => t?.dispose()
      );
      m?.dispose();
    }
  });
}

const DEG2RAD = Math.PI / 180;

/** World-space camera position for a framing, orbiting the framing's target on a
 *  sphere of radius `distance` (yaw about +Y, pitch toward +Y). */
export function framingCameraPosition(framing: HeroCameraFraming): THREE.Vector3 {
  const yaw = framing.yawDeg * DEG2RAD;
  const pitch = framing.pitchDeg * DEG2RAD;
  const [tx, ty, tz] = framing.target;
  return new THREE.Vector3(
    tx + framing.distance * Math.cos(pitch) * Math.sin(yaw),
    ty + framing.distance * Math.sin(pitch),
    tz + framing.distance * Math.cos(pitch) * Math.cos(yaw)
  );
}

/** Position + aim a perspective camera from a framing (also syncs fov/aspect). */
export function applyFraming(
  camera: THREE.PerspectiveCamera,
  framing: HeroCameraFraming,
  aspect?: number
): void {
  camera.fov = HERO_CARD_FOV;
  if (aspect && Number.isFinite(aspect)) camera.aspect = aspect;
  camera.position.copy(framingCameraPosition(framing));
  camera.lookAt(framing.target[0], framing.target[1], framing.target[2]);
  camera.updateProjectionMatrix();
}

export interface BuiltPoseScene {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  /** The normalized + centered model wrapper (apply extra spin here if desired). */
  modelGroup: THREE.Group;
  dispose: () => void;
}

/**
 * Assemble a ready-to-render scene from a loaded GLB scene: normalized/centered
 * model under a yaw wrapper, key+fill lights, camera framed per `framing`, and
 * an optional backdrop + pre-loaded IBL environment.
 *
 * Synchronous (the IBL probe is async and renderer-bound): load it via
 * loadIblEnvironment and pass it as `environment`, or assign scene.environment
 * after the fact. `dispose()` frees the model + backdrop; the caller still owns
 * the renderer and the IBL dispose handle.
 *
 * NOTE on backdrop aspect: a Texture set as scene.background stretches to the
 * viewport. Card panorama art is portrait, so a non-portrait canvas will distort
 * it. The bake should either render at the backdrop's aspect or composite the
 * backdrop as a cover-fit textured quad; this helper just wires the baseline.
 */
export function buildPoseScene(opts: {
  gltfScene: THREE.Object3D;
  framing: HeroCameraFraming;
  aspect: number;
  backdrop?: THREE.Texture | null;
  environment?: THREE.Texture | null;
  modelYawDeg?: number;
}): BuiltPoseScene {
  const scene = new THREE.Scene();
  if (opts.backdrop) scene.background = opts.backdrop;
  if (opts.environment) scene.environment = opts.environment;

  scene.add(new THREE.AmbientLight(0xffffff, AMBIENT_INTENSITY));
  const key = new THREE.DirectionalLight(KEY_LIGHT.color, KEY_LIGHT.intensity);
  key.position.set(...KEY_LIGHT.position);
  scene.add(key);
  const fill = new THREE.DirectionalLight(FILL_LIGHT.color, FILL_LIGHT.intensity);
  fill.position.set(...FILL_LIGHT.position);
  scene.add(fill);

  enableVertexColors(opts.gltfScene);
  const { scale, center } = normalizeModel(opts.gltfScene);

  // Inner group recenters the model on the origin; outer group applies uniform
  // scale + the authored vertical spin so the camera framing is hero-independent.
  const centerGroup = new THREE.Group();
  centerGroup.position.set(-center.x, -center.y, -center.z);
  centerGroup.add(opts.gltfScene);

  const modelGroup = new THREE.Group();
  modelGroup.scale.setScalar(scale);
  modelGroup.rotation.y = (opts.modelYawDeg ?? 0) * DEG2RAD;
  modelGroup.add(centerGroup);
  scene.add(modelGroup);

  const camera = new THREE.PerspectiveCamera(HERO_CARD_FOV, opts.aspect, 0.1, 100);
  applyFraming(camera, opts.framing, opts.aspect);

  return {
    scene,
    camera,
    modelGroup,
    dispose: () => {
      disposeScene(opts.gltfScene);
      opts.backdrop?.dispose();
    },
  };
}
