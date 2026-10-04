import { describe, it, expect } from 'vitest';
import { clothIntegratorMode, parseFeModel, type RawFeModel } from './feModel';
import gigawattRaw from './__fixtures__/cloth/gigawatt_fe.json';

// Mirror of morphic's `decodes_binding_fields` fixture: 3 nodes (1 static + 2 dynamic),
// the binding maps, the collision tree (D=2 -> leaves [0,2), masks.len()==2*D-1==3 so
// per-node masks fold), boxes, stray radii.
const raw: RawFeModel = {
  m_CtrlName: ['pelvis', '$cloth_a', '$cloth_b'],
  m_NodeInvMasses: [0.0, 2.0, 2.0], // node 0 static, 1+2 dynamic (dyn slots 0,1)
  m_nStaticNodes: 1,
  m_NodeIntegrator: [
    { flGravity: 0, flPointDamping: 0, flAnimationForceAttraction: 0, flAnimationVertexAttraction: 0 },
    { flGravity: 360, flPointDamping: 0.5, flAnimationForceAttraction: 1, flAnimationVertexAttraction: 0.25 },
    { flGravity: 360, flPointDamping: 0.5, flAnimationForceAttraction: 0.5, flAnimationVertexAttraction: 0 },
  ],
  m_InitPose: [
    [0, 0, 0, 1, 0, 0, 0, 1],
    [1, 2, 3, 1, 0, 0, 0, 1],
    [4, 5, 6, 1, 0, 0, 0, 1],
  ],
  m_NodeCollisionRadii: [1.5, 2.5], // dyn-slot: node1 -> 1.5, node2 -> 2.5
  m_DynNodeFriction: [0.3, 0.6],
  m_flAddWorldCollisionRadius: 2.0,
  m_flDefaultGravityScale: 1.5,
  m_SkelParents: [-1, 0, 1],
  m_Rods: [{ nNode: [1, 2], flMinDist: 1.0, flMaxDist: 2.0, flRelaxationFactor: 0.8, flWeight0: 0.5 }],
  m_NodeBases: [{ nNode: 2, nNodeX0: 1, nNodeX1: 0, nNodeY0: 2, nNodeY1: 1, qAdjust: [0, 0, 0, 1] }],
  m_CtrlOffsets: [{ vOffset: [1, 2, 3], nCtrlParent: 0, nCtrlChild: 1 }],
  m_ReverseOffsets: [{ vOffset: [4, 5, 6], nBoneCtrl: 1, nTargetNode: 2 }],
  m_CtrlSoftOffsets: [{ vOffset: [7, 8, 9], nCtrlParent: 1, nCtrlChild: 2, flAlpha: 0.5 }],
  m_TaperedCapsuleRigids: [
    { nNode: 0, nCollisionMask: 15, vSphere: [[0, 0, 0, 2], [0, 0, 5, 1.5]] },
  ],
  m_BoxRigids: [{ nNode: 0, nCollisionMask: 15, tmFrame2: [1, 2, 3, 1, 0, 0, 0, 1], vSize: [4, 5, 6] }],
  m_AnimStrayRadii: [{ nNode: [1, 2], flMaxDist: 7, flRelaxationFactor: 1 }],
  // D=2 dynamic nodes -> leaves [0,2), internal node 2; masks.len()==3 so masks fold.
  m_TreeCollisionMasks: [7, 15, 65535],
  m_nExtraIterations: 18,
  m_nExtraGoalIterations: 12,
};

