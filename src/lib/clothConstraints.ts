import * as THREE from 'three';
import type { ClothHingeLimit, ClothKelagerBend, ClothQuad, ClothRod, ClothTriangle, ClothTwist, Vec3, Vec4 } from './feModel';

// Compiled coefficients, not authoring strengths. See docs/source2-preview-physics.md.
const unit = (value: number) => Number.isFinite(value) ? THREE.MathUtils.clamp(value, 0, 1) : 0;
const _delta = new THREE.Vector3();

export function applyGoalDampedAttraction(
  position: THREE.Vector3,
  previous: THREE.Vector3,
  goal: THREE.Vector3,
  force: number,
  vertex: number,
): void {
  const attraction = unit(force);
  if (attraction > Math.fround(0.9999)) {
    position.copy(goal);
    previous.copy(goal);
    return;
  }
  if (attraction >= 2 ** -23) position.lerp(goal, attraction);
  previous.lerp(position, unit(vertex));
}

export function applyRawAttraction(
  position: THREE.Vector3,
  previous: THREE.Vector3,
  goal: THREE.Vector3,
  force: number,
  vertex: number,
  dt: number,
): void {
  const p = unit(vertex * dt);
  const f = Number.isFinite(force) ? Math.max(0, force) * dt * 2 : 0;
  _delta.copy(goal).sub(position);
  previous.addScaledVector(_delta, p * (1 - p));
  position.addScaledVector(_delta, p + f);
}

interface BendNode {
  pos: THREE.Vector3;
  kinematic: boolean;
}

const _rodA = Array.from({ length: 4 }, () => new THREE.Vector3());
const _rodB = Array.from({ length: 4 }, () => new THREE.Vector3());

export function projectRodBatch(nodes: readonly BendNode[], rods: readonly ClothRod[]): void {
  // The compiled block gathers four lanes, computes them from the same pose,
  // then scatters all first endpoints followed by all second endpoints. Padding
  // lanes can repeat a rod; applying those sequentially adds unwanted stiffness.
  for (let lane = 0; lane < rods.length; lane++) {
    const rod = rods[lane];
    const a = nodes[rod.a];
    const b = nodes[rod.b];
    _delta.subVectors(b.pos, a.pos);
    const distance = Math.sqrt(Math.max(_delta.lengthSq(), 2 ** -30));
    const wanted = THREE.MathUtils.clamp(distance, rod.min, rod.max);
    _delta.multiplyScalar((distance - wanted) / distance * rod.relax);
    _rodA[lane].copy(a.pos).addScaledVector(_delta, rod.weight);
    _rodB[lane].copy(b.pos).addScaledVector(_delta, rod.weight - 1);
  }
  for (let lane = 0; lane < rods.length; lane++) {
    const a = nodes[rods[lane].a];
    if (!a.kinematic) a.pos.copy(_rodA[lane]);
  }
  for (let lane = 0; lane < rods.length; lane++) {
    const b = nodes[rods[lane].b];
    if (!b.kinematic) b.pos.copy(_rodB[lane]);
  }
}

const _triangleX = new THREE.Vector3();
const _triangleY = new THREE.Vector3();
const _triangleOrigin = new THREE.Vector3();
const _triangleOutput = Array.from({ length: 4 }, () => Array.from({ length: 3 }, () => new THREE.Vector3()));

