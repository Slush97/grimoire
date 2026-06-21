import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import type { ClothModel } from './feModel';
import {
  applyDrivenReconstructions,
  applyFitMatrixReconstructions,
  animationAttraction,
  applyReverseOffsetReconstructions,
  buildFitMatrixReconstructions,
  closestPointOnSegment,
  clothAnchorMap,
  DEFAULT_CLOTH_SUBSTEPS,
  effectiveNodeGravity,
  fitMatrixDrivenNodeSet,
  fitMatrixTargetNode,
  fixedClothSubsteps,
  freeSimNodeSet,
  isFreeSimNode,
  isKinematicNode,
  isPositionDrivenNode,
  jiggleDrivenNodeSet,
  orderBonesParentFirst,
  projectCollisionPlane,
  projectAnimStrayRadius,
  pushOutsideBox,
  pushOutsideCapsule,
  reconstructReverseOffsetPosition,
  reverseOffsetDrivenNodeSet,
  rigidAnchorSeed,
  restoreBoneBindTransform,
  restorePinnedSolverNodes,
  rodCorrectionShares,
  setBoneWorldPosition,
  solverIterationPhases,
  verletVelocityScale,
} from './useClothSim';

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const Q = (x = 0, y = 0, z = 0) => new THREE.Quaternion().setFromEuler(new THREE.Euler(x, y, z));
const jiggleParams = {} as NonNullable<Parameters<typeof jiggleDrivenNodeSet>[0]['jiggleBones'][number]['params']>;
const simNode = (invMass: number): ClothModel['nodes'][number] => ({
  name: '',
  invMass,
  pinned: invMass <= 0,
  gravity: 0,
  damping: 0,
  animForce: 0,
  animVertex: 0,
  initPos: [0, 0, 0],
  initRot: [0, 0, 0, 1],
  collideRadius: 0,
  friction: 0,
  collisionMask: 0xffff,
});

describe('pushOutsideCapsule', () => {
  it('pushes a point inside a sphere out to the surface', () => {
    const p = V(1, 0, 0);
    const hit = pushOutsideCapsule(p, { a: V(0, 0, 0), b: V(0, 0, 0), ra: 5, rb: 5 }, 0);
    expect(hit).toBe(true);
    expect(p.length()).toBeCloseTo(5, 4);
  });

  it('leaves a point outside untouched', () => {
    const p = V(20, 0, 0);
    const hit = pushOutsideCapsule(p, { a: V(0, 0, 0), b: V(0, 0, 0), ra: 5, rb: 5 }, 0);
    expect(hit).toBe(false);
    expect(p.x).toBe(20);
  });

  it('adds the particle radius to the collider radius', () => {
    const p = V(5, 0, 0);
    pushOutsideCapsule(p, { a: V(0, 0, 0), b: V(0, 0, 0), ra: 5, rb: 5 }, 1);
    expect(p.length()).toBeCloseTo(6, 4); // 5 (collider) + 1 (particle)
  });

  it('uses the tapered radius along a capsule', () => {
    // segment x in [0,10], radius 1 at a -> 5 at b. midpoint radius is 3.
    // point off-axis (y=1) so there's a push direction.
    const p = V(5, 1, 0);
    pushOutsideCapsule(p, { a: V(0, 0, 0), b: V(10, 0, 0), ra: 1, rb: 5 }, 0);
    expect(Math.hypot(p.y, p.z)).toBeCloseTo(3, 4);
    expect(p.x).toBeCloseTo(5, 4);
  });

  it('bails (no NaN) on a point exactly on the centerline', () => {
    // measure-zero degenerate: no escape direction. Returns false, leaves p put;
    // next frame's gravity nudges it off-axis. ponytail: not worth a special case.
    const p = V(5, 0, 0);
    const hit = pushOutsideCapsule(p, { a: V(0, 0, 0), b: V(10, 0, 0), ra: 1, rb: 5 }, 0);
    expect(hit).toBe(false);
    expect(Number.isNaN(p.y)).toBe(false);
  });
});

describe('closestPointOnSegment', () => {
  it('clamps to the start endpoint', () => {
    const out = V(0, 0, 0);
    const { t } = closestPointOnSegment(V(-3, 0, 0), V(0, 0, 0), V(10, 0, 0), out);
    expect(t).toBe(0);
    expect(out.equals(V(0, 0, 0))).toBe(true);
  });

  it('projects onto the interior', () => {
    const out = V(0, 0, 0);
    const { t } = closestPointOnSegment(V(4, 2, 0), V(0, 0, 0), V(10, 0, 0), out);
    expect(t).toBeCloseTo(0.4, 4);
    expect(out.equals(V(4, 0, 0))).toBe(true);
  });
});