describe('parseFeModel', () => {
  it.each([
    { friction: undefined, enabled: false },
    { friction: [], enabled: false },
    { friction: [0, 0], enabled: true },
    { friction: [0.3, 0.6], enabled: true },
  ])('retains the contact kernel selection for friction data $friction', ({ friction, enabled }) => {
    expect(parseFeModel({ ...raw, m_DynNodeFriction: friction })!.hasCollisionFriction).toBe(enabled);
  });

  it('decodes binary collider selections from byte weights and respects map offsets', () => {
    const model = parseFeModel({ ...raw,
      m_VertexMaps: [{ nVertexBase: 0, nVertexCount: 3, nMapOffset: 1 }],
      m_VertexMapValues: [255, 0, 1, 255],
      m_SphereRigids: [{ nNode: 0, vSphere: [0, 0, 0, 1], nVertexMapIndex: 0 }],
    })!;
    expect(model.spheres[0].vertexNodes).toEqual([1, 2]);
    expect(model.decodeIssues).toEqual([]);
  });

  it.each([0xffff, 10, -1, undefined])('treats an out-of-range vertex map as unscoped (%s)', (index) => {
    const model = parseFeModel({ ...raw,
      m_VertexMaps: [{ nVertexBase: 0, nVertexCount: 0, nMapOffset: 0 }],
      m_SphereRigids: [{ nNode: 0, vSphere: [0, 0, 0, 1], nVertexMapIndex: index }],
    })!;
    expect(model.spheres[0].vertexNodes).toBeUndefined();
  });

  it.each([
    { map: { nVertexBase: 1, nVertexCount: 3, nMapOffset: 0 }, values: [255, 255], reason: 'invalid-offsets' },
    { map: { nVertexBase: 0, nVertexCount: 1, nMapOffset: -1 }, values: [255], reason: 'invalid-offsets' },
    { map: { nVertexBase: 0, nVertexCount: 1, nMapOffset: 0 }, values: [256], reason: 'invalid-weights' },
  ])('reports a malformed referenced selection without broadening it: $reason', ({ map, values, reason }) => {
    const model = parseFeModel({ ...raw, m_VertexMaps: [map], m_VertexMapValues: values,
      m_SphereRigids: [{ nNode: 0, vSphere: [0, 0, 0, 1], nVertexMapIndex: 0 }],
    })!;
    expect(model.spheres[0].vertexNodes).toEqual([]);
    expect(model.decodeIssues).toContainEqual({ array: 'm_VertexMaps', record: 0, reason });
  });

  it('accepts empty named selections with a sentinel vertex base', () => {
    const model = parseFeModel({ ...raw, m_VertexMaps: [{ nVertexBase: 0xffff, nVertexCount: 0, nMapOffset: 0 }],
      m_SphereRigids: [{ nNode: 0, vSphere: [0, 0, 0, 1], nVertexMapIndex: 0 }],
    })!;
    expect(model.spheres[0].vertexNodes).toEqual([]);
    expect(model.decodeIssues).toEqual([]);
  });

  it('requires a complete monotone priority partition and retains SDF coverage gaps', () => {
    const zero = { m_nTaperedCapsuleRigidIndex: 0, m_nSphereRigidIndex: 0, m_nBoxRigidIndex: 0, m_nSDFRigidIndex: 0, m_nCollisionPlaneIndex: 0 };
    const end = { ...zero, m_nTaperedCapsuleRigidIndex: 1, m_nBoxRigidIndex: 1 };
    const valid = [zero, { ...zero, m_nTaperedCapsuleRigidIndex: 1 }, end];
    const model = parseFeModel({ ...raw, m_RigidColliderPriorities: valid })!;
    expect(model.capsules[0].priority).toBe(0);
    expect(model.boxes[0].priority).toBe(1);
    expect(model.decodeIssues).toEqual([]);
    for (const rows of [[zero], [zero, zero], [zero, end, zero, end]]) {
      const fallback = parseFeModel({ ...raw, m_RigidColliderPriorities: rows })!;
      expect(fallback.decodeIssues.some((issue) => issue.array === 'm_RigidColliderPriorities')).toBe(true);
      expect(fallback.capsules[0].priority).toBe(0);
      expect(fallback.boxes[0].priority).toBe(0);
    }
    expect(parseFeModel({ ...raw, m_SDFRigids: [{}] })!.featureGaps).toContainEqual({
      field: 'm_SDFRigids', label: 'SDF colliders', count: 1, status: 'not-implemented',
    });
  });

  it('preserves stray-limit target/particle indices and packed repeats without duplicating coverage', () => {
    const limit = { nNode: [[0, 0, 0, 0], [2, 2, 2, 2]], flMaxDist: [1, 1, 1, 1], flRelaxationFactor: [0.5, 0.5, 0.5, 0.5] };
    const model = parseFeModel({ ...raw, m_AnimStrayRadii: [], m_SimdAnimStrayRadii: [limit, limit] })!;
    expect(model.strayRadii).toEqual([{ node: [0, 2], maxDist: 1, relax: 0.5 }]);
    expect(model.strayRadiusBatches).toHaveLength(2);
    expect(model.strayRadiusBatches[0]).toHaveLength(4);
  });

  it('reports invalid stray radii and falls back from malformed packing', () => {
    const model = parseFeModel({ ...raw, m_AnimStrayRadii: [
      { nNode: [0, 2], flMaxDist: 1, flRelaxationFactor: 1 },
      { nNode: [99, 1], flMaxDist: 1, flRelaxationFactor: 1 },
      { nNode: [1, 2], flMaxDist: -1, flRelaxationFactor: 1 },
    ], m_SimdAnimStrayRadii: [{ nNode: [0, 1] }] })!;
    expect(model.strayRadiusBatches).toEqual([[{ node: [0, 2], maxDist: 1, relax: 1 }]]);
    expect(model.decodeIssues.map((issue) => issue.reason)).toEqual(['invalid-nodes', 'invalid-limits', 'invalid-nodes']);
  });

  it('decodes scalar triangle partitions and falls back when a packed block is incomplete', () => {
    const triangle = { nNode: [0, 1, 2], w1: 0, w2: 1, v1x: 2, v2: [1, 0.6] };
    const model = parseFeModel({ ...raw, m_Tris: [triangle], m_nTriCount1: 1, m_nTriCount2: 1,
      m_SimdTris: [{ nNode: [[0, 0, 0, 0], [1, 1, 1, 1], [2, 2, 2, 2]] }],
      m_nSimdTriCount1: 1, m_nSimdTriCount2: 1 })!;
    expect(model.triangles).toEqual([{ node: [0, 1, 2], staticCount: 2, weight1: 0, weight2: 1, x1: 2, x2: 1, y2: 0.6 }]);
    expect(model.triangleBatches).toEqual([model.triangles]);
    expect(model.decodeIssues.every((issue) => issue.array === 'm_SimdTris' && issue.reason === 'invalid-weights')).toBe(true);
    expect(model.featureGaps).toEqual([]);
  });

  it('rejects missing or reversed triangle partitions instead of assuming movable anchors', () => {
    const triangle = { nNode: [0, 1, 2], w1: 0.3, w2: 0.7, v1x: 2, v2: [1, 1] };
    for (const counts of [{}, { m_nTriCount1: 0, m_nTriCount2: 1 }, { m_nTriCount1: 2, m_nTriCount2: 0 }]) {
      const model = parseFeModel({ ...raw, m_Tris: [triangle], ...counts })!;
      expect(model.triangleBatches).toEqual([]);
      expect(model.decodeIssues).toEqual([{ array: 'm_Tris', record: 0, reason: 'invalid-count' }]);
    }
  });

  it('rejects invalid triangle indices, mass shares and rest geometry', () => {
    const triangle = { nNode: [0, 1, 2], w1: 0.3, w2: 0.4, v1x: 2, v2: [1, 1] };
    const model = parseFeModel({ ...raw, m_nTriCount1: 0, m_nTriCount2: 0, m_Tris: [
      { ...triangle, nNode: [0, 1, 99] }, { ...triangle, nNode: [0, 1, 1] },
      { ...triangle, w2: 0.9 }, { ...triangle, v2: [0, Number.NaN] },
    ] })!;
    expect(model.triangleBatches).toEqual([]);
    expect(model.decodeIssues.map((issue) => issue.reason)).toEqual(['invalid-nodes', 'invalid-nodes', 'invalid-weights', 'invalid-limits']);
  });

  it('decodes supported quads and falls back to scalar records when packing is malformed', () => {
    const quad = { nNode: [0, 1, 2, 3], flSlack: 0, vShape: [[-1, 0, 0, 0], [1, 0, 0, 0], [-1, 2, 0, 0.4], [1, 2, 0, 0.6]] };
    const model = parseFeModel({ m_CtrlName: ['a', 'b', 'c', 'd'], m_Quads: [quad], m_nQuadCount1: 1, m_nQuadCount2: 1,
      m_SimdQuads: [{ nNode: [] }], m_nSimdQuadCount1: 1, m_nSimdQuadCount2: 1 })!;
    expect(model.quads).toHaveLength(1);
    expect(model.quads[0]).toEqual({ node: [0, 1, 2, 3], staticCount: 2, shape: quad.vShape, slack: 0 });
    expect(model.quadBatches).toEqual([model.quads]);
    expect(model.featureGaps).toEqual([]);
    expect(model.decodeIssues).toEqual([{ array: 'm_SimdQuads', record: 0, reason: 'invalid-nodes' }]);
  });

  it('rejects ambiguous quad partitions and invalid rest shapes', () => {
    const quad = { nNode: [0, 1, 2, 3], flSlack: 0, vShape: [[-1, 0, 0, 0], [1, 0, 0, 0], [-1, 2, 0, 0.4], [1, 2, 0, 0.6]] };
    const names = ['a', 'b', 'c', 'd'];
    for (const counts of [{}, { m_nQuadCount1: 0, m_nQuadCount2: 1 }, { m_nQuadCount1: 2, m_nQuadCount2: 0 }]) {
      const model = parseFeModel({ m_CtrlName: names, m_Quads: [quad], ...counts })!;
      expect(model.quadBatches).toEqual([]);
      expect(model.decodeIssues).toEqual([{ array: 'm_Quads', record: 0, reason: 'invalid-count' }]);
    }
    const model = parseFeModel({ m_CtrlName: names, m_nQuadCount1: 4, m_nQuadCount2: 4, m_Quads: [
      { ...quad, nNode: [0, 1, 2, 99] }, { ...quad, nNode: [0, 1, 2, 2] },
      { ...quad, vShape: [[0, 0, 0, 1], ...quad.vShape.slice(1)] }, { ...quad, flSlack: Number.NaN },
    ] })!;
    expect(model.quadBatches).toEqual([]);
    expect(model.decodeIssues.map((issue) => issue.reason)).toEqual(['invalid-nodes', 'invalid-nodes', 'invalid-weights', 'invalid-limits']);
  });

  it('reports missing constraint families without counting SIMD copies twice or unscoped colliders', () => {
    const quad = { nNode: [0, 1, 2, 3], flSlack: 0, vShape: [[-1, 0, 0, 0.25], [1, 0, 0, 0.25], [-1, 2, 0, 0.25], [1, 2, 0, 0.25]] };
    const model = parseFeModel({
      ...raw,
      m_CtrlName: ['a', 'b', 'c', 'd'], m_Quads: [quad, quad], m_nQuadCount1: 0, m_nQuadCount2: 0,
      m_TaperedCapsuleRigids: [
        { nNode: 0, vSphere: [], nFlags: 0, nVertexMapIndex: 0xffff },
        { nNode: 0, vSphere: [], nFlags: 1, nVertexMapIndex: 0 },
      ],
    })!;
    expect(model.featureGaps).toEqual([
      { field: 'm_TaperedCapsuleRigids.nFlags', label: 'Collider flags', count: 1, status: 'not-implemented' },
    ]);
    expect(model.decodeIssues).toEqual([]);
  });

  it('validates hinge nodes, weights, flags and angular bounds before solving', () => {
    const hinge = { nNode: [0, 1, 2, 1, 2, 1], flWeight4: 0.3, flWeight5: 0.4, flAngleCenter: 1.6, flAngleExtents: 0.5 };
    const model = parseFeModel({ ...raw, m_HingeLimits: [
      hinge,
      { ...hinge, nNode: [0, 1, 2, 99, 2, 1] },
      { ...hinge, flWeight4: 1.1 },
      { ...hinge, flAngleExtents: -1 },
      { ...hinge, nFlags: 1 },
    ] })!;
    expect(model.hingeLimits).toEqual([{ node: [0, 1, 2, 1, 2, 1], weight4: 0.3, weight5: 0.4, center: 1.6, extents: 0.5 }]);
    expect(model.decodeIssues.map((issue) => issue.reason)).toEqual(['invalid-nodes', 'invalid-weights', 'invalid-limits', 'unsupported-flags']);
  });

  it('preserves packed fixed-rod order and padding independently from the scalar list', () => {
    const model = parseFeModel(gigawattRaw)!;
    expect(model.rods).toHaveLength(157);
    expect(model.rodBatches).toHaveLength(40);
    expect(model.rodBatches[0].map(({ a, b }) => [a, b])).toEqual([[17, 59], [16, 57], [128, 127], [125, 124]]);
    expect(model.rodBatches[0][0]).toMatchObject({ weight: 0, relax: 1, min: 7.988489151000977, max: 7.988489151000977 });
    expect(model.rodBatches.flat()).toHaveLength(160);
  });

  it('reports a malformed packed rod and retains the complete scalar fallback', () => {
    const model = parseFeModel({
      ...raw,
      m_SimdRods: [
        { nNode: [[0, 1, 1, 1], [1, 2, 2, 99]] },
        { nNode: [[0, 1, 1, 1], [1, 2, 2, 2]], f4MinDist: [2, 2, 2, 2], f4MaxDist: [1, 1, 1, 1] },
      ],
    })!;
    expect(model.rodBatches).toEqual([]);
    expect(model.rods).toHaveLength(1);
    expect(model.decodeIssues).toEqual([
      { array: 'm_SimdRods', record: 0, reason: 'invalid-nodes' },
      { array: 'm_SimdRods', record: 1, reason: 'invalid-limits' },
    ]);
  });

  it('preserves the shipped Gigawatt bend indices and signed weights', () => {
    const model = parseFeModel(gigawattRaw)!;
    expect(model.twists).toHaveLength(42);
    expect(model.kelagerBends).toHaveLength(18);
    expect(model.decodeIssues).toEqual([]);
    for (const [index, bend] of model.kelagerBends.entries()) {
      const source = gigawattRaw.m_KelagerBends[index];
      expect(bend.node).toEqual(source.nNode);
      expect(bend.weight).toEqual(source.flWeight);
      expect(bend.height0).toBe(source.flHeight0);
    }
    expect(model.kelagerBends[0].node).toEqual([52, 105, 51]);
    expect(model.kelagerBends.at(-1)!.weight[0]).toBeLessThan(0);
  });

  it('reports invalid bend data instead of inventing node zero and zero weights', () => {
    const model = parseFeModel({
      ...raw,
      m_KelagerBends: [
        { m_nNode: [0, 1, 2], flWeight: [0, 3, 0], flHeight0: 1 },
        { nNode: [0, 1, 99], flWeight: [0, 3, 0], flHeight0: 1 },
        { nNode: [0, 1, 2], flWeight: [0, Number.NaN, 0], flHeight0: 1 },
        { nNode: [0, 1, 2], flWeight: [0, 3, 0], flHeight0: Number.NaN },
      ],
    })!;
    expect(model.kelagerBends).toEqual([]);
    expect(model.decodeIssues.map((issue) => issue.reason)).toEqual([
      'invalid-nodes', 'invalid-nodes', 'invalid-weights', 'invalid-height',
    ]);
  });

  it.each([
    { nNode: [[0, 1, 1, 1], [1, 2, 2, 2]] },
    { nNode: [0, 1, 1, 1, 1, 2, 2, 2] },
  ])('recovers animated rods with no scalar equivalent from SIMD packing $nNode', ({ nNode }) => {
    const model = parseFeModel({
      ...raw,
      m_Rods: [],
      m_SimdRodsAnim: [{ nNode, f4Weight0: [0, 0.25, 0.25, 0.25], f4RelaxationFactor: [1, 0.85, 0.85, 0.85] }],
    })!;
    expect(model.rods).toEqual([]);
    expect(model.animatedRods).toEqual([{ a: 0, b: 1, weight: 0, relax: 1 }, { a: 1, b: 2, weight: 0.25, relax: 0.85 }]);
    expect(model.animatedRodBatches[0]).toHaveLength(4);
    expect(model.decodeIssues).toEqual([]);
  });

  it('keeps animated rod endpoint order and reports invalid SIMD lanes', () => {
    const model = parseFeModel({
      ...raw,
      m_SimdRodsAnim: [{ nNode: [[1, 2, 99, 0], [2, 1, 1, 0]], f4Weight0: [0.25, 0.75, 0.5, 0.5] }],
    })!;
    expect(model.animatedRods).toEqual([{ a: 1, b: 2, weight: 0.25, relax: 1 }, { a: 2, b: 1, weight: 0.75, relax: 1 }]);
    expect(model.decodeIssues).toEqual([{ array: 'm_SimdRodsAnim', record: 0, reason: 'invalid-nodes' }]);
  });

  it('returns null for a non-FeModel payload', () => {
    expect(parseFeModel(null)).toBeNull();
    expect(parseFeModel({})).toBeNull();
    expect(parseFeModel({ m_CtrlName: 'nope' })).toBeNull();
  });

  it('decodes node counts, pinned flags, and integrator constants', () => {
    const m = parseFeModel(raw)!;
    expect(m.nodes).toHaveLength(3);
    expect(m.staticNodeCount).toBe(1);
    expect(m.nodes[0].pinned).toBe(true); // invMass 0
    expect(m.nodes[1].pinned).toBe(false);
    expect(m.nodes[1].gravity).toBeCloseTo(360, 5);
    expect(m.nodes[1].animForce).toBeCloseTo(1, 5);
    expect(m.nodes[1].animVertex).toBeCloseTo(0.25, 5); // per-vertex attraction, distinct from animForce
    expect(m.nodes[1].initPos).toEqual([1, 2, 3]);
    expect(m.nodes[1].initRot).toEqual([0, 0, 0, 1]);
    expect(m.defaultGravityScale).toBeCloseTo(1.5, 5);
    expect(m.extraIterations).toBe(18);
    expect(m.extraGoalIterations).toBe(12);
  });

  it('folds collision radius/friction by DYNAMIC slot (static node skipped)', () => {
    const m = parseFeModel(raw)!;
    expect(m.nodes[0].collideRadius).toBe(0); // static node consumes no slot
    expect(m.nodes[1].collideRadius).toBeCloseTo(1.5, 5); // dyn slot 0
    expect(m.nodes[2].collideRadius).toBeCloseTo(2.5, 5); // dyn slot 1
    expect(m.nodes[1].friction).toBeCloseTo(0.3, 5);
    expect(m.nodes[2].friction).toBeCloseTo(0.6, 5);
  });

  it('folds per-node collision masks from the BVH leaves (leaf k = k-th dynamic node)', () => {
    const m = parseFeModel(raw)!;
    expect(m.nodes[0].collisionMask).toBe(0xffff); // static -> collide-all
    expect(m.nodes[1].collisionMask).toBe(7); // dyn slot 0 -> masks[0]
    expect(m.nodes[2].collisionMask).toBe(15); // dyn slot 1 -> masks[1]
  });

  it('falls back to collide-all when the tree leaf count does not match 2*D-1', () => {
    const m = parseFeModel({ ...raw, m_TreeCollisionMasks: [7, 15] })!; // wrong length
    expect(m.nodes[1].collisionMask).toBe(0xffff);
    expect(m.nodes[2].collisionMask).toBe(0xffff);
  });

  it('decodes the rod band and binding maps', () => {
    const m = parseFeModel(raw)!;
    expect(m.rods).toHaveLength(1);
    expect(m.rods[0]).toMatchObject({ a: 1, b: 2, min: 1, max: 2, relax: 0.8, weight: 0.5 });

    expect(m.nodeBases).toHaveLength(1);
    expect(m.nodeBases[0]).toMatchObject({ node: 2, x0: 1, x1: 0, y0: 2, y1: 1 });
    expect(m.nodeBases[0].qAdjust).toEqual([0, 0, 0, 1]);

    expect(m.ctrlOffsets[0]).toMatchObject({ parent: 0, child: 1 });
    expect(m.ctrlOffsets[0].offset).toEqual([1, 2, 3]);
    expect(m.reverseOffsets[0]).toMatchObject({ boneCtrl: 1, targetNode: 2 });
    expect(m.softOffsets[0]).toMatchObject({ parent: 1, child: 2, alpha: 0.5 });
    expect(m.skelParents).toEqual([-1, 0, 1]);
  });

  it('decodes capsule, box, and stray-radius colliders/constraints', () => {
    const m = parseFeModel(raw)!;
    expect(m.capsules).toHaveLength(1);
    expect(m.capsules[0].node).toBe(0);
    expect(m.capsules[0].mask).toBe(15);
    expect(m.capsules[0].sphere0).toEqual([0, 0, 0, 2]);

    expect(m.boxes).toHaveLength(1);
    expect(m.boxes[0]).toMatchObject({ node: 0, mask: 15 });
    expect(m.boxes[0].pos).toEqual([1, 2, 3]);
    expect(m.boxes[0].halfSize).toEqual([4, 5, 6]);

    expect(m.strayRadii).toHaveLength(1);
    expect(m.strayRadii[0].node).toEqual([1, 2]);
    expect(m.strayRadii[0].maxDist).toBeCloseTo(7, 5);
  });

  it('decodes collision planes with field defaults', () => {
    const m = parseFeModel({
      ...raw,
      m_CollisionPlanes: [
        {
          nCtrlParent: 2,
          nChildNode: 1,
          m_Plane: { m_vNormal: [0, 1, 0], m_flOffset: 3.5 },
          flStrength: 0.25,
        },
        {},
      ],
    })!;

    expect(m.collisionPlanes).toEqual([
      { ctrlParent: 2, childNode: 1, normal: [0, 1, 0], offset: 3.5, strength: 0.25, priority: 0 },
      { ctrlParent: 0, childNode: 0, normal: [0, 0, 0], offset: 0, strength: 1, priority: 0 },
    ]);
  });

  it('decodes jiggle bones with parent defaults', () => {
    const m = parseFeModel({
      ...raw,
      m_JiggleBones: [
        {
          m_nNode: 2,
          m_nJiggleParent: 1,
          m_jiggleBone: {
            m_nFlags: 3,
            m_flLength: 12,
            m_flTipMass: 0.75,
            m_flYawStiffness: 10,
            m_flYawDamping: 11,
            m_flMinYaw: -12,
            m_flMaxYaw: 13,
            m_flYawFriction: 14,
            m_flYawBounce: 15,
            m_flPitchStiffness: 20,
            m_flPitchDamping: 21,
            m_flMinPitch: -22,
            m_flMaxPitch: 23,
            m_flPitchFriction: 24,
            m_flPitchBounce: 25,
            m_flAlongStiffness: 30,
            m_flAlongDamping: 31,
            m_flBaseMass: 40,
            m_flBaseStiffness: 41,
            m_flBaseDamping: 42,
            m_flBaseMinLeft: -43,
            m_flBaseMaxLeft: 44,
            m_flBaseLeftFriction: 45,
            m_flBaseMinUp: -46,
            m_flBaseMaxUp: 47,
            m_flBaseUpFriction: 48,
            m_flBaseMinForward: -49,
            m_flBaseMaxForward: 50,
            m_flBaseForwardFriction: 51,
            m_flAngleLimit: 60,
            m_flRadius0: 2,
            m_flRadius1: 3,
            m_vPoint0: [1, 2, 3],
            m_vPoint1: [4, 5, 6],
            m_nCollisionMask: 255,
          },
        },
        { m_nNode: 1, m_nJiggleParent: 4294967295 },
        { m_nNode: 1 },
        {},
      ],
    })!;

    expect(m.jiggleBones[0]).toEqual({
      node: 2,
      jiggleParent: 1,
      params: {
        flags: 3,
        length: 12,
        tipMass: 0.75,
        yawStiffness: 10,
        yawDamping: 11,
        minYaw: -12,
        maxYaw: 13,
        yawFriction: 14,
        yawBounce: 15,
        pitchStiffness: 20,
        pitchDamping: 21,
        minPitch: -22,
        maxPitch: 23,
        pitchFriction: 24,
        pitchBounce: 25,
        alongStiffness: 30,
        alongDamping: 31,
        baseMass: 40,
        baseStiffness: 41,
        baseDamping: 42,
        baseMinLeft: -43,
        baseMaxLeft: 44,
        baseLeftFriction: 45,
        baseMinUp: -46,
        baseMaxUp: 47,
        baseUpFriction: 48,
        baseMinForward: -49,
        baseMaxForward: 50,
        baseForwardFriction: 51,
        angleLimit: 60,
        radius0: 2,
        radius1: 3,
        point0: [1, 2, 3],
        point1: [4, 5, 6],
        collisionMask: 255,
      },
    });
    expect(m.jiggleBones.slice(1)).toEqual([
      { node: 1, jiggleParent: -1, params: null },
      { node: 1, jiggleParent: -1, params: null },
      { node: 0, jiggleParent: -1, params: null },
    ]);
  });

  it('decodes jiggle bone params with field defaults', () => {
    const m = parseFeModel({
      ...raw,
      m_JiggleBones: [{ m_nNode: 2, m_jiggleBone: { m_flLength: 12, m_vPoint0: [9] } }],
    })!;

    expect(m.jiggleBones[0]).toEqual({
      node: 2,
      jiggleParent: -1,
      params: {
        flags: 0,
        length: 12,
        tipMass: 0,
        yawStiffness: 0,
        yawDamping: 0,
        minYaw: 0,
        maxYaw: 0,
        yawFriction: 0,
        yawBounce: 0,
        pitchStiffness: 0,
        pitchDamping: 0,
        minPitch: 0,
        maxPitch: 0,
        pitchFriction: 0,
        pitchBounce: 0,
        alongStiffness: 0,
        alongDamping: 0,
        baseMass: 0,
        baseStiffness: 0,
        baseDamping: 0,
        baseMinLeft: 0,
        baseMaxLeft: 0,
        baseLeftFriction: 0,
        baseMinUp: 0,
        baseMaxUp: 0,
        baseUpFriction: 0,
        baseMinForward: 0,
        baseMaxForward: 0,
        baseForwardFriction: 0,
        angleLimit: 0,
        radius0: 0,
        radius1: 0,
        point0: [9, 0, 0],
        point1: [0, 0, 0],
        collisionMask: 0,
      },
    });
  });
});