function triangleProjection(nodes: readonly BendNode[], triangle: ClothTriangle, output: THREE.Vector3[], scale: number): void {
  const a = nodes[triangle.node[0]].pos;
  const b = nodes[triangle.node[1]].pos;
  const c = nodes[triangle.node[2]].pos;
  _triangleX.subVectors(b, a);
  const length = _triangleX.lengthSq() > 2 ** -23 ? _triangleX.length() : 1;
  if (_triangleX.lengthSq() > 2 ** -23) _triangleX.multiplyScalar(1 / length);
  else _triangleX.set(1, 0, 0);
  _triangleY.subVectors(c, a);
  const projection = _triangleY.dot(_triangleX);
  _triangleY.addScaledVector(_triangleX, -projection);
  const height = _triangleY.lengthSq() > 2 ** -23 ? _triangleY.length() : 1;
  if (_triangleY.lengthSq() > 2 ** -23) _triangleY.multiplyScalar(1 / height);
  else _triangleY.set(0, 1, 0);

  const { x1, x2, y2, weight1: w1, weight2: w2 } = triangle;
  if (triangle.staticCount === 2) {
    output[0].copy(a);
    output[1].copy(b);
    output[2].copy(a).addScaledVector(_triangleX, ((length - x1) * 0.5 + x2) * scale)
      .addScaledVector(_triangleY, y2 * scale);
    return;
  }

  const centerX = triangle.staticCount === 0 ? w1 * length + w2 * projection : 0;
  const centerY = triangle.staticCount === 0 ? w2 * height : 0;
  const restX = triangle.staticCount === 0 ? (w1 * x1 + w2 * x2) * scale : 0;
  const restY = triangle.staticCount === 0 ? w2 * y2 * scale : 0;
  let cosine: number;
  let sine: number;
  if (triangle.staticCount === 1) {
    cosine = length * x1 * w1 + (height * y2 + projection * x2) * w2;
    sine = (height * x2 - projection * y2) * w2;
  } else {
    // Weighted 2D rigid fit in the current triangle plane. These are compiled
    // normalized mass shares; substituting inverse masses changes the fit.
    const w0 = 1 - w1 - w2;
    const bx = x1 * scale - restX;
    const cx = x2 * scale - restX;
    const cy = y2 * scale - restY;
    cosine = w0 * (centerX * restX + centerY * restY)
      + w1 * ((length - centerX) * bx + centerY * restY)
      + w2 * ((projection - centerX) * cx + (height - centerY) * cy);
    sine = w0 * (centerY * restX - centerX * restY)
      + w1 * (-centerY * bx + (length - centerX) * restY)
      + w2 * ((height - centerY) * cx - (projection - centerX) * cy);
  }
  const squared = cosine * cosine + sine * sine;
  if (squared > 1e-14) {
    const inverse = 1 / Math.sqrt(squared);
    cosine *= inverse;
    sine *= inverse;
  } else {
    cosine = 1;
    sine = 0;
  }
  _triangleOrigin.copy(a)
    .addScaledVector(_triangleX, centerX - (restX * cosine - restY * sine))
    .addScaledVector(_triangleY, centerY - (restX * sine + restY * cosine));
  output[0].copy(_triangleOrigin);
  output[1].copy(_triangleOrigin).addScaledVector(_triangleX, x1 * scale * cosine)
    .addScaledVector(_triangleY, x1 * scale * sine);
  output[2].copy(_triangleOrigin).addScaledVector(_triangleX, (x2 * cosine - y2 * sine) * scale)
    .addScaledVector(_triangleY, (x2 * sine + y2 * cosine) * scale);
}

export function projectTriangleBatch(nodes: readonly BendNode[], triangles: readonly ClothTriangle[], scale = 1): void {
  for (let lane = 0; lane < triangles.length; lane++) triangleProjection(nodes, triangles[lane], _triangleOutput[lane], scale);
  // Preserve compiled gather/scatter ordering even when lanes share a node.
  for (let vertex = 0; vertex < 3; vertex++) {
    for (let lane = 0; lane < triangles.length; lane++) {
      const triangle = triangles[lane];
      const node = nodes[triangle.node[vertex]];
      if (vertex >= triangle.staticCount && !node.kinematic) node.pos.copy(_triangleOutput[lane][vertex]);
    }
  }
}

export function triangleProjectionError(nodes: readonly BendNode[], triangle: ClothTriangle): number {
  triangleProjection(nodes, triangle, _triangleOutput[0], 1);
  let error = 0;
  for (let vertex = triangle.staticCount; vertex < 3; vertex++) {
    const node = nodes[triangle.node[vertex]];
    if (!node.kinematic) error = Math.max(error, node.pos.distanceTo(_triangleOutput[0][vertex]));
  }
  return error;
}

const _quadX = new THREE.Vector3();
const _quadY = new THREE.Vector3();
const _quadZ = new THREE.Vector3();
const _quadCenter = new THREE.Vector3();
const _quadOffset = new THREE.Vector3();
const _quadLive = Array.from({ length: 4 }, () => new THREE.Vector3());
const _quadShape = Array.from({ length: 4 }, () => new THREE.Vector3());
const _quadTorque = new THREE.Vector3();
const _quadRotation = new THREE.Vector3();
const _quadOutput = Array.from({ length: 4 }, () => Array.from({ length: 4 }, () => new THREE.Vector3()));