describe('pushOutsideBox', () => {
  it('pushes a point inside an axis-aligned box to the nearest face', () => {
    const p = V(1.5, 0, 0);
    const hit = pushOutsideBox(p, { center: V(0, 0, 0), rotation: Q(), halfSize: V(2, 3, 4) }, 0);
    expect(hit).toBe(true);
    expect(p.equals(V(2, 0, 0))).toBe(true);
  });

  it('leaves a point outside the box and particle shell untouched', () => {
    const p = V(5, 0, 0);
    const hit = pushOutsideBox(p, { center: V(0, 0, 0), rotation: Q(), halfSize: V(2, 3, 4) }, 1);
    expect(hit).toBe(false);
    expect(p.equals(V(5, 0, 0))).toBe(true);
  });

  it('adds the particle radius outside a box face', () => {
    const p = V(2.5, 0, 0);
    const hit = pushOutsideBox(p, { center: V(0, 0, 0), rotation: Q(), halfSize: V(2, 3, 4) }, 1);
    expect(hit).toBe(true);
    expect(p.equals(V(3, 0, 0))).toBe(true);
  });

  it('uses the oriented box frame for the push direction', () => {
    const p = V(0, 0.5, 0);
    const hit = pushOutsideBox(
      p,
      { center: V(0, 0, 0), rotation: Q(0, 0, Math.PI / 2), halfSize: V(1, 3, 4) },
      0,
    );
    expect(hit).toBe(true);
    expect(p.x).toBeCloseTo(0, 4);
    expect(p.y).toBeCloseTo(1, 4);
    expect(p.z).toBeCloseTo(0, 4);
  });
});

describe('restoreBoneBindTransform', () => {
  it('restores position, rotation, and scale before target sampling', () => {
    const bone = new THREE.Bone();
    const bindPosition = V(1, 2, 3);
    const bindQuaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.2, 0.4, 0.6));
    const bindScale = V(2, 3, 4);

    bone.position.set(10, 20, 30);
    bone.quaternion.setFromEuler(new THREE.Euler(1, 1, 1));
    bone.scale.set(5, 6, 7);

    restoreBoneBindTransform(bone, bindPosition, bindQuaternion, bindScale);

    expect(bone.position.equals(bindPosition)).toBe(true);
    expect(bone.quaternion.angleTo(bindQuaternion)).toBeCloseTo(0, 6);
    expect(bone.scale.equals(bindScale)).toBe(true);
  });
});

describe('setBoneWorldPosition', () => {
  it('uses the parent bone latest local transform when writing a child', () => {
    const root = new THREE.Group();
    const parent = new THREE.Bone();
    const child = new THREE.Bone();
    root.add(parent);
    parent.add(child);
    root.updateWorldMatrix(true, true);

    setBoneWorldPosition(parent, V(5, 0, 0));
    setBoneWorldPosition(child, V(7, 0, 0));
    root.updateWorldMatrix(true, true);

    expect(parent.getWorldPosition(new THREE.Vector3()).equals(V(5, 0, 0))).toBe(true);
    expect(child.position.equals(V(2, 0, 0))).toBe(true);
    expect(child.getWorldPosition(new THREE.Vector3()).equals(V(7, 0, 0))).toBe(true);
  });
});

describe('orderBonesParentFirst', () => {
  it('orders rotation writes from parent to child', () => {
    const root = new THREE.Group();
    const parent = new THREE.Bone();
    const child = new THREE.Bone();
    const grandchild = new THREE.Bone();
    root.add(parent);
    parent.add(child);
    child.add(grandchild);

    const ordered = orderBonesParentFirst([
      [grandchild, 'grandchild'],
      [child, 'child'],
      [parent, 'parent'],
    ]);

    expect(ordered.map(([, name]) => name)).toEqual(['parent', 'child', 'grandchild']);
  });
});

describe('effectiveNodeGravity', () => {
  it('uses defaultGravityScale as a global multiplier for authored gravity', () => {
    expect(effectiveNodeGravity(180, 1.5)).toBe(270);
  });

  it('honors an authored zero gravity verbatim (no 360 fallback)', () => {
    // Position-driven bones (Dynamo bag_main, Celeste hair tresses, ...) are authored
    // flGravity=0 on purpose. The old code substituted 360 here, free-falling them into
    // an orbit. Zero must stay zero -- this is the regression guard for that bug.
    expect(effectiveNodeGravity(0, 1.5)).toBe(0);
    expect(effectiveNodeGravity(0, 1.1)).toBe(0);
  });

  it('allows a zero global scale to disable gravity', () => {
    expect(effectiveNodeGravity(360, 0)).toBe(0);
  });
});

describe('animationAttraction', () => {
  it('splits attraction into a position blend and a velocity impulse (engine convars 1 and 2)', () => {
    // CSoftbody::AddAnimationAttraction: posBlend = min(1, vertexAttr*dt*1),
    // velImpulse = forceAttr*dt*2. At 60fps this is a small per-frame nudge toward goal.
    const dt = 1 / 60;
    expect(animationAttraction(0.6, 0.3, dt)).toEqual({
      posBlend: 0.6 * dt,
      velImpulse: 0.3 * dt * 2,
    });
  });

  it('runs even with no force attraction so a zero-gravity bone still tracks the body', () => {
    // Dynamo bag_main has flGravity=0; only attraction keeps it on the hero. The old
    // animForce*dt^2 form gated behind goalIterations=0 left it with neither force.
    const a = animationAttraction(0.5, 0, 1 / 60);
    expect(a.posBlend).toBeGreaterThan(0);
    expect(a.velImpulse).toBe(0);
  });

  it('clamps the position blend to 1 and ignores negative authored values', () => {
    expect(animationAttraction(1000, 0, 1).posBlend).toBe(1);
    expect(animationAttraction(-5, -5, 1 / 60)).toEqual({ posBlend: 0, velImpulse: 0 });
  });
});

