import { describe, it, expect } from 'vitest';
import { parseFeModel, type RawFeModel } from './feModel';

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
    expect(m.boxes[0].size).toEqual([4, 5, 6]);

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
      { ctrlParent: 2, childNode: 1, normal: [0, 1, 0], offset: 3.5, strength: 0.25 },
      { ctrlParent: 0, childNode: 0, normal: [0, 0, 0], offset: 0, strength: 1 },
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