function orthonormalizeQuadBasis(): void {
  if (_quadX.lengthSq() >= 2 ** -23) _quadX.normalize();
  else _quadX.set(1, 0, 0);
  _quadY.addScaledVector(_quadX, -_quadY.dot(_quadX));
  if (_quadY.lengthSq() < 2 ** -23) {
    if (Math.abs(_quadX.x) > Math.abs(_quadX.z)) _quadY.set(-_quadX.y, _quadX.x, 0);
    else _quadY.set(0, -_quadX.z, _quadX.y);
  }
  _quadY.normalize();
  _quadZ.crossVectors(_quadX, _quadY);
}

function anchoredQuadProjection(nodes: readonly BendNode[], quad: ClothQuad, output: THREE.Vector3[], scale: number): void {
  const a = nodes[quad.node[0]].pos;
  const b = nodes[quad.node[1]].pos;
  const c = nodes[quad.node[2]].pos;
  const d = nodes[quad.node[3]].pos;
  _quadCenter.addVectors(a, b).multiplyScalar(0.5);
  _quadX.subVectors(b, a);
  _quadY.addVectors(c, d).addScaledVector(_quadCenter, -2);
  orthonormalizeQuadBasis();

  // The two fixed corners define the axis and midpoint. Fit the movable
  // corners' compiled Y/Z shape about that axis using their mass shares.
  let cosine = 0;
  let sine = 0;
  for (let vertex = 2; vertex < 4; vertex++) {
    _quadOffset.subVectors(nodes[quad.node[vertex]].pos, _quadCenter);
    const y = _quadOffset.dot(_quadY);
    const z = _quadOffset.dot(_quadZ);
    const [, sy, sz, weight] = quad.shape[vertex];
    cosine += weight * (sy * y + sz * z);
    sine += weight * (sz * y - sy * z);
  }
  const squared = cosine * cosine + sine * sine;
  if (squared > 2 ** -23) {
    const inverse = 1 / Math.sqrt(squared);
    cosine *= inverse;
    sine *= inverse;
  } else {
    cosine = 1;
    sine = 0;
  }
  for (let vertex = 2; vertex < 4; vertex++) {
    const [x, y, z] = quad.shape[vertex];
    output[vertex].copy(_quadCenter).addScaledVector(_quadX, x * scale)
      .addScaledVector(_quadY, (y * cosine + z * sine) * scale)
      .addScaledVector(_quadZ, (z * cosine - y * sine) * scale);
  }
}

function movableQuadProjection(nodes: readonly BendNode[], quad: ClothQuad, output: THREE.Vector3[], scale: number, relaxation: number): void {
  const fixed = quad.staticCount;
  _quadX.subVectors(nodes[quad.node[2]].pos, nodes[quad.node[0]].pos);
  _quadY.subVectors(nodes[quad.node[3]].pos, nodes[quad.node[1]].pos);
  orthonormalizeQuadBasis();
  _quadCenter.set(0, 0, 0);
  if (fixed === 1) _quadCenter.copy(nodes[quad.node[0]].pos);
  else for (let i = 0; i < 4; i++) _quadCenter.addScaledVector(nodes[quad.node[i]].pos, quad.shape[i][3]);

  let xx = 0, yy = 0, zz = 0, xy = 0, xz = 0, yz = 0;
  _quadTorque.set(0, 0, 0);
  for (let i = fixed; i < 4; i++) {
    const [sx, sy, sz, weight] = quad.shape[i];
    const live = _quadLive[i].subVectors(nodes[quad.node[i]].pos, _quadCenter);
    const shape = _quadShape[i].copy(_quadX).multiplyScalar(sx * scale)
      .addScaledVector(_quadY, sy * scale).addScaledVector(_quadZ, sz * scale);
    const { x, y, z } = live;
    xx += weight * (y * y + z * z);
    yy += weight * (x * x + z * z);
    zz += weight * (x * x + y * y);
    xy -= weight * x * y;
    xz -= weight * x * z;
    yz -= weight * y * z;
    _quadTorque.addScaledVector(_quadOffset.crossVectors(live, shape), weight);
  }

  // One linearized angular fit, using the live inertia tensor. The compiled
  // kernel masks singular Cholesky solves to zero angular correction.
  const inverseX = 1 / Math.sqrt(xx);
  const l10 = xy * inverseX;
  const l20 = xz * inverseX;
  const inverseY = 1 / Math.sqrt(yy - l10 * l10);
  const l21 = (yz - l10 * l20) * inverseY;
  const inverseZ = 1 / Math.sqrt(zz - l20 * l20 - l21 * l21);
  _quadRotation.set(0, 0, 0);
  if (inverseX + inverseY + inverseZ < 1e7) {
    let x = _quadTorque.x * inverseX;
    let y = (_quadTorque.y - l10 * x) * inverseY;
    const z = (_quadTorque.z - l20 * x - l21 * y) * inverseZ * inverseZ;
    y = (y - l21 * z) * inverseY;
    x = (x - l20 * z - l10 * y) * inverseX;
    _quadRotation.set(x, y, z);
  }
  for (let i = fixed; i < 4; i++) {
    const projected = output[i].copy(_quadShape[i]).sub(_quadOffset.crossVectors(_quadRotation, _quadShape[i]));
    if (fixed === 0) projected.multiplyScalar(relaxation).addScaledVector(_quadLive[i], 1 - relaxation);
    projected.add(_quadCenter);
  }
}

