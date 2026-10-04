import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { ClothModel, ClothNode } from './feModel';
import { parseFeModel } from './feModel';
import collisionReference from './__fixtures__/cloth/source2_collision_reference.json';
import { CLOTH_TIMESTEP, createClothSimHarness } from './useClothSim';

const Q: [number, number, number, number] = [0, 0, 0, 1];
const jiggleParams = {} as NonNullable<ClothModel['jiggleBones'][number]['params']>;

function node(name: string, initPos: [number, number, number], pinned = false): ClothNode {
  return {
    name,
    invMass: pinned ? 0 : 1,
    pinned,
    gravity: pinned ? 0 : 0.5,
    damping: 0.02,
    animForce: pinned ? 0 : 20,
    animVertex: pinned ? 0 : 4,
    initPos,
    initRot: Q,
    collideRadius: 0,
    friction: 0,
    collisionMask: 0xffff,
  };
}

function syntheticClothModel(): ClothModel {
  return {
    nodes: [
      node('cloth_anchor', [0, 0, 0], true),
      node('cloth_mid', [1, 0.25, 0.2]),
      node('cloth_tip', [0.35, 1.1, -0.25]),
    ],
    rods: [
      { a: 0, b: 1, min: 1.05, max: 1.05, relax: 1, weight: 0 },
      { a: 1, b: 2, min: 1.1608, max: 1.1608, relax: 1, weight: 0.5 },
    ],
    capsules: [],
    animatedRods: [],
    animatedRodBatches: [],
    rodBatches: [],
    decodeIssues: [],
    featureGaps: [],
    hingeLimits: [],
    triangles: [],
    quads: [],
    quadBatches: [],
    triangleBatches: [],
    staticNodeFlags: null,
    dynamicNodeFlags: null,
    goalDampedSpringIntegrators: [],
    spheres: [],
    boxes: [],
    nodeBases: [],
    ctrlOffsets: [],
    reverseOffsets: [],
    softOffsets: [],
    strayRadii: [],
    strayRadiusBatches: [],
    skelParents: [-1, 0, 1],
    staticNodeCount: 1,
    addWorldCollisionRadius: 0,
    defaultGravityScale: 1,
    hasCollisionFriction: false,
    extraIterations: 8,
    extraGoalIterations: 0,
    twists: [],
    fitMatrices: [],
    fitWeights: [],
    freeNodes: [],
    lockToParent: [],
    lockToGoal: [],
    collisionPlanes: [],
    ropes: [],
    ropeCount: 0,
    ropeChains: [],
    jiggleBones: [],
    kelagerBends: [],
    firstPositionDrivenNode: 3,
    rodVelocitySmoothRate: 0,
    rodVelocitySmoothIterations: 0,
    rotLockStaticNodeCount: 0,
  };
}

function syntheticRoot(): { root: THREE.Group; anchor: THREE.Bone } {
  const root = new THREE.Group();
  const anchor = new THREE.Bone();
  const mid = new THREE.Bone();
  const tip = new THREE.Bone();
  anchor.name = 'cloth_anchor';
  mid.name = 'cloth_mid';
  tip.name = 'cloth_tip';
  anchor.position.set(0, 0, 0);
  mid.position.set(1, 0.25, 0.2);
  tip.position.set(0.35, 1.1, -0.25);
  root.add(anchor, mid, tip);
  root.updateWorldMatrix(true, true);
  return { root, anchor };
}

