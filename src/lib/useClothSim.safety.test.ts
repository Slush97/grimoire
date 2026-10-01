import { afterEach, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { parseFeModel } from './feModel';
import { CLOTH_TIMESTEP, clothTuning, createClothSimHarness, resetClothTuning, solverIterationPhases } from './useClothSim';

function rig() {
  const model = parseFeModel({
    m_CtrlName: ['anchor', 'spare_x', 'spare_y', '$cloth_tip'],
    m_NodeInvMasses: [0, 0, 0, 1],
    m_nStaticNodes: 3,
    m_nFirstPositionDrivenNode: 4,
    m_nDynamicNodeFlags: 0x200,
    m_InitPose: [
      [0, 0, 0, 1, 0, 0, 0, 1], [1, 0, 0, 1, 0, 0, 0, 1],
      [0, 1, 0, 1, 0, 0, 0, 1], [0, 0, -1, 1, 0, 0, 0, 1],
    ],
    m_SkelParents: [-1, -1, -1, 0],
    m_NodeIntegrator: [{}, {}, {}, { flGravity: 24, flPointDamping: 1, flAnimationForceAttraction: 20, flAnimationVertexAttraction: 4 }],
    m_Rods: [{ nNode: [0, 3], flMinDist: 1, flMaxDist: 1, flWeight0: 0, flRelaxationFactor: 1 }],
  })!;
  const root = new THREE.Group();
  const bones = model.nodes.map((node) => {
    const bone = new THREE.Bone();
    bone.name = node.name;
    bone.position.fromArray(node.initPos);
    return bone;
  });
  root.add(...bones.slice(0, 3));
  bones[0].add(bones[3]);
  root.updateWorldMatrix(true, true);
  return { root, bones, model };
}

afterEach(resetClothTuning);

describe('cloth runtime safety', () => {
  it('bounds catchup to twelve steps and drops the backlog after suspension', () => {
    const { root, bones, model } = rig();
    const harness = createClothSimHarness(root, model);
    let calls = 0;
    const animate = (dt: number) => { calls++; bones[0].position.x += dt; };
    for (let frame = 0; frame < 20; frame++) harness.step(0.25, animate);
    expect(calls).toBe(240);
    expect(harness.metrics()).toMatchObject({ simulationSteps: 240, finite: 1, recoveryCount: 0 });
    harness.step(CLOTH_TIMESTEP / 2, animate);
    harness.step(60, animate);
    harness.step(CLOTH_TIMESTEP / 2, animate);
    expect(calls).toBe(240);
    harness.step(CLOTH_TIMESTEP / 2, animate);
    expect(calls).toBe(241);
    expect(harness.metrics().recoveryCount).toBe(1);
    harness.dispose();
  });

  it('carries cloth to a teleported anchor without preserving stale collision motion or velocity', () => {
    const { root, bones, model } = rig();
    model.spheres = [{ node: 0, sphere: [0, 0, 0, 0.25], mask: 0xffff }];
    const harness = createClothSimHarness(root, model);
    for (let i = 0; i < 30; i++) harness.step(CLOTH_TIMESTEP);
    const metrics = harness.step(CLOTH_TIMESTEP, () => { bones[0].position.x = 1000; });
    expect(metrics).toMatchObject({ finite: 1, recoveryCount: 1 });
    const tip = harness.snapshot().nodes[3];
    expect(tip.position[0]).toBeCloseTo(1000, 8);
    expect(new THREE.Vector3().fromArray(tip.position).distanceTo(new THREE.Vector3(1000, 0, 0))).toBeCloseTo(1, 8);
    for (let i = 0; i < 120; i++) expect(harness.step(CLOTH_TIMESTEP).finite).toBe(1);
    expect(harness.metrics().recoveryCount).toBe(1);
    harness.dispose();
    expect(bones[0].position.x).toBe(1000);
    expect(bones[3].position.toArray()).toEqual([0, 0, -1]);
  });

  it('rejects a non-finite animation sample without poisoning its clean restore pose', () => {
    const { root, bones, model } = rig();
    const harness = createClothSimHarness(root, model);
    harness.step(CLOTH_TIMESTEP, () => { bones[0].position.x = 3; });
    expect(harness.step(CLOTH_TIMESTEP, () => {
      bones[0].position.x = Number.NaN;
      bones[3].quaternion.set(Number.NaN, 0, 0, 1);
    }).finite).toBe(1);
    expect(bones[0].position.x).toBe(3);
    expect(harness.step(CLOTH_TIMESTEP, () => { bones[0].position.x += 1; }).finite).toBe(1);
    harness.dispose();
    expect(bones[0].position.x).toBe(4);
    expect(bones[3].quaternion.toArray()).toEqual([0, 0, 0, 1]);
  });

  it('recovers an overflowed solver before bone writeback and continues normally', () => {
    const { root, bones, model } = rig();
    const harness = createClothSimHarness(root, model);
    harness.step(CLOTH_TIMESTEP);
    clothTuning.gravityScale = Number.MAX_VALUE;
    const metrics = harness.step(CLOTH_TIMESTEP, () => { bones[0].position.x = 1; });
    expect(metrics).toMatchObject({ finite: 1, recoveryCount: 1 });
    expect(root.children.every((bone) => bone.matrixWorld.elements.every(Number.isFinite))).toBe(true);
    resetClothTuning();
    for (let i = 0; i < 120; i++) expect(harness.step(CLOTH_TIMESTEP).finite).toBe(1);
    expect(harness.metrics().recoveryCount).toBe(1);
    harness.dispose();
  });

  it('preserves animated anchors over sustained turning and running motion', () => {
    const { root, bones, model } = rig();
    const harness = createClothSimHarness(root, model);
    let time = 0;
    for (let frame = 0; frame < 600; frame++) {
      const metrics = harness.step(1 / 60, (dt) => {
        time += dt;
        bones[0].position.set(3 * Math.sin(time * 3), 0.2 * Math.sin(time * 8), 2 * Math.cos(time * 3));
        bones[0].quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), time * 2);
      });
      expect(metrics.finite).toBe(1);
      expect(metrics.maxAnchorError).toBeLessThan(1e-8);
    }
    expect(harness.metrics()).toMatchObject({ simulationSteps: 1200, recoveryCount: 0 });
    const finalPosition = bones[0].position.clone();
    const finalRotation = bones[0].quaternion.clone();
    harness.dispose();
    expect(bones[0].position.distanceTo(finalPosition)).toBeLessThan(1e-8);
    expect(bones[0].quaternion.angleTo(finalRotation)).toBeLessThan(1e-7);
  });

  it('retains finite iteration budgets for malformed counts and debug overrides', () => {
    expect(solverIterationPhases({ extraIterations: Number.NaN, extraGoalIterations: Infinity }, Number.NaN)).toEqual({ constraintIterations: 1, goalIterations: 1 });
    expect(solverIterationPhases({ extraIterations: 1e9, extraGoalIterations: 1e9 }, Infinity)).toEqual({ constraintIterations: 256, goalIterations: 256 });
  });

  it('rejects a singular model-to-skeleton fit without writing bones', () => {
    const { root, model } = rig();
    root.children.forEach((bone) => { bone.position.set(0, 0, 0); });
    expect(() => createClothSimHarness(root, model)).toThrow('requires at least three matched cloth nodes');
    expect(root.children.every((bone) => bone.position.toArray().every(Number.isFinite))).toBe(true);
  });
});