export function projectQuadBatch(nodes: readonly BendNode[], quads: readonly ClothQuad[], scale = 1, relaxation = 1): void {
  for (let lane = 0; lane < quads.length; lane++) {
    if (quads[lane].staticCount === 2) anchoredQuadProjection(nodes, quads[lane], _quadOutput[lane], scale);
    else movableQuadProjection(nodes, quads[lane], _quadOutput[lane], scale, relaxation);
  }
  for (let vertex = 0; vertex < 4; vertex++) {
    for (let lane = 0; lane < quads.length; lane++) {
      const quad = quads[lane];
      const node = nodes[quad.node[vertex]];
      if (vertex >= quad.staticCount && !node.kinematic) node.pos.copy(_quadOutput[lane][vertex]);
    }
  }
}

export function quadProjectionError(nodes: readonly BendNode[], quad: ClothQuad): number {
  if (quad.staticCount === 2) anchoredQuadProjection(nodes, quad, _quadOutput[0], 1);
  else movableQuadProjection(nodes, quad, _quadOutput[0], 1, 1);
  let error = 0;
  for (let vertex = quad.staticCount; vertex < 4; vertex++) {
    const node = nodes[quad.node[vertex]];
    if (!node.kinematic) error = Math.max(error, node.pos.distanceTo(_quadOutput[0][vertex]));
  }
  return error;
}

export function projectKelagerBend(nodes: readonly BendNode[], bend: ClothKelagerBend): void {
  const a = nodes[bend.node[0]];
  const b = nodes[bend.node[1]];
  const c = nodes[bend.node[2]];
  if (!a || !b || !c) return;
  _delta.copy(a.pos).multiplyScalar(2).sub(b.pos).sub(c.pos).multiplyScalar(1 / 3);
  const height = _delta.length();
  if (height <= bend.height0 || height < 1e-12) return;
  _delta.multiplyScalar(1 - bend.height0 / height);
  // Signed shares already include the compiler's mass weighting.
  if (!a.kinematic) a.pos.addScaledVector(_delta, bend.weight[0]);
  if (!b.kinematic) b.pos.addScaledVector(_delta, bend.weight[1]);
  if (!c.kinematic) c.pos.addScaledVector(_delta, bend.weight[2]);
}

const _hingePoints = Array.from({ length: 4 }, () => new THREE.Vector3());
const _hingeGradients = Array.from({ length: 4 }, () => new THREE.Vector3());
const _hingeDeltas = Array.from({ length: 4 }, () => new THREE.Vector3());
const _hingeAxis = new THREE.Vector3();
const _hingeReference = new THREE.Vector3();
const _hingeArm = new THREE.Vector3();
const _hingePerpendicular = new THREE.Vector3();
const _hingeMasses = [0, 0, 0, 0];

function readHingePoints(nodes: readonly BendNode[], hinge: ClothHingeLimit): void {
  for (let i = 0; i < 4; i++) _hingePoints[i].copy(nodes[hinge.node[i]].pos);
  _hingePoints[2].lerp(nodes[hinge.node[4]].pos, hinge.weight4);
  _hingePoints[3].lerp(nodes[hinge.node[5]].pos, hinge.weight5);
}

