import { useCallback, useEffect, useRef } from 'react';
import * as THREE from 'three';
import { clothIntegratorMode } from './feModel';
import { applyGoalDampedAttraction, applyRawAttraction, hingeLimitExcess, projectHingeLimit, projectKelagerBend, projectQuadBatch, projectRodBatch, projectTriangleBatch, quadProjectionError, reconstructClothRope, reconstructClothTwist, triangleProjectionError } from './clothConstraints';
import {
  applyOffset,
  nodeBaseQuaternion,
  recoverOffsetSign,
  recoverSimilarity,
  recoverClothFit,
} from './clothMath';
import type {
  ClothBox,
  ClothCapsule,
  ClothColliderFilter,
  ClothCollisionPlane,
  ClothModel,
  ClothReverseOffset,
  ClothSphere,
  ClothStrayRadius,
  Vec3,
  Vec4,
} from './feModel';

export function closestPointOnSegment(
  p: THREE.Vector3,
  a: THREE.Vector3,
  b: THREE.Vector3,
  out: THREE.Vector3,
): { point: THREE.Vector3; t: number } {
  const ab = b.clone().sub(a);
  const len2 = ab.lengthSq();
  const t = len2 < 1e-9 ? 0 : THREE.MathUtils.clamp(p.clone().sub(a).dot(ab) / len2, 0, 1);
  out.copy(a).addScaledVector(ab, t);
  return { point: out, t };
}

interface Capsule {
  a: THREE.Vector3;
  b: THREE.Vector3;
  ra: number;
  rb: number;
}

interface Box {
  center: THREE.Vector3;
  rotation: THREE.Quaternion;
  halfSize: THREE.Vector3;
}

const _cp = new THREE.Vector3();
const _capsuleAxis = new THREE.Vector3();
const _capsuleRadial = new THREE.Vector3();
export function capsuleDepth(
  p: THREE.Vector3,
  c: Capsule,
  pr: number,
  outN: THREE.Vector3,
  frictionEnabled = false,
): number {
  _capsuleAxis.subVectors(c.b, c.a);
  const length = _capsuleAxis.length();
  let t = 0;
  if (length < 1e-6) t = c.rb > c.ra ? 1 : 0;
  else if (length - (c.rb - c.ra) <= 0.5) t = 1;
  else {
    _capsuleAxis.multiplyScalar(1 / length);
    _capsuleRadial.subVectors(p, c.a);
    const axial = _capsuleRadial.dot(_capsuleAxis);
    const radial = _capsuleRadial.addScaledVector(_capsuleAxis, -axial).length();
    // The tapered contact path shifts the sampled sphere toward the larger
    // endpoint by radius slope * radial distance before projecting out of it.
    t = THREE.MathUtils.clamp((axial + (c.rb - c.ra) / length * radial) / length, 0, 1);
  }
  _cp.copy(c.a).lerp(c.b, t);
  const r = c.ra + (c.rb - c.ra) * t + pr;
  outN.copy(p).sub(_cp);
  const distanceSq = outN.lengthSq();
  if (r <= 0 || distanceSq >= r * r) return 0;
  // Friction uses a full-radius correction from the current particle near the
  // center. The position-only kernel instead places it on the sphere's +Z pole.
  if (frictionEnabled && distanceSq < Math.fround(0.01)) {
    outN.set(0, 0, 1);
    return r;
  }
  if (!frictionEnabled && distanceSq <= 2 ** -23) {
    outN.negate();
    outN.z += r;
    const correction = outN.length();
    outN.multiplyScalar(1 / correction);
    return correction;
  }
  const d = Math.sqrt(distanceSq);
  outN.multiplyScalar(1 / d);
  return r - d;
}

const _contactTangent = new THREE.Vector3();
export function projectClothContact(
  position: THREE.Vector3,
  previous: THREE.Vector3,
  normal: THREE.Vector3,
  depth: number,
  friction: number,
  colliderMotion: THREE.Matrix4,
): void {
  if (depth <= 0) return;
  _contactTangent.copy(previous).applyMatrix4(colliderMotion).sub(position);
  _contactTangent.addScaledVector(normal, -_contactTangent.dot(normal));
  const distance = _contactTangent.length();
  const limit = Math.max(0, friction) * depth;
  if (distance > 0) position.addScaledVector(_contactTangent, Math.min(1, limit / distance));
  position.addScaledVector(normal, depth);
}

const _push = new THREE.Vector3();
export function pushOutsideCapsule(p: THREE.Vector3, c: Capsule, pr: number): boolean {
  const depth = capsuleDepth(p, c, pr, _push);
  if (depth <= 0) return false;
  p.addScaledVector(_push, depth);
  return true;
}

const _boxLocal = new THREE.Vector3();
const _boxClosest = new THREE.Vector3();
const _boxDelta = new THREE.Vector3();
const _boxInvQ = new THREE.Quaternion();
const _boxNormalLocal = new THREE.Vector3();
export function boxDepth(p: THREE.Vector3, box: Box, pr: number, outN: THREE.Vector3, frictionEnabled = false): number {
  const halfX = Math.max(0, box.halfSize.x);
  const halfY = Math.max(0, box.halfSize.y);
  const halfZ = Math.max(0, box.halfSize.z);
  _boxInvQ.copy(box.rotation).invert();
  _boxLocal.copy(p).sub(box.center).applyQuaternion(_boxInvQ);
  if (frictionEnabled) {
    _boxClosest.set(
      THREE.MathUtils.clamp(_boxLocal.x, -halfX, halfX),
      THREE.MathUtils.clamp(_boxLocal.y, -halfY, halfY),
      THREE.MathUtils.clamp(_boxLocal.z, -halfZ, halfZ),
    );
    _boxDelta.copy(_boxLocal).sub(_boxClosest);
    const outsideDistanceSq = _boxDelta.lengthSq();
    if (outsideDistanceSq > Math.fround(1e-5)) {
      const outsideDistance = Math.sqrt(outsideDistanceSq);
      if (outsideDistance >= pr) return 0;
      outN.copy(_boxDelta).multiplyScalar(1 / outsideDistance).applyQuaternion(box.rotation);
      return pr - outsideDistance;
    }
  }

  // The position-only kernel expands each face by the particle radius and
  // requires a unique nearest face. Friction uses rounded corners and breaks
  // equal face distances in Z, Y, X order.
  const expansion = frictionEnabled ? 0 : pr;
  const dx = halfX + expansion - Math.abs(_boxLocal.x);
  const dy = halfY + expansion - Math.abs(_boxLocal.y);
  const dz = halfZ + expansion - Math.abs(_boxLocal.z);
  const axis = dx < dy && dx < dz ? 'x' : dy < dz ? 'y' : 'z';
  if (!frictionEnabled) {
    if (dx < 0 || dy < 0 || dz < 0) return 0;
    if (!(dx < dy && dx < dz) && !(dy < dx && dy < dz) && !(dz < dx && dz < dy)) return 0;
  }
  const depth = (axis === 'x' ? dx : axis === 'y' ? dy : dz) + (frictionEnabled ? pr : 0);
  if (depth <= 0) return 0;
  _boxNormalLocal.set(0, 0, 0);
  _boxNormalLocal[axis] = _boxLocal[axis] >= 0 ? 1 : -1;
  outN.copy(_boxNormalLocal).applyQuaternion(box.rotation);
  return depth;
}

const _boxPush = new THREE.Vector3();
export function pushOutsideBox(p: THREE.Vector3, box: Box, pr: number): boolean {
  const depth = boxDepth(p, box, pr, _boxPush);
  if (depth <= 0) return false;
  p.addScaledVector(_boxPush, depth);
  return true;
}

export const defaultClothTuning = {
  iterationOverride: 0,
  gravityScale: 1,
  attractionScale: 1,
  collisionScale: 1,
  showColliders: false,
  showNodes: false,
};

export const CLOTH_TIMESTEP = 1 / 120;
const MAX_CLOTH_STEPS_PER_FRAME = 12;
const CLOTH_RESUME_GAP = 0.25;
const MIN_TIMESTEP_HISTORY_RATIO = 0.25;
// Legacy exports without integrator selectors keep the preview damping fallback.
const MIN_VELOCITY_DAMPING = 0.02;

export const clothTuning = { ...defaultClothTuning };

export function resetClothTuning(): void {
  Object.assign(clothTuning, defaultClothTuning);
}

export function restoreBoneBindTransform(
  bone: THREE.Bone,
  position: THREE.Vector3,
  quaternion: THREE.Quaternion,
  scale: THREE.Vector3,
): void {
  bone.position.copy(position);
  bone.quaternion.copy(quaternion);
  bone.scale.copy(scale);
}

export function setBoneWorldPosition(bone: THREE.Bone, worldPosition: THREE.Vector3): void {
  const local = worldPosition.clone();
  const parent = bone.parent;
  if (parent) {
    parent.updateWorldMatrix(true, false);
    parent.worldToLocal(local);
  }
  bone.position.copy(local);
  bone.updateMatrixWorld(false);
}

export function setBoneWorldQuaternion(bone: THREE.Bone, worldQuaternion: THREE.Quaternion): void {
  const parent = bone.parent;
  if (parent) parent.updateWorldMatrix(true, false);
  const parentQ = parent?.getWorldQuaternion(new THREE.Quaternion()) ?? new THREE.Quaternion();
  bone.quaternion.copy(parentQ.invert().multiply(worldQuaternion).normalize());
  bone.updateMatrixWorld(false);
}

