import * as THREE from 'three';
import type { FxDescriptor } from './fxDescriptor';

export type SnapshotPoints = NonNullable<FxDescriptor['snapshot']>['points'];
export interface SnapshotInfluence { bone: THREE.Bone; local: THREE.Vector3; weight: number }
/** Snapshot positions share the exported mesh's model-bind coordinates. The
 * inverse bind owns that conversion; adding the skeleton axis/units doubles it. */
export function bindParticleSnapshot(model: THREE.Object3D, points: SnapshotPoints): SnapshotInfluence[][] | null {
  if (points.length < 2 || points.length > 256) return null;
  let skeleton: THREE.Skeleton | null = null;
  const required = new Set(points.flatMap((point) => point.joints.filter((_, i) => point.weights[i] > 0)));
  model.traverse((object) => {
    const skin = (object as THREE.SkinnedMesh).skeleton;
    if (!skeleton && skin && [...required].every((name) => skin.bones.some((bone) => bone.name === name))) skeleton = skin;
  });
  if (!skeleton) return null;
  const skin = skeleton as THREE.Skeleton;
  const rows: SnapshotInfluence[][] = [];
  for (const point of points) {
    if (point.position.length !== 3 || !point.position.every(Number.isFinite) || point.joints.length !== 4 || point.weights.length !== 4
      || !point.weights.every((w) => Number.isFinite(w) && w >= 0 && w <= 1)
      || Math.abs(point.weights.reduce((a, b) => a+b, 0)-1) > 0.001) return null;
    const row: SnapshotInfluence[] = [];
    for (let i = 0; i < 4; i++) {
      if (!point.weights[i]) continue;
      const index = skin.bones.findIndex((bone) => bone.name === point.joints[i]);
      if (index < 0 || !skin.boneInverses[index]) return null;
      row.push({ bone: skin.bones[index], local: new THREE.Vector3(...point.position).applyMatrix4(skin.boneInverses[index]), weight: point.weights[i] });
    }
    rows.push(row);
  }
  return rows;
}

export function skinnedSnapshotPosition(influences: SnapshotInfluence[], target: THREE.Vector3, scratch: THREE.Vector3): THREE.Vector3 {
  target.set(0, 0, 0);
  for (const influence of influences) {
    influence.bone.updateWorldMatrix(true, false);
    target.addScaledVector(scratch.copy(influence.local).applyMatrix4(influence.bone.matrixWorld), influence.weight);
  }
  return target;
}
