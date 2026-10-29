import * as THREE from 'three';

/** Keep ordinary animated silhouettes in view without fitting authored offscreen
 * hide transforms (for example a weapon moved far below an idle character).
 * The reference is the complete bind-pose bounds in the model's local space. */
export function heroPreviewBounds(model: THREE.Object3D, reference?: THREE.Box3): THREE.Box3 {
  const bind = reference?.clone().applyMatrix4(model.matrixWorld);
  const size = bind?.getSize(new THREE.Vector3());
  const envelope = bind && size ? bind.clone().expandByScalar(Math.max(size.x, size.y, size.z)) : null;
  const result = new THREE.Box3();
  model.traverseVisible((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry || Object.hasOwn(mesh.userData, 'morphic_shell') || mesh.userData.citadelNprOutline) return;
    const skinned = mesh as THREE.SkinnedMesh;
    let local: THREE.Box3 | null;
    if (skinned.isSkinnedMesh) {
      skinned.computeBoundingBox();
      local = skinned.boundingBox;
    } else {
      mesh.geometry.computeBoundingBox();
      local = mesh.geometry.boundingBox;
    }
    if (!local) return;
    const bounds = local.clone().applyMatrix4(mesh.matrixWorld);
    if ([...bounds.min.toArray(), ...bounds.max.toArray()].every(Number.isFinite) && (!envelope || envelope.intersectsBox(bounds))) {
      result.union(bounds);
    }
  });
  return result.isEmpty() && bind ? bind : result;
}
