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

export interface ClothFitTransform {
  position: THREE.Vector3;
  rotation: THREE.Quaternion;
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
    const x = v3(source[i]).sub(sourceCentroid);
    const y = v3(target[i]).sub(targetCentroid);
    sxx += x.x * y.x;
    sxy += x.x * y.y;
    sxz += x.x * y.z;
    syx += x.y * y.x;
    syy += x.y * y.y;
    syz += x.y * y.z;
    szx += x.z * y.x;
    szy += x.z * y.y;
    szz += x.z * y.z;
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

export function recoverClothFit(source: Vec3[], target: Vec3[], weights: number[], restCenter: Vec3): ClothFitTransform | null {
  if (!source.length || source.length !== target.length || source.length !== weights.length
    || !restCenter.every(Number.isFinite)) return null;
  const position = new THREE.Vector3();
  let totalWeight = 0;
  for (let i = 0; i < source.length; i++) {
    if (!source[i].every(Number.isFinite) || !target[i].every(Number.isFinite)
      || !Number.isFinite(weights[i]) || weights[i] < 0) return null;
    position.addScaledVector(v3(target[i]), weights[i]);
    totalWeight += weights[i];
  }
  if (totalWeight <= 0) return null;
  position.multiplyScalar(1 / totalWeight);

  const covariance = Array.from({ length: 3 }, () => [0, 0, 0]);
  const center = position.toArray();
  for (let n = 0; n < source.length; n++) {
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 3; col++) {
        covariance[row][col] += weights[n] * (target[n][row] - center[row]) * (source[n][col] - restCenter[col]);
      }
    }
  }
  const normal = Array.from({ length: 3 }, (_, row) => Array.from({ length: 3 }, (_, col) =>
    covariance.reduce((sum, values) => sum + values[row] * values[col], 0)));
  const eigenvectors = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  const epsilon = 2 ** -23;

  // The runtime uses at most six cyclic sweeps with approximate half-angle
  // rotations. Keeping this order also defines the rank-deficient fallback.
  for (let sweep = 0; sweep < 6; sweep++) {
    let rotationSquared = 0;
    for (const [i, j] of [[0, 1], [1, 2], [2, 0]]) {
      let sine = normal[i][j];
      let cosine = 2 * (normal[i][i] - normal[j][j]);
      if (cosine * cosine > 5.828427314758301 * sine * sine) {
        const inverse = 1 / Math.hypot(sine, cosine);
        sine *= inverse;
        cosine *= inverse;
      } else {
        sine = Math.sin(Math.PI / 8);
        cosine = Math.cos(Math.PI / 8);
      }
      rotationSquared += sine * sine;
      const c = cosine * cosine - sine * sine;
      const s = 2 * cosine * sine;
      for (let row = 0; row < 3; row++) {
        const a = normal[row][i], b = normal[row][j];
        normal[row][i] = c * a + s * b;
        normal[row][j] = c * b - s * a;
        const u = eigenvectors[row][i], v = eigenvectors[row][j];
        eigenvectors[row][i] = c * u + s * v;
        eigenvectors[row][j] = c * v - s * u;
      }
      for (let col = 0; col < 3; col++) {
        const a = normal[i][col], b = normal[j][col];
        normal[i][col] = c * a + s * b;
        normal[j][col] = c * b - s * a;
      }
    }
    if (rotationSquared <= epsilon) break;
  }

  const axes = [0, 1, 2].map((col) => new THREE.Vector3(...covariance.map((row) =>
    row.reduce((sum, value, k) => sum + value * eigenvectors[k][col], 0))));
  const x = normal[0][0], y = normal[1][1], z = normal[2][2];
  // Strict comparisons retain the engine's tie order for line-shaped sources.
  const order = x > y ? (y > z ? [0, 1, 2] : z > x ? [2, 0, 1] : [0, 2, 1])
    : x > z ? [1, 0, 2] : z > y ? [2, 1, 0] : [1, 2, 0];
  const [first, second, third] = order;
  if (axes[first].length() < epsilon) return { position: new THREE.Vector3(), rotation: new THREE.Quaternion() };
  axes[first].normalize();
  axes[second].addScaledVector(axes[first], -axes[second].dot(axes[first]));
  if (axes[second].length() <= epsilon) {
    const { x: a, y: b, z: c } = axes[first];
    axes[second].set(c + (1 - c) * b * b, 0, -a).normalize();
    axes[second].addScaledVector(axes[first], -axes[second].dot(axes[first]));
  }
  axes[second].normalize();
  const sign = (second - first + 3) % 3 === 1 ? 1 : -1;
  axes[third].crossVectors(axes[first], axes[second]).multiplyScalar(sign);
  const basis = new THREE.Matrix4().makeBasis(axes[0], axes[1], axes[2]);
  const rightTranspose = new THREE.Matrix4().makeBasis(
    new THREE.Vector3().fromArray(eigenvectors[0]),
    new THREE.Vector3().fromArray(eigenvectors[1]),
    new THREE.Vector3().fromArray(eigenvectors[2]),
  );
  return { position, rotation: new THREE.Quaternion().setFromRotationMatrix(basis.multiply(rightTranspose)).normalize() };
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
  const xAxis = v3(positions[base.x1]).sub(v3(positions[base.x0]));
  const yAxis = v3(positions[base.y1]).sub(v3(positions[base.y0]));
  if (yAxis.lengthSq() > 0) yAxis.normalize();
  else yAxis.set(0, 0, 1);
  xAxis.addScaledVector(yAxis, -xAxis.dot(yAxis));
  // The runtime switches to a deterministic perpendicular when the projected
  // span is at most 0.05 Source units, before normalizing that span.
  if (xAxis.length() <= 0.05) {
    xAxis.set(yAxis.z + (1 - yAxis.z) * yAxis.y ** 2, 0, -yAxis.x).normalize();
    xAxis.addScaledVector(yAxis, -xAxis.dot(yAxis));
  }
  xAxis.normalize();
  const zAxis = new THREE.Vector3().crossVectors(xAxis, yAxis);
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
