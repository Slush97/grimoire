import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { applyGoalDampedAttraction, applyRawAttraction, projectHingeLimit, projectKelagerBend, projectQuadBatch, projectRodBatch, projectTriangleBatch, quadProjectionError, reconstructClothRope, reconstructClothTwist, triangleProjectionError, type TwistNode } from './clothConstraints';
import { parseFeModel } from './feModel';
import hingeReference from './__fixtures__/cloth/source2_hinge_reference.json';
import triangleReference from './__fixtures__/cloth/source2_triangle_reference.json';
import quadReference from './__fixtures__/cloth/source2_quad_reference.json';
import goalReference from './__fixtures__/cloth/source2_goal_reference.json';
import type { ClothKelagerBend, ClothQuad, ClothRod, ClothTriangle, ClothTwist } from './feModel';

describe('compiled quad elements', () => {
  it.each(quadReference.cases)('matches the runtime reference: $name', ({ positions, batches, staticCounts, scale, relaxation, expected }) => {
    const packed = batches.map((batch) => ({
      nNode: [0, 1, 2, 3].map((vertex) => batch.map((quad) => quad.nNode[vertex])),
      f4Slack: batch.map((quad) => quad.flSlack),
      vShape: [0, 1, 2, 3].map((vertex) => [0, 1, 2].flatMap((axis) => batch.map((quad) => quad.vShape[vertex][axis]))),
      f4Weights: [0, 1, 2, 3].map((vertex) => batch.map((quad) => quad.vShape[vertex][3])),
    }));
    const model = parseFeModel({ m_CtrlName: positions.map((_, i) => String(i)), m_SimdQuads: packed,
      m_nSimdQuadCount1: staticCounts.filter((count) => count >= 1).length,
      m_nSimdQuadCount2: staticCounts.filter((count) => count === 2).length })!;
    expect(model.decodeIssues).toEqual([]);
    expect(model.featureGaps).toEqual([]);
    const nodes = positions.map((position) => ({ pos: new THREE.Vector3().fromArray(position), kinematic: false }));
    for (const batch of model.quadBatches) projectQuadBatch(nodes, batch, scale, relaxation);
    nodes.forEach((node, i) => expect(node.pos.distanceTo(new THREE.Vector3().fromArray(expected[i]))).toBeLessThan(1e-5));
  });

  it('preserves fixed and animation-owned nodes, and keeps residual measurement read-only', () => {
    const nodes = [[-1, 0, 0], [1, 0, 0], [-1, 4, 0], [1, 3, 0]].map((p, i) => ({ pos: new THREE.Vector3().fromArray(p), kinematic: i === 2 }));
    const quad: ClothQuad = { node: [0, 1, 2, 3], staticCount: 2, slack: 0,
      shape: [[-1, 0, 0, 0], [1, 0, 0, 0], [-1, 2, 0, 0.5], [1, 2, 0, 0.5]] };
    const before = nodes.map((node) => node.pos.clone());
    expect(quadProjectionError(nodes, quad)).toBeCloseTo(1);
    expect(nodes.map((node) => node.pos)).toEqual(before);
    projectQuadBatch(nodes, [quad]);
    expect(nodes.slice(0, 3).map((node) => node.pos)).toEqual(before.slice(0, 3));
    expect(nodes[3].pos.toArray()).toEqual([1, 2, 0]);
  });

  it.each([0, 1] as const)('preserves animation-owned nodes and measures partition %i without mutation', (staticCount) => {
    const nodes = [[0, 0, 0], [1, 0, 0], [1, 3, 1], [2, 2, -2]].map((p, i) => ({ pos: new THREE.Vector3().fromArray(p), kinematic: i === 2 }));
    const quad: ClothQuad = { node: [0, 1, 2, 3], staticCount, slack: 0,
      shape: [[0, 0, 0, 0], [-0.7, 2, 0.3, 0.2], [1.2, 1.6, -0.2, 0.3], [0.3, -0.2, 0.8, 0.5]] };
    const before = nodes.map((node) => node.pos.clone());
    expect(quadProjectionError(nodes, quad)).toBeGreaterThan(0);
    expect(nodes.map((node) => node.pos)).toEqual(before);
    projectQuadBatch(nodes, [quad]);
    expect(nodes[2].pos).toEqual(before[2]);
    if (staticCount === 1) expect(nodes[0].pos).toEqual(before[0]);
    expect(nodes[3].pos.distanceTo(before[3])).toBeGreaterThan(0.1);
  });
});