function hingeGeometry(center: number): { error: number; valid: boolean } {
  const [a, b, reference, arm] = _hingePoints;
  _hingeAxis.subVectors(b, a);
  const length = _hingeAxis.length();
  _hingeAxis.normalize();
  _hingeReference.subVectors(reference, a);
  _hingeArm.subVectors(arm, a);
  const referenceHeight = _hingeReference.dot(_hingeAxis);
  const armHeight = _hingeArm.dot(_hingeAxis);
  _hingeReference.addScaledVector(_hingeAxis, -referenceHeight);
  _hingeArm.addScaledVector(_hingeAxis, -armHeight);
  const referenceRadius = _hingeReference.length();
  const armRadius = _hingeArm.length();
  if (length < 0.01 || referenceRadius < 0.01 || armRadius < 0.01) return { error: 0, valid: false };
  _hingeReference.multiplyScalar(1 / referenceRadius);
  _hingeArm.multiplyScalar(1 / armRadius);
  _hingePerpendicular.crossVectors(_hingeAxis, _hingeReference);
  const cosine = _hingeReference.dot(_hingeArm);
  const sine = _hingePerpendicular.dot(_hingeArm);
  let error = Math.atan2(sine, cosine) - center;
  if (error > Math.PI) error -= Math.PI * 2;
  else if (error < -Math.PI) error += Math.PI * 2;
  const [g0, g1, g2, g3] = _hingeGradients;
  g2.copy(_hingePerpendicular).multiplyScalar(-1 / referenceRadius);
  g3.copy(_hingePerpendicular).multiplyScalar(cosine).addScaledVector(_hingeReference, -sine).multiplyScalar(1 / armRadius);
  g1.copy(g2).multiplyScalar(-referenceHeight / length).addScaledVector(g3, -armHeight / length);
  g0.copy(g1).add(g2).add(g3).negate();
  return { error, valid: true };
}

export function projectHingeLimit(nodes: readonly (BendNode & { invMass: number })[], hinge: ClothHingeLimit): void {
  readHingePoints(nodes, hinge);
  for (let i = 0; i < 4; i++) _hingeMasses[i] = nodes[hinge.node[i]].invMass;
  _hingeMasses[2] *= 1 - hinge.weight4;
  _hingeMasses[3] *= 1 - hinge.weight5;
  let geometry = hingeGeometry(hinge.center);
  const tolerance = Math.PI / 180;
  if (!geometry.valid || Math.abs(geometry.error) <= hinge.extents + tolerance) return;
  const target = Math.sign(geometry.error) * hinge.extents;
  for (let iteration = 0; iteration < 5; iteration++) {
    if (!geometry.valid) return;
    const correction = target - geometry.error;
    const denominator = _hingeGradients.reduce((sum, gradient, i) => sum + _hingeMasses[i] * gradient.lengthSq(), 0);
    if (denominator < 2 ** -23) return;
    const scale = THREE.MathUtils.clamp(correction, -Math.PI / 4, Math.PI / 4) / denominator;
    for (let i = 0; i < 4; i++) {
      _hingeDeltas[i].copy(_hingeGradients[i]).multiplyScalar(_hingeMasses[i] * scale);
      _hingePoints[i].add(_hingeDeltas[i]);
    }
    if (Math.abs(correction) < Math.PI / 45) break;
    geometry = hingeGeometry(hinge.center);
    if (Math.abs(geometry.error - target) <= tolerance) break;
  }
  for (let i = 0; i < 4; i++) {
    if (_hingeMasses[i] <= 0) continue;
    const node = nodes[hinge.node[i]];
    const weight = i === 2 ? hinge.weight4 : i === 3 ? hinge.weight5 : 0;
    if (weight === 0) {
      if (!node.kinematic) node.pos.copy(_hingePoints[i]);
    } else {
      // The compiled scatter uses the last correction for blended references.
      if (!node.kinematic) node.pos.addScaledVector(_hingeDeltas[i], weight / (1 - weight));
      const other = nodes[hinge.node[i + 2]];
      if (!other.kinematic) other.pos.addScaledVector(_hingeDeltas[i], (1 - weight) / weight);
    }
  }
}

/** Angular excess in radians, or null when the hinge geometry has collapsed. */
export function hingeLimitExcess(nodes: readonly BendNode[], hinge: ClothHingeLimit): number | null {
  readHingePoints(nodes, hinge);
  const geometry = hingeGeometry(hinge.center);
  return geometry.valid ? Math.max(0, Math.abs(geometry.error) - hinge.extents) : null;
}

export interface TwistNode {
  pos: THREE.Vector3;
  initPos: Vec3;
  initRot: Vec4;
  solvedRot: THREE.Quaternion;
  targetRot: THREE.Quaternion;
}

