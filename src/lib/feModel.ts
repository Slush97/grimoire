// Parser for the raw Source 2 FeModel cloth data delivered over IPC by
// `vpkmerge model femodel` (a generic JSON projection of the whole PHYS.m_pFeModel
// KV3 subtree). The preview decodes this directly, independently of morphic's
// typed Rust decoder. See docs/source2-preview-physics.md for source references
// and the distinction between decoded records and implemented simulation.
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
  m_SimdRods?: Array<{
    nNode?: number[] | number[][];
    f4MinDist?: number[];
    f4MaxDist?: number[];
    f4Weight0?: number[];
    f4RelaxationFactor?: number[];
  }>;
  m_SimdRodsAnim?: Array<{
    nNode?: number[] | number[][];
    f4Weight0?: number[];
    f4RelaxationFactor?: number[];
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
  m_TaperedCapsuleRigids?: Array<{ nNode: number; vSphere: number[][]; nCollisionMask?: number; nFlags?: number; nVertexMapIndex?: number }>;
  m_SphereRigids?: Array<{ nNode: number; vSphere: number[]; nCollisionMask?: number; nFlags?: number; nVertexMapIndex?: number }>;
  m_AnimStrayRadii?: Array<{ nNode: [number, number]; flMaxDist?: number; flRelaxationFactor?: number }>;
  m_SimdAnimStrayRadii?: Array<{
    nNode?: number[] | number[][];
    flMaxDist?: number[];
    flRelaxationFactor?: number[];
  }>;
  m_BoxRigids?: Array<{
    nNode: number;
    tmFrame2: number[]; // [x,y,z,1, qx,qy,qz,qw]
    vSize: number[]; // half-extents
    nCollisionMask?: number;
    nFlags?: number;
    nVertexMapIndex?: number;
  }>;
  m_NodeCollisionRadii?: number[]; // dyn-slot indexed
  m_DynNodeFriction?: number[]; // dyn-slot indexed
  m_TreeCollisionMasks?: number[]; // collision BVH; leaves [0,D) hold per-node masks
  m_nStaticNodes?: number;
  m_nStaticNodeFlags?: number;
  m_nDynamicNodeFlags?: number;
  m_GoalDampedSpringIntegrators?: number[];
  m_flAddWorldCollisionRadius?: number;
  m_flDefaultGravityScale?: number;
  m_nExtraIterations?: number;
  m_nExtraGoalIterations?: number;

  // Additional compiled records. Decoding alone does not imply solver support.
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
  m_nRopeCount?: number;
  m_JiggleBones?: Array<{ m_nNode?: number; m_nJiggleParent?: number; m_jiggleBone?: RawJiggleBoneParams }>;
  m_KelagerBends?: Array<{ flHeight0?: number; nNode?: number[]; flWeight?: number[] }>;
  m_HingeLimits?: Array<{
    nNode?: number[];
    nFlags?: number;
    flWeight4?: number;
    flWeight5?: number;
    flAngleCenter?: number;
    flAngleExtents?: number;
  }>;
  m_Tris?: RawClothTriangle[];
  m_nTriCount1?: number;
  m_nTriCount2?: number;
  m_SimdTris?: Array<{
    nNode?: number[] | number[][];
    w1?: number[];
    w2?: number[];
    v1x?: number[];
    v2?: { x?: number[]; y?: number[] };
  }>;
  m_nSimdTriCount1?: number;
  m_nSimdTriCount2?: number;
  m_Quads?: RawClothQuad[];
  m_nQuadCount1?: number;
  m_nQuadCount2?: number;
  m_SimdQuads?: Array<{
    nNode?: number[] | number[][];
    f4Slack?: number[];
    vShape?: number[][];
    f4Weights?: number[][];
  }>;
  m_nSimdQuadCount1?: number;
  m_nSimdQuadCount2?: number;
  m_AxialEdges?: unknown[];
  m_FollowNodes?: unknown[];
  m_RigidColliderPriorities?: RawColliderPriority[];
  m_SDFRigids?: unknown[];
  m_VertexMaps?: Array<{ nVertexBase?: number; nVertexCount?: number; nMapOffset?: number }>;
  m_VertexMapValues?: number[];
  m_nFirstPositionDrivenNode?: number;
  m_flRodVelocitySmoothRate?: number;
  m_nRodVelocitySmoothIterations?: number;
  m_nRotLockStaticNodes?: number;
}

export interface RawClothQuad {
  nNode?: number[];
  flSlack?: number;
  vShape?: number[][];
}

export interface RawClothTriangle {
  nNode?: number[];
  w1?: number;
  w2?: number;
  v1x?: number;
  v2?: number[];
}