describe('solverIterationPhases', () => {
  it('keeps constraint and goal iterations as separate authored phases', () => {
    expect(solverIterationPhases({ extraIterations: 18, extraGoalIterations: 12 })).toEqual({
      goalIterations: 12,
      constraintIterations: 18,
    });
  });

  it('uses the iteration override only for the constraint phase', () => {
    expect(solverIterationPhases({ extraIterations: 18, extraGoalIterations: 12 }, 5)).toEqual({
      goalIterations: 12,
      constraintIterations: 5,
    });
  });

  it('keeps the existing constraint fallback without inventing goal iterations', () => {
    expect(solverIterationPhases({ extraIterations: 0, extraGoalIterations: 0 })).toEqual({
      goalIterations: 0,
      constraintIterations: 8,
    });
  });
});

describe('fixedClothSubsteps', () => {
  it('splits the clamped frame delta into the default fixed quality count', () => {
    expect(fixedClothSubsteps(1 / 60)).toEqual({
      count: DEFAULT_CLOTH_SUBSTEPS,
      dt: (1 / 60) / DEFAULT_CLOTH_SUBSTEPS,
    });
  });

  it('clamps long frames before splitting them', () => {
    expect(fixedClothSubsteps(1)).toEqual({
      count: DEFAULT_CLOTH_SUBSTEPS,
      dt: (1 / 30) / DEFAULT_CLOTH_SUBSTEPS,
    });
  });

  it('keeps at least one substep and ignores invalid deltas', () => {
    expect(fixedClothSubsteps(Number.NaN, 0)).toEqual({ count: 1, dt: 0 });
    expect(fixedClothSubsteps(-1 / 60, -4)).toEqual({ count: 1, dt: 0 });
  });
});

describe('verletVelocityScale', () => {
  it('returns zero for invalid or non-positive current dt', () => {
    expect(verletVelocityScale(Number.NaN, 1 / 120)).toBe(0);
    expect(verletVelocityScale(0, 1 / 120)).toBe(0);
    expect(verletVelocityScale(-1 / 60, 1 / 120)).toBe(0);
  });

  it('returns zero before there is valid timestep history', () => {
    expect(verletVelocityScale(1 / 120, null)).toBe(0);
    expect(verletVelocityScale(1 / 120, 0)).toBe(0);
    expect(verletVelocityScale(1 / 120, Number.NaN)).toBe(0);
  });

  it('scales Verlet velocity by current dt over previous dt', () => {
    expect(verletVelocityScale(1 / 60, 1 / 120)).toBeCloseTo(2, 6);
    expect(verletVelocityScale(1 / 120, 1 / 60)).toBeCloseTo(0.5, 6);
  });

  it('clamps the history denominator to one quarter of current dt', () => {
    expect(verletVelocityScale(1 / 30, 1 / 1000)).toBeCloseTo(4, 6);
  });

  it('preserves the authored velocity damping multiplier', () => {
    expect(verletVelocityScale(1 / 60, 1 / 60, 0.25)).toBeCloseTo(0.75, 6);
    expect(verletVelocityScale(1 / 60, 1 / 60, 2)).toBe(0);
  });
});

describe('rodCorrectionShares', () => {
  it('uses flWeight0=0 as an authored static first endpoint', () => {
    expect(rodCorrectionShares(0)).toEqual({ a: 0, b: 1 });
  });

  it('uses flWeight0=0.5 as an authored even split', () => {
    expect(rodCorrectionShares(0.5)).toEqual({ a: 0.5, b: 0.5 });
  });

  it('uses flWeight0=1 as an authored static second endpoint', () => {
    expect(rodCorrectionShares(1)).toEqual({ a: 1, b: 0 });
  });
});

describe('projectAnimStrayRadius', () => {
  // Faithful semantics: clamp node[0] to within maxDist of its OWN animated target
  // (shipped data is self-referential, nNode == [n, n]). Target sits at the origin
  // in these cases, so the numbers match a clamp toward (0,0,0).
  it('leaves the node unchanged inside the authored radius', () => {
    const nodes = [{ pos: V(3, 0, 0), target: V(0, 0, 0) }];

    const changed = projectAnimStrayRadius(nodes, { node: [0, 0], maxDist: 4, relax: 1 });

    expect(changed).toBe(false);
    expect(nodes[0].pos.x).toBeCloseTo(3, 6);
  });

  it('leaves prev unchanged when no clamp is needed', () => {
    const node = { pos: V(3, 0, 0), prev: V(2.25, 0.5, 0), target: V(0, 0, 0) };
    const beforePrev = node.prev.clone();

    const changed = projectAnimStrayRadius([node], { node: [0, 0], maxDist: 4, relax: 1 });

    expect(changed).toBe(false);
    expect(node.prev.equals(beforePrev)).toBe(true);
  });

  it('clamps the node to the authored max distance from its target', () => {
    const nodes = [{ pos: V(10, 0, 0), target: V(0, 0, 0) }];

    const changed = projectAnimStrayRadius(nodes, { node: [0, 0], maxDist: 4, relax: 1 });

    expect(changed).toBe(true);
    expect(nodes[0].pos.x).toBeCloseTo(4, 6);
  });

  it('applies the same clamp delta to prev to preserve existing velocity', () => {
    const node = { pos: V(10, 0, 0), prev: V(9.5, 1, 0), target: V(0, 0, 0) };
    const beforePos = node.pos.clone();
    const beforePrev = node.prev.clone();
    const beforeVelocity = beforePos.clone().sub(beforePrev);

    const changed = projectAnimStrayRadius([node], { node: [0, 0], maxDist: 4, relax: 1 });

    const posDelta = node.pos.clone().sub(beforePos);
    const prevDelta = node.prev.clone().sub(beforePrev);
    const afterVelocity = node.pos.clone().sub(node.prev);
    expect(changed).toBe(true);
    expect(posDelta.distanceTo(prevDelta)).toBeLessThan(1e-9);
    expect(afterVelocity.distanceTo(beforeVelocity)).toBeLessThan(1e-9);
    expect(node.pos.x).toBeCloseTo(4, 6);
    expect(node.prev.equals(V(3.5, 1, 0))).toBe(true);
  });

  it('scales the projection by the authored relaxation factor', () => {
    const nodes = [{ pos: V(10, 0, 0), target: V(0, 0, 0) }];

    projectAnimStrayRadius(nodes, { node: [0, 0], maxDist: 4, relax: 0.25 });

    expect(nodes[0].pos.x).toBeCloseTo(8.5, 6);
  });

  it('skips a missing node reference', () => {
    const nodes = [{ pos: V(10, 0, 0), target: V(0, 0, 0) }];

    const changed = projectAnimStrayRadius(nodes, { node: [5, 5], maxDist: 4, relax: 1 });

    expect(changed).toBe(false);
    expect(nodes[0].pos.x).toBeCloseTo(10, 6);
  });

  it('does not move a kinematic node', () => {
    const nodes = [{ pos: V(10, 0, 0), target: V(0, 0, 0), pinned: true }];

    const changed = projectAnimStrayRadius(nodes, { node: [0, 0], maxDist: 4, relax: 1 });

    expect(changed).toBe(false);
    expect(nodes[0].pos.x).toBeCloseTo(10, 6);
  });
});