export function objectDepth(obj: THREE.Object3D): number {
  let depth = 0;
  for (let parent = obj.parent; parent; parent = parent.parent) depth += 1;
  return depth;
}

export function orderBonesParentFirst<T>(entries: Iterable<[THREE.Bone, T]>): Array<[THREE.Bone, T]> {
  return [...entries].sort(([boneA], [boneB]) => objectDepth(boneA) - objectDepth(boneB));
}

export type ClothTuningKey = keyof typeof clothTuning;
export type NumericClothTuningKey = {
  [K in ClothTuningKey]: (typeof clothTuning)[K] extends number ? K : never;
}[ClothTuningKey];
export type BooleanClothTuningKey = {
  [K in ClothTuningKey]: (typeof clothTuning)[K] extends boolean ? K : never;
}[ClothTuningKey];

export const clothToggles: BooleanClothTuningKey[] = ['showColliders', 'showNodes'];

export const clothKnobs: Array<{
  k: NumericClothTuningKey;
  min: number;
  max: number;
  step: number;
}> = [
  { k: 'iterationOverride', min: 0, max: 32, step: 1 },
  { k: 'gravityScale', min: 0, max: 2, step: 0.05 },
  { k: 'attractionScale', min: 0, max: 2, step: 0.05 },
  { k: 'collisionScale', min: 0, max: 1.5, step: 0.05 },
];

// Authored per-node gravity (Source units/s^2, Z-up) times the model's global gravity scale,
// matching CSoftbody::Predict: displacement = flGravity * m_flDefaultGravityScale * dt^2.
// flGravity == 0 is Valve's intent for position-driven / reconstructed bones (Dynamo's
// bag, Celeste's hair tresses, Yamato's tassels, Engineer's pouches, ...): they are
// carried by their driving cloth particles, NOT by gravity. We honor 0 verbatim.
// The old code substituted a magic 360 here whenever flGravity was 0, which forced
// every one of those zero-gravity bones to free-fall and -- swept by the turntable --
// orbit the hero. There is no fallback: if the data says 0, gravity is 0.
export function effectiveNodeGravity(nodeGravity: number, defaultGravityScale: number): number {
  const g = Number.isFinite(nodeGravity) ? nodeGravity : 0;
  const scale = Number.isFinite(defaultGravityScale) ? defaultGravityScale : 1;
  return g * scale;
}

// Existing preview approximation. S2V distinguishes raw and goal-damped compiled
// integrators; its authoring conversions do not establish their runtime updates.
export function animationAttraction(
  animVertex: number,
  animForce: number,
  dt: number,
): { posBlend: number; velImpulse: number } {
  const v = Number.isFinite(animVertex) ? Math.max(0, animVertex) : 0;
  const f = Number.isFinite(animForce) ? Math.max(0, animForce) : 0;
  return { posBlend: Math.min(1, v * dt), velImpulse: f * dt * 2 };
}

export function solverIterationPhases(
  model: Pick<ClothModel, 'extraIterations' | 'extraGoalIterations'>,
  iterationOverride = 0,
): { goalIterations: number; constraintIterations: number } {
  const extra = Number.isFinite(model.extraIterations) ? model.extraIterations : 0;
  const goalExtra = Number.isFinite(model.extraGoalIterations) ? model.extraGoalIterations : 0;
  const override = Number.isFinite(iterationOverride) && iterationOverride > 0 ? iterationOverride : 0;
  const constraintIterations = THREE.MathUtils.clamp(
    Math.round(override || (extra + 1)), 1, 256,
  );
  return {
    goalIterations: THREE.MathUtils.clamp(Math.round(goalExtra + 1), 1, constraintIterations),
    constraintIterations,
  };
}

export function verletVelocityScale(dt: number, lastDt: number | null | undefined, damping = 0): number {
  if (!Number.isFinite(dt) || dt <= 0) return 0;
  if (!Number.isFinite(lastDt) || !lastDt || lastDt <= 0) return 0;
  const dampingScale = Math.max(0, 1 - (Number.isFinite(damping) ? damping : 0));
  return dampingScale * (dt / Math.max(dt * MIN_TIMESTEP_HISTORY_RATIO, lastDt));
}

export function rodCorrectionShares(
  rodWeight: number,
): { a: number; b: number } {
  return { a: rodWeight, b: 1 - rodWeight };
}

export function isPositionDrivenNode(
  index: number,
  model: Pick<ClothModel, 'firstPositionDrivenNode' | 'fitMatrices'>,
): boolean {
  return Number.isFinite(model.firstPositionDrivenNode) && index >= model.firstPositionDrivenNode;
}

export function fitMatrixDrivenNodeSet(
  model: Pick<ClothModel, 'fitMatrices'>,
): Set<number> {
  const nodes = new Set<number>();
  for (const fit of model.fitMatrices) {
    const target = fitMatrixTargetNode(fit);
    if (target >= 0) nodes.add(target);
  }
  return nodes;
}

export function fitMatrixTargetNode(
  fit: Pick<ClothModel['fitMatrices'][number], 'node' | 'ctrl'>,
  nodeCount = Number.POSITIVE_INFINITY,
): number {
  const hasNode = Number.isInteger(fit.node) && fit.node >= 0 && fit.node < nodeCount;
  const hasCtrl = Number.isInteger(fit.ctrl) && fit.ctrl >= 0 && fit.ctrl < nodeCount;
  if (hasCtrl && fit.ctrl !== fit.node) return fit.ctrl;
  return hasNode ? fit.node : -1;
}

export function jiggleDrivenNodeSet(
  model: Pick<ClothModel, 'jiggleBones' | 'nodes'>,
): Set<number> {
  const nodes = new Set<number>();
  for (const jiggle of model.jiggleBones) {
    if (
      jiggle.params !== null
      && Number.isInteger(jiggle.node)
      && jiggle.node >= 0
      && jiggle.node < model.nodes.length
    ) {
      nodes.add(jiggle.node);
    }
  }
  return nodes;
}

// --- v16 ClothAnchors port: rigid rest-drape seed -----------------------------
// vpkmerge v0.16.0 (FeModel cloth anchoring in static pose bakes, #29) walks the
// m_SkelParents node tree from each $cloth_* node up to its terminal driver bone
// and rigidly carries the cloth bone with that anchor, reproducing the engine's
// settled rest drape with no solver. grimoire already receives m_SkelParents over
// the femodel IPC, so we reuse the same map to SEED the live sim: warm-start each
// cloth node at its rigid-anchor pose so the cloth loads attached to the posed body
// instead of stranded at bind (where it can start stuck inside the body). The
// solver then adds sway/collision on top from that sane start.

function isClothNodeName(name: string): boolean {
  const lower = name.toLowerCase();
  return lower.startsWith('$cloth') || lower.startsWith('cloth');
}

function walkSkelParentsToTerminal(start: number, parents: readonly number[]): number | null {
  let current = start;
  const seen = new Set<number>();
  for (;;) {
    if (seen.has(current)) return null; // cycle guard
    seen.add(current);
    const parent = parents[current];
    if (!Number.isInteger(parent) || parent < 0) return current; // terminal (tree root)
    if (parent >= parents.length) return null;
    current = parent;
  }
}

/** Map each `$cloth*` node to the terminal (root) driver node of its m_SkelParents
 *  chain, requiring that anchor to be a real non-cloth bone. Mirrors vpkmerge's
 *  `anchors_from_phys` (morphic::model::femodel). */
export function clothAnchorMap(
  model: Pick<ClothModel, 'nodes' | 'skelParents'>,
): Map<number, number> {
  const map = new Map<number, number>();
  const parents = model.skelParents;
  if (parents.length !== model.nodes.length) return map;
  for (let i = 0; i < model.nodes.length; i++) {
    if (!isClothNodeName(model.nodes[i].name)) continue;
    const terminal = walkSkelParentsToTerminal(i, parents);
    if (terminal === null || terminal === i) continue;
    if (isClothNodeName(model.nodes[terminal].name)) continue; // anchor must be a driver
    map.set(i, terminal);
  }
  return map;
}

const _seedAnchorBindInv = new THREE.Quaternion();
/** The cloth node's bind offset from its anchor, rigidly carried by the anchor's
 *  current transform (the v16 `finish_palette` carry, in node/model space). At the
 *  bind pose this returns the node's own initPos. */
export function rigidAnchorSeed(
  nodeInitPos: Vec3,
  anchorInitPos: Vec3,
  anchorInitRot: Vec4,
  anchorPos: THREE.Vector3,
  anchorRot: THREE.Quaternion,
  out: THREE.Vector3 = new THREE.Vector3(),
): THREE.Vector3 {
  _seedAnchorBindInv
    .set(anchorInitRot[0], anchorInitRot[1], anchorInitRot[2], anchorInitRot[3])
    .normalize()
    .invert();
  return out
    .set(
      nodeInitPos[0] - anchorInitPos[0],
      nodeInitPos[1] - anchorInitPos[1],
      nodeInitPos[2] - anchorInitPos[2],
    )
    .applyQuaternion(_seedAnchorBindInv)
    .applyQuaternion(anchorRot)
    .add(anchorPos);
}

export function isKinematicNode(node: {
  pinned?: boolean;
  positionDriven?: boolean;
  lockToGoal?: boolean;
  jiggleDriven?: boolean;
}): boolean {
  return Boolean(node.pinned || node.positionDriven || node.lockToGoal || node.jiggleDriven);
}