interface RawColliderPriority {
  m_nTaperedCapsuleRigidIndex?: number;
  m_nSphereRigidIndex?: number;
  m_nBoxRigidIndex?: number;
  m_nSDFRigidIndex?: number;
  m_nCollisionPlaneIndex?: number;
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
  animForce: number; // compiled flAnimationForceAttraction, interpreted by integrator mode
  animVertex: number; // compiled flAnimationVertexAttraction
  initPos: Vec3; // model space, Source units, Z-up
  initRot: Vec4; // [x,y,z,w]
  collideRadius: number; // particle radius, also used by local body contacts
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

export interface ClothAnimatedRod {
  a: number;
  b: number;
  weight: number;
  relax: number;
}

export interface ClothColliderFilter {
  mask: number;
  priority?: number;
  vertexNodes?: number[]; // absent: layer filtering; empty: explicitly selects no nodes
}

export interface ClothCapsule extends ClothColliderFilter {
  sphere0: Vec4; // [x,y,z,r] local to `node`
  sphere1: Vec4;
  node: number;
}

export interface ClothSphere extends ClothColliderFilter {
  sphere: Vec4; // [x,y,z,r] local to `node`
  node: number;
}

export interface ClothBox extends ClothColliderFilter {
  pos: Vec3; // box center, local to `node`
  rot: Vec4;
  halfSize: Vec3; // compiled vSize is half-extents
  node: number;
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
  node: [number, number]; // animation target, simulated particle
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
  bone: Vec3; // CTransform offset from the rest fit center [x,y,z]
  boneRot: Vec4; // CTransform rotation [qx,qy,qz,qw]
  center: Vec3; // vCenter: rest-pose center of mass
  endWeight: number; // nEnd: end index (exclusive) into fitWeights
  node: number; // control receiving the reconstructed output transform
  beginDynamic: number; // first dynamic-node weight index in [begin,end)
  ctrl: number; // ctrl whose sim transform FitTransforms writes
}

export interface ClothFitWeight {
  weight: number;
  node: number;
}

export interface ClothCollisionPlane {
  priority?: number;
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
  height0: number;
  node: [number, number, number]; // bent node, first end, second end
  weight: Vec3; // signed solver shares, not inverse masses or flags
}

export interface ClothHingeLimit {
  node: [number, number, number, number, number, number];
  weight4: number;
  weight5: number;
  center: number;
  extents: number;
}

export interface ClothTriangle {
  node: [number, number, number];
  staticCount: 0 | 1 | 2;
  weight1: number;
  weight2: number;
  x1: number;
  x2: number;
  y2: number;
}

export interface ClothQuad {
  node: [number, number, number, number];
  staticCount: 0 | 1 | 2;
  shape: [Vec4, Vec4, Vec4, Vec4];
  slack: number;
}

export interface ClothDecodeIssue {
  array: 'm_KelagerBends' | 'm_HingeLimits' | 'm_Tris' | 'm_SimdTris' | 'm_Quads' | 'm_SimdQuads' | 'm_SimdRods' | 'm_SimdRodsAnim' | 'm_AnimStrayRadii' | 'm_SimdAnimStrayRadii' | 'm_GoalDampedSpringIntegrators' | 'm_Twists' | 'm_Ropes' | 'm_RigidColliderPriorities' | 'm_VertexMaps';
  record: number;
  reason: 'invalid-nodes' | 'invalid-weights' | 'invalid-limits' | 'invalid-height' | 'invalid-bitset' | 'invalid-count' | 'invalid-offsets' | 'unsupported-flags';
}

export type ClothIntegratorMode = 'goal-damped' | 'raw' | 'unknown';

export interface ClothModel {
  nodes: ClothNode[];
  rods: ClothRod[];
  rodBatches: ClothRod[][]; // compiled SIMD order; all lanes read before any write
  animatedRods: ClothAnimatedRod[];
  animatedRodBatches: ClothAnimatedRod[][];
  decodeIssues: ClothDecodeIssue[];
  featureGaps: ClothFeatureGap[];
  hingeLimits: ClothHingeLimit[];
  triangles: ClothTriangle[];
  triangleBatches: ClothTriangle[][];
  quads: ClothQuad[];
  quadBatches: ClothQuad[][];
  capsules: ClothCapsule[];
  spheres: ClothSphere[];
  boxes: ClothBox[];
  nodeBases: ClothNodeBase[];
  ctrlOffsets: ClothCtrlOffset[];
  reverseOffsets: ClothReverseOffset[];
  softOffsets: ClothSoftOffset[];
  strayRadii: ClothStrayRadius[];
  strayRadiusBatches: ClothStrayRadius[][];
  skelParents: number[];
  staticNodeCount: number;
  staticNodeFlags: number | null;
  dynamicNodeFlags: number | null;
  goalDampedSpringIntegrators: number[];
  addWorldCollisionRadius: number;
  defaultGravityScale: number;
  hasCollisionFriction: boolean;
  extraIterations: number;
  extraGoalIterations: number;