describe('projectCollisionPlane', () => {
  it('pushes the child along the parent-rotated positive normal and preserves velocity', () => {
    const parent = {
      pos: V(10, 0, 0),
      prev: V(10, 0, 0),
      solvedRot: Q(0, 0, Math.PI / 2),
    };
    const child = {
      pos: V(10, 1.75, 0),
      prev: V(9.5, 1.5, 0),
      solvedRot: Q(),
    };
    const beforeVelocity = child.pos.clone().sub(child.prev);

    const changed = projectCollisionPlane(
      [parent, child],
      { ctrlParent: 0, childNode: 1, normal: [1, 0, 0], offset: 2, strength: 1 },
      0.5,
    );

    const afterVelocity = child.pos.clone().sub(child.prev);
    expect(changed).toBe(true);
    expect(child.pos.x).toBeCloseTo(10, 6);
    expect(child.pos.y).toBeCloseTo(2.5, 6);
    expect(child.pos.z).toBeCloseTo(0, 6);
    expect(afterVelocity.distanceTo(beforeVelocity)).toBeLessThan(1e-9);
  });

  it('scales correction by clamped strength', () => {
    const parent = { pos: V(0, 0, 0), prev: V(0, 0, 0), solvedRot: Q() };
    const child = { pos: V(0, -1, 0), prev: V(0, -2, 0), solvedRot: Q() };
    const clampedChild = { pos: V(0, -1, 0), prev: V(0, -2, 0), solvedRot: Q() };

    const changed = projectCollisionPlane(
      [parent, child],
      { ctrlParent: 0, childNode: 1, normal: [0, 1, 0], offset: 0, strength: 0.25 },
      1,
    );

    expect(changed).toBe(true);
    expect(child.pos.y).toBeCloseTo(-0.5, 6);
    expect(child.prev.y).toBeCloseTo(-1.5, 6);

    projectCollisionPlane(
      [parent, clampedChild],
      { ctrlParent: 0, childNode: 1, normal: [0, 1, 0], offset: 0, strength: 5 },
      1,
    );
    expect(clampedChild.pos.y).toBeCloseTo(1, 6);
    expect(clampedChild.prev.y).toBeCloseTo(0, 6);
  });

  it('leaves nodes alone when the plane reference or normal is invalid', () => {
    const parent = { pos: V(0, 0, 0), prev: V(0, 0, 0), solvedRot: Q() };
    const child = { pos: V(0, -1, 0), prev: V(0, -2, 0), solvedRot: Q() };
    const beforePos = child.pos.clone();
    const beforePrev = child.prev.clone();

    expect(projectCollisionPlane(
      [parent, child],
      { ctrlParent: 9, childNode: 1, normal: [0, 1, 0], offset: 0, strength: 1 },
      1,
    )).toBe(false);
    expect(projectCollisionPlane(
      [parent, child],
      { ctrlParent: 0, childNode: 1, normal: [0, 0, 0], offset: 0, strength: 1 },
      1,
    )).toBe(false);

    expect(child.pos.equals(beforePos)).toBe(true);
    expect(child.prev.equals(beforePrev)).toBe(true);
  });

  it('does not project kinematic child nodes', () => {
    const parent = { pos: V(0, 0, 0), prev: V(0, 0, 0), solvedRot: Q() };
    const child = { pos: V(0, -1, 0), prev: V(0, -2, 0), solvedRot: Q(), pinned: true };

    const changed = projectCollisionPlane(
      [parent, child],
      { ctrlParent: 0, childNode: 1, normal: [0, 1, 0], offset: 0, strength: 1 },
      1,
    );

    expect(changed).toBe(false);
    expect(child.pos.y).toBeCloseTo(-1, 6);
    expect(child.prev.y).toBeCloseTo(-2, 6);
  });
});