describe('compiled triangle elements', () => {
  it.each(triangleReference.cases)('matches the runtime reference: $name', ({ positions, batches, staticCounts, scale, expected }) => {
    const packed = batches.map((batch) => ({
      nNode: [0, 1, 2].map((axis) => batch.map((triangle) => triangle.nNode[axis])),
      w1: batch.map((triangle) => triangle.w1), w2: batch.map((triangle) => triangle.w2),
      v1x: batch.map((triangle) => triangle.v1x),
      v2: { x: batch.map((triangle) => triangle.v2[0]), y: batch.map((triangle) => triangle.v2[1]) },
    }));
    const model = parseFeModel({ m_CtrlName: positions.map((_, i) => String(i)), m_SimdTris: packed,
      m_nSimdTriCount1: staticCounts.filter((count) => count >= 1).length,
      m_nSimdTriCount2: staticCounts.filter((count) => count === 2).length })!;
    expect(model.decodeIssues).toEqual([]);
    const nodes = positions.map((position) => ({ pos: new THREE.Vector3().fromArray(position), kinematic: false }));
    for (const batch of model.triangleBatches) projectTriangleBatch(nodes, batch, scale);
    nodes.forEach((node, i) => expect(node.pos.distanceTo(new THREE.Vector3().fromArray(expected[i]))).toBeLessThan(1e-5));
  });

  it('preserves animation-owned nodes even in a dynamic partition and measures pending corrections', () => {
    const nodes = [[0, 0, 0], [4, 0, 0], [1, 3, 0]].map((p, i) => ({ pos: new THREE.Vector3().fromArray(p), kinematic: i === 0 }));
    const triangle: ClothTriangle = { node: [0, 1, 2], staticCount: 0, weight1: 0.3, weight2: 0.4, x1: 2, x2: 1, y2: 1 };
    const before = nodes.map((node) => node.pos.clone());
    expect(triangleProjectionError(nodes, triangle)).toBeGreaterThan(0.5);
    expect(nodes.map((node) => node.pos)).toEqual(before);
    projectTriangleBatch(nodes, [triangle]);
    expect(nodes[0].pos).toEqual(before[0]);
  });
});

describe('compiled hinge limits', () => {
  it.each(hingeReference.cases)('matches the runtime reference: $name', ({ positions, invMasses, hinge, expected }) => {
    const model = parseFeModel({ m_CtrlName: positions.map((_, i) => String(i)), m_HingeLimits: [hinge] })!;
    const nodes = positions.map((position, i) => ({ pos: new THREE.Vector3().fromArray(position), invMass: invMasses[i], kinematic: invMasses[i] === 0 }));
    projectHingeLimit(nodes, model.hingeLimits[0]);
    nodes.forEach((node, i) => {
      expect(node.pos.distanceTo(new THREE.Vector3().fromArray(expected[i]))).toBeLessThan(1e-6);
      if (node.kinematic) expect(node.pos.toArray()).toEqual(positions[i]);
    });
  });
});

const v = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const axisZ = v(0, 0, 1);