  // Compiled records retained even when their runtime solver is not implemented.
  twists: ClothTwist[];
  fitMatrices: ClothFitMatrix[];
  fitWeights: ClothFitWeight[];
  freeNodes: number[];
  lockToParent: ClothCtrlOffset[]; // reuses {offset, parent, child}
  lockToGoal: number[];
  collisionPlanes: ClothCollisionPlane[];
  ropes: number[]; // flat rope-end-index array (chain segmentation)
  ropeCount: number;
  ropeChains: number[][];
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
const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isUint32 = (v: unknown): v is number => isFiniteNumber(v) && Number.isInteger(v) && v >= 0 && v <= 0xffffffff;
const isNodeIndex = (v: unknown, nodeCount: number): v is number =>
  isFiniteNumber(v) && Number.isInteger(v) && v >= 0 && v < nodeCount;

function parseRopeChains(fe: RawFeModel, issues: ClothDecodeIssue[]): number[][] {
  const packed = fe.m_Ropes ?? [];
  const count = fe.m_nRopeCount ?? 0;
  if (!Array.isArray(packed) || !isUint32(count) || count > packed.length || (count === 0 && packed.length > 0)) {
    issues.push({ array: 'm_Ropes', record: 0, reason: 'invalid-count' });
    return [];
  }
  // The header stores exclusive end offsets, followed by the ordered node runs.
  const chains: number[][] = [];
  let begin = count;
  for (let record = 0; record < count; record++) {
    const end = packed[record];
    if (!isUint32(end) || end < begin + 2 || end > packed.length
      || (record === count - 1 && end !== packed.length)) {
      issues.push({ array: 'm_Ropes', record, reason: 'invalid-offsets' });
      return [];
    }
    const chain = packed.slice(begin, end);
    if (chain.every((index) => isNodeIndex(index, fe.m_CtrlName.length))) {
      chains.push(chain);
    } else {
      issues.push({ array: 'm_Ropes', record, reason: 'invalid-nodes' });
    }
    begin = end;
  }
  return chains;
}

export interface ClothFeatureGap {
  field: string;
  label: string;
  count: number;
  status: 'not-implemented' | 'approximate';
}

function clothFeatureGaps(fe: RawFeModel): ClothFeatureGap[] {
  const gaps: ClothFeatureGap[] = [];
  const add = (field: keyof RawFeModel, label: string, status: ClothFeatureGap['status'] = 'not-implemented') => {
    const entries = fe[field];
    if (Array.isArray(entries) && entries.length > 0) gaps.push({ field, label, count: entries.length, status });
  };
  add('m_AxialEdges', 'Axial edges');
  add('m_FollowNodes', 'Follow links');
  add('m_SDFRigids', 'SDF colliders');
  add('m_JiggleBones', 'Jiggle bones');
  add('m_FitMatrices', 'Fit matrices', 'approximate');
  for (const field of ['m_TaperedCapsuleRigids', 'm_SphereRigids', 'm_BoxRigids'] as const) {
    const colliders = fe[field] ?? [];
    const flags = colliders.filter((entry) => entry.nFlags !== undefined && entry.nFlags !== 0).length;
    if (flags) gaps.push({ field: `${field}.nFlags`, label: 'Collider flags', count: flags, status: 'not-implemented' });
  }
  return gaps;
}

function parseColliderPriorities(fe: RawFeModel, issues: ClothDecodeIssue[]): RawColliderPriority[] {
  const rows = fe.m_RigidColliderPriorities ?? [];
  if (rows.length === 0) return [];
  const counts: Required<RawColliderPriority> = {
    m_nTaperedCapsuleRigidIndex: fe.m_TaperedCapsuleRigids?.length ?? 0,
    m_nSphereRigidIndex: fe.m_SphereRigids?.length ?? 0,
    m_nBoxRigidIndex: fe.m_BoxRigids?.length ?? 0,
    m_nSDFRigidIndex: fe.m_SDFRigids?.length ?? 0,
    m_nCollisionPlaneIndex: fe.m_CollisionPlanes?.length ?? 0,
  };
  const fields = Object.keys(counts) as Array<keyof RawColliderPriority>;
  for (let record = 0; record < rows.length; record++) {
    const valid = rows.length >= 2 && fields.every((field) => {
      const value = rows[record][field];
      return value !== undefined && Number.isInteger(value) && value >= 0 && value <= counts[field]
        && (record > 0 ? value >= rows[record - 1][field]! : value === 0)
        && (record < rows.length - 1 || value === counts[field]);
    });
    if (!valid) {
      issues.push({ array: 'm_RigidColliderPriorities', record, reason: 'invalid-offsets' });
      return [];
    }
  }
  return rows;
}

function parseCollisionVertexMaps(fe: RawFeModel, issues: ClothDecodeIssue[]): number[][] {
  const values = fe.m_VertexMapValues ?? [];
  return (fe.m_VertexMaps ?? []).map((map, record) => {
    const { nVertexBase: base, nVertexCount: count, nMapOffset: offset } = map;
    if (base === undefined || count === undefined || offset === undefined
      || !Number.isInteger(base) || !Number.isInteger(count) || !Number.isInteger(offset)
      || base < 0 || count < 0 || offset < 0 || offset + count > values.length
      || (count > 0 && base + count > fe.m_CtrlName!.length)) {
      issues.push({ array: 'm_VertexMaps', record, reason: 'invalid-offsets' });
      return [];
    }
    const nodes: number[] = [];
    for (let i = 0; i < count; i++) {
      const weight = values[offset + i];
      if (!Number.isInteger(weight) || weight < 0 || weight > 255) {
        issues.push({ array: 'm_VertexMaps', record, reason: 'invalid-weights' });
        return [];
      }
      if (weight > 0) nodes.push(base + i);
    }
    return nodes;
  });
}

export function clothIntegratorMode(model: Pick<ClothModel,
  'staticNodeCount' | 'staticNodeFlags' | 'dynamicNodeFlags' | 'goalDampedSpringIntegrators'
>, node: number): ClothIntegratorMode {
  if (!Number.isInteger(node) || node < 0) return 'unknown';
  const dynamicIndex = node - model.staticNodeCount;
  if (dynamicIndex >= 0 && model.goalDampedSpringIntegrators.length > 0) {
    const word = model.goalDampedSpringIntegrators[dynamicIndex >>> 5];
    if (word === undefined) return 'unknown';
    return (word & (1 << (dynamicIndex & 31))) !== 0 ? 'goal-damped' : 'raw';
  }

  const flags = dynamicIndex >= 0 ? model.dynamicNodeFlags : model.staticNodeFlags;
  if (flags === null) return 'unknown';
  const raw = (flags & 0x600) !== 0;
  const goal = (flags & 0x80) !== 0;
  if (!raw) return 'goal-damped';
  // Mixed band flags without a node bitset cannot identify a node's mode.
  return goal ? 'unknown' : 'raw';
}

function parseAnimatedRods(fe: RawFeModel, issues: ClothDecodeIssue[]): { rods: ClothAnimatedRod[]; batches: ClothAnimatedRod[][] } {
  const rods: ClothAnimatedRod[] = [];
  const batches: ClothAnimatedRod[][] = [];
  const seen = new Set<string>();
  for (const [record, entry] of (fe.m_SimdRodsAnim ?? []).entries()) {
    const indices = Array.isArray(entry.nNode) ? entry.nNode.flat() : [];
    if (indices.length !== 8) {
      issues.push({ array: 'm_SimdRodsAnim', record, reason: 'invalid-nodes' });
      continue;
    }
    const batch: ClothAnimatedRod[] = [];
    for (let lane = 0; lane < 4; lane++) {
      const a = indices[lane];
      const b = indices[4 + lane];
      if (!isNodeIndex(a, fe.m_CtrlName.length) || !isNodeIndex(b, fe.m_CtrlName.length)) {
        issues.push({ array: 'm_SimdRodsAnim', record, reason: 'invalid-nodes' });
        continue;
      }
      if (a === b) continue;
      const weight = entry.f4Weight0?.[lane] ?? 0.5;
      const relax = entry.f4RelaxationFactor?.[lane] ?? 1;
      if (!isFiniteNumber(weight) || !isFiniteNumber(relax)) {
        issues.push({ array: 'm_SimdRodsAnim', record, reason: 'invalid-weights' });
        continue;
      }
      const rod = { a, b, weight, relax };
      batch.push(rod);
      // The flat list is for coverage; solving retains every lane and batch.
      const key = `${a}:${b}:${weight}:${relax}`;
      if (seen.has(key)) continue;
      seen.add(key);
      rods.push(rod);
    }
    if (batch.length > 0) batches.push(batch);
  }
  return { rods, batches };
}

function parseRodBatches(fe: RawFeModel, issues: ClothDecodeIssue[]): ClothRod[][] {
  const batches: ClothRod[][] = [];
  let invalid = false;
  for (const [record, entry] of (fe.m_SimdRods ?? []).entries()) {
    const indices = Array.isArray(entry.nNode) ? entry.nNode.flat() : [];
    if (indices.length !== 8 || !indices.every((index) => isNodeIndex(index, fe.m_CtrlName.length))) {
      issues.push({ array: 'm_SimdRods', record, reason: 'invalid-nodes' });
      invalid = true;
      continue;
    }
    const batch: ClothRod[] = [];
    for (let lane = 0; lane < 4; lane++) {
      const min = entry.f4MinDist?.[lane];
      const max = entry.f4MaxDist?.[lane];
      const weight = entry.f4Weight0?.[lane];
      const relax = entry.f4RelaxationFactor?.[lane];
      if (!isFiniteNumber(min) || !isFiniteNumber(max) || min < 0 || max < min) {
        issues.push({ array: 'm_SimdRods', record, reason: 'invalid-limits' });
        invalid = true;
        break;
      }
      if (!isFiniteNumber(weight) || !isFiniteNumber(relax)) {
        issues.push({ array: 'm_SimdRods', record, reason: 'invalid-weights' });
        invalid = true;
        break;
      }
      batch.push({ a: indices[lane], b: indices[lane + 4], min, max, weight, relax });
    }
    batches.push(batch);
  }
  // Keep a complete scalar fallback if any packed record is malformed. Never
  // deduplicate valid batches: repeated rods can encode authored extra passes.
  return invalid ? [] : batches;
}

function parseStrayRadii(fe: RawFeModel, issues: ClothDecodeIssue[]): { radii: ClothStrayRadius[]; batches: ClothStrayRadius[][] } {
  const decode = (indices: number[], maxDist: number | undefined, relax: number | undefined,
    array: 'm_AnimStrayRadii' | 'm_SimdAnimStrayRadii', record: number): ClothStrayRadius | null => {
    if (indices.length !== 2 || !indices.every((index) => isNodeIndex(index, fe.m_CtrlName.length))) {
      issues.push({ array, record, reason: 'invalid-nodes' });
      return null;
    }
    if (!isFiniteNumber(maxDist) || maxDist < 0 || !isFiniteNumber(relax) || relax < 0 || relax > 1) {
      issues.push({ array, record, reason: 'invalid-limits' });
      return null;
    }
    return { node: [indices[0], indices[1]], maxDist, relax };
  };
  const radii: ClothStrayRadius[] = [];
  for (const [record, entry] of (fe.m_AnimStrayRadii ?? []).entries()) {
    const radius = decode(entry.nNode ?? [], entry.flMaxDist, entry.flRelaxationFactor, 'm_AnimStrayRadii', record);
    if (radius) radii.push(radius);
  }
  const batches: ClothStrayRadius[][] = [];
  let invalid = false;
  for (const [record, entry] of (fe.m_SimdAnimStrayRadii ?? []).entries()) {
    const indices = Array.isArray(entry.nNode) ? entry.nNode.flat() : [];
    if (indices.length !== 8) {
      issues.push({ array: 'm_SimdAnimStrayRadii', record, reason: 'invalid-nodes' });
      invalid = true;
      continue;
    }
    const batch: ClothStrayRadius[] = [];
    for (let lane = 0; lane < 4; lane++) {
      const radius = decode([indices[lane], indices[lane + 4]], entry.flMaxDist?.[lane], entry.flRelaxationFactor?.[lane], 'm_SimdAnimStrayRadii', record);
      if (radius) batch.push(radius);
      else invalid = true;
    }
    batches.push(batch);
  }
  if (invalid || batches.length === 0) return { radii, batches: radii.map((radius) => [radius]) };
  if (radii.length === 0) {
    const seen = new Set<string>();
    for (const radius of batches.flat()) {
      const key = JSON.stringify(radius);
      if (!seen.has(key)) radii.push(radius);
      seen.add(key);
    }
  }
  return { radii, batches };
}

function parseTriangles(fe: RawFeModel, issues: ClothDecodeIssue[]): { triangles: ClothTriangle[]; batches: ClothTriangle[][] } {
  const decode = (entry: RawClothTriangle, staticCount: ClothTriangle['staticCount'], array: 'm_Tris' | 'm_SimdTris', record: number): ClothTriangle | null => {
    const n = entry.nNode;
    if (!Array.isArray(n) || n.length !== 3 || new Set(n).size !== 3
      || !n.every((index) => isNodeIndex(index, fe.m_CtrlName.length))) {
      issues.push({ array, record, reason: 'invalid-nodes' });
      return null;
    }
    const { w1, w2, v1x } = entry;
    if (!isFiniteNumber(w1) || !isFiniteNumber(w2) || w1 < 0 || w2 < 0 || w1 + w2 > 1 + 1e-6) {
      issues.push({ array, record, reason: 'invalid-weights' });
      return null;
    }
    const x2 = entry.v2?.[0];
    const y2 = entry.v2?.[1];
    if (!isFiniteNumber(v1x) || !isFiniteNumber(x2) || !isFiniteNumber(y2) || v1x < 0 || y2 < 0) {
      issues.push({ array, record, reason: 'invalid-limits' });
      return null;
    }
    return { node: [n[0], n[1], n[2]], staticCount, weight1: w1, weight2: w2, x1: v1x, x2, y2 };
  };
  const partitions = (count: number, one: number | undefined, two: number | undefined, array: 'm_Tris' | 'm_SimdTris') => {
    if (count === 0) return [];
    if (!isUint32(one) || !isUint32(two) || two > one || one > count) {
      issues.push({ array, record: 0, reason: 'invalid-count' });
      return null;
    }
    return Array.from({ length: count }, (_, index): ClothTriangle['staticCount'] => index < two ? 2 : index < one ? 1 : 0);
  };
  const scalar = fe.m_Tris ?? [];
  const scalarPartitions = partitions(scalar.length, fe.m_nTriCount1, fe.m_nTriCount2, 'm_Tris');
  const triangles: ClothTriangle[] = [];
  scalarPartitions?.forEach((fixed, record) => {
    const triangle = decode(scalar[record], fixed, 'm_Tris', record);
    if (triangle) triangles.push(triangle);
  });
  const packed = fe.m_SimdTris ?? [];
  const packedPartitions = partitions(packed.length, fe.m_nSimdTriCount1, fe.m_nSimdTriCount2, 'm_SimdTris');
  const batches: ClothTriangle[][] = [];
  let invalid = packedPartitions === null;
  packedPartitions?.forEach((fixed, record) => {
    const entry = packed[record];
    const indices = Array.isArray(entry.nNode) ? entry.nNode.flat() : [];
    if (indices.length !== 12) {
      issues.push({ array: 'm_SimdTris', record, reason: 'invalid-nodes' });
      invalid = true;
      return;
    }
    const batch: ClothTriangle[] = [];
    for (let lane = 0; lane < 4; lane++) {
      const triangle = decode({
        nNode: [indices[lane], indices[lane + 4], indices[lane + 8]],
        w1: entry.w1?.[lane], w2: entry.w2?.[lane], v1x: entry.v1x?.[lane],
        v2: entry.v2?.x && entry.v2?.y ? [entry.v2.x[lane], entry.v2.y[lane]] : undefined,
      }, fixed, 'm_SimdTris', record);
      if (triangle) batch.push(triangle);
      else invalid = true;
    }
    batches.push(batch);
  });
  // A malformed packed block uses the validated scalar sequence. Valid blocks
  // retain padding and cross-batch repeats, just like compiled rod batches.
  if (invalid || batches.length === 0) return { triangles, batches: triangles.map((triangle) => [triangle]) };
  if (triangles.length === 0) {
    const seen = new Set<string>();
    for (const triangle of batches.flat()) {
      const key = JSON.stringify(triangle);
      if (!seen.has(key)) triangles.push(triangle);
      seen.add(key);
    }
  }
  return { triangles, batches };
}

function parseQuads(fe: RawFeModel, issues: ClothDecodeIssue[]): { quads: ClothQuad[]; batches: ClothQuad[][] } {
  const decode = (entry: RawClothQuad, staticCount: ClothQuad['staticCount'], array: 'm_Quads' | 'm_SimdQuads', record: number): ClothQuad | null => {
    const n = entry.nNode;
    if (!Array.isArray(n) || n.length !== 4 || new Set(n).size !== 4
      || !n.every((index) => isNodeIndex(index, fe.m_CtrlName.length))) {
      issues.push({ array, record, reason: 'invalid-nodes' });
      return null;
    }
    const shape = entry.vShape;
    if (!Array.isArray(shape) || shape.length !== 4 || !shape.every((v) => Array.isArray(v) && v.length === 4 && v.every(isFiniteNumber))
      || !isFiniteNumber(entry.flSlack) || entry.flSlack < 0) {
      issues.push({ array, record, reason: 'invalid-limits' });
      return null;
    }
    if (shape.some((v, i) => v[3] < 0 || (i < staticCount && v[3] !== 0))
      || Math.abs(shape.reduce((sum, v) => sum + v[3], 0) - 1) > 1e-5) {
      issues.push({ array, record, reason: 'invalid-weights' });
      return null;
    }
    return { node: [n[0], n[1], n[2], n[3]], staticCount,
      shape: [sphere4(shape[0]), sphere4(shape[1]), sphere4(shape[2]), sphere4(shape[3])], slack: entry.flSlack };
  };
  const partitions = (count: number, one: number | undefined, two: number | undefined, array: 'm_Quads' | 'm_SimdQuads') => {
    if (count === 0) return [];
    if (!isUint32(one) || !isUint32(two) || two > one || one > count) {
      issues.push({ array, record: 0, reason: 'invalid-count' });
      return null;
    }
    return Array.from({ length: count }, (_, index): ClothQuad['staticCount'] => index < two ? 2 : index < one ? 1 : 0);
  };
  const scalar = fe.m_Quads ?? [];
  const quads: ClothQuad[] = [];
  partitions(scalar.length, fe.m_nQuadCount1, fe.m_nQuadCount2, 'm_Quads')?.forEach((fixed, record) => {
    const quad = decode(scalar[record], fixed, 'm_Quads', record);
    if (quad) quads.push(quad);
  });
  const packed = fe.m_SimdQuads ?? [];
  const packedPartitions = partitions(packed.length, fe.m_nSimdQuadCount1, fe.m_nSimdQuadCount2, 'm_SimdQuads');
  const batches: ClothQuad[][] = [];
  let invalid = packedPartitions === null;
  packedPartitions?.forEach((fixed, record) => {
    const entry = packed[record];
    const indices = Array.isArray(entry.nNode) ? entry.nNode.flat() : [];
    if (indices.length !== 16) {
      issues.push({ array: 'm_SimdQuads', record, reason: 'invalid-nodes' });
      invalid = true;
      return;
    }
    const batch: ClothQuad[] = [];
    for (let lane = 0; lane < 4; lane++) {
      const quad = decode({ nNode: [indices[lane], indices[lane + 4], indices[lane + 8], indices[lane + 12]],
        flSlack: entry.f4Slack?.[lane],
        vShape: [0, 1, 2, 3].map((vertex) => [
          entry.vShape?.[vertex]?.[lane] ?? NaN, entry.vShape?.[vertex]?.[lane + 4] ?? NaN,
          entry.vShape?.[vertex]?.[lane + 8] ?? NaN, entry.f4Weights?.[vertex]?.[lane] ?? NaN,
        ]),
      }, fixed, 'm_SimdQuads', record);
      if (quad) batch.push(quad);
      else invalid = true;
    }
    batches.push(batch);
  });
  if (invalid || batches.length === 0) return { quads, batches: quads.map((quad) => [quad]) };
  if (quads.length === 0) {
    const seen = new Set<string>();
    for (const quad of batches.flat()) {
      const key = JSON.stringify(quad);
      if (!seen.has(key)) quads.push(quad);
      seen.add(key);
    }
  }
  return { quads, batches };
}

function parseKelagerBends(fe: RawFeModel, issues: ClothDecodeIssue[]): ClothKelagerBend[] {
  const bends: ClothKelagerBend[] = [];
  for (const [record, bend] of (fe.m_KelagerBends ?? []).entries()) {
    const indices = bend.nNode;
    const weights = bend.flWeight;
    if (!Array.isArray(indices) || indices.length !== 3
      || !indices.every((index) => isNodeIndex(index, fe.m_CtrlName.length))) {
      issues.push({ array: 'm_KelagerBends', record, reason: 'invalid-nodes' });
      continue;
    }
    if (!Array.isArray(weights) || weights.length !== 3 || !weights.every(isFiniteNumber)) {
      issues.push({ array: 'm_KelagerBends', record, reason: 'invalid-weights' });
      continue;
    }
    if (!isFiniteNumber(bend.flHeight0) || bend.flHeight0 < 0) {
      issues.push({ array: 'm_KelagerBends', record, reason: 'invalid-height' });
      continue;
    }
    bends.push({
      node: [indices[0], indices[1], indices[2]],
      weight: [weights[0], weights[1], weights[2]],
      height0: bend.flHeight0,
    });
  }
  return bends;
}

function parseHingeLimits(fe: RawFeModel, issues: ClothDecodeIssue[]): ClothHingeLimit[] {
  const hinges: ClothHingeLimit[] = [];
  for (const [record, hinge] of (fe.m_HingeLimits ?? []).entries()) {
    const n = hinge.nNode;
    if (!Array.isArray(n) || n.length !== 6 || !n.every((index) => isNodeIndex(index, fe.m_CtrlName.length))) {
      issues.push({ array: 'm_HingeLimits', record, reason: 'invalid-nodes' });
      continue;
    }
    if ((hinge.nFlags ?? 0) !== 0) {
      issues.push({ array: 'm_HingeLimits', record, reason: 'unsupported-flags' });
      continue;
    }
    const { flWeight4: weight4, flWeight5: weight5, flAngleCenter: center, flAngleExtents: extents } = hinge;
    if (!isFiniteNumber(weight4) || !isFiniteNumber(weight5) || weight4 < 0 || weight4 > 1 || weight5 < 0 || weight5 > 1) {
      issues.push({ array: 'm_HingeLimits', record, reason: 'invalid-weights' });
      continue;
    }
    if (!isFiniteNumber(center) || !isFiniteNumber(extents) || extents < 0 || extents > Math.PI) {
      issues.push({ array: 'm_HingeLimits', record, reason: 'invalid-limits' });
      continue;
    }
    hinges.push({ node: [n[0], n[1], n[2], n[3], n[4], n[5]], weight4, weight5, center, extents });
  }
  return hinges;
}

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
 * is handled cleanly. Keeps compiler selectors and unsupported constraints so the
 * runtime can report its coverage without silently dropping authored behavior.
 */
export function parseFeModel(raw: unknown): ClothModel | null {
  const fe = raw as RawFeModel | null | undefined;
  if (!fe || !Array.isArray(fe.m_CtrlName)) return null;
  const decodeIssues: ClothDecodeIssue[] = [];

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

  const priorities = parseColliderPriorities(fe, decodeIssues);
  const vertexMaps = parseCollisionVertexMaps(fe, decodeIssues);
  const priority = (field: keyof RawColliderPriority, index: number): number => {
    let rank = 0;
    for (let group = 1; group < priorities.length && index >= priorities[group][field]!; group++) rank = group;
    return rank;
  };
  const vertexNodes = (index: number | undefined): number[] | undefined => (
    index !== undefined && Number.isInteger(index) && index >= 0 && index < vertexMaps.length ? vertexMaps[index] : undefined
  );
  const capsules: ClothCapsule[] = (fe.m_TaperedCapsuleRigids ?? []).map((c, index) => ({
    sphere0: sphere4(c.vSphere?.[0]),
    sphere1: sphere4(c.vSphere?.[1]),
    node: num(c.nNode),
    mask: num(c.nCollisionMask),
    priority: priority('m_nTaperedCapsuleRigidIndex', index),
    vertexNodes: vertexNodes(c.nVertexMapIndex),
  }));

  const spheres: ClothSphere[] = (fe.m_SphereRigids ?? []).map((s, index) => ({
    sphere: sphere4(s.vSphere),
    node: num(s.nNode),
    mask: num(s.nCollisionMask),
    priority: priority('m_nSphereRigidIndex', index),
    vertexNodes: vertexNodes(s.nVertexMapIndex),
  }));

  const boxes: ClothBox[] = (fe.m_BoxRigids ?? []).map((b, index) => ({
    pos: vec3(b.tmFrame2),
    rot: [num(b.tmFrame2?.[4]), num(b.tmFrame2?.[5]), num(b.tmFrame2?.[6]), num(b.tmFrame2?.[7], 1)],
    halfSize: vec3(b.vSize),
    node: num(b.nNode),
    mask: num(b.nCollisionMask),
    priority: priority('m_nBoxRigidIndex', index),
    vertexNodes: vertexNodes(b.nVertexMapIndex),
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

  const { radii: strayRadii, batches: strayRadiusBatches } = parseStrayRadii(fe, decodeIssues);

  const twists: ClothTwist[] = [];
  for (const [record, t] of (fe.m_Twists ?? []).entries()) {
    if (!isObject(t) || !isNodeIndex(t.nNodeOrient, names.length) || !isNodeIndex(t.nNodeEnd, names.length)) {
      decodeIssues.push({ array: 'm_Twists', record, reason: 'invalid-nodes' });
      continue;
    }
    if (!isFiniteNumber(t.flTwistRelax) || !isFiniteNumber(t.flSwingRelax)
      || t.flTwistRelax < 0 || t.flTwistRelax > 1 || t.flSwingRelax < 0 || t.flSwingRelax > 1) {
      decodeIssues.push({ array: 'm_Twists', record, reason: 'invalid-weights' });
      continue;
    }
    twists.push({ nodeOrient: t.nNodeOrient, nodeEnd: t.nNodeEnd,
      twistRelax: t.flTwistRelax, swingRelax: t.flSwingRelax });
  }

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

  const collisionPlanes: ClothCollisionPlane[] = (fe.m_CollisionPlanes ?? []).map((p, index) => ({
    priority: priority('m_nCollisionPlaneIndex', index),
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

  const { rods: animatedRods, batches: animatedRodBatches } = parseAnimatedRods(fe, decodeIssues);
  const rodBatches = parseRodBatches(fe, decodeIssues);
  const { triangles, batches: triangleBatches } = parseTriangles(fe, decodeIssues);
  const { quads, batches: quadBatches } = parseQuads(fe, decodeIssues);
  const kelagerBends = parseKelagerBends(fe, decodeIssues);
  const ropeChains = parseRopeChains(fe, decodeIssues);
  const bitset = fe.m_GoalDampedSpringIntegrators ?? [];
  const validBitset = Array.isArray(bitset) && bitset.every(isUint32);
  if (!validBitset) {
    decodeIssues.push({ array: 'm_GoalDampedSpringIntegrators', record: 0, reason: 'invalid-bitset' });
  }

  return {
    nodes,
    rods,
    rodBatches,
    animatedRods,
    animatedRodBatches,
    decodeIssues,
    featureGaps: clothFeatureGaps(fe),
    hingeLimits: parseHingeLimits(fe, decodeIssues),
    triangles,
    triangleBatches,
    quads,
    quadBatches,
    staticNodeFlags: isUint32(fe.m_nStaticNodeFlags) ? fe.m_nStaticNodeFlags : null,
    dynamicNodeFlags: isUint32(fe.m_nDynamicNodeFlags) ? fe.m_nDynamicNodeFlags : null,
    goalDampedSpringIntegrators: validBitset ? bitset : [],
    capsules,
    spheres,
    boxes,
    nodeBases,
    ctrlOffsets,
    reverseOffsets,
    softOffsets,
    strayRadii,
    strayRadiusBatches,
    skelParents: (fe.m_SkelParents ?? []).map((v) => num(v, -1)),
    staticNodeCount: num(fe.m_nStaticNodes),
    addWorldCollisionRadius: num(fe.m_flAddWorldCollisionRadius),
    defaultGravityScale: num(fe.m_flDefaultGravityScale, 1),
    hasCollisionFriction: friction.length > 0,
    extraIterations: num(fe.m_nExtraIterations),
    extraGoalIterations: num(fe.m_nExtraGoalIterations),

    twists,
    fitMatrices,
    fitWeights,
    freeNodes: (fe.m_FreeNodes ?? []).map((v) => num(v)),
    lockToParent,
    lockToGoal: (fe.m_LockToGoal ?? []).map((v) => num(v)),
    collisionPlanes,
    ropes: Array.isArray(fe.m_Ropes) ? fe.m_Ropes.map((v) => num(v, -1)) : [],
    ropeCount: isUint32(fe.m_nRopeCount) ? fe.m_nRopeCount : 0,
    ropeChains,
    jiggleBones,
    kelagerBends,
    firstPositionDrivenNode: num(fe.m_nFirstPositionDrivenNode, names.length),
    rodVelocitySmoothRate: num(fe.m_flRodVelocitySmoothRate),
    rodVelocitySmoothIterations: num(fe.m_nRodVelocitySmoothIterations),
    rotLockStaticNodeCount: num(fe.m_nRotLockStaticNodes),
  };
}