describe('position-driven classification', () => {
  it('marks nodes at and after firstPositionDrivenNode as position-driven', () => {
    const model = { firstPositionDrivenNode: 2, fitMatrices: [] };

    expect(isPositionDrivenNode(1, model)).toBe(false);
    expect(isPositionDrivenNode(2, model)).toBe(true);
    expect(isPositionDrivenNode(3, model)).toBe(true);
  });

  it('disables position-driven classification when FitMatrix data is present', () => {
    const model = { firstPositionDrivenNode: 1, fitMatrices: [{}] } as Parameters<typeof isPositionDrivenNode>[1];

    expect(isPositionDrivenNode(1, model)).toBe(false);
    expect(isPositionDrivenNode(2, model)).toBe(false);
  });

  it('treats pinned, position-driven, and lock-to-goal nodes as kinematic', () => {
    expect(isKinematicNode({ pinned: true })).toBe(true);
    expect(isKinematicNode({ positionDriven: true })).toBe(true);
    expect(isKinematicNode({ lockToGoal: true })).toBe(true);
    expect(isKinematicNode({ jiggleDriven: true })).toBe(true);
    expect(isKinematicNode({})).toBe(false);
  });

  it('classifies only param-bearing valid jiggle bones as kinematic', () => {
    const jiggleNodes = jiggleDrivenNodeSet({
      nodes: new Array(3).fill(null) as Parameters<typeof jiggleDrivenNodeSet>[0]['nodes'],
      jiggleBones: [
        { node: 1, jiggleParent: 0, params: jiggleParams },
        { node: 2, jiggleParent: 0, params: null },
        { node: 99, jiggleParent: 0, params: jiggleParams },
        { node: -1, jiggleParent: 0, params: jiggleParams },
      ],
    });

    expect(jiggleNodes.has(1)).toBe(true);
    expect(jiggleNodes.has(2)).toBe(false);
    expect(jiggleNodes.has(99)).toBe(false);
    expect(jiggleNodes.has(-1)).toBe(false);
    expect(isKinematicNode({ jiggleDriven: jiggleNodes.has(1) })).toBe(true);
    expect(isKinematicNode({ jiggleDriven: jiggleNodes.has(2) })).toBe(false);
  });

  it('classifies reverse-offset bone controls as kinematic below firstPositionDrivenNode', () => {
    const reverseOffsetNodes = reverseOffsetDrivenNodeSet({
      reverseOffsets: [{ boneCtrl: 127, targetNode: 252, offset: [1, 0, 0] }],
    });

    expect(isPositionDrivenNode(127, { firstPositionDrivenNode: 252, fitMatrices: [] })).toBe(false);
    expect(reverseOffsetNodes.has(127)).toBe(true);
    expect(isKinematicNode({ reverseOffsetDriven: reverseOffsetNodes.has(127) })).toBe(true);
  });

  it('keeps reverse-offset classification independent of FitMatrix position-driven gating', () => {
    const reverseOffsetNodes = reverseOffsetDrivenNodeSet({
      reverseOffsets: [{ boneCtrl: 127, targetNode: 252, offset: [1, 0, 0] }],
    });

    const model = { firstPositionDrivenNode: 1, fitMatrices: [{}] } as Parameters<typeof isPositionDrivenNode>[1];

    expect(isPositionDrivenNode(127, model)).toBe(false);
    expect(reverseOffsetNodes.has(127)).toBe(true);
  });

  it('classifies FitMatrix ctrl controls as kinematic position-driven nodes', () => {
    const fitNodes = fitMatrixDrivenNodeSet({
      fitMatrices: [{
        node: 4,
        endWeight: 4,
        beginDynamic: 2,
        bone: [0, 0, 0],
        boneRot: [0, 0, 0, 1],
        center: [0, 0, 0],
        ctrl: 7,
      }],
    });

    expect(fitNodes.has(4)).toBe(false);
    expect(fitNodes.has(7)).toBe(true);
    expect(isKinematicNode({ positionDriven: fitNodes.has(7) })).toBe(true);
  });

  it('falls back to FitMatrix nNode when ctrl is absent or equal to node', () => {
    expect(fitMatrixTargetNode({ node: 4, ctrl: 4 }, 8)).toBe(4);
    expect(fitMatrixTargetNode({ node: 4, ctrl: -1 }, 8)).toBe(4);
  });

  it('uses authored freeNodes as the free simulation set when present', () => {
    const model = {
      freeNodes: [2, 99, -1],
      nodes: [
        simNode(0),
        simNode(1),
        simNode(1),
      ],
    };

    const freeNodes = freeSimNodeSet(model);

    expect(freeNodes.has(1)).toBe(false);
    expect(freeNodes.has(2)).toBe(true);
    expect(freeNodes.has(99)).toBe(false);
    expect(isFreeSimNode(2, model)).toBe(true);
  });

  it('falls back to positive invMass when freeNodes are absent', () => {
    const model = {
      freeNodes: [],
      nodes: [
        simNode(0),
        simNode(0.5),
        simNode(1),
      ],
    };

    const freeNodes = freeSimNodeSet(model);

    expect(freeNodes.has(0)).toBe(false);
    expect(freeNodes.has(1)).toBe(true);
    expect(freeNodes.has(2)).toBe(true);
  });
});

