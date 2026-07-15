// Parser for the raw Source 2 FeModel cloth data delivered over IPC by
// `vpkmerge model femodel` (a generic JSON projection of the whole PHYS.m_pFeModel
// KV3 subtree). This is the TS mirror of morphic's `decode_fe_model`
// (morphic/src/model/femodel.rs): it turns the raw m_-keyed JSON into a typed
// `ClothModel` the rod-graph XPBD solver consumes.
//
// The field semantics + the two non-obvious folds (collision radius/friction are
// DYNAMIC-slot indexed; the per-node collision mask lives in the collision-BVH
// leaves) are validated against necro+dynamo by the Rust rest oracle
// (morphic/tests/fe_rest_oracle.rs) and the decode tests.

// --- raw wire shape (the full PHYS.m_pFeModel subtree; only m_CtrlName required) ---

export interface RawFeModel {
  m_CtrlName: string[];
  m_SkelParents?: number[];
  m_NodeInvMasses?: number[]; // 0 = pinned/kinematic
  m_InitPose?: number[][]; // [x,y,z,1, qx,qy,qz,qw]
  m_NodeIntegrator?: Array<{
    flGravity?: number;
    flPointDamping?: number;
    flAnimationForceAttraction?: number;
    flAnimationVertexAttraction?: number;
  }>;
  m_Rods?: Array<{
    nNode: [number, number];
    flMinDist?: number;
    flMaxDist?: number;
    flRelaxationFactor?: number;
    flWeight0?: number;
  }>;
  m_NodeBases?: Array<{
    nNode: number;
    nNodeX0: number;
    nNodeX1: number;
    nNodeY0: number;
    nNodeY1: number;
    qAdjust: number[]; // [x,y,z,w]
  }>;
  m_CtrlOffsets?: Array<{ vOffset: number[]; nCtrlParent: number; nCtrlChild: number }>;
  m_ReverseOffsets?: Array<{ vOffset: number[]; nBoneCtrl: number; nTargetNode: number }>;
  m_CtrlSoftOffsets?: Array<{
    vOffset: number[];
    nCtrlParent: number;
    nCtrlChild: number;
    flAlpha?: number;
  }>;
  m_TaperedCapsuleRigids?: Array<{ nNode: number; vSphere: number[][]; nCollisionMask?: number }>;
  m_SphereRigids?: Array<{ nNode: number; vSphere: number[]; nCollisionMask?: number }>;
  m_AnimStrayRadii?: Array<{ nNode: [number, number]; flMaxDist?: number; flRelaxationFactor?: number }>;
  m_BoxRigids?: Array<{
    nNode: number;
    tmFrame2: number[]; // [x,y,z,1, qx,qy,qz,qw]
    vSize: number[];
    nCollisionMask?: number;
  }>;
  m_NodeCollisionRadii?: number[]; // dyn-slot indexed
  m_DynNodeFriction?: number[]; // dyn-slot indexed
  m_TreeCollisionMasks?: number[]; // collision BVH; leaves [0,D) hold per-node masks
  m_nStaticNodes?: number;
  m_flAddWorldCollisionRadius?: number;
  m_flDefaultGravityScale?: number;
  m_nExtraIterations?: number;
  m_nExtraGoalIterations?: number;