export function restorePinnedSolverNodes(
  nodes: Iterable<{
    pinned: boolean;
    positionDriven?: boolean;
    lockToGoal?: boolean;
    jiggleDriven?: boolean;
    pos: THREE.Vector3;
    prev: THREE.Vector3;
    target: THREE.Vector3;
    solvedRot: THREE.Quaternion;
    targetRot: THREE.Quaternion;
  }>,
): void {
  for (const node of nodes) {
    if (!isKinematicNode(node)) continue;
    node.pos.copy(node.target);
    node.prev.copy(node.target);
    node.solvedRot.copy(node.targetRot);
  }
}

type AnimStrayRadiusNode = {
  pos: THREE.Vector3;
  prev?: THREE.Vector3;
  target: THREE.Vector3;
  pinned?: boolean;
  positionDriven?: boolean;
  lockToGoal?: boolean;
  jiggleDriven?: boolean;
  kinematic?: boolean;
};

const _strayDelta = new THREE.Vector3();
const _strayOutput = Array.from({ length: 4 }, () => new THREE.Vector3());
const _strayWrite = [false, false, false, false];

export function projectAnimStrayRadiusBatch(
  nodes: readonly (AnimStrayRadiusNode | undefined)[],
  radii: readonly ClothStrayRadius[],
  scale = 1,
): boolean {
  let changed = false;
  for (let lane = 0; lane < radii.length; lane++) {
    const stray = radii[lane];
    const goal = nodes[stray.node[0]];
    const node = nodes[stray.node[1]];
    _strayWrite[lane] = false;
    if (!goal || !node || isKinematicNode(node) || node.kinematic) continue;
    const { maxDist, relax } = stray;
    if (!Number.isFinite(maxDist) || maxDist < 0 || !Number.isFinite(relax) || relax <= 0) continue;
    _strayDelta.subVectors(node.pos, goal.target);
    const distance = Math.sqrt(Math.max(_strayDelta.lengthSq(), 2 ** -30));
    const correction = (Math.min(distance, maxDist * scale) / distance - 1) * relax;
    _strayOutput[lane].copy(node.pos).addScaledVector(_strayDelta, correction);
    _strayWrite[lane] = true;
    changed ||= correction !== 0 && _strayDelta.lengthSq() !== 0;
  }
  // Every lane reads the original positions, including padding and shared
  // particles. The compiled routine changes positions only, never history.
  for (let lane = 0; lane < radii.length; lane++) {
    if (_strayWrite[lane]) nodes[radii[lane].node[1]]!.pos.copy(_strayOutput[lane]);
  }
  return changed;
}

export function projectAnimStrayRadius(
  nodes: readonly (AnimStrayRadiusNode | undefined)[],
  stray: ClothStrayRadius,
): boolean {
  return projectAnimStrayRadiusBatch(nodes, [stray]);
}

interface NodeRuntime {
  index: number;
  name: string;
  bone: THREE.Bone | null;
  animationPosition: THREE.Vector3 | null;
  animationQuaternion: THREE.Quaternion | null;
  animationScale: THREE.Vector3 | null;
  invMass: number;
  pinned: boolean;
  positionDriven: boolean;
  lockToGoal: boolean;
  jiggleDriven: boolean;
  kinematic: boolean;
  generatedTarget: boolean;
  integratorMode: ReturnType<typeof clothIntegratorMode>;
  gravity: number;
  damping: number;
  animForce: number;
  animVertex: number;
  collideRadius: number;
  friction: number;
  collisionMask: number;
  initPos: Vec3;
  initRot: Vec4;
  pos: THREE.Vector3;
  prev: THREE.Vector3;
  lastSolvedPos: THREE.Vector3;
  target: THREE.Vector3;
  solvedRot: THREE.Quaternion;
  targetRot: THREE.Quaternion;
}

interface ColliderFilterRuntime {
  mask: number;
  priority: number;
  vertexNodes: ReadonlySet<number> | null;
}

interface RigidRuntime extends ColliderFilterRuntime {
  node: number;
  sphere0: Vec4;
  sphere1: Vec4;
  dbgName: string;
}

interface BoxRuntime extends ColliderFilterRuntime {
  node: number;
  pos: Vec3;
  rot: Vec4;
  halfSize: Vec3;
  dbgName: string;
}

interface CollisionPlaneRuntime {
  priority?: number;
  ctrlParent: number;
  childNode: number;
  normal: Vec3;
  offset: number;
  strength: number;
}

type ColliderRuntime =
  | { kind: 'capsule'; shape: RigidRuntime }
  | { kind: 'box'; shape: BoxRuntime }
  | { kind: 'plane'; shape: CollisionPlaneRuntime };

interface OffsetRuntime {
  parent: number;
  child: number;
  offset: Vec3;
  sign: 1 | -1;
}

interface ReverseOffsetRuntime {
  boneCtrl: number;
  targetNode: number;
  offset: Vec3;
  sign: 1 | -1;
}

interface FitWeightRuntime {
  node: number;
  weight: number;
}

export interface FitMatrixReconstruction {
  node: number;
  targetNode: number;
  bone: Vec3;
  boneRot: Vec4;
  center: Vec3;
  weights: FitWeightRuntime[];
}

interface SoftOffsetRuntime extends OffsetRuntime {
  alpha: number;
}

interface ClothRuntime {
  model: ClothModel;
  nodes: NodeRuntime[];
  rods: ClothModel['rods'];
  animatedRodBatches: ClothModel['rodBatches'];
  twistNodes: Set<number>;
  rotationNodes: Set<number>;
  capsules: RigidRuntime[];
  boxes: BoxRuntime[];
  colliders: ColliderRuntime[];
  colliderTransforms: Map<number, THREE.Matrix4>;
  ctrlOffsets: OffsetRuntime[];
  reverseOffsets: ReverseOffsetRuntime[];
  fitReconstructions: FitMatrixReconstruction[];
  softOffsets: SoftOffsetRuntime[];
  modelToRoot: THREE.Matrix4;
  rootToModel: THREE.Matrix4;
  modelToRootRot: THREE.Quaternion;
  rootToModelRot: THREE.Quaternion;
  modelToRootScale: number;
  rmse: number;
  lastSubstepDt: number | null;
  warmStarted: boolean;
  clothAnchors: Map<number, number>;
  writtenBones: Set<THREE.Bone>;
  accumulator: number;
  simulationSteps: number;
  recoveryCount: number;
  teleportDistance: number;
}

export interface ClothSimulationCoverage {
  rods: number;
  animatedRods: number;
  twists: number;
  kelagerBends: number;
  hingeLimits: number;
  triangles: number;
  quads: number;
  ropeChains: number;
  pending: {
    ropeChains: number;
    jiggleBones: number;
  };
  integrators: Record<ReturnType<typeof clothIntegratorMode>, number>;
  decodeIssues: number;
  featureGaps: ClothModel['featureGaps'];
}

export interface ClothHarnessMetrics {
  finite: number;
  rmse: number;
  fitRmse: number;
  maxDistanceFromTarget: number;
  maxDistanceFromInit: number;
  maxFrameMotion: number;
  maxFrameMotionNode: string | null;
  maxAnchorError: number;
  maxBendExcess: number;
  nodeCount: number;
  kinematicCount: number;
  simulationSteps: number;
  recoveryCount: number;
  coverage: ClothSimulationCoverage;
}

export interface ClothSimHarness {
  step(delta: number, animate?: (delta: number) => void): ClothHarnessMetrics;
  metrics(): ClothHarnessMetrics;
  snapshot(): ClothDebugSnapshot;
  dispose(): void;
}

/** Detached solver data in Source units, with its current transform to world space. */
export interface ClothDebugSnapshot {
  modelToWorld: number[];
  nodes: { name: string; position: Vec3; target: Vec3; kinematic: boolean; collisionMask: number }[];
  capsules: { a: Vec3; b: Vec3; ra: number; rb: number; mask: number; node: number }[];
  boxes: { center: Vec3; rotation: Vec4; halfSize: Vec3; mask: number; node: number }[];
  rods: { a: number; b: number; min: number; max: number; error: number }[];
  hinges: { node: number[]; excess: number | null }[];
  triangles: { node: number[]; correction: number }[];
  quads: { node: number[]; correction: number }[];
  contacts: { node: number; shape: string; depth: number }[];
}

export function clothSimulationCoverage(model: ClothModel): ClothSimulationCoverage {
  const integrators: ClothSimulationCoverage['integrators'] = { 'goal-damped': 0, raw: 0, unknown: 0 };
  model.nodes.forEach((node, index) => {
    if (!node.pinned) integrators[clothIntegratorMode(model, index)]++;
  });
  return {
    rods: model.rods.length,
    animatedRods: model.animatedRods.length,
    twists: model.twists.length,
    kelagerBends: model.kelagerBends.length,
    hingeLimits: model.hingeLimits.length,
    triangles: model.triangles.length,
    quads: model.quads.length,
    ropeChains: model.ropeChains.length,
    pending: {
      ropeChains: Math.max(0, model.ropeCount - model.ropeChains.length),
      jiggleBones: model.jiggleBones.length,
    },
    integrators,
    decodeIssues: model.decodeIssues.length,
    featureGaps: model.featureGaps.map((gap) => ({ ...gap })),
  };
}

function vec3(v: Vec3): THREE.Vector3 {
  return new THREE.Vector3(v[0], v[1], v[2]);
}

function quat(v: Vec4): THREE.Quaternion {
  return new THREE.Quaternion(v[0], v[1], v[2], v[3]).normalize();
}