describe('compiled rod batches', () => {
  it('does not apply padded copies repeatedly, but preserves subsequent batches', () => {
    const nodes = [{ pos: v(0), kinematic: true }, { pos: v(10), kinematic: false }];
    const rod: ClothRod = { a: 0, b: 1, min: 2, max: 2, relax: 0.5, weight: 0 };
    projectRodBatch(nodes, [rod, rod, rod, rod]);
    expect(nodes[1].pos.x).toBe(6);
    projectRodBatch(nodes, [rod, rod, rod, rod]);
    expect(nodes[1].pos.x).toBe(4);
    expect(nodes[0].pos.x).toBe(0);
  });

  it('gathers every lane before scattering the corrected endpoints', () => {
    const nodes = [0, 4, 8].map((x) => ({ pos: v(x), kinematic: false }));
    const first: ClothRod = { a: 0, b: 1, min: 2, max: 2, relax: 1, weight: 0.5 };
    const second: ClothRod = { ...first, a: 1, b: 2 };
    projectRodBatch(nodes, [first, second]);
    // Both read the original middle position. The first rod's second endpoint
    // is scattered after the second rod's first endpoint.
    expect(nodes.map((node) => node.pos.x)).toEqual([1, 3, 7]);
  });
});

describe('compiled animation attraction', () => {
  it.each(goalReference.cases)('matches the runtime reference: $name', ({ position, previous, goal, force, vertex, expected }) => {
    const current = new THREE.Vector3().fromArray(position);
    const history = new THREE.Vector3().fromArray(previous);
    applyGoalDampedAttraction(current, history, new THREE.Vector3().fromArray(goal), force, vertex);
    expect(current.distanceTo(new THREE.Vector3().fromArray(expected.position))).toBeLessThan(2e-6);
    expect(history.distanceTo(new THREE.Vector3().fromArray(expected.previous))).toBeLessThan(2e-6);
    if (expected.position.every((value, axis) => value === position[axis])) expect(current.toArray()).toEqual(position);
  });

  it('uses force for goal displacement and vertex for velocity damping in goal mode', () => {
    const position = v(8);
    const previous = v(6);
    applyGoalDampedAttraction(position, previous, v(), 0.25, 0.5);
    expect(position.x).toBe(6);
    expect(previous.x).toBe(6);
  });

  it('can damp without pulling, and full attraction resets both history buffers', () => {
    const position = v(8);
    const previous = v(6);
    applyGoalDampedAttraction(position, previous, v(), 0, 1);
    expect(position.x).toBe(8);
    expect(previous.x).toBe(8);
    applyGoalDampedAttraction(position, previous, v(2), 1, 0);
    expect(position.x).toBe(2);
    expect(previous.x).toBe(2);
  });

  it('settles an undriven displaced particle without the preview damping floor', () => {
    const position = v(8);
    const previous = v(8);
    for (let i = 0; i < 1200; i++) {
      const velocity = position.clone().sub(previous);
      previous.copy(position);
      position.add(velocity);
      applyGoalDampedAttraction(position, previous, v(), 0.05, 0.3);
    }
    expect(position.length()).toBeLessThan(1e-8);
    expect(position.distanceTo(previous)).toBeLessThan(1e-8);
  });

  it('uses the raw position blend in both buffers with its history correction', () => {
    const position = v();
    const previous = v();
    applyRawAttraction(position, previous, v(10), 0, 30, 1 / 60);
    expect(position.x).toBe(5);
    expect(previous.x).toBe(2.5);
    // This distinguishes the raw path from the same coefficients in goal mode.
    const damped = v();
    applyGoalDampedAttraction(damped, v(), v(10), 0, 30);
    expect(damped.x).toBe(0);
  });

  it('raw force imparts velocity without translating history', () => {
    const position = v();
    const previous = v();
    applyRawAttraction(position, previous, v(10), 3, 0, 1 / 60);
    expect(position.x).toBeCloseTo(1);
    expect(previous.x).toBe(0);
  });
});

