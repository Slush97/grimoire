import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { installFastSkinnedBounds } from './skinnedBounds';

function skinnedMesh(seed: number): THREE.SkinnedMesh {
  let state = seed;
  const random = () => { state = (state * 1664525 + 1013904223) % 4294967296; return state / 4294967296; };
  const count = 500;
  const positions = new Float32Array(count * 3).map(() => random() * 4 - 2);
  const indices = new Uint16Array(count * 4).map(() => Math.floor(random() * 3));
  const weights = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) {
    const raw = [random(), random(), random() < 0.5 ? 0 : random(), 0];
    const sum = raw.reduce((a, b) => a + b, 0);
    raw.forEach((value, k) => { weights[i * 4 + k] = value / sum; });
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('skinIndex', new THREE.BufferAttribute(indices, 4));
  geometry.setAttribute('skinWeight', new THREE.BufferAttribute(weights, 4));
  const bones = [new THREE.Bone(), new THREE.Bone(), new THREE.Bone()];
  bones[0].add(bones[1]); bones[1].add(bones[2]);
  bones[1].position.set(0.3, 1, 0); bones[2].position.set(0, 0.7, 0.2);
  const mesh = new THREE.SkinnedMesh(geometry, new THREE.MeshBasicMaterial());
  mesh.add(bones[0]);
  mesh.position.set(0.5, -0.2, 0.1);
  mesh.updateMatrixWorld(true);
  mesh.bind(new THREE.Skeleton(bones));
  // An animated pose, away from the bind pose.
  bones[1].rotation.set(0.4, -0.2, 0.9); bones[2].rotation.set(-0.7, 0.3, 0.1); bones[0].scale.set(1, 1.2, 0.9);
  mesh.updateMatrixWorld(true);
  return mesh;
}

describe('fast skinned bounds', () => {
  it('matches three.js bit for bit, in the bind pose and posed', () => {
    for (const seed of [1, 2, 3]) {
      const reference = skinnedMesh(seed), fast = skinnedMesh(seed);
      installFastSkinnedBounds(fast);
      reference.computeBoundingBox(); fast.computeBoundingBox();
      reference.computeBoundingSphere(); fast.computeBoundingSphere();
      expect(fast.boundingBox!.min.toArray()).toEqual(reference.boundingBox!.min.toArray());
      expect(fast.boundingBox!.max.toArray()).toEqual(reference.boundingBox!.max.toArray());
      expect(fast.boundingSphere!.center.toArray()).toEqual(reference.boundingSphere!.center.toArray());
      expect(fast.boundingSphere!.radius).toBe(reference.boundingSphere!.radius);
      reference.skeleton.pose(); fast.skeleton.pose();
      reference.updateMatrixWorld(true); fast.updateMatrixWorld(true);
      reference.computeBoundingBox(); fast.computeBoundingBox();
      expect(fast.boundingBox!.max.toArray()).toEqual(reference.boundingBox!.max.toArray());
    }
  });

  it('leaves morph targets to three.js', () => {
    const mesh = skinnedMesh(4);
    mesh.geometry.morphAttributes.position = [new THREE.BufferAttribute(new Float32Array(500 * 3).fill(0.5), 3)];
    mesh.morphTargetInfluences = [0.5];
    const reference = mesh.clone();
    reference.computeBoundingBox = THREE.SkinnedMesh.prototype.computeBoundingBox;
    installFastSkinnedBounds(mesh);
    mesh.computeBoundingBox(); THREE.SkinnedMesh.prototype.computeBoundingBox.call(reference);
    expect(mesh.boundingBox!.max.toArray()).toEqual(reference.boundingBox!.max.toArray());
  });
});