function finiteVector(vector: THREE.Vector3): boolean {
  return Number.isFinite(vector.x) && Number.isFinite(vector.y) && Number.isFinite(vector.z);
}

function finiteRotation(rotation: THREE.Quaternion): boolean {
  return Number.isFinite(rotation.x) && Number.isFinite(rotation.y)
    && Number.isFinite(rotation.z) && Number.isFinite(rotation.w) && rotation.lengthSq() > 1e-12;
}

function v3Array(v: THREE.Vector3): Vec3 {
  return [v.x, v.y, v.z];
}

function worldToModelPos(root: THREE.Object3D, rt: ClothRuntime, world: THREE.Vector3): THREE.Vector3 {
  return world.applyMatrix4(root.matrixWorld.clone().invert()).applyMatrix4(rt.rootToModel);
}

function modelToWorldPos(root: THREE.Object3D, rt: ClothRuntime, model: THREE.Vector3): THREE.Vector3 {
  return model.clone().applyMatrix4(rt.modelToRoot).applyMatrix4(root.matrixWorld);
}

function worldToModelQuat(root: THREE.Object3D, rt: ClothRuntime, world: THREE.Quaternion): THREE.Quaternion {
  const rootWorld = root.getWorldQuaternion(new THREE.Quaternion()).invert();
  return rt.rootToModelRot.clone().multiply(rootWorld.multiply(world)).normalize();
}

function modelToWorldQuat(root: THREE.Object3D, rt: ClothRuntime, model: THREE.Quaternion): THREE.Quaternion {
  const rootWorld = root.getWorldQuaternion(new THREE.Quaternion());
  return rootWorld.multiply(rt.modelToRootRot.clone().multiply(model)).normalize();
}

function writeBonePosition(root: THREE.Object3D, rt: ClothRuntime, bone: THREE.Bone, pos: THREE.Vector3): void {
  setBoneWorldPosition(bone, modelToWorldPos(root, rt, pos));
}

function writeBoneQuaternion(root: THREE.Object3D, rt: ClothRuntime, bone: THREE.Bone, q: THREE.Quaternion): void {
  setBoneWorldQuaternion(bone, modelToWorldQuat(root, rt, q));
}

function canCollide(node: Pick<NodeRuntime, 'index' | 'collisionMask'>, rigid: ColliderFilterRuntime): boolean {
  if (rigid.vertexNodes !== null) return rigid.vertexNodes.has(node.index);
  return (node.collisionMask & rigid.mask) !== 0;
}

type CollisionPlaneNode = {
  pos: THREE.Vector3;
  prev: THREE.Vector3;
  solvedRot: THREE.Quaternion;
  pinned?: boolean;
  positionDriven?: boolean;
  lockToGoal?: boolean;
};

const _planeNormal = new THREE.Vector3();
const _planePoint = new THREE.Vector3();
const _planeDelta = new THREE.Vector3();
export function projectCollisionPlane(
  nodes: readonly (CollisionPlaneNode | undefined)[],
  plane: Pick<ClothCollisionPlane, 'ctrlParent' | 'childNode' | 'normal' | 'offset' | 'strength'>,
): boolean {
  const parent = nodes[plane.ctrlParent];
  const child = nodes[plane.childNode];
  if (!parent || !child || isKinematicNode(child)) return false;
  if (!plane.normal.every(Number.isFinite) || !Number.isFinite(plane.offset)) return false;

  _planeNormal.fromArray(plane.normal).applyQuaternion(parent.solvedRot);
  const normalLength = _planeNormal.length();
  if (!Number.isFinite(normalLength) || normalLength < 1e-6) return false;
  _planeNormal.multiplyScalar(1 / normalLength);

  const strength = THREE.MathUtils.clamp(Number.isFinite(plane.strength) ? plane.strength : 0, 0, 1);
  if (strength <= 0) return false;

  _planePoint.copy(parent.pos).addScaledVector(_planeNormal, plane.offset);
  const signed = _planeDelta.copy(child.pos).sub(_planePoint).dot(_planeNormal);
  if (signed >= 0) return false;

  _planeDelta.copy(_planeNormal).multiplyScalar(-signed * strength);
  child.pos.add(_planeDelta);
  return true;
}

export function reconstructReverseOffsetPosition(
  offset: { boneCtrl: number; targetNode: number; offset: Vec3; sign: 1 | -1 },
  nodes: Array<{
    pos: THREE.Vector3;
    solvedRot: THREE.Quaternion;
  } | undefined>,
): THREE.Vector3 | null {
  const boneNode = nodes[offset.boneCtrl];
  const targetNode = nodes[offset.targetNode];
  if (!boneNode || !targetNode) return null;
  return targetNode.pos.clone().add(vec3(offset.offset).multiplyScalar(offset.sign).applyQuaternion(boneNode.solvedRot));
}

export function buildFitMatrixReconstructions(
  model: Pick<ClothModel, 'fitMatrices' | 'fitWeights'> & { nodes: readonly unknown[] },
): FitMatrixReconstruction[] {
  const reconstructions: FitMatrixReconstruction[] = [];
  let begin = 0;
  for (const fit of model.fitMatrices) {
    const end = Math.max(begin, Math.min(model.fitWeights.length, Math.trunc(fit.endWeight)));
    const weights: FitWeightRuntime[] = [];
    for (let i = begin; i < end; i++) {
      const weight = model.fitWeights[i];
      if (!weight || !Number.isInteger(weight.node) || weight.node < 0 || weight.node >= model.nodes.length) continue;
      if (!Number.isFinite(weight.weight) || weight.weight <= 0) continue;
      weights.push({ node: weight.node, weight: weight.weight });
    }
    const targetNode = fitMatrixTargetNode(fit, model.nodes.length);
    if (targetNode >= 0 && weights.length > 0) {
      reconstructions.push({
        node: fit.node,
        targetNode,
        bone: fit.bone,
        boneRot: fit.boneRot,
        center: fit.center,
        weights,
      });
    }
    begin = end;
  }
  return reconstructions;
}

export function reconstructFitMatrixTransform(
  fit: FitMatrixReconstruction,
  nodes: Array<{
    initPos: Vec3;
    pos: THREE.Vector3;
  } | undefined>,
): { position: THREE.Vector3; rotation: THREE.Quaternion } | null {
  if (!nodes[fit.targetNode]) return null;

  const source: Vec3[] = [];
  const target: Vec3[] = [];
  const weights: number[] = [];
  for (const entry of fit.weights) {
    const node = nodes[entry.node];
    if (!node) continue;
    source.push(node.initPos);
    target.push(v3Array(node.pos));
    weights.push(entry.weight);
  }
  const rigid = recoverClothFit(source, target, weights, fit.center);
  if (!rigid) return null;
  // The compiled bone transform is already relative to the fit center. It is
  // an output transform, separate from the particle and its integration history.
  return {
    position: rigid.position.add(vec3(fit.bone).applyQuaternion(rigid.rotation)),
    rotation: rigid.rotation.clone().multiply(quat(fit.boneRot)).normalize(),
  };
}

function rigidToCapsule(rt: ClothRuntime, rigid: RigidRuntime, out: Capsule): Capsule {
  const anchor = rt.nodes[rigid.node];
  const p0 = vec3([rigid.sphere0[0], rigid.sphere0[1], rigid.sphere0[2]]).applyQuaternion(anchor.solvedRot);
  const p1 = vec3([rigid.sphere1[0], rigid.sphere1[1], rigid.sphere1[2]]).applyQuaternion(anchor.solvedRot);
  out.a.copy(anchor.pos).add(p0);
  out.b.copy(anchor.pos).add(p1);
  out.ra = rigid.sphere0[3] * clothTuning.collisionScale;
  out.rb = rigid.sphere1[3] * clothTuning.collisionScale;
  return out;
}

function rigidToBox(rt: ClothRuntime, rigid: BoxRuntime, out: Box): Box {
  const anchor = rt.nodes[rigid.node];
  const center = vec3(rigid.pos).applyQuaternion(anchor.solvedRot);
  out.center.copy(anchor.pos).add(center);
  out.rotation.copy(anchor.solvedRot).multiply(quat(rigid.rot)).normalize();
  out.halfSize
    .set(Math.abs(rigid.halfSize[0]), Math.abs(rigid.halfSize[1]), Math.abs(rigid.halfSize[2]))
    .multiplyScalar(clothTuning.collisionScale);
  return out;
}

function colliderFilter(collider: ClothColliderFilter): ColliderFilterRuntime {
  return {
    mask: collider.mask,
    priority: collider.priority ?? 0,
    vertexNodes: collider.vertexNodes === undefined ? null : new Set(collider.vertexNodes),
  };
}

function fromCapsule(c: ClothCapsule): RigidRuntime {
  return {
    ...colliderFilter(c),
    node: c.node,
    sphere0: c.sphere0,
    sphere1: c.sphere1,
    dbgName: `node:${c.node}`,
  };
}

function fromSphere(s: ClothSphere): RigidRuntime {
  return {
    ...colliderFilter(s),
    node: s.node,
    sphere0: s.sphere,
    sphere1: s.sphere,
    dbgName: `node:${s.node}`,
  };
}

function fromBox(b: ClothBox): BoxRuntime {
  return {
    ...colliderFilter(b),
    node: b.node,
    pos: b.pos,
    rot: b.rot,
    halfSize: b.halfSize,
    dbgName: `node:${b.node}`,
  };
}

function fromCollisionPlane(p: ClothCollisionPlane): CollisionPlaneRuntime {
  return {
    priority: p.priority,
    ctrlParent: p.ctrlParent,
    childNode: p.childNode,
    normal: p.normal,
    offset: p.offset,
    strength: p.strength,
  };
}