const _axis = new THREE.Vector3();
const _direction = new THREE.Vector3();
const _restEnd = new THREE.Quaternion();
const _restOrient = new THREE.Quaternion();
const _desired = new THREE.Quaternion();
const _align = new THREE.Quaternion();
const _error = new THREE.Quaternion();
const _twist = new THREE.Quaternion();
const _swing = new THREE.Quaternion();
const _weightedTwist = new THREE.Quaternion();

/** Orient an ordered rope from its animated X axes and solved segment directions. */
export function reconstructClothRope(
  nodes: readonly TwistNode[],
  chain: readonly number[],
  rotationNodes: ReadonlySet<number>,
): void {
  if (chain.length < 2) return;
  const first = nodes[chain[0]];
  const second = nodes[chain[1]];
  _axis.set(1, 0, 0).applyQuaternion(_restOrient.fromArray(first.initRot).normalize());
  _direction.fromArray(second.initPos).sub(_delta.fromArray(first.initPos));
  const sign = _axis.dot(_direction) < 0 ? -1 : 1;

  for (let i = 0; i < chain.length; i++) {
    if (!rotationNodes.has(chain[i])) continue;
    const node = nodes[chain[i]];
    if (i === chain.length - 1 && chain.length > 2) {
      node.solvedRot.copy(nodes[chain[i - 1]].solvedRot);
      continue;
    }
    const start = Math.min(i, chain.length - 2);
    _direction.copy(nodes[chain[start + 1]].pos).sub(nodes[chain[start]].pos).multiplyScalar(sign);
    // Collapsed links keep their animated orientation, including two-node tips.
    node.solvedRot.copy(node.targetRot);
    if (_direction.lengthSq() <= 0.03 * 0.03) continue;
    _axis.set(1, 0, 0).applyQuaternion(node.targetRot).normalize();
    _align.setFromUnitVectors(_axis, _direction.normalize());
    node.solvedRot.premultiply(_align).normalize();
  }
}

function blendIdentity(q: THREE.Quaternion, amount: number): THREE.Quaternion {
  return q.set(q.x * amount, q.y * amount, q.z * amount, 1 + (q.w - 1) * amount).normalize();
}

/** Reconstruct one directed link, preserving the authored local axis and rest twist. */
export function reconstructClothTwist(nodes: readonly TwistNode[], link: ClothTwist): void {
  const node = nodes[link.nodeOrient];
  const end = nodes[link.nodeEnd];
  if (!node || !end) return;
  if (node === end) {
    _axis.set(0, 0, 0);
    _desired.copy(node.targetRot);
  } else {
    _axis.fromArray(end.initPos).sub(_direction.fromArray(node.initPos));
    _direction.copy(end.pos).sub(node.pos);
    if (_axis.lengthSq() < 1e-12 || _direction.lengthSq() < 1e-12) return;
    _restOrient.fromArray(node.initRot).normalize();
    _restEnd.fromArray(end.initRot).normalize();
    _axis.normalize().applyQuaternion(_restOrient.clone().invert());
    _desired.copy(end.solvedRot).multiply(_restEnd.invert()).multiply(_restOrient).normalize();
    _direction.normalize().applyQuaternion(_desired.clone().invert());
    _align.setFromUnitVectors(_axis, _direction);
    _desired.multiply(_align).normalize();
  }
  if (node.solvedRot.dot(_desired) < 0) {
    _desired.set(-_desired.x, -_desired.y, -_desired.z, -_desired.w);
  }
  const twist = unit(link.twistRelax);
  const swing = unit(link.swingRelax);
  if (twist === swing) {
    node.solvedRot.set(
      THREE.MathUtils.lerp(node.solvedRot.x, _desired.x, twist),
      THREE.MathUtils.lerp(node.solvedRot.y, _desired.y, twist),
      THREE.MathUtils.lerp(node.solvedRot.z, _desired.z, twist),
      THREE.MathUtils.lerp(node.solvedRot.w, _desired.w, twist),
    ).normalize();
    return;
  }
  _error.copy(node.solvedRot).invert().multiply(_desired);
  const along = _error.x * _axis.x + _error.y * _axis.y + _error.z * _axis.z;
  _twist.set(_axis.x * along, _axis.y * along, _axis.z * along, _error.w);
  // The compiled relaxation blends the unnormalized twist projection.
  blendIdentity(_weightedTwist.copy(_twist), twist);
  _swing.copy(_error).multiply(_twist.conjugate());
  blendIdentity(_swing, swing);
  node.solvedRot.multiply(_swing.multiply(_weightedTwist)).normalize();
}