describe('compiled collision selections and priority groups', () => {
  it.each(collisionReference.cases)('matches the complete runtime contact pass: $name', ({ model: raw, expected, name }) => {
    const model = parseFeModel(raw)!;
    expect(model.decodeIssues).toEqual([]);
    expect(model.featureGaps).toEqual([]);
    const root = new THREE.Group();
    for (const node of model.nodes) {
      const bone = new THREE.Bone();
      bone.name = node.name;
      bone.position.fromArray(node.initPos);
      root.add(bone);
    }
    const harness = createClothSimHarness(root, model);
    harness.step(CLOTH_TIMESTEP);
    const snapshot = harness.snapshot();
    snapshot.nodes.forEach((node, index) => {
      expect(new THREE.Vector3().fromArray(node.position).distanceTo(new THREE.Vector3().fromArray(expected[index]))).toBeLessThan(2e-6);
    });
    if (name.includes('empty scope')) expect(snapshot.contacts).toEqual([]);
    harness.dispose();
  });

  it.each([
    { friction: undefined, expected: [1, 0, 2] },
    { friction: [0], expected: [0.05, 0, 3] },
  ])('selects the compiled centerline response from friction data $friction', ({ friction, expected }) => {
    const positions = [[0, 0, 0], [10, 0, 0], [0.05, 0, 2]];
    const model = parseFeModel({ m_CtrlName: ['body', 'anchor', 'cloth'], m_nStaticNodes: 2,
      m_nRotLockStaticNodes: 2, m_nDynamicNodeFlags: 0x2080, m_NodeInvMasses: [0, 0, 1],
      m_InitPose: positions.map((position) => [...position, 1, ...Q]), m_DynNodeFriction: friction,
      m_TaperedCapsuleRigids: [{ nNode: 0, nCollisionMask: 0xffff, vSphere: [[0, 0, 0, 1], [0, 0, 4, 1]] }],
    })!;
    const root = new THREE.Group();
    model.nodes.forEach((node) => {
      const bone = new THREE.Bone();
      bone.name = node.name; bone.position.fromArray(node.initPos); root.add(bone);
    });
    const harness = createClothSimHarness(root, model);
    harness.step(CLOTH_TIMESTEP);
    const snapshot = harness.snapshot();
    expect(snapshot.nodes[2].position).toEqual(expected);
    expect(snapshot.nodes.slice(0, 2).map((node) => node.position)).toEqual(positions.slice(0, 2));
    harness.dispose();
    expect(root.children.map((bone) => bone.position.toArray())).toEqual(positions);
  });

  it('uses selection membership independently of collision layers', () => {
    const model = syntheticClothModel();
    model.nodes.forEach((node) => { node.gravity = 0; node.animForce = 0; node.animVertex = 0; node.collisionMask = 0; });
    model.rods = [];
    model.spheres = [{ node: 0, sphere: [0, 0, 0, 2], mask: 1, vertexNodes: [1] }];
    const { root } = syntheticRoot();
    const harness = createClothSimHarness(root, model);
    harness.step(CLOTH_TIMESTEP);
    const snapshot = harness.snapshot();
    expect(new THREE.Vector3().fromArray(snapshot.nodes[1].position).length()).toBeCloseTo(2, 8);
    expect(snapshot.nodes[2].position).toEqual(model.nodes[2].initPos);
    expect(snapshot.contacts).toEqual([]);
    harness.dispose();
  });

  it.each([
    { friction: undefined, expected: [1, 2, 3] },
    { friction: [0], expected: [1, 2, 4] },
  ])('selects the compiled box response from friction data $friction', ({ friction, expected }) => {
    const positions = [[0, 0, 0], [10, 0, 0], [1, 2, 3]];
    const model = parseFeModel({ m_CtrlName: ['body', 'anchor', 'cloth'], m_nStaticNodes: 2,
      m_nRotLockStaticNodes: 2, m_nDynamicNodeFlags: 0x2080, m_NodeInvMasses: [0, 0, 1],
      m_InitPose: positions.map((position) => [...position, 1, ...Q]), m_DynNodeFriction: friction,
      m_BoxRigids: [{ nNode: 0, nCollisionMask: 0xffff, tmFrame2: [0, 0, 0, 1, ...Q], vSize: [2, 3, 4] }],
    })!;
    const root = new THREE.Group();
    model.nodes.forEach((node) => {
      const bone = new THREE.Bone();
      bone.name = node.name; bone.position.fromArray(node.initPos); root.add(bone);
    });
    const harness = createClothSimHarness(root, model);
    harness.step(CLOTH_TIMESTEP);
    const snapshot = harness.snapshot();
    expect(snapshot.nodes[2].position).toEqual(expected);
    expect(snapshot.nodes.slice(0, 2).map((node) => node.position)).toEqual(positions.slice(0, 2));
    harness.dispose();
    expect(root.children.map((bone) => bone.position.toArray())).toEqual(positions);
  });
});

describe('compiled quad integration', () => {
  it('projects after rods and restores the animation pose on cleanup', () => {
    const positions = [[-1, 0, 0], [1, 0, 0], [-1, 4, 0], [1, 3, 0]];
    const model = parseFeModel({ m_CtrlName: ['a', 'b', 'c', 'd'], m_nStaticNodes: 2, m_NodeInvMasses: [0, 0, 1, 1],
      m_InitPose: positions.map((position) => [...position, 1, ...Q]),
      m_Quads: [{ nNode: [0, 1, 2, 3], flSlack: 0, vShape: [[-1, 0, 0, 0], [1, 0, 0, 0], [-1, 2, 0, 0.5], [1, 2, 0, 0.5]] }],
      m_nQuadCount1: 1, m_nQuadCount2: 1,
      m_Rods: [{ nNode: [0, 2], flMinDist: 3, flMaxDist: 3, flWeight0: 0, flRelaxationFactor: 1 }],
    })!;
    const root = new THREE.Group();
    model.nodes.forEach((node) => {
      const bone = new THREE.Bone();
      bone.name = node.name;
      bone.position.fromArray(node.initPos);
      root.add(bone);
    });
    const harness = createClothSimHarness(root, model);
    harness.step(CLOTH_TIMESTEP);
    expect(harness.snapshot().nodes.map((node) => node.position)).toEqual([[-1, 0, 0], [1, 0, 0], [-1, 2, 0], [1, 2, 0]]);
    expect(harness.snapshot().quads[0].correction).toBe(0);
    expect(harness.metrics().coverage.quads).toBe(1);
    harness.dispose();
    expect(root.children.map((bone) => bone.position.toArray())).toEqual(positions);
  });
});

describe('compiled triangle integration', () => {
  it('projects dynamic triangle vertices while retaining both animated anchors', () => {
    const model = syntheticClothModel();
    model.nodes[1].pinned = true;
    model.nodes[1].invMass = 0;
    model.staticNodeCount = 2;
    model.nodes.forEach((node) => { node.gravity = 0; node.animForce = 0; node.animVertex = 0; });
    model.rods = [];
    const triangle: ClothModel['triangles'][number] = { node: [0, 1, 2], staticCount: 2, weight1: 0, weight2: 1, x1: 1, x2: 0.5, y2: 0.4 };
    model.triangles = [triangle];
    model.triangleBatches = [[triangle, triangle, triangle, triangle]];
    const { root } = syntheticRoot();
    const harness = createClothSimHarness(root, model);
    harness.step(CLOTH_TIMESTEP);
    const snapshot = harness.snapshot();
    expect(snapshot.triangles[0].correction).toBeLessThan(1e-10);
    expect(harness.metrics().maxAnchorError).toBe(0);
    expect(snapshot.nodes[2].position).not.toEqual(model.nodes[2].initPos);
    harness.dispose();
  });
});