function buildRuntime(root: THREE.Object3D, model: ClothModel): ClothRuntime | null {
  const bones = new Map<string, THREE.Bone>();
  root.traverse((obj) => {
    const bone = obj as THREE.Bone;
    if (bone.isBone) bones.set(bone.name, bone);
  });

  root.updateWorldMatrix(true, true);
  const invRoot = root.matrixWorld.clone().invert();
  const sourceAll: Vec3[] = [];
  const targetAll: Vec3[] = [];
  const sourcePinned: Vec3[] = [];
  const targetPinned: Vec3[] = [];

  for (const node of model.nodes) {
    const bone = bones.get(node.name);
    if (!bone) continue;
    const world = bone.getWorldPosition(new THREE.Vector3()).applyMatrix4(invRoot);
    sourceAll.push(node.initPos);
    targetAll.push(v3Array(world));
    if (node.pinned) {
      sourcePinned.push(node.initPos);
      targetPinned.push(v3Array(world));
    }
  }

  const usePinned = sourcePinned.length >= 3;
  const source = usePinned ? sourcePinned : sourceAll;
  const target = usePinned ? targetPinned : targetAll;
  if (source.length < 3) return null;

  const fit = recoverSimilarity(source, target);
  if (![fit.scale, fit.rmse, ...fit.matrix.elements, ...fit.inverse.elements].every(Number.isFinite)
    || Math.abs(fit.scale) < 1e-12) return null;
  const lockToGoalNodes = new Set(model.lockToGoal);
  const fitMatrixDrivenNodes = fitMatrixDrivenNodeSet(model);
  const jiggleDrivenNodes = jiggleDrivenNodeSet(model);
  const generatedTargets = new Set([...model.ctrlOffsets, ...model.softOffsets].map((offset) => offset.child));
  const nodes: NodeRuntime[] = model.nodes.map((node, index) => {
    const bone = bones.get(node.name) ?? null;
    const initPos = vec3(node.initPos);
    const initRot = quat(node.initRot);
    return {
      index,
      name: node.name,
      bone,
      animationPosition: bone ? bone.position.clone() : null,
      animationQuaternion: bone ? bone.quaternion.clone() : null,
      animationScale: bone ? bone.scale.clone() : null,
      invMass: node.invMass,
      // FreeNodes selects an orientation path; nodes with a reconstructed basis
      // still simulate their positions. Explicit driven-node flags are separate.
      pinned: node.pinned,
      positionDriven: isPositionDrivenNode(index, model) || fitMatrixDrivenNodes.has(index),
      lockToGoal: lockToGoalNodes.has(index),
      jiggleDriven: jiggleDrivenNodes.has(index),
      kinematic: false,
      generatedTarget: generatedTargets.has(index),
      integratorMode: clothIntegratorMode(model, index),
      gravity: effectiveNodeGravity(node.gravity, model.defaultGravityScale),
      damping: node.damping,
      animForce: node.animForce,
      animVertex: node.animVertex,
      collideRadius: node.collideRadius,
      friction: node.friction,
      collisionMask: node.collisionMask,
      initPos: node.initPos,
      initRot: node.initRot,
      pos: initPos.clone(),
      prev: initPos.clone(),
      lastSolvedPos: initPos.clone(),
      target: initPos.clone(),
      solvedRot: initRot.clone(),
      targetRot: initRot.clone(),
    };
  });

  for (const node of nodes) node.kinematic = isKinematicNode(node);

  const ctrlOffsets: OffsetRuntime[] = model.ctrlOffsets.map((offset) => ({
    ...offset,
    sign: recoverOffsetSign(
      model.nodes[offset.parent]?.initPos ?? [0, 0, 0],
      model.nodes[offset.parent]?.initRot ?? [0, 0, 0, 1],
      model.nodes[offset.child]?.initPos ?? [0, 0, 0],
      offset.offset,
    ),
  }));

  const softOffsets: SoftOffsetRuntime[] = model.softOffsets.map((offset) => ({
    ...offset,
    sign: recoverOffsetSign(
      model.nodes[offset.parent]?.initPos ?? [0, 0, 0],
      model.nodes[offset.parent]?.initRot ?? [0, 0, 0, 1],
      model.nodes[offset.child]?.initPos ?? [0, 0, 0],
      offset.offset,
    ),
  }));

  const reverseOffsets: ReverseOffsetRuntime[] = model.reverseOffsets.map((offset: ClothReverseOffset) => {
    const targetPos = model.nodes[offset.targetNode]?.initPos ?? [0, 0, 0];
    const bonePos = model.nodes[offset.boneCtrl]?.initPos ?? [0, 0, 0];
    const boneRot = model.nodes[offset.boneCtrl]?.initRot ?? [0, 0, 0, 1];
    const plus = applyOffset(targetPos, boneRot, offset.offset, 1).distanceToSquared(vec3(bonePos));
    const minus = applyOffset(targetPos, boneRot, offset.offset, -1).distanceToSquared(vec3(bonePos));
    return {
      ...offset,
      sign: plus <= minus ? 1 : -1,
    };
  });

  const capsules = [...model.capsules.map(fromCapsule).reverse(), ...model.spheres.map(fromSphere).reverse()].filter(
    (rigid) => Number.isInteger(rigid.node) && rigid.node >= 0 && rigid.node < nodes.length,
  );
  const boxes = model.boxes.map(fromBox).reverse().filter((rigid) => Number.isInteger(rigid.node) && rigid.node >= 0 && rigid.node < nodes.length);
  const collisionPlanes = model.collisionPlanes.map(fromCollisionPlane).filter((plane) => (
    Number.isInteger(plane.ctrlParent) && Number.isInteger(plane.childNode)
    && plane.ctrlParent >= 0 && plane.ctrlParent < nodes.length && plane.childNode >= 0 && plane.childNode < nodes.length
  ));
  const colliders: ColliderRuntime[] = [
    ...capsules.map((shape) => ({ kind: 'capsule' as const, shape })),
    ...boxes.map((shape) => ({ kind: 'box' as const, shape })),
    ...collisionPlanes.map((shape) => ({ kind: 'plane' as const, shape })),
  ];
  // Stable sorting preserves each type's compiled traversal within a priority.
  colliders.sort((a, b) => (b.shape.priority ?? 0) - (a.shape.priority ?? 0));

  return {
    model,
    nodes,
    rods: model.rods,
    animatedRodBatches: model.animatedRodBatches.map((batch) => batch.map((rod) => ({ ...rod, min: 0, max: 0 }))),
    twistNodes: new Set(model.twists.map((link) => link.nodeOrient).filter((index) => (
      index >= model.rotLockStaticNodeCount && index < nodes.length && !nodes[index].jiggleDriven
    ))),
    rotationNodes: new Set([...model.twists.map((link) => link.nodeOrient), ...model.ropeChains.flat()].filter((index) => (
      index >= model.rotLockStaticNodeCount && index < nodes.length && !nodes[index].jiggleDriven
    ))),
    capsules,
    boxes,
    colliders,
    colliderTransforms: new Map(),
    ctrlOffsets,
    reverseOffsets,
    fitReconstructions: buildFitMatrixReconstructions(model),
    softOffsets,
    modelToRoot: fit.matrix,
    rootToModel: fit.inverse,
    modelToRootRot: fit.rotation,
    rootToModelRot: fit.rotation.clone().invert(),
    modelToRootScale: Math.abs(fit.scale),
    rmse: fit.rmse,
    lastSubstepDt: null,
    warmStarted: false,
    clothAnchors: clothAnchorMap(model),
    writtenBones: new Set(),
    accumulator: 0,
    simulationSteps: 0,
    recoveryCount: 0,
    // Source units. Ordinary animation remains untouched; discontinuous body
    // motion spanning multiple rest-pose bounds starts a new drape.
    teleportDistance: Math.max(128, new THREE.Box3().setFromPoints(nodes.map((node) => vec3(node.initPos))).getSize(new THREE.Vector3()).length() * 4),
  };
}

function restoreAnimationPose(rt: ClothRuntime): void {
  for (const node of rt.nodes) {
    if (node.bone && rt.writtenBones.has(node.bone)
      && node.animationPosition && node.animationQuaternion && node.animationScale) {
      restoreBoneBindTransform(node.bone, node.animationPosition, node.animationQuaternion, node.animationScale);
    }
  }
  rt.writtenBones.clear();
}

