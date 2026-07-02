import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  applyOffset,
  nodeBaseQuaternion,
  recoverOffsetSign,
  recoverSimilarity,
  recoverWeightedRigidFit,
} from './clothMath';
import type { ClothNodeBase, Vec3, Vec4 } from './feModel';

const quatArray = (q: THREE.Quaternion): Vec4 => [q.x, q.y, q.z, q.w];

describe('recoverSimilarity', () => {
  it('recovers a synthetic model-to-preview similarity', () => {
    const source: Vec3[] = [
      [1, 2, 3],
      [-1, 5, 2],
      [4, 0, 2],
      [3, 2, -2],
      [0, 1, 0],
      [2, -3, 1],
    ];
    const rotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.35, -0.2, 0.6)).normalize();
    const scale = 0.0254;
    const translation = new THREE.Vector3(0.5, -1.25, 2.0);
    const matrix = new THREE.Matrix4().compose(translation, rotation, new THREE.Vector3(scale, scale, scale));
    const target = source.map((p) => {
      const v = new THREE.Vector3(...p).applyMatrix4(matrix);
      return [v.x, v.y, v.z] as Vec3;
    });

    const fit = recoverSimilarity(source, target);

    expect(fit.rmse).toBeLessThan(1e-9);
    expect(fit.scale).toBeCloseTo(scale, 10);
    for (let i = 0; i < source.length; i++) {
      const actual = new THREE.Vector3(...source[i]).applyMatrix4(fit.matrix);
      expect(actual.distanceTo(new THREE.Vector3(...target[i]))).toBeLessThan(1e-9);
    }
  });
});

describe('recoverWeightedRigidFit', () => {
  it('returns an identity no-scale fit at rest', () => {
    const source: Vec3[] = [
      [0, 0, 0],
      [2, 0, 0],
      [0, 3, 0],
      [0, 0, 4],
    ];
    const weights = [2, 1, 3, 4];

    const fit = recoverWeightedRigidFit(source, source, weights);

    expect(fit.rmse).toBeLessThan(1e-10);
    expect(fit.totalWeight).toBe(10);
    expect(fit.rotation.angleTo(new THREE.Quaternion())).toBeLessThan(1e-10);
    expect(fit.sourceCenter.distanceTo(fit.targetCenter)).toBeLessThan(1e-10);
  });

  it('recovers a weighted rigid rotation and translation without scale', () => {
    const source: Vec3[] = [
      [-1, 0, 0],
      [2, 0.5, 0],
      [0, 3, 1],
      [0.5, -1, 2],
      [1, 1, -1],
    ];
    const weights = [4, 1, 2, 3, 5];
    const rotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.2, -0.5, 0.9)).normalize();
    const translation = new THREE.Vector3(3, -2, 5);
    const target = source.map((p) => {
      const v = new THREE.Vector3(...p).applyQuaternion(rotation).add(translation);
      return [v.x, v.y, v.z] as Vec3;
    });

    const fit = recoverWeightedRigidFit(source, target, weights);

    expect(fit.rmse).toBeLessThan(1e-10);
    expect(fit.rotation.angleTo(rotation)).toBeLessThan(1e-10);
    const movedCenter = fit.sourceCenter.clone().applyQuaternion(fit.rotation).add(translation);
    expect(movedCenter.distanceTo(fit.targetCenter)).toBeLessThan(1e-10);
  });
});

describe('nodeBaseQuaternion', () => {
  it('uses the validated absolute basis times qAdjust convention', () => {
    const qAdjust = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.2, 0.4, -0.1)).normalize();
    const positions: Vec3[] = [
      [0, 0, 0],
      [2, 0, 0],
      [0, 1, 0],
    ];
    const base: ClothNodeBase = {
      node: 2,
      x0: 0,
      x1: 1,
      y0: 0,
      y1: 2,
      qAdjust: quatArray(qAdjust),
    };

    expect(nodeBaseQuaternion(positions, base).angleTo(qAdjust)).toBeLessThan(1e-10);
  });

  it('builds X from cross(Y, cross(xSeed, Y)) and Y as the primary axis', () => {
    const positions: Vec3[] = [
      [0, 0, 0],
      [0, 0, 1],
      [0, 1, 0],
    ];
    const base: ClothNodeBase = {
      node: 2,
      x0: 0,
      x1: 1,
      y0: 0,
      y1: 2,
      qAdjust: [0, 0, 0, 1],
    };
    const expected = new THREE.Quaternion().setFromRotationMatrix(
      new THREE.Matrix4().makeBasis(
        new THREE.Vector3(0, 0, 1),
        new THREE.Vector3(0, 1, 0),
        new THREE.Vector3(-1, 0, 0),
      ),
    );

    expect(nodeBaseQuaternion(positions, base).angleTo(expected)).toBeLessThan(1e-10);
  });
});

describe('recoverOffsetSign', () => {
  it('selects the sign that reproduces the child bind position', () => {
    const parentPos: Vec3 = [10, -3, 2];
    const parentRot = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2);
    const parentRotArray = quatArray(parentRot);
    const offset: Vec3 = [2, 0, 0];
    const childPlus = applyOffset(parentPos, parentRotArray, offset, 1);
    const childMinus = applyOffset(parentPos, parentRotArray, offset, -1);

    expect(recoverOffsetSign(parentPos, parentRotArray, [childPlus.x, childPlus.y, childPlus.z], offset)).toBe(1);
    expect(recoverOffsetSign(parentPos, parentRotArray, [childMinus.x, childMinus.y, childMinus.z], offset)).toBe(-1);
  });
});