describe('Kelager bending', () => {
  const bend: ClothKelagerBend = { node: [0, 1, 2], weight: [-1, 0.5, 0.5], height0: 0 };
  const nodes = () => [v(0, 1), v(-1), v(1)].map((pos) => ({ pos, kinematic: false }));

  it('straightens a bent segment while conserving its centroid', () => {
    const points = nodes();
    projectKelagerBend(points, bend);
    for (const point of points) expect(point.pos.y).toBeCloseTo(1 / 3);
    expect(points[1].pos.distanceTo(points[2].pos)).toBeCloseTo(2);
  });

  it('leaves a bend below its authored height unchanged', () => {
    const points = nodes();
    projectKelagerBend(points, { ...bend, height0: 1 });
    expect(points.map((point) => point.pos.toArray())).toEqual([[0, 1, 0], [-1, 0, 0], [1, 0, 0]]);
  });

  it('honors a compiled share of three without moving either anchor', () => {
    const points = [
      { pos: v(), kinematic: true },
      { pos: v(-1, 1), kinematic: false },
      { pos: v(1), kinematic: true },
    ];
    projectKelagerBend(points, { ...bend, weight: [0, 3, 0] });
    expect(points.map((point) => point.pos.toArray())).toEqual([[0, 0, 0], [-1, 0, 0], [1, 0, 0]]);
  });

  it('is invariant under rigid transforms and handles a collapsed segment', () => {
    const rotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.3, -0.7, 1.2));
    const offset = v(18, -43, 12);
    const points = nodes();
    const transformed = nodes();
    transformed.forEach((point) => point.pos.applyQuaternion(rotation).add(offset));
    projectKelagerBend(points, bend);
    projectKelagerBend(transformed, bend);
    points.forEach((point, i) => {
      expect(point.pos.applyQuaternion(rotation).add(offset).distanceTo(transformed[i].pos)).toBeLessThan(1e-10);
    });
    const collapsed = [v(), v(), v()].map((pos) => ({ pos, kinematic: false }));
    projectKelagerBend(collapsed, bend);
    expect(collapsed.every((point) => point.pos.length() === 0)).toBe(true);
  });
});

describe('rope bone reconstruction', () => {
  const nodes = (): TwistNode[] => [0, 1, 2].map((x) => ({
    pos: v(0, x), initPos: [x, 0, 0], initRot: [0, 0, 0, 1],
    solvedRot: new THREE.Quaternion(), targetRot: new THREE.Quaternion(),
  }));

  it('aligns the animated X axis to each segment and copies the terminal rotation', () => {
    const points = nodes();
    points[2].pos.set(1, 1, 0);
    points[1].targetRot.setFromAxisAngle(v(1), 0.8);
    reconstructClothRope(points, [0, 1, 2], new Set([0, 1, 2]));
    expect(v(1).applyQuaternion(points[0].solvedRot).distanceTo(v(0, 1))).toBeLessThan(1e-7);
    expect(points[1].solvedRot.angleTo(points[1].targetRot)).toBeLessThan(1e-7);
    expect(points[2].solvedRot.angleTo(points[1].solvedRot)).toBeLessThan(1e-7);
    expect(points.map((point) => point.pos.toArray())).toEqual([[0, 0, 0], [0, 1, 0], [1, 1, 0]]);
  });

  it('preserves a two-node tip own animated twist and leaves rotation-locked anchors alone', () => {
    const points = nodes();
    points[1].targetRot.setFromAxisAngle(v(1), 0.8);
    reconstructClothRope(points, [0, 1], new Set([1]));
    expect(points[0].solvedRot.toArray()).toEqual([0, 0, 0, 1]);
    expect(v(1).applyQuaternion(points[1].solvedRot).distanceTo(v(0, 1))).toBeLessThan(1e-7);
    expect(v(0, 0, 1).applyQuaternion(points[1].solvedRot).z).toBeCloseTo(Math.cos(0.8));
  });

  it('recovers reversed X direction from the rest pose and keeps collapsed links finite', () => {
    const points = nodes();
    points[1].initPos = [-1, 0, 0];
    reconstructClothRope(points, [0, 1], new Set([0, 1]));
    expect(v(-1).applyQuaternion(points[0].solvedRot).distanceTo(v(0, 1))).toBeLessThan(1e-7);
    points[1].pos.copy(points[0].pos);
    reconstructClothRope(points, [0, 1], new Set([0, 1]));
    expect(points[0].solvedRot.toArray()).toEqual([0, 0, 0, 1]);
  });
});