  // --- Phase-B arrays (parsed here, consumed by the stub constraints) ----------
  m_Twists?: Array<{
    nNodeOrient?: number;
    nNodeEnd?: number;
    flTwistRelax?: number;
    flSwingRelax?: number;
  }>;
  m_FitMatrices?: Array<{
    bone?: number[]; // CTransform [x,y,z,1, qx,qy,qz,qw]
    vCenter?: number[];
    nEnd?: number; // end index into m_FitWeights
    nNode?: number; // dynamic center node to back-solve
    nBeginDynamic?: number; // first dynamic-node weight index
    nCtrl?: number; // ctrl whose transform FitTransforms writes
  }>;
  m_FitWeights?: Array<{ flWeight?: number; nNode?: number; nDummy?: number }>;
  m_FreeNodes?: number[]; // node indices oriented by GetAnim, positioned by sim
  m_LockToParent?: Array<{ vOffset?: number[]; nCtrlParent?: number; nCtrlChild?: number }>;
  m_LockToGoal?: number[]; // node/ctrl indices locked to the animated goal
  m_CollisionPlanes?: Array<{
    nCtrlParent?: number;
    nChildNode?: number;
    m_Plane?: { m_vNormal?: number[]; m_flOffset?: number };
    flStrength?: number;
  }>;
  m_Ropes?: number[]; // flat: m_pRopes[i] is the end index of rope i (chain segmentation)
  m_JiggleBones?: Array<{ m_nNode?: number; m_nJiggleParent?: number; m_jiggleBone?: RawJiggleBoneParams }>;
  m_KelagerBends?: Array<{ flHeight0?: number; m_nNode?: number[]; m_nFlags?: number }>;
  m_HingeLimits?: unknown[];
  m_nFirstPositionDrivenNode?: number;
  m_flRodVelocitySmoothRate?: number;
  m_nRodVelocitySmoothIterations?: number;
  m_nRotLockStaticNodes?: number;
}

export interface RawJiggleBoneParams {
  m_nFlags?: number;
  m_flLength?: number;
  m_flTipMass?: number;
  m_flYawStiffness?: number;
  m_flYawDamping?: number;
  m_flMinYaw?: number;
  m_flMaxYaw?: number;
  m_flYawFriction?: number;
  m_flYawBounce?: number;
  m_flPitchStiffness?: number;
  m_flPitchDamping?: number;
  m_flMinPitch?: number;
  m_flMaxPitch?: number;
  m_flPitchFriction?: number;
  m_flPitchBounce?: number;
  m_flAlongStiffness?: number;
  m_flAlongDamping?: number;
  m_flBaseMass?: number;
  m_flBaseStiffness?: number;
  m_flBaseDamping?: number;
  m_flBaseMinLeft?: number;
  m_flBaseMaxLeft?: number;
  m_flBaseLeftFriction?: number;
  m_flBaseMinUp?: number;
  m_flBaseMaxUp?: number;
  m_flBaseUpFriction?: number;
  m_flBaseMinForward?: number;
  m_flBaseMaxForward?: number;
  m_flBaseForwardFriction?: number;
  m_flAngleLimit?: number;
  m_flRadius0?: number;
  m_flRadius1?: number;
  m_vPoint0?: number[];
  m_vPoint1?: number[];
  m_nCollisionMask?: number;
}

// --- typed intermediate the solver consumes -------------------------------------

export type Vec3 = [number, number, number];
export type Vec4 = [number, number, number, number];

export interface ClothNode {
  name: string; // m_CtrlName[i] (== GLB joint name)
  invMass: number;
  pinned: boolean; // invMass <= 0: driven kinematically from the animated body
  gravity: number;
  damping: number;
  animForce: number; // pull toward the animated rest target (mandatory)
  animVertex: number; // per-vertex sibling (no bone-level consumer; see plan)
  initPos: Vec3; // model space, cm, Z-up
  initRot: Vec4; // [x,y,z,w]
  collideRadius: number;
  friction: number;
  collisionMask: number; // AND-tested against a rigid's mask; 0xFFFF = collide-all
}

export interface ClothRod {
  a: number;
  b: number;
  min: number;
  max: number;
  relax: number;
  weight: number;
}

export interface ClothCapsule {
  sphere0: Vec4; // [x,y,z,r] local to `node`
  sphere1: Vec4;
  node: number;
  mask: number;
}

export interface ClothSphere {
  sphere: Vec4; // [x,y,z,r] local to `node`
  node: number;
  mask: number;
}

export interface ClothBox {
  pos: Vec3; // box center, local to `node`
  rot: Vec4;
  size: Vec3; // full extents
  node: number;
  mask: number;
}

export interface ClothNodeBase {
  node: number;
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  qAdjust: Vec4;
}