describe('compiled stray-limit scheduling', () => {
  it('applies each constraint iteration before the final goal attraction', () => {
    const model = syntheticClothModel();
    model.rods = [];
    model.extraIterations = 1;
    model.extraGoalIterations = 0;
    model.dynamicNodeFlags = 0;
    model.nodes.forEach((node) => { node.gravity = 0; node.animForce = 0.5; node.animVertex = 0; });
    const radius: ClothModel['strayRadii'][number] = { node: [1, 1], maxDist: 0, relax: 0.5 };
    model.strayRadii = [radius];
    model.strayRadiusBatches = [[radius]];
    const { root } = syntheticRoot();
    const harness = createClothSimHarness(root, model);
    harness.step(CLOTH_TIMESTEP);
    const before = harness.snapshot().nodes[1].position[0];
    harness.step(CLOTH_TIMESTEP, () => { root.getObjectByName('cloth_mid')!.position.x += 10; });
    // Two half-strength radius projections, then one half-strength attraction.
    // An end-of-step clamp would leave a quarter of the original displacement.
    expect(harness.snapshot().nodes[1].position[0] - before).toBeCloseTo(8.75, 8);
    harness.dispose();
  });
});

describe('local body contacts', () => {
  it.each(['sphere', 'box'])('expands a %s by the particle radius but not the extra world margin', (shape) => {
    const positions: number[] = [];
    for (const margin of [0, 20]) {
      const model = syntheticClothModel();
      model.nodes = [node('body', [0, 0, 0], true),
        { ...node('cloth', [0.5, 0, 0]), gravity: 0, animForce: 0, animVertex: 0, collideRadius: 0.5 },
        node('anchor', [0, 1, 0], true)];
      model.rods = [];
      model.addWorldCollisionRadius = margin;
      if (shape === 'sphere') model.spheres = [{ node: 0, sphere: [0, 0, 0, 1], mask: 0xffff }];
      else model.boxes = [{ node: 0, pos: [0, 0, 0], rot: Q, halfSize: [1, 1, 1], mask: 0xffff }];
      const root = new THREE.Group();
      model.nodes.forEach((item) => {
        const bone = new THREE.Bone();
        bone.name = item.name; bone.position.fromArray(item.initPos); root.add(bone);
      });
      const harness = createClothSimHarness(root, model);
      harness.step(CLOTH_TIMESTEP);
      positions.push(root.getObjectByName('cloth')!.getWorldPosition(new THREE.Vector3()).x);
      harness.dispose();
    }
    expect(positions).toEqual([1.5, 1.5]);
  });

  it.each([{ flags: 0x80, x: 0.5 }, { flags: 0x2080, x: 1 }])('honors the contact phase selected by compiled flags $flags', ({ flags, x }) => {
    const model = syntheticClothModel();
    model.nodes = [node('body', [0, 0, 0], true),
      { ...node('cloth', [0.5, 0, 0]), gravity: 0, animForce: 1, animVertex: 0 },
      node('anchor', [0, 1, 0], true)];
    model.dynamicNodeFlags = flags;
    model.rods = [];
    model.spheres = [{ node: 0, sphere: [0, 0, 0, 1], mask: 0xffff }];
    const root = new THREE.Group();
    model.nodes.forEach((item) => {
      const bone = new THREE.Bone();
      bone.name = item.name; bone.position.fromArray(item.initPos); root.add(bone);
    });
    const harness = createClothSimHarness(root, model);
    harness.step(CLOTH_TIMESTEP);
    expect(root.getObjectByName('cloth')!.position.x).toBeCloseTo(x, 8);
    harness.dispose();
  });

  it('transfers tangential body motion through contact friction', () => {
    const model = syntheticClothModel();
    model.hasCollisionFriction = true;
    model.nodes = [node('body', [0, 0, 0], true), node('anchor', [1, 0, 0], true),
      { ...node('cloth', [0, 1, 0]), gravity: 100, animForce: 0, animVertex: 0, friction: 0.2 }];
    model.dynamicNodeFlags = 0x2080;
    model.rods = [];
    model.boxes = [{ node: 0, pos: [0, 0, 0], rot: Q, halfSize: [10, 1, 10], mask: 0xffff }];
    const root = new THREE.Group();
    model.nodes.forEach((item) => {
      const bone = new THREE.Bone();
      bone.name = item.name; bone.position.fromArray(item.initPos); root.add(bone);
    });
    const harness = createClothSimHarness(root, model);
    harness.step(CLOTH_TIMESTEP);
    harness.step(CLOTH_TIMESTEP, () => { root.getObjectByName('body')!.position.x = 0.001; });
    expect(root.getObjectByName('cloth')!.position.x).toBeCloseTo(0.001, 8);
    expect(root.getObjectByName('cloth')!.position.y).toBeCloseTo(1, 8);
    harness.dispose();
  });
});

function syntheticFitClothModel(): ClothModel {
  return {
    ...syntheticClothModel(),
    nodes: [
      node('fit_anchor', [0, 0, 0], true),
      node('fit_left', [1, 0.15, 0.1]),
      node('fit_right', [0.15, 1, -0.1]),
      node('fit_ctrl', [0.55, 0.55, 0.35]),
    ],
    rods: [
      { a: 0, b: 1, min: 1.016, max: 1.016, relax: 0.9, weight: 0 },
      { a: 0, b: 2, min: 1.016, max: 1.016, relax: 0.9, weight: 0 },
      { a: 1, b: 2, min: 1.22, max: 1.22, relax: 0.8, weight: 0.5 },
    ],
    skelParents: [-1, 0, 0, 0],
    firstPositionDrivenNode: 4,
    fitMatrices: [{
      node: 3,
      endWeight: 3,
      beginDynamic: 0,
      bone: [0.2625, 0.2625, 0.35],
      boneRot: Q,
      center: [0.2875, 0.2875, 0],
      ctrl: 3,
    }],
    fitWeights: [
      { node: 0, weight: 2 },
      { node: 1, weight: 1 },
      { node: 2, weight: 1 },
    ],
  };
}

