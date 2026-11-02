import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { decodeHideoutSnapshot, encodeHideoutSnapshot, hideoutSnapshotMatches, hideoutSnapshotName, HIDEOUT_SNAPSHOT_VERSION,
  type HideoutSnapshot as Snapshot, type HideoutSnapshotHeader } from '../../lib/hideoutSnapshot';

/** Only the room and the scene's lights are on this layer while a snapshot is drawn. */
const CAPTURE_LAYER = 31;
/** The camera must rest this long before the room is captured, so an orbit
 *  and its damping save one frame instead of one per pause. */
const CAPTURE_REST_MS = 600;

const copyVertex = 'void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }';

/** Writes the stored scene color and depth pixel for pixel, before any other
 *  opaque draw. The hero then depth tests against the room as if it were there. */
function snapshotMesh(snapshot: Snapshot): THREE.Mesh {
  const color = new THREE.DataTexture(snapshot.color, snapshot.width, snapshot.height, THREE.RGBAFormat, THREE.HalfFloatType);
  const depth = new THREE.DataTexture(snapshot.depth, snapshot.width, snapshot.height, THREE.RedFormat, THREE.FloatType);
  for (const texture of [color, depth]) {
    texture.minFilter = THREE.NearestFilter;
    texture.magFilter = THREE.NearestFilter;
    texture.generateMipmaps = false;
    texture.flipY = false;
    texture.colorSpace = THREE.NoColorSpace;
    texture.unpackAlignment = 1;
    texture.needsUpdate = true;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
  const material = new THREE.ShaderMaterial({
    name: 'HideoutSnapshot',
    uniforms: { snapshotColor: { value: color }, snapshotDepth: { value: depth }, snapshotEnabled: { value: 0 } },
    vertexShader: copyVertex,
    fragmentShader: `uniform highp sampler2D snapshotColor;
uniform highp sampler2D snapshotDepth;
uniform float snapshotEnabled;
void main() {
  if (snapshotEnabled < 0.5) discard;
  ivec2 pixel = ivec2(gl_FragCoord.xy);
  gl_FragColor = texelFetch(snapshotColor, pixel, 0);
  gl_FragDepth = texelFetch(snapshotDepth, pixel, 0).r;
}`,
    depthTest: true, depthWrite: true, depthFunc: THREE.AlwaysDepth, toneMapped: false,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'hideout snapshot';
  mesh.frustumCulled = false;
  mesh.renderOrder = -1e9;
  return mesh;
}

function disposeSnapshotMesh(mesh: THREE.Mesh): void {
  const material = mesh.material as THREE.ShaderMaterial;
  (material.uniforms.snapshotColor.value as THREE.Texture).dispose();
  (material.uniforms.snapshotDepth.value as THREE.Texture).dispose();
  material.dispose();
  mesh.geometry.dispose();
}

type Pose = Omit<HideoutSnapshotHeader, 'version'>;
/** The default orbit controls, registered in the R3F store. */
type Orbit = { target: THREE.Vector3; update: () => void };

function currentPose(gl: THREE.WebGLRenderer, camera: THREE.Camera, controls: Orbit | null, scale: number, floor: number): Pose {
  const size = gl.getDrawingBufferSize(new THREE.Vector2());
  return { view: camera.matrixWorldInverse.toArray(), projection: camera.projectionMatrix.toArray(), placement: [scale, floor], width: size.x, height: size.y,
    orbit: controls?.target ? { position: camera.position.toArray(), target: controls.target.toArray() } : null };
}

/** The default framing fits the posed hero, so it moves between opens with
 *  the animation phase at the fit: measured up to 20 mm for a looping idle.
 *  Within this distance the camera moves onto the saved pose, no further than
 *  that jitter, and the saved frame stays exact. An orbit moves it further. */
const SNAP_DISTANCE = 0.03;
const near = (vector: THREE.Vector3, saved: readonly number[], distance: number) =>
  Math.abs(vector.x - saved[0]) <= distance && Math.abs(vector.y - saved[1]) <= distance && Math.abs(vector.z - saved[2]) <= distance;

const header = (pose: Pose): HideoutSnapshotHeader => ({ version: HIDEOUT_SNAPSHOT_VERSION, ...pose });
const samePose = (a: Pose, b: Pose) => hideoutSnapshotMatches(header(a), b.view, b.projection, b.placement, b.width, b.height, 0);

export interface HideoutRoom { meshes: readonly THREE.Object3D[]; lights: readonly THREE.Light[] }

/** Renders the room alone, as the post pipeline's scene pass would (4x MSAA,
 *  half float), and reads back its color and depth. Other lights in the scene,
 *  such as particle lights, stay in the pass at zero intensity: three keys
 *  programs on the light count, so dropping them would relink every room
 *  material, and a zero light adds exactly nothing. */
async function captureRoom(gl: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, room: HideoutRoom, pose: Pose): Promise<Snapshot> {
  const { width, height } = pose;
  const target = new THREE.WebGLRenderTarget(width, height, { type: THREE.HalfFloatType, samples: 4, depthBuffer: true,
    depthTexture: new THREE.DepthTexture(width, height), minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
  const readback = new THREE.WebGLRenderTarget(width, height, { type: THREE.FloatType, depthBuffer: false,
    minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
  const copy = new THREE.ShaderMaterial({ uniforms: { source: { value: null } }, vertexShader: copyVertex,
    fragmentShader: 'uniform highp sampler2D source;\nvoid main() { gl_FragColor = texelFetch(source, ivec2(gl_FragCoord.xy), 0); }',
    depthTest: false, depthWrite: false, toneMapped: false });
  const quad = new FullScreenQuad(copy);
  const enabled: THREE.Object3D[] = [];
  const include = (object: THREE.Object3D) => { if (!object.layers.isEnabled(CAPTURE_LAYER)) { object.layers.enable(CAPTURE_LAYER); enabled.push(object); } };
  const dimmed: { light: THREE.Light; intensity: number }[] = [];
  scene.traverse(object => {
    const light = object as THREE.Light;
    if (!light.isLight) return;
    include(light);
    if (!room.lights.includes(light)) { dimmed.push({ light, intensity: light.intensity }); light.intensity = 0; }
  });
  for (const mesh of room.meshes) include(mesh);
  const layers = camera.layers.mask;
  const previous = gl.getRenderTarget();
  const autoClear = gl.autoClear;
  const pixels = width * height;
  const colorFloat = new Float32Array(pixels * 4);
  const depthFloat = new Float32Array(pixels * 4);
  try {
    camera.layers.set(CAPTURE_LAYER);
    gl.autoClear = true;
    gl.setRenderTarget(target);
    gl.render(scene, camera);
    for (const { light, intensity } of dimmed) light.intensity = intensity;
    dimmed.length = 0;
    camera.layers.mask = layers;
    for (const object of enabled) object.layers.disable(CAPTURE_LAYER);
    enabled.length = 0;
    gl.setRenderTarget(readback);
    copy.uniforms.source.value = target.texture;
    quad.render(gl);
    gl.setRenderTarget(previous);
    await gl.readRenderTargetPixelsAsync(readback, 0, 0, width, height, colorFloat);
    gl.setRenderTarget(readback);
    copy.uniforms.source.value = target.depthTexture;
    quad.render(gl);
    gl.setRenderTarget(previous);
    await gl.readRenderTargetPixelsAsync(readback, 0, 0, width, height, depthFloat);
  } finally {
    for (const { light, intensity } of dimmed) light.intensity = intensity;
    camera.layers.mask = layers;
    for (const object of enabled) object.layers.disable(CAPTURE_LAYER);
    gl.autoClear = autoClear;
    gl.setRenderTarget(previous);
    quad.dispose(); copy.dispose(); target.depthTexture?.dispose(); target.dispose(); readback.dispose();
  }
  // The scene pass stores half floats, so every value converts back exactly.
  const color = new Uint16Array(pixels * 4);
  for (let i = 0; i < color.length; i++) color[i] = THREE.DataUtils.toHalfFloat(colorFloat[i]);
  const depth = new Float32Array(pixels);
  for (let i = 0; i < pixels; i++) depth[i] = depthFloat[i * 4];
  return { ...header(pose), color, depth };
}

function differingPixels(a: Snapshot, b: Snapshot): number {
  let count = 0;
  for (let i = 0; i < a.depth.length; i++) {
    const c = i * 4;
    if (a.depth[i] !== b.depth[i] || a.color[c] !== b.color[c] || a.color[c + 1] !== b.color[c + 1] || a.color[c + 2] !== b.color[c + 2] || a.color[c + 3] !== b.color[c + 3]) count++;
  }
  return count;
}

export interface HideoutSnapshotStats { marks?: Record<string, number>; loaded: boolean; shown: number; snapped: number; checked: number | null; saved: number; savedPose?: Pose; capturedPose?: Pose; renderPose?: Pose }

/**
 * Shows the room's last saved frame while the real room loads, and keeps that
 * frame current. Exact only at the camera, placement and drawing size it was
 * saved from; at any other pose it draws nothing, so an orbit before the real
 * room is ready shows the hero alone rather than a misplaced room.
 * Every rest of the camera on the real room re-captures the frame, which also
 * replaces a stale one (an app update can change the room's shaders).
 */
export function HideoutSnapshot({ sceneKey, bytes, hint, scale, floor, room, onShown }: {
  sceneKey: string; hint: string; scale: number; floor: number;
  /** Called on the first frame the saved frame draws. */
  onShown?: () => void;
  /** The saved frame's file, read with the scene (hideoutPreload). */
  bytes: Promise<ArrayBuffer | null>;
  /** The real room's meshes and lights once they are in the scene; null while loading. */
  room: HideoutRoom | null;
}) {
  const { gl, camera } = useThree();
  const getThree = useThree(state => state.get);
  const [mesh, setMesh] = useState<THREE.Mesh | null>(null);
  const saved = useRef<{ snapshot: Snapshot; checked: boolean } | null>(null);
  const placement = useRef<[number, number]>([scale, floor]);
  useEffect(() => { placement.current = [scale, floor]; }, [scale, floor]);
  const capture = useRef({ pose: null as Pose | null, since: 0, busy: false, done: null as Pose | null });
  const stats = useRef<HideoutSnapshotStats>({ loaded: false, shown: 0, snapped: 0, checked: null, saved: 0 });
  const shown = useRef(onShown);
  useEffect(() => { shown.current = onShown; }, [onShown]);
  useEffect(() => {
    const { scene } = getThree();
    if (import.meta.env.VITE_GRIMOIRE_VIEWER_BENCH === '1') scene.userData.hideoutSnapshot = stats.current;
    let cancelled = false;
    let built: THREE.Mesh | null = null;
    const mark = (name: string) => { if (import.meta.env.VITE_GRIMOIRE_VIEWER_BENCH === '1') (stats.current.marks ??= {})[name] = performance.now(); };
    mark('fetch');
    void bytes
      .then(buffer => {
        mark('fetched');
        const snapshot = buffer && decodeHideoutSnapshot(buffer);
        if (cancelled || !snapshot) return;
        saved.current = { snapshot, checked: false };
        stats.current.loaded = true;
        if (import.meta.env.VITE_GRIMOIRE_VIEWER_BENCH === '1') stats.current.savedPose = { view: snapshot.view, projection: snapshot.projection, placement: snapshot.placement, width: snapshot.width, height: snapshot.height, orbit: snapshot.orbit };
        built = snapshotMesh(snapshot);
        built.onBeforeRender = (renderer, _scene, renderCamera) => {
          const uniform = ((built as THREE.Mesh).material as THREE.ShaderMaterial).uniforms.snapshotEnabled;
          const size = renderer.getDrawingBufferSize(new THREE.Vector2());
          const target = renderer.getRenderTarget();
          // Only the full-size scene pass, at the saved pose. Transmission and
          // capture passes render at other sizes or without this mesh's layer.
          const match = (!target || (target.width === size.x && target.height === size.y))
            && hideoutSnapshotMatches(snapshot, renderCamera.matrixWorldInverse.elements, renderCamera.projectionMatrix.elements, placement.current, size.x, size.y);
          if (match && uniform.value !== 1) shown.current?.();
          uniform.value = match ? 1 : 0;
          if (import.meta.env.VITE_GRIMOIRE_VIEWER_BENCH === '1') stats.current.renderPose = { view: renderCamera.matrixWorldInverse.toArray(), projection: renderCamera.projectionMatrix.toArray(), placement: [...placement.current], width: size.x, height: size.y, orbit: null };
          if (match) stats.current.shown++;
          if (match && !stats.current.marks?.shown) mark('shown');
          if (!stats.current.marks?.firstRender) mark('firstRender');
        };
        setMesh(built);
        mark('mounted');
      })
      .catch(() => { /* No snapshot: the room appears when it loads. */ });
    return () => {
      cancelled = true;
      if (built) disposeSnapshotMesh(built);
      saved.current = null;
      if (import.meta.env.VITE_GRIMOIRE_VIEWER_BENCH === '1') delete scene.userData.hideoutSnapshot;
    };
  }, [getThree, bytes]);

  useFrame(() => {
    const controls = getThree().controls as unknown as Orbit | null;
    const orbit = saved.current?.snapshot.orbit;
    if (!room && orbit && controls?.target && camera.userData.previewHome && near(camera.position, orbit.position, SNAP_DISTANCE) && near(controls.target, orbit.target, SNAP_DISTANCE)
      && !(near(camera.position, orbit.position, 1e-9) && near(controls.target, orbit.target, 1e-9))) {
      camera.position.fromArray(orbit.position);
      controls.target.fromArray(orbit.target);
      controls.update();
      stats.current.snapped++;
    }
    const state = capture.current;
    if (!room || state.busy) return;
    camera.updateMatrixWorld();
    const pose = currentPose(gl, camera, controls, placement.current[0], placement.current[1]);
    const now = performance.now();
    if (!state.pose || !samePose(state.pose, pose)) { state.pose = pose; state.since = now; return; }
    if (now - state.since < CAPTURE_REST_MS || (state.done && samePose(state.done, pose))) return;
    const previous = saved.current;
    const sameAsSaved = !!previous && hideoutSnapshotMatches(previous.snapshot, pose.view, pose.projection, pose.placement, pose.width, pose.height);
    if (sameAsSaved && previous.checked) { state.done = pose; return; }
    state.busy = true;
    if (import.meta.env.VITE_GRIMOIRE_VIEWER_BENCH === '1') stats.current.capturedPose = pose;
    void captureRoom(gl, getThree().scene, camera, room, pose).then(async snapshot => {
      state.done = pose;
      if (sameAsSaved && previous) {
        const changed = differingPixels(previous.snapshot, snapshot);
        stats.current.checked = changed;
        previous.checked = true;
        if (!changed) return;
      }
      saved.current = { snapshot, checked: true };
      await window.electronAPI.saveHideoutSnapshot(sceneKey, hideoutSnapshotName(hint), encodeHideoutSnapshot(snapshot));
      stats.current.saved++;
    }).catch(() => { state.done = pose; /* Keep the previous snapshot; the next pose tries again. */ }).finally(() => { state.busy = false; });
  });

  return mesh && !room ? <primitive object={mesh} /> : null;
}