export interface ClothCtrlOffset {
  offset: Vec3;
  parent: number;
  child: number;
}
export interface ClothReverseOffset {
  offset: Vec3;
  boneCtrl: number;
  targetNode: number;
}
export interface ClothSoftOffset {
  offset: Vec3;
  parent: number;
  child: number;
  alpha: number;
}
export interface ClothStrayRadius {
  node: [number, number];
  maxDist: number;
  relax: number;
}

// --- Phase-B typed records (data, not counts) -----------------------------------

export interface ClothTwist {
  nodeOrient: number; // the node carrying the reference orientation
  nodeEnd: number; // the far node the twist is measured against
  twistRelax: number;
  swingRelax: number;
}

export interface ClothFitMatrix {
  bone: Vec3; // CTransform translation part [x,y,z]
  boneRot: Vec4; // CTransform rotation [qx,qy,qz,qw]
  center: Vec3; // vCenter: rest-pose center of mass
  endWeight: number; // nEnd: end index (exclusive) into fitWeights
  node: number; // dynamic center node to back-solve
  beginDynamic: number; // first dynamic-node weight index in [begin,end)
  ctrl: number; // ctrl whose sim transform FitTransforms writes
}

export interface ClothFitWeight {
  weight: number;
  node: number;
}

export interface ClothCollisionPlane {
  ctrlParent: number; // anim-anchored ctrl whose frame holds the plane
  childNode: number; // the node pushed out of the half-space
  normal: Vec3; // plane normal in ctrlParent's frame
  offset: number; // plane offset along the normal
  strength: number;
}

export interface ClothJiggleBoneParams {
  flags: number;
  length: number;
  tipMass: number;
  yawStiffness: number;
  yawDamping: number;
  minYaw: number;
  maxYaw: number;
  yawFriction: number;
  yawBounce: number;
  pitchStiffness: number;
  pitchDamping: number;
  minPitch: number;
  maxPitch: number;
  pitchFriction: number;
  pitchBounce: number;
  alongStiffness: number;
  alongDamping: number;
  baseMass: number;
  baseStiffness: number;
  baseDamping: number;
  baseMinLeft: number;
  baseMaxLeft: number;
  baseLeftFriction: number;
  baseMinUp: number;
  baseMaxUp: number;
  baseUpFriction: number;
  baseMinForward: number;
  baseMaxForward: number;
  baseForwardFriction: number;
  angleLimit: number;
  radius0: number;
  radius1: number;
  point0: Vec3;
  point1: Vec3;
  collisionMask: number;
}

export interface ClothJiggleBone {
  node: number;
  jiggleParent: number;
  params: ClothJiggleBoneParams | null;
}

export interface ClothKelagerBend {
  height0: number; // relaxed distance from tip to base centroid
  node: Vec3; // [v, b0, b1] tip + two base ends (uint16 triple)
  flags: number; // low 3 bits: inverse masses of the three nodes
}

export interface ClothModel {
  nodes: ClothNode[];
  rods: ClothRod[];
  capsules: ClothCapsule[];
  spheres: ClothSphere[];
  boxes: ClothBox[];
  nodeBases: ClothNodeBase[];
  ctrlOffsets: ClothCtrlOffset[];
  reverseOffsets: ClothReverseOffset[];
  softOffsets: ClothSoftOffset[];
  strayRadii: ClothStrayRadius[];
  skelParents: number[];
  staticNodeCount: number;
  addWorldCollisionRadius: number;
  defaultGravityScale: number;
  extraIterations: number;
  extraGoalIterations: number;

  // --- Phase-B data (parsed; consumed by the stub constraints) -----------------
  twists: ClothTwist[];
  fitMatrices: ClothFitMatrix[];
  fitWeights: ClothFitWeight[];
  freeNodes: number[];
  lockToParent: ClothCtrlOffset[]; // reuses {offset, parent, child}
  lockToGoal: number[];
  collisionPlanes: ClothCollisionPlane[];
  ropes: number[]; // flat rope-end-index array (chain segmentation)
  jiggleBones: ClothJiggleBone[];
  kelagerBends: ClothKelagerBend[];
  firstPositionDrivenNode: number; // m_nFirstPositionDrivenNode (>= here => reconstructed)
  rodVelocitySmoothRate: number;
  rodVelocitySmoothIterations: number;
  rotLockStaticNodeCount: number;
}