function refreshTargets(root: THREE.Object3D, rt: ClothRuntime): void {
  // Capture after the mixer update. Unkeyed channels must start the next update
  // from this clean pose, while body anchors remain owned by animation.
  for (const node of rt.nodes) {
    if (!node.bone) continue;
    // A malformed animation sample must not become next frame's restore pose.
    if (!finiteVector(node.bone.position) || !finiteRotation(node.bone.quaternion) || !finiteVector(node.bone.scale)) {
      if (node.animationPosition && node.animationQuaternion && node.animationScale) {
        restoreBoneBindTransform(node.bone, node.animationPosition, node.animationQuaternion, node.animationScale);
      }
    }
    node.animationPosition?.copy(node.bone.position);
    node.animationQuaternion?.copy(node.bone.quaternion);
    node.animationScale?.copy(node.bone.scale);
  }
  root.updateWorldMatrix(true, true);

  for (const node of rt.nodes) {
    if (!node.bone) {
      node.target.copy(vec3(node.initPos));
      node.targetRot.copy(quat(node.initRot));
      continue;
    }
    const target = worldToModelPos(root, rt, node.bone.getWorldPosition(new THREE.Vector3()));
    const rotation = worldToModelQuat(root, rt, node.bone.getWorldQuaternion(new THREE.Quaternion()));
    if (!finiteVector(target) || !finiteRotation(rotation)) continue;
    if (rt.warmStarted && node.kinematic && target.distanceTo(node.target) > rt.teleportDistance) {
      resetRuntimeHistory(rt);
    }
    node.target.copy(target);
    node.targetRot.copy(rotation);
  }

  for (const offset of rt.ctrlOffsets) {
    const parent = rt.nodes[offset.parent];
    const child = rt.nodes[offset.child];
    if (!parent || !child) continue;
    child.target.copy(applyOffset(v3Array(parent.target), [parent.targetRot.x, parent.targetRot.y, parent.targetRot.z, parent.targetRot.w], offset.offset, offset.sign));
  }

  for (const offset of rt.softOffsets) {
    const parent = rt.nodes[offset.parent];
    const child = rt.nodes[offset.child];
    if (!parent || !child || !Number.isFinite(offset.alpha)) continue;
    const target = applyOffset(
      v3Array(parent.target),
      [parent.targetRot.x, parent.targetRot.y, parent.targetRot.z, parent.targetRot.w],
      offset.offset,
      offset.sign,
    );
    // The serialized network is an ordered series of lerps. Alpha retains the
    // previous result, while this parent's influence receives 1 - alpha.
    child.target.lerp(target, 1 - THREE.MathUtils.clamp(offset.alpha, 0, 1));
  }

  const positions = rt.nodes.map((node) => v3Array(node.target));
  for (const base of rt.model.nodeBases) {
    const node = rt.nodes[base.node];
    if (node) node.targetRot.copy(nodeBaseQuaternion(positions, base));
  }
}

function resetRuntimeHistory(rt: ClothRuntime): void {
  rt.warmStarted = false;
  rt.lastSubstepDt = null;
  rt.colliderTransforms.clear();
  rt.recoveryCount++;
}

function recoverInvalidSolverState(rt: ClothRuntime): void {
  const limit = Math.max(1e6, rt.teleportDistance * 1024);
  if (rt.nodes.every((node) => (
    finiteVector(node.pos) && finiteVector(node.prev) && finiteRotation(node.solvedRot)
    // This is an emergency guard, far beyond ordinary cloth motion, rather
    // than a replacement for authored constraints.
    && node.pos.distanceToSquared(node.target) < limit * limit
  ))) return;
  resetRuntimeHistory(rt);
  warmStartRuntime(rt, CLOTH_TIMESTEP);
  for (const node of rt.nodes) node.lastSolvedPos.copy(node.pos);
}

const _seedTmp = new THREE.Vector3();
function warmStartRuntime(rt: ClothRuntime, substepDt: number): void {
  if (rt.warmStarted) return;
  for (const node of rt.nodes) {
    // Seed cloth nodes at their rigid-anchor rest pose (v16 ClothAnchors) so the sim
    // starts attached to the already-posed body, not stranded at bind. Anchorless
    // nodes (and any degenerate seed) fall back to their own animated target.
    const anchorIndex = rt.clothAnchors.get(node.index);
    const anchor = anchorIndex === undefined ? undefined : rt.nodes[anchorIndex];
    if (anchor) {
      rigidAnchorSeed(node.initPos, anchor.initPos, anchor.initRot, anchor.target, anchor.targetRot, _seedTmp);
      if (Number.isFinite(_seedTmp.x) && Number.isFinite(_seedTmp.y) && Number.isFinite(_seedTmp.z)) {
        node.pos.copy(_seedTmp);
        node.prev.copy(_seedTmp);
        node.solvedRot.copy(node.targetRot);
        continue;
      }
    }
    node.pos.copy(node.target);
    node.prev.copy(node.target);
    node.solvedRot.copy(node.targetRot);
  }
  rt.lastSubstepDt = Number.isFinite(substepDt) && substepDt > 0 ? substepDt : null;
  rt.warmStarted = true;
}

function integrate(rt: ClothRuntime, gravity: THREE.Vector3, dt: number): void {
  const dt2 = dt * dt;
  const lastDt = rt.lastSubstepDt;
  for (const node of rt.nodes) {
    if (isKinematicNode(node)) {
      node.pos.copy(node.target);
      node.prev.copy(node.target);
      if (!rt.twistNodes.has(node.index)) node.solvedRot.copy(node.targetRot);
      continue;
    }
    const damping = node.integratorMode === 'unknown'
      ? Math.max(node.damping, MIN_VELOCITY_DAMPING)
      : Math.max(0, node.damping * dt);
    const velocity = node.pos.clone().sub(node.prev).multiplyScalar(
      verletVelocityScale(dt, lastDt, damping),
    );
    node.prev.copy(node.pos);
    node.pos.add(velocity);
    node.pos.addScaledVector(gravity, node.gravity * clothTuning.gravityScale * dt2);
  }
  if (Number.isFinite(dt) && dt > 0) rt.lastSubstepDt = dt;
}

const _goalDelta = new THREE.Vector3();
function solveGoals(rt: ClothRuntime, dt: number): void {
  for (const node of rt.nodes) {
    if (isKinematicNode(node)) continue;
    if (node.integratorMode === 'goal-damped') continue;
    if (node.integratorMode === 'raw') {
      applyRawAttraction(node.pos, node.prev, node.target,
        node.animForce * clothTuning.attractionScale, node.animVertex * clothTuning.attractionScale, dt);
      continue;
    }
    const { posBlend, velImpulse } = animationAttraction(node.animVertex, node.animForce, dt);
    const pos = posBlend * clothTuning.attractionScale;
    const vel = velImpulse * clothTuning.attractionScale;
    if (pos <= 0 && vel <= 0) continue;
    _goalDelta.copy(node.target).sub(node.pos);
    // Position blend moves both Verlet buffers (no velocity change); the force term
    // moves only the current position (imparts velocity toward the goal).
    node.prev.addScaledVector(_goalDelta, pos);
    node.pos.addScaledVector(_goalDelta, pos + vel);
  }
}

function solveGoalDampedNodes(rt: ClothRuntime): void {
  for (const node of rt.nodes) {
    if (node.kinematic || node.integratorMode !== 'goal-damped') continue;
    applyGoalDampedAttraction(node.pos, node.prev, node.target,
      node.animForce * clothTuning.attractionScale, node.animVertex * clothTuning.attractionScale);
  }
}

function solveFixedRods(rt: ClothRuntime): void {
  if (rt.model.rodBatches.length > 0) {
    for (const batch of rt.model.rodBatches) projectRodBatch(rt.nodes, batch);
    return;
  }
  for (const rod of rt.rods) {
    const a = rt.nodes[rod.a];
    const b = rt.nodes[rod.b];
    if (!a || !b) continue;
    const delta = b.pos.clone().sub(a.pos);
    const d = delta.length();
    if (d < 1e-6) continue;
    let wanted = d;
    if (rod.min > 0 && d < rod.min) wanted = rod.min;
    if (rod.max > 0 && d > rod.max) wanted = rod.max;
    if (wanted === d) continue;

    const shares = rodCorrectionShares(rod.weight);
    if (shares.a <= 0 && shares.b <= 0) continue;
    const correction = delta.multiplyScalar(((d - wanted) / d) * rod.relax);
    if (shares.a > 0 && !a.kinematic) a.pos.addScaledVector(correction, shares.a);
    if (shares.b > 0 && !b.kinematic) b.pos.addScaledVector(correction, -shares.b);
  }
}

function solveCollisions(rt: ClothRuntime): void {
  const cap: Capsule = { a: new THREE.Vector3(), b: new THREE.Vector3(), ra: 0, rb: 0 };
  const box: Box = {
    center: new THREE.Vector3(),
    rotation: new THREE.Quaternion(),
    halfSize: new THREE.Vector3(),
  };
  const normal = new THREE.Vector3();
  const transforms = new Map<number, THREE.Matrix4>();
  const motions = new Map<number, THREE.Matrix4>();
  const unitScale = new THREE.Vector3(1, 1, 1);
  const motion = (index: number) => {
    const cached = motions.get(index);
    if (cached) return cached;
    const parent = rt.nodes[index];
    const transform = new THREE.Matrix4().compose(parent.pos, parent.solvedRot, unitScale);
    const previous = rt.colliderTransforms.get(index);
    const delta = previous ? transform.clone().multiply(previous.clone().invert()) : new THREE.Matrix4();
    transforms.set(index, transform);
    motions.set(index, delta);
    return delta;
  };
  for (const collider of rt.colliders) {
    if (collider.kind === 'plane') {
      projectCollisionPlane(rt.nodes, collider.shape);
      continue;
    }
    if (collider.kind === 'capsule') rigidToCapsule(rt, collider.shape, cap);
    else rigidToBox(rt, collider.shape, box);
    const colliderMotion = motion(collider.shape.node);
    for (const node of rt.nodes) {
      if (node.kinematic) continue;
      if (!canCollide(node, collider.shape)) continue;
      const radius = Math.max(0, node.collideRadius);
      const depth = collider.kind === 'capsule' ? capsuleDepth(node.pos, cap, radius, normal, rt.model.hasCollisionFriction) : boxDepth(node.pos, box, radius, normal, rt.model.hasCollisionFriction);
      projectClothContact(node.pos, node.prev, normal, depth, node.friction, colliderMotion);
    }
  }
  for (const [index, transform] of transforms) rt.colliderTransforms.set(index, transform);
}