function syntheticStrayClothModel(): ClothModel {
  return {
    ...syntheticClothModel(),
    nodes: [
      node('stray_anchor', [0, 0, 0], true),
      node('stray_tip', [0.45, 0, 0]),
      node('stray_tail', [0.45, 0.2, 0]),
    ],
    rods: [
      { a: 1, b: 2, min: 0.2, max: 0.2, relax: 1, weight: 0.5 },
    ],
    strayRadii: [{ node: [0, 1], maxDist: 0.35, relax: 1 }],
    strayRadiusBatches: [[{ node: [0, 1], maxDist: 0.35, relax: 1 }]],
    skelParents: [-1, 0, 1],
    staticNodeCount: 1,
    firstPositionDrivenNode: 3,
  };
}

function syntheticPlaneClothModel(): ClothModel {
  return {
    ...syntheticClothModel(),
    nodes: [
      node('plane_anchor', [0, 0, 0], true),
      node('plane_child', [0, -1, 0]),
      node('plane_spare', [1, 0, 0]),
    ],
    rods: [],
    collisionPlanes: [
      { ctrlParent: 0, childNode: 1, normal: [0, 1, 0], offset: 0, strength: 1 },
      { ctrlParent: 0, childNode: 9, normal: [0, 1, 0], offset: 100, strength: 1 },
    ],
    skelParents: [-1, 0, 0],
    firstPositionDrivenNode: 3,
  };
}

function syntheticJiggleClothModel(): ClothModel {
  return {
    ...syntheticClothModel(),
    nodes: [
      node('jiggle_anchor', [0, 0, 0], true),
      node('jiggle_dynamic', [0.4, 0.7, 0.2]),
      node('jiggle_spare', [1, 0, 0], true),
    ],
    rods: [],
    skelParents: [-1, 0, 0],
    staticNodeCount: 1,
    firstPositionDrivenNode: 3,
    jiggleBones: [{ node: 1, jiggleParent: 0, params: jiggleParams }],
  };
}

function syntheticFitRoot(): THREE.Group {
  const root = new THREE.Group();
  for (const [name, pos] of [
    ['fit_anchor', [0, 0, 0]],
    ['fit_left', [1, 0.15, 0.1]],
    ['fit_right', [0.15, 1, -0.1]],
    ['fit_ctrl', [0.55, 0.55, 0.35]],
  ] as const) {
    const bone = new THREE.Bone();
    bone.name = name;
    bone.position.fromArray(pos);
    root.add(bone);
  }
  root.updateWorldMatrix(true, true);
  return root;
}

function syntheticStrayRoot(): THREE.Group {
  const root = new THREE.Group();
  for (const [name, pos] of [
    ['stray_anchor', [0, 0, 0]],
    ['stray_tip', [0.45, 0, 0]],
    ['stray_tail', [0.45, 0.2, 0]],
  ] as const) {
    const bone = new THREE.Bone();
    bone.name = name;
    bone.position.fromArray(pos);
    root.add(bone);
  }
  root.updateWorldMatrix(true, true);
  return root;
}

function syntheticPlaneRoot(): THREE.Group {
  const root = new THREE.Group();
  for (const [name, pos] of [
    ['plane_anchor', [0, 0, 0]],
    ['plane_child', [0, -1, 0]],
    ['plane_spare', [1, 0, 0]],
  ] as const) {
    const bone = new THREE.Bone();
    bone.name = name;
    bone.position.fromArray(pos);
    root.add(bone);
  }
  root.updateWorldMatrix(true, true);
  return root;
}

function syntheticJiggleRoot(): { root: THREE.Group; jiggle: THREE.Bone } {
  const root = new THREE.Group();
  const anchor = new THREE.Bone();
  const jiggle = new THREE.Bone();
  const spare = new THREE.Bone();
  anchor.name = 'jiggle_anchor';
  jiggle.name = 'jiggle_dynamic';
  spare.name = 'jiggle_spare';
  anchor.position.set(0, 0, 0);
  jiggle.position.set(0.4, 0.7, 0.2);
  spare.position.set(1, 0, 0);
  root.add(anchor, jiggle, spare);
  root.updateWorldMatrix(true, true);
  return { root, jiggle };
}

