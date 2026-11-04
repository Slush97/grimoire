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

export interface HeroPreviewNormalization {
  scale: number;
  center: THREE.Vector3;
  /** Bind-pose bounds in the model's local space. */
  bounds: THREE.Box3;
  /** Where the model's floor is, normalized. A Source model stands on its origin, so
   * this is the origin's height, unless the measured pose lifts every vertex above
   * it (a static menu pose caught mid-hop), when it is the pose's lowest point. */
  ground: number;
}

/** Fit the model's current bounds to a height-independent size of two units and
 * center them on the origin. The caller poses the model first. */
export function normalizeHeroPreview(model: THREE.Object3D): HeroPreviewNormalization {
  model.updateWorldMatrix(true, true);
  const box = heroPreviewBounds(model);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z);
  const scale = maxDim > 0 ? 2.0 / maxDim : 1;
  const origin = new THREE.Vector3().setFromMatrixPosition(model.matrixWorld);
  const ground = scale * (Math.max(origin.y, box.min.y) - center.y);
  return { scale, center, bounds: box.clone().applyMatrix4(model.matrixWorld.clone().invert()), ground };
}