describe('directed twist and swing reconstruction', () => {
  const link: ClothTwist = { nodeOrient: 0, nodeEnd: 1, twistRelax: 1, swingRelax: 1 };
  const nodes = (): TwistNode[] => [
    { pos: v(), initPos: [0, 0, 0], initRot: [0, 0, 0, 1], solvedRot: new THREE.Quaternion(), targetRot: new THREE.Quaternion() },
    { pos: v(0, 0, 1), initPos: [0, 0, 1], initRot: [0, 0, 0, 1], solvedRot: new THREE.Quaternion(), targetRot: new THREE.Quaternion() },
  ];

  it('orients the skinning axis toward a bent segment without moving either particle', () => {
    const points = nodes();
    points[1].pos.set(0, -1, 0);
    reconstructClothTwist(points, { ...link, twistRelax: 0 });
    expect(axisZ.clone().applyQuaternion(points[0].solvedRot).distanceTo(v(0, -1, 0))).toBeLessThan(1e-7);
    expect(points[0].pos.toArray()).toEqual([0, 0, 0]);
    expect(points[1].pos.toArray()).toEqual([0, -1, 0]);
  });

  it('transfers axial twist independently of swing', () => {
    const points = nodes();
    points[1].solvedRot.setFromAxisAngle(axisZ, Math.PI / 2);
    reconstructClothTwist(points, { ...link, swingRelax: 0 });
    expect(points[0].solvedRot.angleTo(points[1].solvedRot)).toBeLessThan(1e-7);
    expect(axisZ.clone().applyQuaternion(points[0].solvedRot).distanceTo(axisZ)).toBeLessThan(1e-7);
  });

  it('keeps a zero-weight orientation and a degenerate link finite', () => {
    const points = nodes();
    points[1].pos.set(0, -1, 0);
    reconstructClothTwist(points, { ...link, twistRelax: 0, swingRelax: 0 });
    expect(points[0].solvedRot.toArray()).toEqual([0, 0, 0, 1]);
    points[1].pos.copy(points[0].pos);
    reconstructClothTwist(points, link);
    expect(points[0].solvedRot.toArray()).toEqual([0, 0, 0, 1]);
  });

  it('relaxes combined swing and twist without normalizing the projection before blending', () => {
    const points = nodes();
    points[1].solvedRot.setFromAxisAngle(v(1), 1.2)
      .multiply(new THREE.Quaternion().setFromAxisAngle(axisZ, 0.8));
    points[1].pos.copy(axisZ).applyQuaternion(points[1].solvedRot);
    reconstructClothTwist(points, { ...link, twistRelax: 0.618, swingRelax: 0.5 });
    // Analytic result: swing 0.54081718 radians, twist 0.45818280 radians.
    const expected = new THREE.Quaternion(0.2601460571638217, -0.060662198251375664, 0.21884062134845542, 0.9384843680601453);
    expect(points[0].solvedRot.angleTo(expected)).toBeLessThan(1e-7);
  });

  it('uses the animation orientation for a self link', () => {
    const points = nodes();
    points[0].targetRot.setFromAxisAngle(axisZ, 0.7);
    reconstructClothTwist(points, { ...link, nodeEnd: 0 });
    expect(points[0].solvedRot.angleTo(points[0].targetRot)).toBeLessThan(1e-7);
  });

  it('preserves authored relative rotations under a rigidly transformed pose', () => {
    const points = nodes();
    const rotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.4, 0.8, -0.6));
    const rest0 = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.2, -0.5, 0.3));
    const rest1 = new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.8, 0.1, 1.1));
    points[0].initRot = rest0.toArray();
    points[1].initRot = rest1.toArray();
    points[0].solvedRot.copy(rotation).multiply(rest0);
    points[1].solvedRot.copy(rotation).multiply(rest1);
    points.forEach((point) => point.pos.applyQuaternion(rotation).add(v(7, 5, -9)));
    const expected = points[0].solvedRot.clone();
    reconstructClothTwist(points, { ...link, twistRelax: 0.618, swingRelax: 0.5 });
    expect(points[0].solvedRot.angleTo(expected)).toBeLessThan(1e-7);
  });
});