describe('createClothSimHarness', () => {
  it('uses animated rod lengths without freezing or feeding back a reverse-offset bone', () => {
    const model = syntheticClothModel();
    model.nodes = [node('anchor', [0, 0, 0], true), node('cloth', [2, 0, 0]), node('other', [0, 2, 0], true)];
    model.nodes[1] = { ...model.nodes[1], gravity: 0, animForce: 0, animVertex: 0, damping: 0 };
    model.rods = [];
    model.extraIterations = 0;
    model.dynamicNodeFlags = 0x80;
    const rod = { a: 0, b: 1, weight: 0, relax: 0.5 };
    model.animatedRods = [rod];
    model.animatedRodBatches = [[rod, rod, rod, rod]];
    model.reverseOffsets = [{ boneCtrl: 1, targetNode: 0, offset: [2, 0, 0] }];
    const root = new THREE.Group();
    model.nodes.forEach((particle) => {
      const bone = new THREE.Bone();
      bone.name = particle.name; bone.position.fromArray(particle.initPos); root.add(bone);
    });
    const harness = createClothSimHarness(root, model);
    harness.step(CLOTH_TIMESTEP);
    harness.step(CLOTH_TIMESTEP, () => { root.getObjectByName('cloth')!.position.set(0, 6, 0); });
    expect(harness.snapshot().nodes[1].position).toEqual([4, 0, 0]);
    expect(root.getObjectByName('cloth')!.position.toArray()).toEqual([2, 0, 0]);
    expect(harness.snapshot().rods[0]).toMatchObject({ min: 6, max: 6, error: 2 });
    expect(harness.metrics().coverage.animatedRods).toBe(1);
    expect(harness.metrics().kinematicCount).toBe(2);
    harness.step(CLOTH_TIMESTEP);
    expect(harness.snapshot().nodes[1].position).toEqual([6, 0, 0]);
    expect(root.getObjectByName('cloth')!.position.toArray()).toEqual([2, 0, 0]);
    harness.dispose();
    expect(root.getObjectByName('cloth')!.position.toArray()).toEqual([0, 6, 0]);
  });

  it('can render generated targets without applying gravity, contacts or rod relaxation', () => {
    const { root, anchor } = syntheticRoot();
    const model = syntheticClothModel();
    model.ctrlOffsets = [{ parent: 0, child: 1, offset: [1, 0.25, 0.2] }];
    model.spheres = [{ node: 0, sphere: [0, 0, 0, 5], mask: 0xffff }];
    const harness = createClothSimHarness(root, model, { mode: 'targets' });
    for (let i = 0; i < 120; i++) harness.step(CLOTH_TIMESTEP, (dt) => { anchor.position.x += dt; });
    const snapshot = harness.snapshot();
    for (const particle of snapshot.nodes) expect(particle.position).toEqual(particle.target);
    expect(root.getObjectByName('cloth_mid')!.position.x).toBeCloseTo(2, 8);
    expect(harness.metrics().simulationSteps).toBe(120);
    harness.dispose();
    expect(root.getObjectByName('cloth_mid')!.position.x).toBe(1);
  });

  it('keeps an animated attachment fixed when its simulated parent translates', () => {
    const model = syntheticClothModel();
    model.nodes = [
      node('anchor', [0, 0, 0], true),
      node('attachment', [1, 1, 0], true),
      { ...node('moving_parent', [1, 0, 0]), gravity: 100, animForce: 0, animVertex: 1 },
    ];
    model.staticNodeCount = 2;
    model.dynamicNodeFlags = 0x80;
    model.skelParents = [-1, 2, -1];
    model.rods = [];
    const root = new THREE.Group();
    const anchor = new THREE.Bone();
    anchor.name = 'anchor';
    const parent = new THREE.Bone();
    parent.name = 'moving_parent';
    parent.position.set(1, 0, 0);
    const attachment = new THREE.Bone();
    attachment.name = 'attachment';
    attachment.position.set(0, 1, 0);
    root.add(anchor, parent);
    parent.add(attachment);
    const harness = createClothSimHarness(root, model);
    for (let i = 0; i < 120; i++) harness.step(CLOTH_TIMESTEP);
    expect(parent.position.y).toBeLessThan(-0.1);
    expect(attachment.getWorldPosition(new THREE.Vector3()).distanceTo(new THREE.Vector3(1, 1, 0))).toBeLessThan(1e-7);
    harness.dispose();
    expect(attachment.position.toArray()).toEqual([0, 1, 0]);
  });

  it.each(['twist', 'rope'])('rotates a static %s base while preserving descendant animation anchors and cleanup', (kind) => {
    const model = syntheticClothModel();
    model.nodes = [
      node('cable_base', [0, 0, 0], true),
      node('child_anchor', [0, 1, 0], true),
      node('spare_anchor', [1, 0, 0], true),
      { ...node('cable_tip', [0, 0, 1]), gravity: 100, animForce: 0, animVertex: 0.2 },
    ];
    model.rods = [{ a: 0, b: 3, min: 1, max: 1, relax: 1, weight: 0 }];
    if (kind === 'twist') model.twists = [{ nodeOrient: 0, nodeEnd: 3, twistRelax: 0, swingRelax: 1 }];
    else { model.ropeChains = [[0, 3]]; model.ropeCount = 1; }
    model.staticNodeCount = 3;
    model.firstPositionDrivenNode = 4;
    model.dynamicNodeFlags = 0x80;
    const root = new THREE.Group();
    const bones = model.nodes.map((item) => {
      const bone = new THREE.Bone();
      bone.name = item.name;
      bone.position.fromArray(item.initPos);
      return bone;
    });
    root.add(bones[0], bones[2]);
    bones[0].add(bones[1], bones[3]);
    const harness = createClothSimHarness(root, model);
    for (let i = 0; i < 120; i++) harness.step(CLOTH_TIMESTEP);
    expect(bones[0].quaternion.angleTo(new THREE.Quaternion())).toBeGreaterThan(0.1);
    expect(bones[0].getWorldPosition(new THREE.Vector3()).length()).toBeLessThan(1e-7);
    expect(bones[1].getWorldPosition(new THREE.Vector3()).distanceTo(new THREE.Vector3(0, 1, 0))).toBeLessThan(1e-7);
    expect(bones[1].getWorldQuaternion(new THREE.Quaternion()).angleTo(new THREE.Quaternion())).toBeLessThan(1e-7);
    harness.dispose();
    bones.forEach((bone, index) => {
      expect(bone.position.distanceTo(new THREE.Vector3().fromArray(model.nodes[index].initPos))).toBeLessThan(1e-7);
      expect(bone.quaternion.angleTo(new THREE.Quaternion())).toBeLessThan(1e-7);
    });
    model.rotLockStaticNodeCount = 1;
    const locked = createClothSimHarness(root, model);
    for (let i = 0; i < 120; i++) locked.step(CLOTH_TIMESTEP);
    expect(bones[0].quaternion.angleTo(new THREE.Quaternion())).toBeLessThan(1e-7);
    locked.dispose();
  });

  it('samples moving body anchors without restoring them to the initial pose', () => {
    const { root, anchor } = syntheticRoot();
    const harness = createClothSimHarness(root, syntheticClothModel());
    for (let i = 0; i < 120; i++) {
      harness.step(CLOTH_TIMESTEP, (dt) => { anchor.position.x += dt; });
    }
    expect(anchor.position.x).toBeCloseTo(1, 8);
    expect(harness.metrics().simulationSteps).toBe(120);
    harness.dispose();
    expect(anchor.position.x).toBeCloseTo(1, 8);
  });

  it('does not write a simulated node-base rotation into an animated body anchor', () => {
    const { root, anchor } = syntheticRoot();
    const model = syntheticClothModel();
    model.nodeBases = [{ node: 0, x0: 0, x1: 1, y0: 0, y1: 2, qAdjust: Q }];
    const harness = createClothSimHarness(root, model);
    const rotation = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), 0.7);
    harness.step(CLOTH_TIMESTEP, () => { anchor.quaternion.copy(rotation); });
    expect(anchor.quaternion.angleTo(rotation)).toBeLessThan(1e-7);
    harness.dispose();
    expect(anchor.quaternion.angleTo(rotation)).toBeLessThan(1e-7);
  });

  it('restores unkeyed cloth channels before animation and on disposal', () => {
    const { root, anchor } = syntheticRoot();
    const tip = root.getObjectByName('cloth_tip')!;
    const initial = tip.position.clone();
    const mixer = new THREE.AnimationMixer(root);
    const clip = new THREE.AnimationClip('partial', 2, [
      new THREE.NumberKeyframeTrack('cloth_anchor.position[x]', [0, 2], [0, 2]),
      new THREE.QuaternionKeyframeTrack('cloth_tip.quaternion', [0, 2], [0, 0, 0, 1, 0, 0, 1, 0]),
    ]);
    mixer.clipAction(clip).play();
    const harness = createClothSimHarness(root, syntheticClothModel());
    for (let i = 0; i < 60; i++) {
      harness.step(CLOTH_TIMESTEP, (dt) => {
        expect(tip.position.distanceTo(initial)).toBeLessThan(1e-8);
        mixer.update(dt);
      });
    }
    expect(tip.position.distanceTo(initial)).toBeGreaterThan(0.01);
    const animatedRotation = tip.quaternion.clone();
    harness.dispose();
    expect(tip.position.distanceTo(initial)).toBeLessThan(1e-8);
    expect(tip.quaternion.angleTo(animatedRotation)).toBeLessThan(1e-7);
    expect(anchor.position.x).toBeCloseTo(0.5, 8);
    harness.dispose();
    expect(anchor.position.x).toBeCloseTo(0.5, 8);
  });

  it('runs the same animated simulation at 30, 60, 144 and 360 render fps', () => {
    const runs = [30, 60, 144, 360].map((fps) => {
      const { root, anchor } = syntheticRoot();
      const harness = createClothSimHarness(root, syntheticClothModel());
      const mixer = new THREE.AnimationMixer(root);
      const clip = new THREE.AnimationClip('move', 4, [
        new THREE.NumberKeyframeTrack('cloth_anchor.position[x]', [0, 4], [0, 2]),
      ]);
      mixer.clipAction(clip).play();
      for (let frame = 0; frame < fps * 2; frame++) {
        harness.step(1 / fps, (dt) => mixer.update(dt));
      }
      expect(anchor.position.x).toBeCloseTo(1, 8);
      expect(harness.metrics().simulationSteps).toBe(240);
      return root.children.map((bone) => bone.position.toArray()).flat();
    });
    for (const run of runs.slice(1)) {
      run.forEach((value, index) => expect(value).toBeCloseTo(runs[0][index], 8));
    }
  });

  it('accumulates short frames, ignores invalid time and treats a suspended tab as paused', () => {
    const { root, anchor } = syntheticRoot();
    const harness = createClothSimHarness(root, syntheticClothModel());
    const animate = (dt: number) => { anchor.position.x += dt; };
    harness.step(CLOTH_TIMESTEP / 2, animate);
    expect(anchor.position.x).toBe(0);
    harness.step(CLOTH_TIMESTEP / 2, animate);
    expect(anchor.position.x).toBeCloseTo(CLOTH_TIMESTEP, 10);
    for (const invalid of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, 2]) {
      harness.step(invalid, animate);
    }
    expect(harness.metrics().simulationSteps).toBe(1);
    harness.step(CLOTH_TIMESTEP, animate);
    expect(anchor.position.x).toBeCloseTo(2 * CLOTH_TIMESTEP, 10);
    const metrics = harness.step(0.2, animate);
    expect(metrics.simulationSteps).toBe(14);
    expect(metrics.finite).toBe(1);
  });

  it('can step zero time headlessly without moving the pinned node', () => {
    const { root, anchor } = syntheticRoot();
    const harness = createClothSimHarness(root, syntheticClothModel());
    const before = anchor.getWorldPosition(new THREE.Vector3());

    const metrics = harness.step(0);
    const after = anchor.getWorldPosition(new THREE.Vector3());

    expect(metrics).toMatchObject({
      finite: 1,
      nodeCount: 3,
      kinematicCount: 1,
    });
    expect(metrics.maxFrameMotion).toBeLessThan(0.02);
    expect(after.distanceTo(before)).toBeCloseTo(0, 8);
  });

  it('exposes detached diagnostics with the transform used for bone writeback', () => {
    const { root } = syntheticRoot();
    root.position.set(3, 4, 5);
    root.scale.setScalar(0.0254);
    const harness = createClothSimHarness(root, syntheticClothModel());
    harness.step(CLOTH_TIMESTEP);
    const before = harness.metrics();
    const snapshot = harness.snapshot();
    const transform = new THREE.Matrix4().fromArray(snapshot.modelToWorld);
    for (const particle of snapshot.nodes) {
      const bone = root.getObjectByName(particle.name)!;
      const position = new THREE.Vector3().fromArray(particle.position).applyMatrix4(transform);
      expect(position.distanceTo(bone.getWorldPosition(new THREE.Vector3()))).toBeLessThan(1e-10);
    }
    const original = snapshot.nodes[1].position[0];
    snapshot.nodes[1].position[0] += 100;
    snapshot.rods[0].min = 100;
    expect(harness.snapshot().nodes[1].position[0]).toBe(original);
    expect(harness.snapshot().rods[0].min).toBe(1.05);
    expect(harness.metrics()).toEqual(before);
  });

  it('stays finite and bounded over a small 60fps run', () => {
    const { root } = syntheticRoot();
    const harness = createClothSimHarness(root, syntheticClothModel());
    let metrics = harness.metrics();

    for (let i = 0; i < 600; i++) {
      metrics = harness.step(1 / 60);
    }

    expect(metrics.finite).toBe(1);
    expect(metrics.nodeCount).toBe(3);
    expect(metrics.kinematicCount).toBe(1);
    expect(metrics.rmse).toBeLessThan(0.5);
    expect(metrics.maxDistanceFromInit).toBeLessThan(1);
    expect(metrics.maxFrameMotion).toBeLessThan(0.05);
  });

  it.each([{ freeNodes: [] }, { freeNodes: [2] }])('simulates positive-mass node bases independently of the free-orientation list $freeNodes', ({ freeNodes }) => {
    const { root } = syntheticRoot();
    const model = syntheticClothModel();
    model.freeNodes = freeNodes;
    model.dynamicNodeFlags = 0x80;
    model.rods = [];
    model.nodeBases = [{ node: 1, x0: 0, x1: 1, y0: 0, y1: 2, qAdjust: Q }];
    for (const particle of model.nodes.slice(1)) {
      particle.gravity = 100;
      particle.animForce = 0;
      particle.animVertex = 0.2;
    }
    const harness = createClothSimHarness(root, model);
    harness.step(CLOTH_TIMESTEP);
    expect(harness.metrics().kinematicCount).toBe(1);
    for (const particle of model.nodes.slice(1)) {
      expect(root.getObjectByName(particle.name)!.position.y).toBeCloseTo(particle.initPos[1] - 100 * CLOTH_TIMESTEP ** 2, 8);
    }
    expect(root.getObjectByName('cloth_anchor')!.position.toArray()).toEqual([0, 0, 0]);
  });

  it.each([{ pinned: false }, { pinned: true }])('reconstructs ordered soft-offset targets even for exported bones (pinned=$pinned)', ({ pinned }) => {
    const model = syntheticClothModel();
    model.nodes = [
      node('a', [0, 0, 0], true), node('b', [2, 0, 0], true), node('c', [0, 2, 0], true),
      { ...node('generated', [1, 0, 0], pinned), animForce: 1, animVertex: 0, gravity: 0 },
    ];
    model.staticNodeCount = pinned ? 4 : 3;
    model.firstPositionDrivenNode = 4;
    model.rods = [];
    model.dynamicNodeFlags = 0x80;
    model.ctrlOffsets = [{ parent: 0, child: 3, offset: [1, 0, 0] }];
    model.softOffsets = [
      { parent: 1, child: 3, offset: [-1, 0, 0], alpha: 0.75 },
      { parent: 2, child: 3, offset: [1, -2, 0], alpha: 0.6 },
    ];
    const root = new THREE.Group();
    const bones = model.nodes.map((particle) => {
      const bone = new THREE.Bone();
      bone.name = particle.name;
      bone.position.fromArray(particle.initPos);
      root.add(bone);
      return bone;
    });
    const harness = createClothSimHarness(root, model);
    harness.step(CLOTH_TIMESTEP, () => {
      bones[0].position.x = 10;
      bones[1].position.x = 22;
      bones[2].position.y = 32;
    });
    // ((11,0) * .75 + (21,0) * .25) * .6 + (1,30) * .4.
    expect(bones[3].position.x).toBeCloseTo(8.5, 8);
    expect(bones[3].position.y).toBeCloseTo(12, 8);
    expect(harness.metrics().maxAnchorError).toBeLessThan(1e-8);
    harness.dispose();
    expect(bones[3].position.toArray()).toEqual([1, 0, 0]);
    expect(bones[0].position.x).toBe(10);
  });

  it('keeps a FitMatrix control bounded while source nodes settle', () => {
    const root = syntheticFitRoot();
    const harness = createClothSimHarness(root, syntheticFitClothModel());
    let metrics = harness.metrics();

    for (let i = 0; i < 180; i++) {
      metrics = harness.step(1 / 60);
    }

    expect(metrics.finite).toBe(1);
    expect(metrics.nodeCount).toBe(4);
    expect(metrics.kinematicCount).toBe(2);
    expect(metrics.maxDistanceFromInit).toBeLessThan(0.75);
    expect(metrics.maxFrameMotion).toBeLessThan(0.04);
  });

  it('uses the compiled collapsed-fit fallback and resumes without changing particles', () => {
    const model = syntheticFitClothModel();
    model.nodes.slice(0, 3).forEach((source) => { source.pinned = true; });
    model.staticNodeCount = 3;
    model.firstPositionDrivenNode = 3;
    model.rods = [];
    const root = syntheticFitRoot();
    const control = root.getObjectByName('fit_ctrl')!;
    const original = control.position.clone();
    const harness = createClothSimHarness(root, model);
    harness.step(CLOTH_TIMESTEP, () => {
      model.nodes.slice(0, 3).forEach((source) => root.getObjectByName(source.name)!.position.set(5, 6, 7));
    });
    expect(control.position.distanceTo(new THREE.Vector3().fromArray(model.fitMatrices[0].bone))).toBeLessThan(1e-8);
    expect(harness.snapshot().nodes[3].position).toEqual(original.toArray());
    harness.step(CLOTH_TIMESTEP, () => {
      model.nodes.slice(0, 3).forEach((source) => root.getObjectByName(source.name)!.position.fromArray(source.initPos));
    });
    expect(control.position.distanceTo(original)).toBeLessThan(1e-8);
    expect(harness.snapshot().nodes[3].position).toEqual(original.toArray());
    harness.dispose();
    expect(control.position.distanceTo(original)).toBeLessThan(1e-8);
  });

  it.each([false, true])('writes a fit transform separately from its particle and attached animation-owned controls (pinned=%s)', (pinned) => {
    const model = syntheticFitClothModel();
    model.nodes.slice(0, 3).forEach((source) => { source.pinned = true; });
    model.nodes[3].pinned = pinned;
    model.nodes.push(node('attachment', [0.55, 1.55, 0.35]));
    model.firstPositionDrivenNode = 3;
    model.staticNodeCount = pinned ? 4 : 3;
    model.rods = [];
    model.skelParents.push(3);
    const root = syntheticFitRoot();
    const control = root.getObjectByName('fit_ctrl')!;
    const attachment = new THREE.Bone();
    attachment.name = 'attachment';
    attachment.position.set(0, 1, 0);
    control.add(attachment);
    const initial = new THREE.Vector3().fromArray(model.nodes[3].initPos);
    const rotation = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), 0.6);
    const translation = new THREE.Vector3(3, -2, 1);
    const expected = initial.clone().applyQuaternion(rotation).add(translation);
    const harness = createClothSimHarness(root, model);
    for (let tick = 0; tick < 2; tick++) {
      harness.step(CLOTH_TIMESTEP, () => {
        model.nodes.slice(0, 3).forEach((source) => {
          root.getObjectByName(source.name)!.position.fromArray(source.initPos).applyQuaternion(rotation).add(translation);
        });
      });
      expect(control.getWorldPosition(new THREE.Vector3()).distanceTo(expected)).toBeLessThan(1e-8);
      expect(control.getWorldQuaternion(new THREE.Quaternion()).angleTo(rotation)).toBeLessThan(1e-7);
      expect(harness.snapshot().nodes[3].position).toEqual(initial.toArray());
      expect(attachment.getWorldPosition(new THREE.Vector3()).distanceTo(new THREE.Vector3(0.55, 1.55, 0.35))).toBeLessThan(1e-8);
      expect(harness.metrics().maxAnchorError).toBeLessThan(1e-8);
    }
    harness.dispose();
    expect(control.position.distanceTo(initial)).toBeLessThan(1e-8);
    expect(attachment.position.distanceTo(new THREE.Vector3(0, 1, 0))).toBeLessThan(1e-8);
  });

  it('keeps a stray-radius clamp finite and bounded over repeated steps', () => {
    const root = syntheticStrayRoot();
    const harness = createClothSimHarness(root, syntheticStrayClothModel());
    let metrics = harness.metrics();

    for (let i = 0; i < 240; i++) {
      metrics = harness.step(1 / 60);
    }

    expect(metrics.finite).toBe(1);
    expect(metrics.nodeCount).toBe(3);
    expect(metrics.kinematicCount).toBe(1);
    expect(metrics.maxDistanceFromInit).toBeLessThan(0.75);
    expect(metrics.maxFrameMotion).toBeLessThan(0.12);
  });

  it('applies a collision plane through the solver pass', () => {
    const root = syntheticPlaneRoot();
    const child = root.children.find((obj) => obj.name === 'plane_child') as THREE.Bone;
    const harness = createClothSimHarness(root, syntheticPlaneClothModel());

    const metrics = harness.step(CLOTH_TIMESTEP);
    root.updateWorldMatrix(true, true);

    expect(metrics.finite).toBe(1);
    expect(child.getWorldPosition(new THREE.Vector3()).y).toBeCloseTo(0, 6);
  });

  it('keeps a param-bearing jiggle node on its target under gravity', () => {
    const { root, jiggle } = syntheticJiggleRoot();
    const expected = jiggle.getWorldPosition(new THREE.Vector3());
    const harness = createClothSimHarness(root, syntheticJiggleClothModel());
    let metrics = harness.metrics();

    for (let i = 0; i < 180; i++) {
      metrics = harness.step(1 / 60);
    }

    root.updateWorldMatrix(true, true);
    expect(metrics.finite).toBe(1);
    expect(metrics.kinematicCount).toBe(3);
    expect(metrics.maxDistanceFromTarget).toBeLessThan(1e-6);
    expect(jiggle.getWorldPosition(new THREE.Vector3()).distanceTo(expected)).toBeLessThan(1e-6);
  });
});
