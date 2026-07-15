import * as THREE from 'three';
import type { ClothNodeBase, Vec3, Vec4 } from './feModel';

export interface SimilarityFit {
  matrix: THREE.Matrix4;
  inverse: THREE.Matrix4;
  rotation: THREE.Quaternion;
  scale: number;
  translation: THREE.Vector3;
  rmse: number;
}

export interface WeightedRigidFit {
  rotation: THREE.Quaternion;
  sourceCenter: THREE.Vector3;
  targetCenter: THREE.Vector3;
  totalWeight: number;
  rmse: number;
}

const EPS = 1e-9;

function v3(v: Vec3): THREE.Vector3 {
  return new THREE.Vector3(v[0], v[1], v[2]);
}

function q4(q: Vec4): THREE.Quaternion {
  return new THREE.Quaternion(q[0], q[1], q[2], q[3]).normalize();
}

function centroid(points: Vec3[]): THREE.Vector3 {
  const c = new THREE.Vector3();
  for (const p of points) c.add(v3(p));
  return c.multiplyScalar(1 / points.length);
}

function weightedCentroid(points: Vec3[], weights: number[]): { center: THREE.Vector3; totalWeight: number } {
  const center = new THREE.Vector3();
  let totalWeight = 0;
  for (let i = 0; i < points.length; i++) {
    const weight = Number.isFinite(weights[i]) ? weights[i] : 0;
    if (weight <= 0) continue;
    center.addScaledVector(v3(points[i]), weight);
    totalWeight += weight;
  }
  if (totalWeight <= EPS) throw new Error('weighted rigid fit requires positive total weight');
  center.multiplyScalar(1 / totalWeight);
  return { center, totalWeight };
}

function largestEigenvector4(m: number[][]): [number, number, number, number] {
  const a = m.map((row) => [...row]);
  const vectors = [
    [1, 0, 0, 0],
    [0, 1, 0, 0],
    [0, 0, 1, 0],
    [0, 0, 0, 1],
  ];

  for (let iter = 0; iter < 64; iter++) {
    let p = 0;
    let q = 1;
    let max = 0;
    for (let r = 0; r < 4; r++) {
      for (let c = r + 1; c < 4; c++) {
        const v = Math.abs(a[r][c]);
        if (v > max) {
          max = v;
          p = r;
          q = c;
        }
      }
    }
    if (max < 1e-12) break;

    const theta = (a[q][q] - a[p][p]) / (2 * a[p][q]);
    const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
    const cos = 1 / Math.sqrt(t * t + 1);
    const sin = t * cos;
    const app = a[p][p];
    const aqq = a[q][q];
    const apq = a[p][q];
    a[p][p] = app - t * apq;
    a[q][q] = aqq + t * apq;
    a[p][q] = 0;
    a[q][p] = 0;

    for (let r = 0; r < 4; r++) {
      if (r === p || r === q) continue;
      const arp = a[r][p];
      const arq = a[r][q];
      a[r][p] = cos * arp - sin * arq;
      a[p][r] = a[r][p];
      a[r][q] = sin * arp + cos * arq;
      a[q][r] = a[r][q];
    }

    for (let r = 0; r < 4; r++) {
      const vrp = vectors[r][p];
      const vrq = vectors[r][q];
      vectors[r][p] = cos * vrp - sin * vrq;
      vectors[r][q] = sin * vrp + cos * vrq;
    }
  }

  let best = 0;
  for (let i = 1; i < 4; i++) {
    if (a[i][i] > a[best][best]) best = i;
  }
  const v: [number, number, number, number] = [
    vectors[0][best],
    vectors[1][best],
    vectors[2][best],
    vectors[3][best],
  ];
  const len = Math.hypot(v[0], v[1], v[2], v[3]);
  return len < EPS ? [1, 0, 0, 0] : [v[0] / len, v[1] / len, v[2] / len, v[3] / len];
}

function fitRotation(
  source: Vec3[],
  target: Vec3[],
  sourceCentroid: THREE.Vector3,
  targetCentroid: THREE.Vector3,
  weights?: number[],
): THREE.Quaternion {
  let sxx = 0;
  let sxy = 0;
  let sxz = 0;
  let syx = 0;
  let syy = 0;
  let syz = 0;
  let szx = 0;
  let szy = 0;
  let szz = 0;

  for (let i = 0; i < source.length; i++) {
    const weight = weights ? (Number.isFinite(weights[i]) ? weights[i] : 0) : 1;
    if (weight <= 0) continue;
    const x = v3(source[i]).sub(sourceCentroid);
    const y = v3(target[i]).sub(targetCentroid);
    sxx += weight * x.x * y.x;
    sxy += weight * x.x * y.y;
    sxz += weight * x.x * y.z;
    syx += weight * x.y * y.x;
    syy += weight * x.y * y.y;
    syz += weight * x.y * y.z;
    szx += weight * x.z * y.x;
    szy += weight * x.z * y.y;
    szz += weight * x.z * y.z;
  }

  const trace = sxx + syy + szz;
  const k = [
    [trace, syz - szy, szx - sxz, sxy - syx],
    [syz - szy, sxx - syy - szz, sxy + syx, szx + sxz],
    [szx - sxz, sxy + syx, -sxx + syy - szz, syz + szy],
    [sxy - syx, szx + sxz, syz + szy, -sxx - syy + szz],
  ];
  const [w, x, y, z] = largestEigenvector4(k);
  return new THREE.Quaternion(x, y, z, w).normalize();
}

