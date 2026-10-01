import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { bindParticleSnapshot, skinnedSnapshotPosition } from './particleSnapshotSkinning';
const point = (position: [number, number, number]) => ({ position, joints: ['head', '', '', ''], weights: [1, 0, 0, 0] });
describe('model-bind particle snapshots', () => {
  it('uses exported inverse binds exactly once through rotated, scaled animated bones', () => {
    const model = new THREE.Group(), root = new THREE.Group(); root.scale.setScalar(.0254); root.rotation.x = -Math.PI/2; model.add(root);
    const bone = new THREE.Bone(); bone.name = 'head'; bone.position.set(0, 0, 80); root.add(bone);
    model.updateMatrixWorld(true);
    const skeleton = new THREE.Skeleton([bone], [new THREE.Matrix4().makeTranslation(0, 0, -80)]);
    const mesh = new THREE.SkinnedMesh(); mesh.skeleton = skeleton; root.add(mesh);
    const points = [point([3, 0, 83]), point([14, 0, 97])];
    const bound = bindParticleSnapshot(model, points)!;
    const expected = new THREE.Vector3(3, 0, 83).applyMatrix4(root.matrixWorld);
    const actual = skinnedSnapshotPosition(bound[0], new THREE.Vector3(), new THREE.Vector3());
    expect(actual.distanceTo(expected)).toBeLessThan(1e-9);
    bone.rotation.y = Math.PI/2; model.updateMatrixWorld(true);
    const animated = new THREE.Vector3(3, 0, 3).applyMatrix4(bone.matrixWorld);
    expect(skinnedSnapshotPosition(bound[0], actual, new THREE.Vector3()).distanceTo(animated)).toBeLessThan(1e-9);
  });
  it('rejects missing joints and malformed influence data instead of inventing an anchor', () => {
    const model = new THREE.Group();
    expect(bindParticleSnapshot(model, [point([0, 0, 0]), point([1, 0, 0])])).toBeNull();
    const bone = new THREE.Bone(); bone.name = 'head'; model.add(bone);
    const mesh = new THREE.SkinnedMesh(); mesh.skeleton = new THREE.Skeleton([bone]); model.add(mesh);
    expect(bindParticleSnapshot(model, [{ ...point([0, 0, 0]), weights: [.5, 0, 0, 0] }, point([1, 0, 0])])).toBeNull();
  });
});
