import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { SurfaceSnapshot } from './surfaceSnapshot';

const towardBox = () => new THREE.Ray(new THREE.Vector3(0, 0, 5), new THREE.Vector3(0, 0, -1));
const scene = (mesh: THREE.Mesh) => { const root = new THREE.Group(); root.add(mesh); return root; };

describe('surface snapshot', () => {
  it('hits every face of a single-material mesh, whatever groups its geometry has', () => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());
    const hit = new SurfaceSnapshot(scene(mesh), () => false).raycast(towardBox());
    expect(hit?.distance).toBeCloseTo(4.5);
  });
  it('ignores triangles outside the draw range', () => {
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    // The front face is the fifth group; drawing only the first face leaves nothing in front of the ray.
    geometry.setDrawRange(0, 6);
    const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
    expect(new SurfaceSnapshot(scene(mesh), () => false).raycast(towardBox())).toBeNull();
  });
  it('skips meshes without positions, like engine particles parented under the model', () => {
    const root = scene(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial()));
    const particles = new THREE.InstancedBufferGeometry();
    particles.setAttribute('instanceColor', new THREE.InstancedBufferAttribute(new Float32Array(4), 4));
    root.add(new THREE.Mesh(particles, new THREE.MeshBasicMaterial()));
    expect(new SurfaceSnapshot(root, () => false).raycast(towardBox())?.distance).toBeCloseTo(4.5);
  });
  it('notices a changed morph weight', () => {
    const geometry = new THREE.PlaneGeometry(1, 1);
    const moved = geometry.attributes.position.clone();
    for (let index = 0; index < moved.count; index++) moved.setX(index, moved.getX(index) + 10);
    geometry.morphAttributes.position = [moved];
    geometry.morphTargetsRelative = false;
    const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
    mesh.updateMorphTargets();
    const snapshot = new SurfaceSnapshot(scene(mesh), () => false);
    expect(snapshot.raycast(towardBox())).not.toBeNull();
    mesh.morphTargetInfluences![0] = 1;
    expect(snapshot.raycast(towardBox())).toBeNull();
  });
});