describe('malformed cloth sidecars', () => {
  it.each(['m_NodeInvMasses', 'm_Rods', 'm_SimdRods', 'm_NodeBases', 'm_CtrlOffsets', 'm_InitPose', 'm_CollisionPlanes'])('rejects a non-array %s container', (field) => {
    expect(parseFeModel({ m_CtrlName: ['a'], [field]: {} })).toBeNull();
  });

  it.each(['m_Rods', 'm_SimdTris', 'm_NodeBases', 'm_CtrlOffsets', 'm_SphereRigids', 'm_FitMatrices'])('rejects null %s records', (field) => {
    expect(parseFeModel({ m_CtrlName: ['a'], [field]: [null] })).toBeNull();
  });

  it('reports invalid scalar rod and basis references instead of throwing during diagnostics or stepping', () => {
    const { root } = rig();
    const model = parseFeModel({
      m_CtrlName: ['anchor', 'spare_x', 'spare_y'],
      m_InitPose: [[0, 0, 0], [1, 0, 0], [0, 1, 0]],
      m_Rods: [{ nNode: [-1, 1] }, { nNode: [0, 1.5] }],
      m_NodeBases: [{ nNode: 0, nNodeX0: 0, nNodeX1: 400, nNodeY0: 0, nNodeY1: 1 }],
    })!;
    expect(model.decodeIssues).toHaveLength(3);
    const harness = createClothSimHarness(root, model);
    expect(harness.step(CLOTH_TIMESTEP).finite).toBe(1);
    expect(harness.snapshot().rods).toEqual([]);
    harness.dispose();
  });

  it('skips fractional collider references before the contact pass and debug snapshot', () => {
    const { root, model } = rig();
    model.spheres = [{ node: 0.5, sphere: [0, 0, 0, 1], mask: 0xffff }];
    model.boxes = [{ node: 1.5, pos: [0, 0, 0], rot: [0, 0, 0, 1], halfSize: [1, 1, 1], mask: 0xffff }];
    model.collisionPlanes = [{ ctrlParent: 0.5, childNode: 3, normal: [0, 1, 0], offset: 0, strength: 1 }];
    const harness = createClothSimHarness(root, model);
    expect(harness.step(CLOTH_TIMESTEP).finite).toBe(1);
    expect(harness.snapshot()).toMatchObject({ capsules: [], boxes: [], contacts: [] });
    harness.dispose();
  });

  it('rejects oversized node and constraint containers before constructing runtime arrays', () => {
    expect(parseFeModel({ m_CtrlName: Array.from({ length: 16385 }, () => 'a') })).toBeNull();
    expect(parseFeModel({ m_CtrlName: ['a'], m_Rods: Array.from({ length: 262145 }, () => ({ nNode: [0, 0] })) })).toBeNull();
  });
});