describe('restorePinnedSolverNodes', () => {
  it('restores pinned solver positions after constraint projection', () => {
    const targetRot = Q(0, 0, Math.PI / 4);
    const pinned = {
      pinned: true,
      pos: V(10, 0, 0),
      prev: V(9, 0, 0),
      target: V(1, 2, 3),
      solvedRot: Q(),
      targetRot,
    };
    const free = {
      pinned: false,
      pos: V(4, 5, 6),
      prev: V(3, 5, 6),
      target: V(7, 8, 9),
      solvedRot: Q(),
      targetRot: Q(0, Math.PI / 4, 0),
    };

    restorePinnedSolverNodes([pinned, free]);

    expect(pinned.pos.equals(pinned.target)).toBe(true);
    expect(pinned.prev.equals(pinned.target)).toBe(true);
    expect(pinned.solvedRot.angleTo(targetRot)).toBeCloseTo(0, 6);
    expect(free.pos.equals(V(4, 5, 6))).toBe(true);
    expect(free.prev.equals(V(3, 5, 6))).toBe(true);
  });

  it('restores position-driven solver positions after constraint projection', () => {
    const targetRot = Q(0, Math.PI / 3, 0);
    const node = {
      pinned: false,
      positionDriven: true,
      pos: V(20, 0, 0),
      prev: V(19, 0, 0),
      target: V(2, 3, 4),
      solvedRot: Q(),
      targetRot,
    };

    restorePinnedSolverNodes([node]);

    expect(node.pos.equals(node.target)).toBe(true);
    expect(node.prev.equals(node.target)).toBe(true);
    expect(node.solvedRot.angleTo(targetRot)).toBeCloseTo(0, 6);
  });

  it('restores reverse-offset-driven solver positions as kinematic state', () => {
    const node = {
      pinned: false,
      reverseOffsetDriven: true,
      pos: V(20, 0, 0),
      prev: V(19, 0, 0),
      target: V(2, 3, 4),
      solvedRot: Q(),
      targetRot: Q(0, Math.PI / 5, 0),
    };

    restorePinnedSolverNodes([node]);

    expect(node.pos.equals(node.target)).toBe(true);
    expect(node.prev.equals(node.target)).toBe(true);
    expect(node.solvedRot.angleTo(node.targetRot)).toBeCloseTo(0, 6);
  });
});

describe('reconstructReverseOffsetPosition', () => {
  it('reconstructs the bone control node from target position plus rotated offset', () => {
    const boneNode = {
      pos: V(0, 0, 0),
      prev: V(-1, 0, 0),
      solvedRot: Q(0, 0, Math.PI / 2),
    };
    const targetNode = {
      pos: V(10, 0, 0),
      prev: V(0, 0, 0),
      solvedRot: Q(),
    };

    const pos = reconstructReverseOffsetPosition(
      { boneCtrl: 0, targetNode: 1, offset: [2, 0, 0], sign: 1 },
      [boneNode, targetNode],
    );

    expect(pos?.x).toBeCloseTo(10, 6);
    expect(pos?.y).toBeCloseTo(2, 6);
    expect(pos?.z).toBeCloseTo(0, 6);
    expect(boneNode.pos.equals(pos!)).toBe(true);
    expect(boneNode.prev.equals(pos!)).toBe(true);
  });

  it('applies all reverse-offset reconstructions into solver state before consumers read positions', () => {
    const boneNode = {
      initPos: [0, 0, 0] as [number, number, number],
      pos: V(-100, 0, 0),
      prev: V(-101, 0, 0),
      solvedRot: Q(0, 0, Math.PI / 2),
    };
    const targetNode = {
      initPos: [0, 0, 0] as [number, number, number],
      pos: V(10, 0, 0),
      prev: V(9, 0, 0),
      solvedRot: Q(),
    };

    const count = applyReverseOffsetReconstructions(
      [{ boneCtrl: 0, targetNode: 1, offset: [2, 0, 0], sign: 1 }],
      [boneNode, targetNode],
    );
    const consumerRead = boneNode.pos.clone();

    expect(count).toBe(1);
    expect(consumerRead.x).toBeCloseTo(10, 6);
    expect(consumerRead.y).toBeCloseTo(2, 6);
    expect(consumerRead.z).toBeCloseTo(0, 6);
    expect(boneNode.prev.equals(boneNode.pos)).toBe(true);
  });

  it('reruns reverse offsets after FitMatrix so fit-driven targets are observed', () => {
    const current = [
      V(10, 0, 0),
      V(11, 0, 0),
      V(10, 1, 0),
      V(10, 0, 1),
    ];
    const fitTarget = {
      initPos: [2, 0, 0] as [number, number, number],
      pos: V(0, 0, 0),
      prev: V(0, 0, 0),
      solvedRot: Q(),
    };
    const reverseBone = {
      initPos: [3, 0, 0] as [number, number, number],
      pos: V(-100, 0, 0),
      prev: V(-100, 0, 0),
      solvedRot: Q(),
    };
    const nodes = [
      { initPos: [0, 0, 0] as [number, number, number], pos: current[0], prev: current[0].clone(), solvedRot: Q() },
      { initPos: [1, 0, 0] as [number, number, number], pos: current[1], prev: current[1].clone(), solvedRot: Q() },
      { initPos: [0, 1, 0] as [number, number, number], pos: current[2], prev: current[2].clone(), solvedRot: Q() },
      { initPos: [0, 0, 1] as [number, number, number], pos: current[3], prev: current[3].clone(), solvedRot: Q() },
      fitTarget,
      reverseBone,
    ];

    const counts = applyDrivenReconstructions(
      [{ boneCtrl: 5, targetNode: 4, offset: [1, 0, 0], sign: 1 }],
      [{
        node: 4,
        targetNode: 4,
        bone: [0, 0, 0],
        boneRot: [0, 0, 0, 1],
        center: [0, 0, 0],
        weights: [
          { node: 0, weight: 1 },
          { node: 1, weight: 1 },
          { node: 2, weight: 1 },
          { node: 3, weight: 1 },
        ],
      }],
      nodes,
    );

    expect(counts).toEqual({ reverseBefore: 1, fit: 1, reverseAfter: 1 });
    expect(fitTarget.pos.x).toBeCloseTo(10.25, 6);
    expect(reverseBone.pos.x).toBeCloseTo(11.25, 6);
  });
});