function solveAnimStrayRadii(rt: ClothRuntime): void {
  for (const batch of rt.model.strayRadiusBatches) projectAnimStrayRadiusBatch(rt.nodes, batch);
}

function updateSolvedRotations(rt: ClothRuntime): void {
  const positions = rt.nodes.map((node) => v3Array(node.pos));
  for (const node of rt.nodes) {
    if (!rt.twistNodes.has(node.index)) node.solvedRot.copy(node.targetRot);
  }
  for (const base of rt.model.nodeBases) {
    const node = rt.nodes[base.node];
    if (node) node.solvedRot.copy(nodeBaseQuaternion(positions, base));
  }
  for (const chain of rt.model.ropeChains) {
    reconstructClothRope(rt.nodes, chain, rt.rotationNodes);
  }
  for (const link of rt.model.twists) {
    if (rt.twistNodes.has(link.nodeOrient)) reconstructClothTwist(rt.nodes, link);
  }
}

function updateAnimatedRodLengths(rt: ClothRuntime): void {
  for (const batch of rt.animatedRodBatches) {
    for (const rod of batch) {
      const length = Math.sqrt(Math.max(rt.nodes[rod.a].target.distanceToSquared(rt.nodes[rod.b].target), 2 ** -30));
      rod.min = length;
      rod.max = length;
    }
  }
}

function solveRods(rt: ClothRuntime): void {
  solveFixedRods(rt);
  for (const batch of rt.animatedRodBatches) projectRodBatch(rt.nodes, batch);
}

function writeBack(root: THREE.Object3D, rt: ClothRuntime): void {
  recoverInvalidSolverState(rt);
  updateSolvedRotations(rt);
  for (const node of rt.nodes) {
    if (!finiteRotation(node.solvedRot)) node.solvedRot.copy(node.targetRot);
  }

  const fitWrites = new Map<THREE.Bone, { position: THREE.Vector3; rotation: THREE.Quaternion }>();
  for (const fit of rt.fitReconstructions) {
    const node = rt.nodes[fit.targetNode];
    if (!node?.bone || node.jiggleDriven) continue;
    const transform = reconstructFitMatrixTransform(fit, rt.nodes);
    if (transform) fitWrites.set(node.bone, transform);
  }

  const rotationWrites = new Map<THREE.Bone, THREE.Quaternion>();
  for (const index of rt.rotationNodes) {
    const node = rt.nodes[index];
    if (node.bone) rotationWrites.set(node.bone, node.solvedRot.clone());
  }
  for (const base of rt.model.nodeBases) {
    const node = rt.nodes[base.node];
    if (node?.bone && !node.pinned && !node.jiggleDriven) {
      rotationWrites.set(node.bone, node.solvedRot.clone());
    }
  }

  for (const [bone, transform] of fitWrites) rotationWrites.set(bone, transform.rotation);

  for (const node of rt.nodes) {
    if (!node.bone || rotationWrites.has(node.bone)) continue;
    for (let parent = node.bone.parent; parent; parent = parent.parent) {
      if (parent instanceof THREE.Bone && rotationWrites.has(parent)) {
        rotationWrites.set(node.bone, node.targetRot.clone());
        break;
      }
    }
  }
  for (const [bone, rot] of orderBonesParentFirst(rotationWrites.entries())) {
    writeBoneQuaternion(root, rt, bone, rot);
    rt.writtenBones.add(bone);
  }

  const movedBones = new Set(rt.nodes.filter((node) => (!node.kinematic || node.generatedTarget) && node.bone).map((node) => node.bone));
  const positionWrites = new Map<THREE.Bone, THREE.Vector3>();
  for (const node of rt.nodes) {
    if (!node.bone) continue;
    if (node.kinematic && !node.generatedTarget) {
      // A simulated ancestor must not carry an animation-owned attachment away
      // from its sampled world position, even when that ancestor only translates.
      let parent: THREE.Object3D | null = node.bone;
      while (parent && !(parent instanceof THREE.Bone && (rotationWrites.has(parent) || movedBones.has(parent)))) parent = parent.parent;
      if (!parent) continue;
    }
    positionWrites.set(node.bone, node.pos.clone());
  }

  for (const offset of rt.reverseOffsets) {
    const boneNode = rt.nodes[offset.boneCtrl];
    if (!boneNode?.bone || boneNode.pinned || boneNode.jiggleDriven) continue;
    // Reverse offsets place the rendered bone after orientation reconstruction.
    // The particle and its integration history remain in the solver buffer.
    const position = reconstructReverseOffsetPosition(offset, rt.nodes);
    if (position) positionWrites.set(boneNode.bone, position);
  }

  for (const [bone, transform] of fitWrites) positionWrites.set(bone, transform.position);

  [...positionWrites.entries()]
    .sort(([a], [b]) => objectDepth(a) - objectDepth(b))
    .forEach(([bone, pos]) => {
      writeBonePosition(root, rt, bone, pos);
      rt.writtenBones.add(bone);
    });

  root.updateWorldMatrix(true, true);
}

function clearDebugGeometry(group: THREE.Group): void {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  group.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    geometries.add(object.geometry);
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      materials.add(material);
    }
  });
  geometries.forEach((geometry) => geometry.dispose());
  materials.forEach((material) => material.dispose());
  group.clear();
}

function updateDebug(root: THREE.Object3D, rt: ClothRuntime, debugRef: React.MutableRefObject<THREE.Group | null>): void {
  if (!clothTuning.showNodes && !clothTuning.showColliders) {
    if (debugRef.current) debugRef.current.visible = false;
    return;
  }
  if (!debugRef.current) {
    const group = new THREE.Group();
    group.name = '__clothDebug';
    root.add(group);
    debugRef.current = group;
  }
  const group = debugRef.current;
  group.visible = true;
  clearDebugGeometry(group);

  if (clothTuning.showNodes) {
    const freeMat = new THREE.MeshBasicMaterial({ color: 0x22ff66, depthTest: false });
    const pinMat = new THREE.MeshBasicMaterial({ color: 0xffaa00, depthTest: false });
    const geo = new THREE.SphereGeometry(0.015, 6, 4);
    for (const node of rt.nodes) {
      const mesh = new THREE.Mesh(geo, node.pinned ? pinMat : freeMat);
      mesh.position.copy(node.pos.clone().applyMatrix4(rt.modelToRoot));
      mesh.renderOrder = 999;
      group.add(mesh);
    }
  }

  if (clothTuning.showColliders) {
    const mat = new THREE.MeshBasicMaterial({ color: 0x33aaff, wireframe: true, transparent: true, opacity: 0.45, depthTest: false });
    const geo = new THREE.SphereGeometry(1, 10, 6);
    const boxGeo = new THREE.BoxGeometry(1, 1, 1);
    const cap: Capsule = { a: new THREE.Vector3(), b: new THREE.Vector3(), ra: 0, rb: 0 };
    const box: Box = {
      center: new THREE.Vector3(),
      rotation: new THREE.Quaternion(),
      halfSize: new THREE.Vector3(),
    };
    for (const rigid of rt.capsules) {
      rigidToCapsule(rt, rigid, cap);
      for (const [pos, radius] of [[cap.a, cap.ra], [cap.b, cap.rb]] as const) {
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.copy(pos.clone().applyMatrix4(rt.modelToRoot));
        mesh.scale.setScalar(Math.max(radius * rt.modelToRootScale, 1e-3));
        mesh.renderOrder = 999;
        group.add(mesh);
      }
    }
    for (const rigid of rt.boxes) {
      rigidToBox(rt, rigid, box);
      const mesh = new THREE.Mesh(boxGeo, mat);
      mesh.position.copy(box.center.clone().applyMatrix4(rt.modelToRoot));
      mesh.quaternion.copy(rt.modelToRootRot).multiply(box.rotation).normalize();
      mesh.scale.copy(box.halfSize).multiplyScalar(2 * rt.modelToRootScale);
      mesh.renderOrder = 999;
      group.add(mesh);
    }
  }
}