describe('compiled rope and twist decoding', () => {
  it('decodes ordered rope runs after their exclusive-end header', () => {
    const model = parseFeModel({ m_CtrlName: ['a', 'b', 'c'], m_nRopeCount: 2, m_Ropes: [5, 7, 0, 1, 2, 0, 2] })!;
    expect(model.ropeChains).toEqual([[0, 1, 2], [0, 2]]);
    expect(model.decodeIssues).toEqual([]);
  });

  it.each([
    { m_nRopeCount: -1, m_Ropes: [], reason: 'invalid-count' },
    { m_Ropes: [3, 0, 1], reason: 'invalid-count' },
    { m_nRopeCount: 1, m_Ropes: [4, 0, 1], reason: 'invalid-offsets' },
    { m_nRopeCount: 1, m_Ropes: [2, 0], reason: 'invalid-offsets' },
    { m_nRopeCount: 1, m_Ropes: [3, 0, 8], reason: 'invalid-nodes' },
    { m_nRopeCount: 1, m_Ropes: [3, 0, 1, 2], reason: 'invalid-offsets' },
  ])('rejects malformed rope packing: %j', ({ reason, ...packed }) => {
    const model = parseFeModel({ m_CtrlName: ['a', 'b', 'c'], ...packed })!;
    expect(model.ropeChains).toEqual([]);
    expect(model.decodeIssues).toEqual([{ array: 'm_Ropes', record: 0, reason }]);
  });

  it('rejects malformed twist links instead of modifying a fabricated node zero', () => {
    const model = parseFeModel({ m_CtrlName: ['base', 'tip'], m_Twists: [
      {},
      { nNodeOrient: -1, nNodeEnd: 1, flTwistRelax: 1, flSwingRelax: 1 },
      { nNodeOrient: 0, nNodeEnd: 1, flTwistRelax: Number.NaN, flSwingRelax: 1 },
      { nNodeOrient: 0, nNodeEnd: 1, flTwistRelax: 0.618, flSwingRelax: 0.5 },
    ] })!;
    expect(model.twists).toEqual([{ nodeOrient: 0, nodeEnd: 1, twistRelax: 0.618, swingRelax: 0.5 }]);
    expect(model.decodeIssues).toEqual([
      { array: 'm_Twists', record: 0, reason: 'invalid-nodes' },
      { array: 'm_Twists', record: 1, reason: 'invalid-nodes' },
      { array: 'm_Twists', record: 2, reason: 'invalid-weights' },
    ]);
  });

});

