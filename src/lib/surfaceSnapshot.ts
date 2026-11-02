import * as THREE from 'three';

/** One mesh's triangles where the renderer last drew them. */
interface MeshSnapshot {
  mesh: THREE.Mesh;
  geometry: THREE.BufferGeometry;
  /** World-space vertex positions, three floats each. */
  positions: Float32Array;
  index: ArrayLike<number> | null;
  bounds: THREE.Box3;
  /** What the pose was computed from, to notice when it moves. */
  pose: Float32Array;
}

export interface SurfaceHit {
  object: THREE.Mesh;
  material: THREE.Material;
  face: { a: number; b: number; c: number };
  distance: number;
  uv: THREE.Vector2 | null;
}

/** Everything that moves a mesh's vertices: its transform, bones, morph weights and the position data itself. */
const poseOf = (mesh: THREE.Mesh) => {
  const bones = mesh instanceof THREE.SkinnedMesh ? mesh.skeleton.boneMatrices : null;
  const morphs = mesh.morphTargetInfluences ?? [];
  const position = mesh.geometry.attributes.position;
  const version = 'version' in position ? position.version : 0;
  const pose = new Float32Array(17 + morphs.length + (bones?.length ?? 0));
  pose.set(mesh.matrixWorld.elements);
  pose[16] = version;
  pose.set(morphs, 17);
  if (bones) pose.set(bones, 17 + morphs.length);
  return pose;
};

const samePose = (a: Float32Array, b: Float32Array) => {
  if (a.length !== b.length) return false;
  for (let index = 0; index < a.length; index++) if (a[index] !== b[index]) return false;
  return true;
};

/**
 * Hit-testing against posed geometry without re-skinning it for every ray. three.js skins every vertex of
 * every hero mesh on the CPU per raycast (over 100 ms on a hero), which made hovering and brushing lag.
 * This skins each mesh once per pose and tests rays against the cached positions.
 */
export class SurfaceSnapshot {
  private meshes = new Map<THREE.Mesh, MeshSnapshot>();
  private root: THREE.Object3D;
  private skip: (object: THREE.Object3D) => boolean;
  constructor(root: THREE.Object3D, skip: (object: THREE.Object3D) => boolean) {
    this.root = root;
    this.skip = skip;
  }

  private snapshot(mesh: THREE.Mesh): MeshSnapshot {
    const pose = poseOf(mesh);
    const cached = this.meshes.get(mesh);
    if (cached && cached.geometry === mesh.geometry && samePose(cached.pose, pose)) return cached;
    const count = mesh.geometry.attributes.position.count;
    const positions = cached?.positions.length === count * 3 ? cached.positions : new Float32Array(count * 3);
    const point = new THREE.Vector3();
    const bounds = new THREE.Box3();
    for (let vertex = 0; vertex < count; vertex++) {
      mesh.getVertexPosition(vertex, point).applyMatrix4(mesh.matrixWorld);
      positions[vertex * 3] = point.x; positions[vertex * 3 + 1] = point.y; positions[vertex * 3 + 2] = point.z;
      bounds.expandByPoint(point);
    }
    const index = mesh.geometry.index;
    const next = { mesh, geometry: mesh.geometry, positions, index: index ? index.array : null, bounds, pose };
    this.meshes.set(mesh, next);
    return next;
  }

  /** Posed corners of one triangle, for measuring the surface around a hit. */
  corners(mesh: THREE.Mesh, face: { a: number; b: number; c: number }): THREE.Vector3[] {
    const { positions } = this.snapshot(mesh);
    return [face.a, face.b, face.c].map((vertex) => new THREE.Vector3(positions[vertex * 3], positions[vertex * 3 + 1], positions[vertex * 3 + 2]));
  }