describe('FitMatrix reconstruction', () => {
  it('builds spans from previous endWeight and keeps the static prefix before beginDynamic', () => {
    const reconstructions = buildFitMatrixReconstructions({
      nodes: [
        { initPos: [0, 0, 0] },
        { initPos: [1, 0, 0] },
        { initPos: [0, 1, 0] },
        { initPos: [0, 0, 1] },
        { initPos: [2, 0, 0] },
        { initPos: [3, 0, 0] },
        { initPos: [4, 0, 0] },
      ],
      fitMatrices: [
        {
          node: 4,
          endWeight: 1,
          beginDynamic: 0,
          bone: [0, 0, 0],
          boneRot: [0, 0, 0, 1],
          center: [0, 0, 0],
          ctrl: 4,
        },
        {
          node: 6,
          endWeight: 5,
          beginDynamic: 3,
          bone: [2, 0, 0],
          boneRot: [0, 0, 0, 1],
          center: [0.25, 0.25, 0.25],
          ctrl: 6,
        },
      ],
      fitWeights: [
        { node: 5, weight: 1 },
        { node: 0, weight: 4 },
        { node: 1, weight: 2 },
        { node: 2, weight: 3 },
        { node: 3, weight: 5 },
      ],
    });

    expect(reconstructions).toHaveLength(1);
    expect(reconstructions[0].node).toBe(6);
    expect(reconstructions[0].targetNode).toBe(6);
    expect(reconstructions[0].center).toEqual([0.25, 0.25, 0.25]);
    expect(reconstructions[0].weights.map((w) => w.node)).toEqual([0, 1, 2, 3]);
    expect(reconstructions[0].weights.map((w) => w.weight)).toEqual([4, 2, 3, 5]);
  });

  it('targets nCtrl when it differs from nNode', () => {
    const reconstructions = buildFitMatrixReconstructions({
      nodes: [
        { initPos: [0, 0, 0] },
        { initPos: [1, 0, 0] },
        { initPos: [0, 1, 0] },
        { initPos: [0, 0, 1] },
        { initPos: [2, 0, 0] },
        { initPos: [3, 0, 0] },
      ],
      fitMatrices: [{
        node: 4,
        endWeight: 4,
        beginDynamic: 0,
        bone: [0, 0, 0],
        boneRot: [0, 0, 0, 1],
        center: [0, 0, 0],
        ctrl: 5,
      }],
      fitWeights: [
        { node: 0, weight: 1 },
        { node: 1, weight: 1 },
        { node: 2, weight: 1 },
        { node: 3, weight: 1 },
      ],
    });

    expect(reconstructions).toHaveLength(1);
    expect(reconstructions[0].node).toBe(4);
    expect(reconstructions[0].targetNode).toBe(5);
  });

  it('reconstructs a driven control from a rotated weighted source set', () => {
    const rotation = Q(0.25, -0.4, 0.8);
    const translation = V(3, -2, 1);
    const rest = [
      V(0, 0, 0),
      V(1, 0, 0),
      V(0, 2, 0),
      V(0, 0, 3),
    ];
    const weights = [4, 2, 3, 5];
    const current = rest.map((p) => p.clone().applyQuaternion(rotation).add(translation));
    const targetCenter = current.reduce((acc, p, i) => acc.addScaledVector(p, weights[i]), V(0, 0, 0))
      .multiplyScalar(1 / weights.reduce((a, b) => a + b, 0));
    const authoredCenter = V(0.4, 0.6, 0.8);
    const bone = V(2, -0.5, 0.25);
    const boneRot = Q(0.1, 0.2, -0.1);
    const driven = {
      initPos: [0, 0, 0] as [number, number, number],
      pos: V(-100, 0, 0),
      prev: V(-101, 0, 0),
      solvedRot: Q(),
    };
    const nodes = [
      { initPos: [0, 0, 0] as [number, number, number], pos: current[0], prev: current[0].clone(), solvedRot: Q() },
      { initPos: [1, 0, 0] as [number, number, number], pos: current[1], prev: current[1].clone(), solvedRot: Q() },
      { initPos: [0, 2, 0] as [number, number, number], pos: current[2], prev: current[2].clone(), solvedRot: Q() },
      { initPos: [0, 0, 3] as [number, number, number], pos: current[3], prev: current[3].clone(), solvedRot: Q() },
      driven,
    ];
    const expectedPos = targetCenter.clone().add(bone.clone().sub(authoredCenter).applyQuaternion(rotation));
    const expectedRot = rotation.clone().multiply(boneRot).normalize();

    const count = applyFitMatrixReconstructions(
      [{
        node: 4,
        targetNode: 4,
        bone: [bone.x, bone.y, bone.z],
        boneRot: [boneRot.x, boneRot.y, boneRot.z, boneRot.w],
        center: [authoredCenter.x, authoredCenter.y, authoredCenter.z],
        weights: [
          { node: 0, weight: weights[0] },
          { node: 1, weight: weights[1] },
          { node: 2, weight: weights[2] },
          { node: 3, weight: weights[3] },
        ],
      }],
      nodes,
    );

    expect(count).toBe(1);
    expect(driven.pos.distanceTo(expectedPos)).toBeLessThan(1e-9);
    expect(driven.prev.distanceTo(expectedPos)).toBeLessThan(1e-9);
    expect(driven.solvedRot.angleTo(expectedRot)).toBeLessThan(1e-9);
  });

  it('reconstructs the ctrl target when ctrl differs from node', () => {
    const rest = [
      V(0, 0, 0),
      V(1, 0, 0),
      V(0, 1, 0),
      V(0, 0, 1),
    ];
    const current = rest.map((p) => p.clone().add(V(5, 0, 0)));
    const dynamicCenter = {
      initPos: [2, 0, 0] as [number, number, number],
      pos: V(-100, 0, 0),
      prev: V(-100, 0, 0),
      solvedRot: Q(),
    };
    const ctrl = {
      initPos: [3, 0, 0] as [number, number, number],
      pos: V(-200, 0, 0),
      prev: V(-200, 0, 0),
      solvedRot: Q(),
    };
    const nodes = [
      { initPos: [0, 0, 0] as [number, number, number], pos: current[0], prev: current[0].clone(), solvedRot: Q() },
      { initPos: [1, 0, 0] as [number, number, number], pos: current[1], prev: current[1].clone(), solvedRot: Q() },
      { initPos: [0, 1, 0] as [number, number, number], pos: current[2], prev: current[2].clone(), solvedRot: Q() },
      { initPos: [0, 0, 1] as [number, number, number], pos: current[3], prev: current[3].clone(), solvedRot: Q() },
      dynamicCenter,
      ctrl,
    ];

    const count = applyFitMatrixReconstructions(
      [{
        node: 4,
        targetNode: 5,
        bone: [0, 0, 0],
        boneRot: [0, 0, 0, 1],
        center: [0, 0, 0],
        weights: [
          { node: 0, weight: 1 },
          { node: 1, weight: 1 },
          { node: 2, weight: 1 },
          { node: 3, weight: 1 },
        ],
      }],
      nodes,
    );

    expect(count).toBe(1);
    expect(ctrl.pos.x).toBeCloseTo(5.25, 6);
    expect(dynamicCenter.pos.equals(V(-100, 0, 0))).toBe(true);
  });
});