const num = (v: unknown, d = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const vec3 = (a: number[] | undefined): Vec3 => [num(a?.[0]), num(a?.[1]), num(a?.[2])];
const vec4 = (a: number[] | undefined, w = 1): Vec4 => [
  num(a?.[0]),
  num(a?.[1]),
  num(a?.[2]),
  num(a?.[3], w),
];
const sphere4 = (a: number[] | undefined): Vec4 => [num(a?.[0]), num(a?.[1]), num(a?.[2]), num(a?.[3])];
const jiggleParent = (v: unknown): number => {
  const parent = num(v, -1);
  return parent === 0xffffffff ? -1 : parent;
};

const isObject = (v: unknown): v is object => typeof v === 'object' && v !== null;

const parseJiggleBoneParams = (p: RawJiggleBoneParams | undefined): ClothJiggleBoneParams | null => {
  if (!isObject(p)) return null;

  return {
    flags: num(p.m_nFlags),
    length: num(p.m_flLength),
    tipMass: num(p.m_flTipMass),
    yawStiffness: num(p.m_flYawStiffness),
    yawDamping: num(p.m_flYawDamping),
    minYaw: num(p.m_flMinYaw),
    maxYaw: num(p.m_flMaxYaw),
    yawFriction: num(p.m_flYawFriction),
    yawBounce: num(p.m_flYawBounce),
    pitchStiffness: num(p.m_flPitchStiffness),
    pitchDamping: num(p.m_flPitchDamping),
    minPitch: num(p.m_flMinPitch),
    maxPitch: num(p.m_flMaxPitch),
    pitchFriction: num(p.m_flPitchFriction),
    pitchBounce: num(p.m_flPitchBounce),
    alongStiffness: num(p.m_flAlongStiffness),
    alongDamping: num(p.m_flAlongDamping),
    baseMass: num(p.m_flBaseMass),
    baseStiffness: num(p.m_flBaseStiffness),
    baseDamping: num(p.m_flBaseDamping),
    baseMinLeft: num(p.m_flBaseMinLeft),
    baseMaxLeft: num(p.m_flBaseMaxLeft),
    baseLeftFriction: num(p.m_flBaseLeftFriction),
    baseMinUp: num(p.m_flBaseMinUp),
    baseMaxUp: num(p.m_flBaseMaxUp),
    baseUpFriction: num(p.m_flBaseUpFriction),
    baseMinForward: num(p.m_flBaseMinForward),
    baseMaxForward: num(p.m_flBaseMaxForward),
    baseForwardFriction: num(p.m_flBaseForwardFriction),
    angleLimit: num(p.m_flAngleLimit),
    radius0: num(p.m_flRadius0),
    radius1: num(p.m_flRadius1),
    point0: vec3(p.m_vPoint0),
    point1: vec3(p.m_vPoint1),
    collisionMask: num(p.m_nCollisionMask),
  };
};

/**
 * Parse the raw FeModel JSON (whole m_pFeModel subtree) into a typed `ClothModel`.
 * Returns null when the payload is not a FeModel (no m_CtrlName) so a non-cloth hero
 * is handled cleanly. Mirrors morphic::model::decode_fe_model exactly, including the
 * dynamic-slot fold of radius/friction and the BVH-leaf fold of the per-node mask.
 */
export function parseFeModel(raw: unknown): ClothModel | null {
  const fe = raw as RawFeModel | null | undefined;
  if (!fe || !Array.isArray(fe.m_CtrlName)) return null;

  const names = fe.m_CtrlName;
  const inv = fe.m_NodeInvMasses ?? [];
  const integ = fe.m_NodeIntegrator ?? [];
  const pose = fe.m_InitPose ?? [];
  const radii = fe.m_NodeCollisionRadii ?? [];
  const friction = fe.m_DynNodeFriction ?? [];
  const treeMasks = fe.m_TreeCollisionMasks ?? [];

  // Per-node mask lives in the BVH leaves (indices [0, D), D = dynamic count); leaf k
  // = the k-th dynamic node. Fold only when the leaf layout matches (len == 2*D-1),
  // else fall back to collide-all rather than mis-fold (matches the Rust guard).
  const dynamicCount = inv.reduce((c, v) => c + (num(v) > 0 ? 1 : 0), 0);
  const foldMasks = dynamicCount > 0 && treeMasks.length === 2 * dynamicCount - 1;

  const nodes: ClothNode[] = [];
  let dynSlot = 0;
  for (let i = 0; i < names.length; i++) {
    const invMass = num(inv[i]);
    const it = integ[i] ?? {};
    const p = pose[i] ?? [];
    let collideRadius = 0;
    let fric = 0;
    let mask = 0xffff;
    if (invMass > 0) {
      collideRadius = num(radii[dynSlot]);
      fric = num(friction[dynSlot]);
      if (foldMasks) mask = num(treeMasks[dynSlot], 0xffff);
      dynSlot++;
    }
    nodes.push({
      name: String(names[i] ?? ''),
      invMass,
      pinned: invMass <= 0,
      gravity: num(it.flGravity),
      damping: num(it.flPointDamping),
      animForce: num(it.flAnimationForceAttraction),
      animVertex: num(it.flAnimationVertexAttraction),
      initPos: vec3(p),
      initRot: [num(p[4]), num(p[5]), num(p[6]), num(p[7], 1)],
      collideRadius,
      friction: fric,
      collisionMask: mask,
    });
  }

  const rods: ClothRod[] = (fe.m_Rods ?? []).map((r) => ({
    a: num(r.nNode?.[0]),
    b: num(r.nNode?.[1]),
    min: num(r.flMinDist),
    max: num(r.flMaxDist),
    relax: num(r.flRelaxationFactor, 1),
    weight: num(r.flWeight0),
  }));

  const capsules: ClothCapsule[] = (fe.m_TaperedCapsuleRigids ?? []).map((c) => ({
    sphere0: sphere4(c.vSphere?.[0]),
    sphere1: sphere4(c.vSphere?.[1]),
    node: num(c.nNode),
    mask: num(c.nCollisionMask),
  }));

  const spheres: ClothSphere[] = (fe.m_SphereRigids ?? []).map((s) => ({
    sphere: sphere4(s.vSphere),
    node: num(s.nNode),
    mask: num(s.nCollisionMask),
  }));

  const boxes: ClothBox[] = (fe.m_BoxRigids ?? []).map((b) => ({
    pos: vec3(b.tmFrame2),
    rot: [num(b.tmFrame2?.[4]), num(b.tmFrame2?.[5]), num(b.tmFrame2?.[6]), num(b.tmFrame2?.[7], 1)],
    size: vec3(b.vSize),
    node: num(b.nNode),
    mask: num(b.nCollisionMask),
  }));

  const nodeBases: ClothNodeBase[] = (fe.m_NodeBases ?? []).map((b) => ({
    node: num(b.nNode),
    x0: num(b.nNodeX0),
    x1: num(b.nNodeX1),
    y0: num(b.nNodeY0),
    y1: num(b.nNodeY1),
    qAdjust: vec4(b.qAdjust),
  }));

  const ctrlOffsets: ClothCtrlOffset[] = (fe.m_CtrlOffsets ?? []).map((c) => ({
    offset: vec3(c.vOffset),
    parent: num(c.nCtrlParent),
    child: num(c.nCtrlChild),
  }));

  const reverseOffsets: ClothReverseOffset[] = (fe.m_ReverseOffsets ?? []).map((r) => ({
    offset: vec3(r.vOffset),
    boneCtrl: num(r.nBoneCtrl),
    targetNode: num(r.nTargetNode),
  }));

  const softOffsets: ClothSoftOffset[] = (fe.m_CtrlSoftOffsets ?? []).map((c) => ({
    offset: vec3(c.vOffset),
    parent: num(c.nCtrlParent),
    child: num(c.nCtrlChild),
    alpha: num(c.flAlpha),
  }));

  const strayRadii: ClothStrayRadius[] = (fe.m_AnimStrayRadii ?? []).map((s) => ({
    node: [num(s.nNode?.[0]), num(s.nNode?.[1])],
    maxDist: num(s.flMaxDist),
    relax: num(s.flRelaxationFactor, 1),
  }));

  const twists: ClothTwist[] = (fe.m_Twists ?? []).map((t) => ({
    nodeOrient: num(t.nNodeOrient),
    nodeEnd: num(t.nNodeEnd),
    twistRelax: num(t.flTwistRelax),
    swingRelax: num(t.flSwingRelax),
  }));

  const fitMatrices: ClothFitMatrix[] = (fe.m_FitMatrices ?? []).map((m) => ({
    bone: vec3(m.bone),
    boneRot: [num(m.bone?.[4]), num(m.bone?.[5]), num(m.bone?.[6]), num(m.bone?.[7], 1)],
    center: vec3(m.vCenter),
    endWeight: num(m.nEnd),
    node: num(m.nNode),
    beginDynamic: num(m.nBeginDynamic),
    ctrl: num(m.nCtrl, num(m.nNode)),
  }));

  const fitWeights: ClothFitWeight[] = (fe.m_FitWeights ?? []).map((w) => ({
    weight: num(w.flWeight),
    node: num(w.nNode),
  }));

  const lockToParent: ClothCtrlOffset[] = (fe.m_LockToParent ?? []).map((l) => ({
    offset: vec3(l.vOffset),
    parent: num(l.nCtrlParent),
    child: num(l.nCtrlChild),
  }));

  const collisionPlanes: ClothCollisionPlane[] = (fe.m_CollisionPlanes ?? []).map((p) => ({
    ctrlParent: num(p.nCtrlParent),
    childNode: num(p.nChildNode),
    normal: vec3(p.m_Plane?.m_vNormal),
    offset: num(p.m_Plane?.m_flOffset),
    strength: num(p.flStrength, 1),
  }));

  const jiggleBones: ClothJiggleBone[] = (fe.m_JiggleBones ?? []).map((j) => ({
    node: num(j.m_nNode),
    jiggleParent: jiggleParent(j.m_nJiggleParent),
    params: parseJiggleBoneParams(j.m_jiggleBone),
  }));

  const kelagerBends: ClothKelagerBend[] = (fe.m_KelagerBends ?? []).map((k) => ({
    height0: num(k.flHeight0),
    node: vec3(k.m_nNode),
    flags: num(k.m_nFlags),
  }));

  return {
    nodes,
    rods,
    capsules,
    spheres,
    boxes,
    nodeBases,
    ctrlOffsets,
    reverseOffsets,
    softOffsets,
    strayRadii,
    skelParents: (fe.m_SkelParents ?? []).map((v) => num(v, -1)),
    staticNodeCount: num(fe.m_nStaticNodes),
    addWorldCollisionRadius: num(fe.m_flAddWorldCollisionRadius),
    defaultGravityScale: num(fe.m_flDefaultGravityScale, 1),
    extraIterations: num(fe.m_nExtraIterations),
    extraGoalIterations: num(fe.m_nExtraGoalIterations),

    twists,
    fitMatrices,
    fitWeights,
    freeNodes: (fe.m_FreeNodes ?? []).map((v) => num(v)),
    lockToParent,
    lockToGoal: (fe.m_LockToGoal ?? []).map((v) => num(v)),
    collisionPlanes,
    ropes: (fe.m_Ropes ?? []).map((v) => num(v)),
    jiggleBones,
    kelagerBends,
    firstPositionDrivenNode: num(fe.m_nFirstPositionDrivenNode, names.length),
    rodVelocitySmoothRate: num(fe.m_flRodVelocitySmoothRate),
    rodVelocitySmoothIterations: num(fe.m_nRodVelocitySmoothIterations),
    rotLockStaticNodeCount: num(fe.m_nRotLockStaticNodes),
  };
}