describe('compiled integrator selection', () => {
  it('uses dynamic-node bit indices, including the unsigned high bit and next word', () => {
    const model = parseFeModel({
      m_CtrlName: Array.from({ length: 35 }, (_, i) => `node_${i}`),
      m_nStaticNodes: 2,
      m_nStaticNodeFlags: 0x200,
      m_nDynamicNodeFlags: 0x680,
      m_GoalDampedSpringIntegrators: [0x80000001, 1],
    })!;
    expect(clothIntegratorMode(model, 0)).toBe('raw');
    expect(clothIntegratorMode(model, 2)).toBe('goal-damped');
    expect(clothIntegratorMode(model, 3)).toBe('raw');
    expect(clothIntegratorMode(model, 33)).toBe('goal-damped');
    expect(clothIntegratorMode(model, 34)).toBe('goal-damped');
  });

  it.each([
    [0x80, 'goal-damped'], [0x200, 'raw'], [0x400, 'raw'], [0x680, 'unknown'],
  ])('classifies band flags %i without guessing mixed nodes', (flags, mode) => {
    const model = parseFeModel({ ...raw, m_nDynamicNodeFlags: flags })!;
    expect(clothIntegratorMode(model, 1)).toBe(mode);
  });

  it('does not infer an integrator from attraction values when selectors are absent', () => {
    const model = parseFeModel(raw)!;
    expect(model.dynamicNodeFlags).toBeNull();
    expect(clothIntegratorMode(model, 1)).toBe('unknown');
    expect(model.nodes[1].animForce).toBe(1);
    expect(model.nodes[1].animVertex).toBe(0.25);
  });

  it('reports invalid selector words and leaves truncated mixed bitsets unknown', () => {
    const invalid = parseFeModel({ ...raw, m_GoalDampedSpringIntegrators: [-1] })!;
    expect(invalid.decodeIssues[0].reason).toBe('invalid-bitset');
    expect(clothIntegratorMode(invalid, 1)).toBe('unknown');
    const truncated = { ...invalid, goalDampedSpringIntegrators: [1], dynamicNodeFlags: 0x680 };
    expect(clothIntegratorMode(truncated, 33)).toBe('unknown');
  });
});