function stepClothRuntime(
  root: THREE.Object3D,
  rt: ClothRuntime,
  delta: number,
  animate?: (delta: number) => void,
  mode: 'simulation' | 'targets' = 'simulation',
): void {
  if (!Number.isFinite(delta) || delta <= 0) return;
  if (delta > CLOTH_RESUME_GAP) {
    rt.accumulator = 0;
    resetRuntimeHistory(rt);
    return;
  }
  rt.accumulator += Math.min(delta, MAX_CLOTH_STEPS_PER_FRAME * CLOTH_TIMESTEP);
  const count = Math.min(MAX_CLOTH_STEPS_PER_FRAME, Math.floor((rt.accumulator + 1e-10) / CLOTH_TIMESTEP));
  rt.accumulator = Math.max(0, rt.accumulator - count * CLOTH_TIMESTEP);
  const gravity = new THREE.Vector3(0, -1, 0)
    .applyQuaternion(root.getWorldQuaternion(new THREE.Quaternion()).invert())
    .applyQuaternion(rt.rootToModelRot);

  const { constraintIterations, goalIterations } = solverIterationPhases(rt.model, clothTuning.iterationOverride);
  const collideAfterConstraints = ((rt.model.dynamicNodeFlags ?? 0) & 0x2000) !== 0;
  for (let step = 0; step < count; step++) {
    restoreAnimationPose(rt);
    animate?.(CLOTH_TIMESTEP);
    refreshTargets(root, rt);
    updateAnimatedRodLengths(rt);
    warmStartRuntime(rt, CLOTH_TIMESTEP);
    for (const node of rt.nodes) node.lastSolvedPos.copy(node.pos);
    if (mode === 'targets') {
      for (const node of rt.nodes) {
        node.pos.copy(node.target);
        node.prev.copy(node.target);
        node.solvedRot.copy(node.targetRot);
      }
      writeBack(root, rt);
      rt.simulationSteps++;
      continue;
    }
    integrate(rt, gravity, CLOTH_TIMESTEP);

    solveGoals(rt, CLOTH_TIMESTEP);
    if (!collideAfterConstraints) solveCollisions(rt);

    for (let i = 0; i < constraintIterations; i++) {
      for (const bend of rt.model.kelagerBends) projectKelagerBend(rt.nodes, bend);
      for (const hinge of rt.model.hingeLimits) projectHingeLimit(rt.nodes, hinge);
      solveRods(rt);
      solveAnimStrayRadii(rt);
      for (const batch of rt.model.quadBatches) projectQuadBatch(rt.nodes, batch);
      for (const batch of rt.model.triangleBatches) projectTriangleBatch(rt.nodes, batch);
      if (i >= constraintIterations - goalIterations) solveGoalDampedNodes(rt);
      restorePinnedSolverNodes(rt.nodes);
    }
    if (collideAfterConstraints) solveCollisions(rt);
    restorePinnedSolverNodes(rt.nodes);
    writeBack(root, rt);
    rt.simulationSteps++;
  }
}

function collectClothHarnessMetrics(rt: ClothRuntime): ClothHarnessMetrics {
  let finite = Number.isFinite(rt.rmse) ? 1 : 0;
  let targetErrorSq = 0;
  let maxDistanceFromTarget = 0;
  let maxDistanceFromInit = 0;
  let maxFrameMotion = 0;
  let maxFrameMotionNode: string | null = null;
  let maxAnchorError = 0;
  let kinematicCount = 0;

  for (const node of rt.nodes) {
    const init = vec3(node.initPos);
    const targetDistance = node.pos.distanceTo(node.target);
    const initDistance = node.pos.distanceTo(init);
    const frameMotion = node.pos.distanceTo(node.lastSolvedPos);
    targetErrorSq += targetDistance * targetDistance;
    maxDistanceFromTarget = Math.max(maxDistanceFromTarget, targetDistance);
    maxDistanceFromInit = Math.max(maxDistanceFromInit, initDistance);
    if (frameMotion > maxFrameMotion) {
      maxFrameMotion = frameMotion;
      maxFrameMotionNode = node.name;
    }
    if (isKinematicNode(node)) {
      kinematicCount += 1;
      if (!node.positionDriven) maxAnchorError = Math.max(maxAnchorError, targetDistance);
    }

    const values = [
      node.pos.x,
      node.pos.y,
      node.pos.z,
      node.prev.x,
      node.prev.y,
      node.prev.z,
      node.target.x,
      node.target.y,
      node.target.z,
      node.solvedRot.x,
      node.solvedRot.y,
      node.solvedRot.z,
      node.solvedRot.w,
      targetDistance,
      initDistance,
      frameMotion,
    ];
    if (!values.every(Number.isFinite)) finite = 0;
  }

  const nodeCount = rt.nodes.length;
  let maxBendExcess = 0;
  for (const bend of rt.model.kelagerBends) {
    const [a, b, c] = bend.node.map((index) => rt.nodes[index]);
    if (!a || !b || !c) continue;
    const height = a.pos.clone().multiplyScalar(2).sub(b.pos).sub(c.pos).length() / 3;
    maxBendExcess = Math.max(maxBendExcess, height - bend.height0);
  }
  return {
    finite,
    rmse: nodeCount > 0 ? Math.sqrt(targetErrorSq / nodeCount) : 0,
    fitRmse: rt.rmse,
    maxDistanceFromTarget,
    maxDistanceFromInit,
    maxFrameMotion,
    maxFrameMotionNode,
    maxAnchorError,
    maxBendExcess,
    nodeCount,
    kinematicCount,
    simulationSteps: rt.simulationSteps,
    recoveryCount: rt.recoveryCount,
    coverage: clothSimulationCoverage(rt.model),
  };
}

export function createClothSimHarness(
  root: THREE.Object3D,
  femodel: ClothModel,
  options: { mode?: 'simulation' | 'targets' } = {},
): ClothSimHarness {
  const rt = buildRuntime(root, femodel);
  if (!rt) throw new Error('createClothSimHarness requires at least three matched cloth nodes');
  return {
    step(delta: number, animate?: (delta: number) => void): ClothHarnessMetrics {
      stepClothRuntime(root, rt, delta, animate, options.mode);
      return collectClothHarnessMetrics(rt);
    },
    metrics(): ClothHarnessMetrics {
      return collectClothHarnessMetrics(rt);
    },
    snapshot(): ClothDebugSnapshot {
      root.updateWorldMatrix(true, false);
      const capsules = rt.capsules.map((rigid) => {
        const cap = rigidToCapsule(rt, rigid, { a: new THREE.Vector3(), b: new THREE.Vector3(), ra: 0, rb: 0 });
        return { a: v3Array(cap.a), b: v3Array(cap.b), ra: cap.ra, rb: cap.rb, mask: rigid.mask, node: rigid.node };
      });
      const boxes = rt.boxes.map((rigid) => {
        const box = rigidToBox(rt, rigid, { center: new THREE.Vector3(), rotation: new THREE.Quaternion(), halfSize: new THREE.Vector3() });
        return { center: v3Array(box.center), rotation: box.rotation.toArray(), halfSize: v3Array(box.halfSize), mask: rigid.mask, node: rigid.node };
      });
      const contacts: ClothDebugSnapshot['contacts'] = [];
      const normal = new THREE.Vector3();
      const cap = { a: new THREE.Vector3(), b: new THREE.Vector3(), ra: 0, rb: 0 };
      const box = { center: new THREE.Vector3(), rotation: new THREE.Quaternion(), halfSize: new THREE.Vector3() };
      for (const node of rt.nodes) {
        if (node.kinematic) continue;
        rt.capsules.forEach((rigid, index) => {
          if (!canCollide(node, rigid)) return;
          const depth = capsuleDepth(node.pos, rigidToCapsule(rt, rigid, cap), Math.max(0, node.collideRadius), normal, rt.model.hasCollisionFriction);
          if (depth > 1e-6) contacts.push({ node: node.index, shape: `capsule:${index}`, depth });
        });
        rt.boxes.forEach((rigid, index) => {
          if (!canCollide(node, rigid)) return;
          const depth = boxDepth(node.pos, rigidToBox(rt, rigid, box), Math.max(0, node.collideRadius), normal, rt.model.hasCollisionFriction);
          if (depth > 1e-6) contacts.push({ node: node.index, shape: `box:${index}`, depth });
        });
      }
      return {
        modelToWorld: root.matrixWorld.clone().multiply(rt.modelToRoot).toArray(),
        nodes: rt.nodes.map((node) => ({ name: node.name, position: v3Array(node.pos), target: v3Array(node.target), kinematic: node.kinematic, collisionMask: node.collisionMask })),
        capsules, boxes, contacts,
        rods: [...rt.rods, ...rt.animatedRodBatches.flat()].map((rod) => {
          const distance = rt.nodes[rod.a].pos.distanceTo(rt.nodes[rod.b].pos);
          const error = Math.max(0, rod.min - distance, rod.max > 0 ? distance - rod.max : 0);
          return { a: rod.a, b: rod.b, min: rod.min, max: rod.max, error };
        }),
        hinges: rt.model.hingeLimits.map((hinge) => ({ node: [...hinge.node], excess: hingeLimitExcess(rt.nodes, hinge) })),
        triangles: rt.model.triangles.map((triangle) => ({ node: [...triangle.node], correction: triangleProjectionError(rt.nodes, triangle) })),
        quads: rt.model.quads.map((quad) => ({ node: [...quad.node], correction: quadProjectionError(rt.nodes, quad) })),
      };
    },
    dispose(): void {
      restoreAnimationPose(rt);
      root.updateWorldMatrix(true, true);
    },
  };
}

export function useClothSim(
  root: THREE.Object3D | null,
  femodel: ClothModel | null,
  resetKey?: string,
): (delta: number, animate: (delta: number) => void) => void {
  const runtime = useRef<ClothRuntime | null>(null);
  const debugGroup = useRef<THREE.Group | null>(null);

  useEffect(() => {
    if (debugGroup.current) {
      clearDebugGeometry(debugGroup.current);
      debugGroup.current.removeFromParent();
      debugGroup.current = null;
    }
    runtime.current = null;
    if (!root || !femodel) return;
    const rt = buildRuntime(root, femodel);
    runtime.current = rt;
    return () => {
      if (rt) restoreAnimationPose(rt);
      root.updateWorldMatrix(true, true);
      runtime.current = null;
      if (debugGroup.current) {
        clearDebugGeometry(debugGroup.current);
        debugGroup.current.removeFromParent();
        debugGroup.current = null;
      }
    };
  }, [root, femodel, resetKey]);

  return useCallback(
    (delta: number, animate: (delta: number) => void) => {
      const rt = runtime.current;
      if (!root || !rt) {
        if (Number.isFinite(delta) && delta > 0) animate(delta);
        return;
      }
      stepClothRuntime(root, rt, delta, animate);
      updateDebug(root, rt, debugGroup);
    },
    [root],
  );
}