export function recoverWeightedRigidFit(source: Vec3[], target: Vec3[], weights: number[]): WeightedRigidFit {
  if (source.length !== target.length || source.length !== weights.length || source.length < 3) {
    throw new Error('recoverWeightedRigidFit requires at least three paired weighted points');
  }

  const { center: sourceCenter, totalWeight } = weightedCentroid(source, weights);
  const { center: targetCenter } = weightedCentroid(target, weights);
  const rotation = fitRotation(source, target, sourceCenter, targetCenter, weights);

  let sourceSpread = 0;
  let err2 = 0;
  for (let i = 0; i < source.length; i++) {
    const weight = Number.isFinite(weights[i]) ? weights[i] : 0;
    if (weight <= 0) continue;
    const src = v3(source[i]).sub(sourceCenter);
    sourceSpread += weight * src.lengthSq();
    const p = src.applyQuaternion(rotation).add(targetCenter);
    err2 += weight * p.distanceToSquared(v3(target[i]));
  }
  if (sourceSpread <= EPS) throw new Error('recoverWeightedRigidFit source points are degenerate');

  return {
    rotation,
    sourceCenter,
    targetCenter,
    totalWeight,
    rmse: Math.sqrt(err2 / totalWeight),
  };
}

export function recoverSimilarity(source: Vec3[], target: Vec3[]): SimilarityFit {
  if (source.length !== target.length || source.length < 3) {
    throw new Error('recoverSimilarity requires at least three paired points');
  }

  const sourceCentroid = centroid(source);
  const targetCentroid = centroid(target);
  const rotation = fitRotation(source, target, sourceCentroid, targetCentroid);

  let numerator = 0;
  let denominator = 0;
  for (let i = 0; i < source.length; i++) {
    const x = v3(source[i]).sub(sourceCentroid);
    const y = v3(target[i]).sub(targetCentroid);
    numerator += y.dot(x.clone().applyQuaternion(rotation));
    denominator += x.lengthSq();
  }
  if (denominator < EPS) throw new Error('recoverSimilarity source points are degenerate');

  const scale = numerator / denominator;
  const translation = targetCentroid.clone().sub(sourceCentroid.clone().applyQuaternion(rotation).multiplyScalar(scale));
  const matrix = new THREE.Matrix4().compose(translation, rotation, new THREE.Vector3(scale, scale, scale));
  const inverse = matrix.clone().invert();

  let err2 = 0;
  for (let i = 0; i < source.length; i++) {
    const p = v3(source[i]).applyMatrix4(matrix);
    err2 += p.distanceToSquared(v3(target[i]));
  }

  return {
    matrix,
    inverse,
    rotation,
    scale,
    translation,
    rmse: Math.sqrt(err2 / source.length),
  };
}

export function nodeBaseQuaternion(positions: Vec3[], base: ClothNodeBase): THREE.Quaternion {
  const xSeed = v3(positions[base.x1]).sub(v3(positions[base.x0])).normalize();
  const yAxis = v3(positions[base.y1]).sub(v3(positions[base.y0])).normalize();
  const zAxis = new THREE.Vector3().crossVectors(xSeed, yAxis).normalize();
  const xAxis = new THREE.Vector3().crossVectors(yAxis, zAxis).normalize();
  const basis = new THREE.Matrix4().makeBasis(xAxis, yAxis, zAxis);
  return new THREE.Quaternion().setFromRotationMatrix(basis).multiply(q4(base.qAdjust)).normalize();
}

export function applyOffset(parentPos: Vec3, parentRot: Vec4, offset: Vec3, sign: 1 | -1): THREE.Vector3 {
  return v3(parentPos).add(v3(offset).multiplyScalar(sign).applyQuaternion(q4(parentRot)));
}

export function recoverOffsetSign(parentPos: Vec3, parentRot: Vec4, childPos: Vec3, offset: Vec3): 1 | -1 {
  const plus = applyOffset(parentPos, parentRot, offset, 1).distanceToSquared(v3(childPos));
  const minus = applyOffset(parentPos, parentRot, offset, -1).distanceToSquared(v3(childPos));
  return plus <= minus ? 1 : -1;
}
