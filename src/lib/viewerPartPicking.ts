import * as THREE from 'three';
import { surfaceSnapshot } from './surfaceSnapshot';

export interface ViewerPartHit {
  material: string;
  /** Texture coordinate under the pointer, when the mesh has UVs. */
  uv: THREE.Vector2 | null;
  /** How far one screen pixel reaches on the hit surface, in the mesh's own units, for sizing a brush. */
  unitsPerPixel: number | null;
}

/** Screen pixels to mesh units at the hit's depth, through the hit triangle's posed-to-rest scale. */
function unitsPerPixel(mesh: THREE.Object3D, face: { a: number; b: number; c: number } | null | undefined, distance: number, camera: THREE.Camera, viewportHeight: number,
  posedCorners?: THREE.Vector3[]): number | null {
  if (!(mesh instanceof THREE.Mesh) || !face || !(camera instanceof THREE.PerspectiveCamera)) return null;
  const position = mesh.geometry.attributes.position;
  if (!position) return null;
  const { a, b, c } = face;
  const rest = [a, b, c].map((index) => new THREE.Vector3().fromBufferAttribute(position, index));
  const posed = posedCorners ?? [a, b, c].map((index) => mesh.getVertexPosition(index, new THREE.Vector3()).applyMatrix4(mesh.matrixWorld));
  const area = (points: THREE.Vector3[]) => points[1].clone().sub(points[0]).cross(points[2].clone().sub(points[0])).length();
  const restArea = area(rest), posedArea = area(posed);
  if (!restArea || !posedArea) return null;
  const worldPerPixel = 2 * distance * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) / Math.max(1, viewportHeight);
  return worldPerPixel * Math.sqrt(restArea / posedArea);
}

const helper = (object: THREE.Object3D) => !!object.userData.skinPartHighlight || !!object.userData.skinRegionOverlay;

/**
 * The first visible model surface under a client point. `posed` tests against geometry skinned once per
 * pose instead of per ray, for pointer work that runs every frame (hover, brush strokes) on a held pose.
 */
export function viewerPartAt(canvas: HTMLElement, model: THREE.Object3D, camera: THREE.Camera, raycaster: THREE.Raycaster, clientX: number, clientY: number, posed = false): ViewerPartHit | null {
  const rect = canvas.getBoundingClientRect();
  if (!rect.width || !rect.height) return null;
  camera.updateMatrixWorld();
  model.updateWorldMatrix(true, false);
  model.updateMatrixWorld(true);
  raycaster.setFromCamera(new THREE.Vector2(
    (clientX - rect.left) / rect.width * 2 - 1,
    -(clientY - rect.top) / rect.height * 2 + 1,
  ), camera);
  if (posed) {
    const snapshot = surfaceSnapshot(model, helper);
    const hit = snapshot.raycast(raycaster.ray);
    return hit && { material: hit.material.name, uv: hit.uv,
      unitsPerPixel: unitsPerPixel(hit.object, hit.face, hit.distance, camera, rect.height, snapshot.corners(hit.object, hit.face)) };
  }
  const meshes: THREE.Mesh[] = [];
  model.traverseVisible((object) => {
    if (object instanceof THREE.Mesh && !helper(object)) meshes.push(object);
  });
  for (const hit of raycaster.intersectObjects(meshes, false)) {
    if (!(hit.object instanceof THREE.Mesh)) continue;
    const materials = hit.object.material;
    const material = Array.isArray(materials) ? materials[hit.face?.materialIndex ?? 0] : materials;
    if (material?.visible) return { material: material.name, uv: hit.uv?.clone() ?? null, unitsPerPixel: unitsPerPixel(hit.object, hit.face, hit.distance, camera, rect.height) };
  }
  return null;
}

/** Report the surface under a resting pointer, at most once a frame and never during a drag. */
export function attachViewerHover(canvas: HTMLElement, model: THREE.Object3D, camera: THREE.Camera, onHover: (hit: ViewerPartHit | null) => void, cursor?: string, posed = false): () => void {
  const raycaster = new THREE.Raycaster();
  const previousCursor = canvas.style.cursor;
  if (cursor) canvas.style.cursor = cursor;
  let frame = 0;
  let point: { x: number; y: number } | null = null;
  const run = () => { frame = 0; onHover(point ? viewerPartAt(canvas, model, camera, raycaster, point.x, point.y, posed) : null); };
  const move = (event: PointerEvent) => {
    point = event.buttons ? null : { x: event.clientX, y: event.clientY };
    if (!point) { onHover(null); return; }
    if (!frame) frame = requestAnimationFrame(run);
  };
  const leave = () => { point = null; if (frame) cancelAnimationFrame(frame); frame = 0; onHover(null); };
  canvas.addEventListener('pointermove', move);
  canvas.addEventListener('pointerleave', leave);
  return () => {
    if (frame) cancelAnimationFrame(frame);
    if (cursor) canvas.style.cursor = previousCursor;
    canvas.removeEventListener('pointermove', move);
    canvas.removeEventListener('pointerleave', leave);
  };
}

/** Pick only after a primary click. Camera gestures never traverse model geometry. */
export function attachViewerPartPicker(canvas: HTMLElement, model: THREE.Object3D, camera: THREE.Camera, onPick: (material: string, hit: ViewerPartHit) => void, posed = false): () => void {
  let candidate: { pointerId: number; x: number; y: number } | null = null;
  const raycaster = new THREE.Raycaster();
  const down = (event: PointerEvent) => {
    candidate = event.button === 0 && event.isPrimary
      ? { pointerId: event.pointerId, x: event.clientX, y: event.clientY } : null;
  };
  const moved = (event: PointerEvent) => candidate
    && Math.hypot(event.clientX - candidate.x, event.clientY - candidate.y) > 4;
  const move = (event: PointerEvent) => {
    if (candidate?.pointerId === event.pointerId && moved(event)) candidate = null;
  };
  const cancel = () => { candidate = null; };
  const up = (event: PointerEvent) => {
    const select = candidate?.pointerId === event.pointerId && event.button === 0 && !moved(event);
    candidate = null;
    if (!select) return;
    const hit = viewerPartAt(canvas, model, camera, raycaster, event.clientX, event.clientY, posed);
    if (hit) onPick(hit.material, hit);
  };
  canvas.addEventListener('pointerdown', down);
  canvas.addEventListener('pointermove', move);
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', cancel);
  return () => {
    candidate = null;
    canvas.removeEventListener('pointerdown', down);
    canvas.removeEventListener('pointermove', move);
    canvas.removeEventListener('pointerup', up);
    canvas.removeEventListener('pointercancel', cancel);
  };
}
