import * as THREE from 'three';

const base = new THREE.Vector4();
const skinIndex = new THREE.Vector4();
const skinWeight = new THREE.Vector4();
const influence = new THREE.Vector4();
const vertex = new THREE.Vector3();

/**
 * Visits each vertex as SkinnedMesh.getVertexPosition places it, bit for bit: the same three.js
 * operations in the same order, except that each bone's matrix is multiplied once per pass instead
 * of once per vertex and influence. Returns false, visiting nothing, for morph targets.
 */
function forEachSkinnedVertex(mesh: THREE.SkinnedMesh, visit: (position: THREE.Vector3) => void): boolean {
  const { geometry, skeleton } = mesh;
  if (geometry.morphAttributes.position && mesh.morphTargetInfluences) return false;
  const position = geometry.getAttribute('position');
  // Interleaved attributes read the same through getX, as three's own skinning reads them.
  const indices = geometry.getAttribute('skinIndex') as THREE.BufferAttribute;
  const weights = geometry.getAttribute('skinWeight') as THREE.BufferAttribute;
  const matrices: (THREE.Matrix4 | undefined)[] = [];
  for (let i = 0; i < position.count; i++) {
    vertex.fromBufferAttribute(position, i);
    skinIndex.fromBufferAttribute(indices, i);
    skinWeight.fromBufferAttribute(weights, i);
    base.set(vertex.x, vertex.y, vertex.z, 1);
    vertex.set(0, 0, 0);
    base.applyMatrix4(mesh.bindMatrix);
    for (let k = 0; k < 4; k++) {
      const weight = skinWeight.getComponent(k);
      if (weight === 0) continue;
      const bone = skinIndex.getComponent(k);
      const matrix = matrices[bone] ??= new THREE.Matrix4().multiplyMatrices(skeleton.bones[bone].matrixWorld, skeleton.boneInverses[bone]);
      vertex.addScaledVector(influence.copy(base).applyMatrix4(matrix), weight);
    }
    visit(vertex.applyMatrix4(mesh.bindMatrixInverse));
  }
  return true;
}

function computeBoundingBox(this: THREE.SkinnedMesh): void {
  this.boundingBox ??= new THREE.Box3();
  const box = this.boundingBox.makeEmpty();
  if (!forEachSkinnedVertex(this, (position) => box.expandByPoint(position))) THREE.SkinnedMesh.prototype.computeBoundingBox.call(this);
}

function computeBoundingSphere(this: THREE.SkinnedMesh): void {
  this.boundingSphere ??= new THREE.Sphere();
  const sphere = this.boundingSphere.makeEmpty();
  if (!forEachSkinnedVertex(this, (position) => sphere.expandByPoint(position))) THREE.SkinnedMesh.prototype.computeBoundingSphere.call(this);
}

/** Gives each skinned mesh under `root` the faster, identical bounds above. The camera fit, the
 *  height normalization and frustum culling each skin every vertex once per model. */
export function installFastSkinnedBounds(root: THREE.Object3D): void {
  root.traverse((object) => {
    const mesh = object as THREE.SkinnedMesh;
    if (!mesh.isSkinnedMesh || !mesh.skeleton) return;
    mesh.computeBoundingBox = computeBoundingBox;
    mesh.computeBoundingSphere = computeBoundingSphere;
  });
}