describe('clothAnchorMap', () => {
  const model = (names: string[], skelParents: number[]) => ({
    nodes: names.map((name) => ({ name })) as ClothModel['nodes'],
    skelParents,
  });

  it('maps each $cloth node to the terminal (root) driver of its chain', () => {
    // 0 pelvis (root), 1 $cloth_a -> 0, 2 $cloth_b -> 1: both resolve to pelvis.
    const map = clothAnchorMap(model(['pelvis', '$cloth_a', '$cloth_b'], [-1, 0, 1]));
    expect(map.get(1)).toBe(0);
    expect(map.get(2)).toBe(0);
    expect(map.has(0)).toBe(false); // pelvis is a driver, not a cloth node
  });

  it('skips a cloth node whose terminal is also cloth (no real anchor)', () => {
    const map = clothAnchorMap(model(['$cloth_root', '$cloth_tip'], [-1, 0]));
    expect(map.size).toBe(0);
  });

  it('guards against cycles and a length mismatch', () => {
    expect(clothAnchorMap(model(['$cloth_a', '$cloth_b'], [1, 0])).size).toBe(0); // cycle
    expect(clothAnchorMap(model(['pelvis', '$cloth_a'], [-1])).size).toBe(0); // mismatch
  });
});

describe('rigidAnchorSeed', () => {
  it('returns the node init position when the anchor is at bind', () => {
    const seed = rigidAnchorSeed([1, 2, 3], [0, 0, 0], [0, 0, 0, 1], V(0, 0, 0), Q());
    expect(seed.distanceTo(V(1, 2, 3))).toBeLessThan(1e-6);
  });

  it('rigidly carries the node by the anchor translation', () => {
    const seed = rigidAnchorSeed([1, 2, 3], [0, 0, 0], [0, 0, 0, 1], V(10, 0, 0), Q());
    expect(seed.distanceTo(V(11, 2, 3))).toBeLessThan(1e-6);
  });

  it('rigidly carries the node by the anchor rotation', () => {
    // node sits 1 unit +x of the anchor (at origin); rotate the anchor +90 deg about Z.
    const seed = rigidAnchorSeed([1, 0, 0], [0, 0, 0], [0, 0, 0, 1], V(0, 0, 0), Q(0, 0, Math.PI / 2));
    expect(seed.distanceTo(V(0, 1, 0))).toBeLessThan(1e-6);
  });
});