  /** The nearest visible triangle along the ray, either side, like the default double-sided raycast. */
  raycast(ray: THREE.Ray): SurfaceHit | null {
    this.root.updateMatrixWorld(true);
    let best: SurfaceHit | null = null;
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), hit = new THREE.Vector3();
    const { x: ox, y: oy, z: oz } = ray.origin, { x: dx, y: dy, z: dz } = ray.direction;
    this.root.traverseVisible((object) => {
      if (!(object instanceof THREE.Mesh) || this.skip(object)) return;
      // Meshes placed by their shader, like engine particles parented under the hero, have no positions to test.
      if (!object.geometry.attributes.position) return;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      if (!materials.some((material) => material.visible)) return;
      const snap = this.snapshot(object);
      if (!ray.intersectsBox(snap.bounds)) return;
      // Like three.js: groups only split a multi-material mesh, and every range stops at the draw range.
      const groups = Array.isArray(object.material) && object.geometry.groups.length ? object.geometry.groups : [{ start: 0, count: Infinity, materialIndex: 0 }];
      const total = snap.index ? snap.index.length : snap.positions.length / 3;
      const { start: drawStart, count: drawCount } = object.geometry.drawRange;
      for (const group of groups) {
        const material = materials[group.materialIndex ?? 0];
        if (!material?.visible) continue;
        const begin = Math.max(group.start, drawStart);
        const end = Math.min(total, group.start + group.count, drawStart + drawCount);
        const position = snap.positions;
        for (let corner = begin; corner + 2 < end; corner += 3) {
          const ia = snap.index ? snap.index[corner] : corner, ib = snap.index ? snap.index[corner + 1] : corner + 1, ic = snap.index ? snap.index[corner + 2] : corner + 2;
          // Moller-Trumbore on the raw arrays, both sides: copying every triangle into vectors dominated brush strokes.
          const ax = position[ia * 3], ay = position[ia * 3 + 1], az = position[ia * 3 + 2];
          const e1x = position[ib * 3] - ax, e1y = position[ib * 3 + 1] - ay, e1z = position[ib * 3 + 2] - az;
          const e2x = position[ic * 3] - ax, e2y = position[ic * 3 + 1] - ay, e2z = position[ic * 3 + 2] - az;
          const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x;
          const det = e1x * px + e1y * py + e1z * pz;
          if (Math.abs(det) < 1e-12) continue;
          const inverse = 1 / det;
          const tx = ox - ax, ty = oy - ay, tz = oz - az;
          const w1 = (tx * px + ty * py + tz * pz) * inverse;
          if (w1 < 0 || w1 > 1) continue;
          const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x;
          const w2 = (dx * qx + dy * qy + dz * qz) * inverse;
          if (w2 < 0 || w1 + w2 > 1) continue;
          const distance = (e2x * qx + e2y * qy + e2z * qz) * inverse;
          if (distance < 0 || (best && distance >= best.distance)) continue;
          a.fromArray(position, ia * 3); b.fromArray(position, ib * 3); c.fromArray(position, ic * 3);
          hit.copy(ray.origin).addScaledVector(ray.direction, distance);
          const uv = object.geometry.attributes.uv;
          let coordinate: THREE.Vector2 | null = null;
          if (uv) {
            const weights = THREE.Triangle.getBarycoord(hit, a, b, c, new THREE.Vector3());
            if (weights) coordinate = new THREE.Vector2()
              .addScaledVector(new THREE.Vector2().fromBufferAttribute(uv, ia), weights.x)
              .addScaledVector(new THREE.Vector2().fromBufferAttribute(uv, ib), weights.y)
              .addScaledVector(new THREE.Vector2().fromBufferAttribute(uv, ic), weights.z);
          }
          best = { object, material, face: { a: ia, b: ib, c: ic }, distance, uv: coordinate };
        }
      }
    });
    return best;
  }
}

const snapshots = new WeakMap<THREE.Object3D, SurfaceSnapshot>();

/** One shared snapshot per model, so hover, clicks and brush strokes reuse the same posed geometry. */
export function surfaceSnapshot(root: THREE.Object3D, skip: (object: THREE.Object3D) => boolean): SurfaceSnapshot {
  let snapshot = snapshots.get(root);
  if (!snapshot) { snapshot = new SurfaceSnapshot(root, skip); snapshots.set(root, snapshot); }
  return snapshot;
}
