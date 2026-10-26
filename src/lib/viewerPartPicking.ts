import * as THREE from 'three';

/** Pick only after a primary click. Camera gestures never traverse model geometry. */
export function attachViewerPartPicker(canvas: HTMLElement, model: THREE.Object3D, camera: THREE.Camera, onPick: (material: string) => void): () => void {
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
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    camera.updateMatrixWorld();
    model.updateWorldMatrix(true, false);
    model.updateMatrixWorld(true);
    raycaster.setFromCamera(new THREE.Vector2(
      (event.clientX - rect.left) / rect.width * 2 - 1,
      -(event.clientY - rect.top) / rect.height * 2 + 1,
    ), camera);
    const meshes: THREE.Mesh[] = [];
    model.traverseVisible((object) => {
      if (object instanceof THREE.Mesh && !object.userData.skinPartHighlight) meshes.push(object);
    });
    for (const hit of raycaster.intersectObjects(meshes, false)) {
      if (!(hit.object instanceof THREE.Mesh)) continue;
      const materials = hit.object.material;
      const material = Array.isArray(materials) ? materials[hit.face?.materialIndex ?? 0] : materials;
      if (material?.visible) { onPick(material.name); return; }
    }
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
