import { useCallback, useEffect, useRef } from 'react';
import * as THREE from 'three';
import {
  applyOffset,
  nodeBaseQuaternion,
  recoverOffsetSign,
  recoverSimilarity,
  recoverWeightedRigidFit,
} from './clothMath';
import type {
  ClothBox,
  ClothCapsule,
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
export function capsuleDepth(
  p: THREE.Vector3,
  c: Capsule,
  pr: number,
  outN: THREE.Vector3,
): number {
  const { point, t } = closestPointOnSegment(p, c.a, c.b, _cp);
  const r = c.ra + (c.rb - c.ra) * t + pr;
  outN.copy(p).sub(point);
  const d = outN.length();
  if (d >= r || d < 1e-6) return 0;
  outN.multiplyScalar(1 / d);
  return r - d;
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
export function boxDepth(p: THREE.Vector3, box: Box, pr: number, outN: THREE.Vector3): number {
  const halfX = Math.max(0, box.halfSize.x);
  const halfY = Math.max(0, box.halfSize.y);
  const halfZ = Math.max(0, box.halfSize.z);
  _boxInvQ.copy(box.rotation).invert();
  _boxLocal.copy(p).sub(box.center).applyQuaternion(_boxInvQ);
  _boxClosest.set(
    THREE.MathUtils.clamp(_boxLocal.x, -halfX, halfX),
    THREE.MathUtils.clamp(_boxLocal.y, -halfY, halfY),
    THREE.MathUtils.clamp(_boxLocal.z, -halfZ, halfZ),
  );

  _boxDelta.copy(_boxLocal).sub(_boxClosest);
  const outsideDistance = _boxDelta.length();
  if (outsideDistance > 1e-6) {
    if (outsideDistance >= pr) return 0;
    outN.copy(_boxDelta).multiplyScalar(1 / outsideDistance).applyQuaternion(box.rotation);
    return pr - outsideDistance;
  }

  const dx = halfX - Math.abs(_boxLocal.x);
  const dy = halfY - Math.abs(_boxLocal.y);
  const dz = halfZ - Math.abs(_boxLocal.z);
  let axis: 'x' | 'y' | 'z' = 'x';
  let depth = dx;
  if (dy < depth) {
    axis = 'y';
    depth = dy;
  }
  if (dz < depth) {
    axis = 'z';
    depth = dz;
  }

  if (depth + pr <= 0) return 0;
  _boxNormalLocal.set(0, 0, 0);
  _boxNormalLocal[axis] = _boxLocal[axis] >= 0 ? 1 : -1;
  outN.copy(_boxNormalLocal).applyQuaternion(box.rotation);
  return depth + pr;
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

const DEFAULT_CONSTRAINT_ITERATIONS = 8;
const MAX_CLOTH_FRAME_DT = 1 / 30;
const MIN_TIMESTEP_HISTORY_RATIO = 0.25;
// Every shipped FeModel authors flPointDamping == 0, so an undamped Verlet pass
// conserves energy and rings forever -- the cloth "never settles". Source 2's real
// velocity sinks (rod-velocity smoothing, air drag) are not ported here, so we floor
// the per-node damping with a small global value. This stays clear of the gravity==0
// invariant: damping only scales carried velocity (pos - prev), never gravity, so a
// node authored at rest with zero gravity still cannot move.
const MIN_VELOCITY_DAMPING = 0.02;
export const DEFAULT_CLOTH_SUBSTEPS = 2;

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

// Authored per-node gravity (cm/s^2, Z-up) times the model's global gravity scale,
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

// Per-step animation-attraction coefficients, ported verbatim from Source 2's
// CSoftbody::AddAnimationAttraction (run once per frame over every dynamic node):
//   posBlend   = min(1, flAnimationVertexAttraction * dt * g_flClothAttrPos)  // inertia-less
//   velImpulse =        flAnimationForceAttraction  * dt * g_flClothAttrVel   // toward goal
// with Valve's global convars g_flClothAttrPos = 1, g_flClothAttrVel = 2. Both terms are
// linear in (animatedTarget - pos). This is the ONLY damping these models carry (every
// flPointDamping / air-drag field is authored 0), so it must run unconditionally.
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
  return {
    goalIterations: Math.max(0, Math.round(model.extraGoalIterations || 0)),
    constraintIterations: Math.max(
      1,
      Math.round(iterationOverride || model.extraIterations || DEFAULT_CONSTRAINT_ITERATIONS),
    ),
  };
}

export function fixedClothSubsteps(
  delta: number,
  substeps = DEFAULT_CLOTH_SUBSTEPS,
): { count: number; dt: number } {
  const count = Math.max(1, Math.round(Number.isFinite(substeps) ? substeps : DEFAULT_CLOTH_SUBSTEPS));
  const frameDt = Math.max(0, Math.min(Number.isFinite(delta) ? delta : 0, MAX_CLOTH_FRAME_DT));
  return { count, dt: frameDt / count };
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
  if (model.fitMatrices.length > 0) return false;
  return Number.isFinite(model.firstPositionDrivenNode) && index >= model.firstPositionDrivenNode;
}

export function reverseOffsetDrivenNodeSet(
  model: Pick<ClothModel, 'reverseOffsets'>,
): Set<number> {
  const nodes = new Set<number>();
  for (const offset of model.reverseOffsets) {
    if (Number.isInteger(offset.boneCtrl) && offset.boneCtrl >= 0) nodes.add(offset.boneCtrl);
  }
  return nodes;
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

export function freeSimNodeSet(
  model: Pick<ClothModel, 'nodes' | 'freeNodes'>,
): Set<number> {
  const authored = new Set<number>();
  for (const index of model.freeNodes) {
    if (Number.isInteger(index) && index >= 0 && index < model.nodes.length) authored.add(index);
  }
  if (authored.size > 0) return authored;

  const fallback = new Set<number>();
  model.nodes.forEach((node, index) => {
    if (node.invMass > 0) fallback.add(index);
  });
  return fallback;
}

export function isFreeSimNode(
  index: number,
  model: Pick<ClothModel, 'nodes' | 'freeNodes'>,
): boolean {
  return freeSimNodeSet(model).has(index);
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
  reverseOffsetDriven?: boolean;
  lockToGoal?: boolean;
  jiggleDriven?: boolean;
}): boolean {
  return Boolean(node.pinned || node.positionDriven || node.reverseOffsetDriven || node.lockToGoal || node.jiggleDriven);
}

export function restorePinnedSolverNodes(
  nodes: Iterable<{
    pinned: boolean;
    positionDriven?: boolean;
    reverseOffsetDriven?: boolean;
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
  reverseOffsetDriven?: boolean;
  lockToGoal?: boolean;
  jiggleDriven?: boolean;
};

const _strayDelta = new THREE.Vector3();
const _strayCorrection = new THREE.Vector3();
// m_AnimStrayRadii is Source 2's anti-stray / anti-explosion clamp: it bounds how far
// a node may drift from its animated goal (the bind/clip target), keeping cloth on the
// body. The shipped data is self-referential -- nNode == [n, n] -- i.e. "clamp node n
// to its OWN target", which is why the earlier node-vs-node reading was a no-op: it
// measured a node against itself (distance 0, never fired). We clamp pos to within
// maxDist of node.target and move prev by the same delta, so the clamp pulls a strayed
// node back without injecting velocity. This is the high-stray-count mechanism on hair
// heroes (Celeste authors 384) and the data-driven leash against "flies off into the
// distance". Reverse-engineered from the shipped FeModel data (no reference impl);
// honored only as a one-sided pull-in, never a push-out, so it cannot add energy.
export function projectAnimStrayRadius(
  nodes: readonly (AnimStrayRadiusNode | undefined)[],
  stray: ClothStrayRadius,
): boolean {
  const node = nodes[stray.node[0]];
  if (!node || isKinematicNode(node)) return false;

  const maxDist = stray.maxDist;
  const relax = stray.relax;
  if (!Number.isFinite(maxDist) || maxDist < 0 || !Number.isFinite(relax) || relax <= 0) return false;

  _strayDelta.copy(node.pos).sub(node.target);
  const distance = _strayDelta.length();
  if (distance <= maxDist || distance < 1e-6) return false;

  _strayCorrection.copy(_strayDelta).multiplyScalar(-((distance - maxDist) / distance) * relax);
  node.pos.add(_strayCorrection);
  node.prev?.add(_strayCorrection);
  return true;
}

interface NodeRuntime {
  index: number;
  name: string;
  bone: THREE.Bone | null;
  bindPosition: THREE.Vector3 | null;
  bindQuaternion: THREE.Quaternion | null;
  bindScale: THREE.Vector3 | null;
  invMass: number;
  pinned: boolean;
  positionDriven: boolean;
  reverseOffsetDriven: boolean;
  lockToGoal: boolean;
  jiggleDriven: boolean;
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
  target: THREE.Vector3;
  solvedRot: THREE.Quaternion;
  targetRot: THREE.Quaternion;
}

interface RigidRuntime {
  node: number;
  mask: number;
  sphere0: Vec4;
  sphere1: Vec4;
  dbgName: string;
}

interface BoxRuntime {
  node: number;
  mask: number;
  pos: Vec3;
  rot: Vec4;
  size: Vec3;
  dbgName: string;
}

interface CollisionPlaneRuntime {
  ctrlParent: number;
  childNode: number;
  normal: Vec3;
  offset: number;
  strength: number;
}

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
  capsules: RigidRuntime[];
  boxes: BoxRuntime[];
  collisionPlanes: CollisionPlaneRuntime[];
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
}

export interface ClothHarnessOptions {
  substeps?: number;
}

export interface ClothHarnessMetrics {
  finite: number;
  rmse: number;
  fitRmse: number;
  maxDistanceFromTarget: number;
  maxDistanceFromInit: number;
  maxFrameMotion: number;
  nodeCount: number;
  kinematicCount: number;
}

export interface ClothSimHarness {
  step(delta: number): ClothHarnessMetrics;
  metrics(): ClothHarnessMetrics;
}

function vec3(v: Vec3): THREE.Vector3 {
  return new THREE.Vector3(v[0], v[1], v[2]);
}

function quat(v: Vec4): THREE.Quaternion {
  return new THREE.Quaternion(v[0], v[1], v[2], v[3]).normalize();
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

function canCollide(nodeMask: number, rigidMask: number): boolean {
  return rigidMask === 0 || (nodeMask & rigidMask) !== 0;
}

type CollisionPlaneNode = {
  pos: THREE.Vector3;
  prev: THREE.Vector3;
  solvedRot: THREE.Quaternion;
  pinned?: boolean;
  positionDriven?: boolean;
  reverseOffsetDriven?: boolean;
  lockToGoal?: boolean;
};

const _planeNormal = new THREE.Vector3();
const _planePoint = new THREE.Vector3();
const _planeDelta = new THREE.Vector3();
export function projectCollisionPlane(
  nodes: readonly (CollisionPlaneNode | undefined)[],
  plane: Pick<ClothCollisionPlane, 'ctrlParent' | 'childNode' | 'normal' | 'offset' | 'strength'>,
  particleRadius: number,
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

  const radius = Number.isFinite(particleRadius) ? Math.max(0, particleRadius) : 0;
  _planePoint.copy(parent.pos).addScaledVector(_planeNormal, plane.offset);
  const signed = _planeDelta.copy(child.pos).sub(_planePoint).dot(_planeNormal);
  if (signed >= radius) return false;

  _planeDelta.copy(_planeNormal).multiplyScalar((radius - signed) * strength);
  child.pos.add(_planeDelta);
  child.prev.add(_planeDelta);
  return true;
}

export function reconstructReverseOffsetPosition(
  offset: { boneCtrl: number; targetNode: number; offset: Vec3; sign: 1 | -1 },
  nodes: Array<{
    pos: THREE.Vector3;
    prev: THREE.Vector3;
    solvedRot: THREE.Quaternion;
  } | undefined>,
): THREE.Vector3 | null {
  const boneNode = nodes[offset.boneCtrl];
  const targetNode = nodes[offset.targetNode];
  if (!boneNode || !targetNode) return null;
  const pos = targetNode.pos.clone().add(vec3(offset.offset).multiplyScalar(offset.sign).applyQuaternion(boneNode.solvedRot));
  boneNode.pos.copy(pos);
  boneNode.prev.copy(pos);
  return pos;
}

export function applyReverseOffsetReconstructions(
  offsets: Iterable<{ boneCtrl: number; targetNode: number; offset: Vec3; sign: 1 | -1 }>,
  nodes: Array<{
    pos: THREE.Vector3;
    prev: THREE.Vector3;
    solvedRot: THREE.Quaternion;
  } | undefined>,
): number {
  let reconstructed = 0;
  for (const offset of offsets) {
    if (reconstructReverseOffsetPosition(offset, nodes)) reconstructed += 1;
  }
  return reconstructed;
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
    if (targetNode >= 0 && weights.length >= 3) {
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

export function reconstructFitMatrixPosition(
  fit: FitMatrixReconstruction,
  nodes: Array<{
    initPos: Vec3;
    pos: THREE.Vector3;
    prev: THREE.Vector3;
    solvedRot: THREE.Quaternion;
  } | undefined>,
): THREE.Vector3 | null {
  const driven = nodes[fit.targetNode];
  if (!driven) return null;

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
  if (source.length < 3) return null;

  const rigid = recoverWeightedRigidFit(source, target, weights);
  const reconstructed = rigid.targetCenter.clone().add(vec3(fit.bone).sub(vec3(fit.center)).applyQuaternion(rigid.rotation));
  const reconstructedRot = rigid.rotation.clone().multiply(quat(fit.boneRot)).normalize();
  driven.pos.copy(reconstructed);
  driven.prev.copy(reconstructed);
  driven.solvedRot.copy(reconstructedRot);
  return reconstructed;
}

export function applyFitMatrixReconstructions(
  fits: Iterable<FitMatrixReconstruction>,
  nodes: Array<{
    initPos: Vec3;
    pos: THREE.Vector3;
    prev: THREE.Vector3;
    solvedRot: THREE.Quaternion;
  } | undefined>,
): number {
  let reconstructed = 0;
  for (const fit of fits) {
    if (reconstructFitMatrixPosition(fit, nodes)) reconstructed += 1;
  }
  return reconstructed;
}

export function applyDrivenReconstructions(
  reverseOffsets: Iterable<{ boneCtrl: number; targetNode: number; offset: Vec3; sign: 1 | -1 }>,
  fits: Iterable<FitMatrixReconstruction>,
  nodes: Array<{
    initPos: Vec3;
    pos: THREE.Vector3;
    prev: THREE.Vector3;
    solvedRot: THREE.Quaternion;
  } | undefined>,
): { reverseBefore: number; fit: number; reverseAfter: number } {
  const reverseBefore = applyReverseOffsetReconstructions(reverseOffsets, nodes);
  const fit = applyFitMatrixReconstructions(fits, nodes);
  const reverseAfter = applyReverseOffsetReconstructions(reverseOffsets, nodes);
  return { reverseBefore, fit, reverseAfter };
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
    .set(Math.abs(rigid.size[0]), Math.abs(rigid.size[1]), Math.abs(rigid.size[2]))
    .multiplyScalar(0.5 * clothTuning.collisionScale);
  return out;
}

function fromCapsule(c: ClothCapsule): RigidRuntime {
  return {
    node: c.node,
    mask: c.mask,
    sphere0: c.sphere0,
    sphere1: c.sphere1,
    dbgName: `node:${c.node}`,
  };
}

function fromSphere(s: ClothSphere): RigidRuntime {
  return {
    node: s.node,
    mask: s.mask,
    sphere0: s.sphere,
    sphere1: s.sphere,
    dbgName: `node:${s.node}`,
  };
}

function fromBox(b: ClothBox): BoxRuntime {
  return {
    node: b.node,
    mask: b.mask,
    pos: b.pos,
    rot: b.rot,
    size: b.size,
    dbgName: `node:${b.node}`,
  };
}

function fromCollisionPlane(p: ClothCollisionPlane): CollisionPlaneRuntime {
  return {
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
  const lockToGoalNodes = new Set(model.lockToGoal);
  const freeSimNodes = freeSimNodeSet(model);
  const reverseOffsetDrivenNodes = reverseOffsetDrivenNodeSet(model);
  const fitMatrixDrivenNodes = fitMatrixDrivenNodeSet(model);
  const jiggleDrivenNodes = jiggleDrivenNodeSet(model);
  const nodes: NodeRuntime[] = model.nodes.map((node, index) => {
    const bone = bones.get(node.name) ?? null;
    const initPos = vec3(node.initPos);
    const initRot = quat(node.initRot);
    return {
      index,
      name: node.name,
      bone,
      bindPosition: bone ? bone.position.clone() : null,
      bindQuaternion: bone ? bone.quaternion.clone() : null,
      bindScale: bone ? bone.scale.clone() : null,
      invMass: node.invMass,
      // m_FreeNodes is Source 2's authored sim-positioned set. Positive invMass
      // alone is too broad on several preview exports, so use invMass only when
      // the payload does not provide m_FreeNodes.
      pinned: node.pinned || !freeSimNodes.has(index),
      positionDriven: isPositionDrivenNode(index, model) || fitMatrixDrivenNodes.has(index),
      reverseOffsetDriven: reverseOffsetDrivenNodes.has(index),
      lockToGoal: lockToGoalNodes.has(index),
      jiggleDriven: jiggleDrivenNodes.has(index),
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
      target: initPos.clone(),
      solvedRot: initRot.clone(),
      targetRot: initRot.clone(),
    };
  });

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

  return {
    model,
    nodes,
    rods: model.rods,
    capsules: [...model.capsules.map(fromCapsule), ...model.spheres.map(fromSphere)].filter(
      (rigid) => rigid.node >= 0 && rigid.node < nodes.length,
    ),
    boxes: model.boxes.map(fromBox).filter((rigid) => rigid.node >= 0 && rigid.node < nodes.length),
    collisionPlanes: model.collisionPlanes.map(fromCollisionPlane).filter((plane) => (
      plane.ctrlParent >= 0
      && plane.ctrlParent < nodes.length
      && plane.childNode >= 0
      && plane.childNode < nodes.length
    )),
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
  };
}

function refreshTargets(root: THREE.Object3D, rt: ClothRuntime): void {
  root.updateWorldMatrix(true, true);
  for (const node of rt.nodes) {
    if (node.bone && node.bindPosition && node.bindQuaternion && node.bindScale) {
      restoreBoneBindTransform(node.bone, node.bindPosition, node.bindQuaternion, node.bindScale);
    }
  }
  root.updateWorldMatrix(true, true);

  for (const node of rt.nodes) {
    node.target.copy(vec3(node.initPos));
    node.targetRot.copy(quat(node.initRot));
    if (!node.bone) continue;
    node.target.copy(worldToModelPos(root, rt, node.bone.getWorldPosition(new THREE.Vector3())));
    node.targetRot.copy(worldToModelQuat(root, rt, node.bone.getWorldQuaternion(new THREE.Quaternion())));
  }

  for (const offset of rt.ctrlOffsets) {
    const parent = rt.nodes[offset.parent];
    const child = rt.nodes[offset.child];
    if (!parent || !child || child.bone) continue;
    child.target.copy(applyOffset(v3Array(parent.target), [parent.targetRot.x, parent.targetRot.y, parent.targetRot.z, parent.targetRot.w], offset.offset, offset.sign));
  }

  const softPos = new Map<number, { pos: THREE.Vector3; weight: number }>();
  for (const offset of rt.softOffsets) {
    const parent = rt.nodes[offset.parent];
    const child = rt.nodes[offset.child];
    if (!parent || !child || child.bone) continue;
    const target = applyOffset(
      v3Array(parent.target),
      [parent.targetRot.x, parent.targetRot.y, parent.targetRot.z, parent.targetRot.w],
      offset.offset,
      offset.sign,
    ).multiplyScalar(offset.alpha);
    const acc = softPos.get(offset.child) ?? { pos: new THREE.Vector3(), weight: 0 };
    acc.pos.add(target);
    acc.weight += offset.alpha;
    softPos.set(offset.child, acc);
  }
  for (const [index, acc] of softPos) {
    if (acc.weight <= 0) continue;
    rt.nodes[index]?.target.lerp(acc.pos.multiplyScalar(1 / acc.weight), Math.min(acc.weight, 1));
  }

  const positions = rt.nodes.map((node) => v3Array(node.target));
  for (const base of rt.model.nodeBases) {
    const node = rt.nodes[base.node];
    if (node) node.targetRot.copy(nodeBaseQuaternion(positions, base));
  }
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

function applyRuntimeReverseOffsetReconstructions(rt: ClothRuntime): void {
  applyReverseOffsetReconstructions(rt.reverseOffsets, rt.nodes);
}

function applyRuntimeSettledReconstructions(rt: ClothRuntime): void {
  applyFitMatrixReconstructions(rt.fitReconstructions, rt.nodes);
  applyReverseOffsetReconstructions(rt.reverseOffsets, rt.nodes);
}

function integrate(rt: ClothRuntime, gravity: THREE.Vector3, dt: number): void {
  const dt2 = dt * dt;
  const lastDt = rt.lastSubstepDt;
  for (const node of rt.nodes) {
    if (isKinematicNode(node)) {
      node.pos.copy(node.target);
      node.prev.copy(node.target);
      node.solvedRot.copy(node.targetRot);
      continue;
    }
    // Floor the authored damping (0 on every shipped model) so carried velocity
    // actually decays each step; without this the integrator never settles.
    const damping = Math.max(node.damping, MIN_VELOCITY_DAMPING);
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

function solveRods(rt: ClothRuntime): void {
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
    if (shares.a > 0) a.pos.addScaledVector(correction, shares.a);
    if (shares.b > 0) b.pos.addScaledVector(correction, -shares.b);
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
  for (const node of rt.nodes) {
    if (isKinematicNode(node)) continue;
    const particleRadius = node.collideRadius + rt.model.addWorldCollisionRadius;
    // Position-only depenetration: push the node to the collider surface and leave the
    // Verlet history (prev) alone, so Verlet derives the corrected velocity implicitly.
    // The previous code also rewrote prev after the push (an inbound-velocity kill plus
    // tangential friction); because cloth nodes rest INSIDE their own body capsules, that
    // pumped outward velocity into the integrator every frame -> a self-sustaining limit
    // cycle (the reported jitter / fly-off / clipping). A pure positional projection is
    // the Source 2 contact behavior and is what makes the solver settle.
    for (const rigid of rt.capsules) {
      if (!canCollide(node.collisionMask, rigid.mask)) continue;
      rigidToCapsule(rt, rigid, cap);
      const depth = capsuleDepth(node.pos, cap, particleRadius, normal);
      if (depth <= 0) continue;
      node.pos.addScaledVector(normal, depth);
    }
    for (const rigid of rt.boxes) {
      if (!canCollide(node.collisionMask, rigid.mask)) continue;
      rigidToBox(rt, rigid, box);
      const depth = boxDepth(node.pos, box, particleRadius, normal);
      if (depth <= 0) continue;
      node.pos.addScaledVector(normal, depth);
    }
    for (const plane of rt.collisionPlanes) {
      if (plane.childNode !== node.index) continue;
      projectCollisionPlane(rt.nodes, plane, particleRadius);
    }
  }
}

function solveAnimStrayRadii(rt: ClothRuntime): void {
  for (const stray of rt.model.strayRadii) projectAnimStrayRadius(rt.nodes, stray);
}

function updateSolvedRotations(rt: ClothRuntime): void {
  const positions = rt.nodes.map((node) => v3Array(node.pos));
  for (const node of rt.nodes) node.solvedRot.copy(node.targetRot);
  for (const base of rt.model.nodeBases) {
    const node = rt.nodes[base.node];
    if (node) node.solvedRot.copy(nodeBaseQuaternion(positions, base));
  }
}

function writeBack(root: THREE.Object3D, rt: ClothRuntime): void {
  updateSolvedRotations(rt);
  applyRuntimeSettledReconstructions(rt);

  const rotationWrites = new Map<THREE.Bone, THREE.Quaternion>();
  for (const base of rt.model.nodeBases) {
    const node = rt.nodes[base.node];
    if (node?.bone) rotationWrites.set(node.bone, node.solvedRot.clone());
  }

  for (const fit of rt.fitReconstructions) {
    const fitNode = rt.nodes[fit.targetNode];
    if (fitNode?.bone) rotationWrites.set(fitNode.bone, fitNode.solvedRot.clone());
  }

  for (const [bone, rot] of orderBonesParentFirst(rotationWrites.entries())) {
    writeBoneQuaternion(root, rt, bone, rot);
  }

  const positionWrites = new Map<THREE.Bone, THREE.Vector3>();
  for (const node of rt.nodes) {
    if (!node.bone || isKinematicNode(node)) continue;
    positionWrites.set(node.bone, node.pos.clone());
  }

  for (const offset of rt.reverseOffsets) {
    const boneNode = rt.nodes[offset.boneCtrl];
    if (!boneNode?.bone) continue;
    positionWrites.set(boneNode.bone, boneNode.pos.clone());
  }

  for (const fit of rt.fitReconstructions) {
    const fitNode = rt.nodes[fit.targetNode];
    if (!fitNode?.bone) continue;
    positionWrites.set(fitNode.bone, fitNode.pos.clone());
  }

  [...positionWrites.entries()]
    .sort(([a], [b]) => objectDepth(a) - objectDepth(b))
    .forEach(([bone, pos]) => writeBonePosition(root, rt, bone, pos));

  root.updateWorldMatrix(true, true);
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
  group.clear();

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
  options: ClothHarnessOptions = {},
): void {
  const substep = fixedClothSubsteps(delta, options.substeps);

  refreshTargets(root, rt);
  warmStartRuntime(rt, substep.dt);
  applyRuntimeReverseOffsetReconstructions(rt);
  const gravity = new THREE.Vector3(0, -1, 0)
    .applyQuaternion(root.getWorldQuaternion(new THREE.Quaternion()).invert())
    .applyQuaternion(rt.rootToModelRot);

  const { constraintIterations } = solverIterationPhases(rt.model, clothTuning.iterationOverride);
  for (let step = 0; step < substep.count; step++) {
    integrate(rt, gravity, substep.dt);
    applyRuntimeReverseOffsetReconstructions(rt);

    // Engine order: Predict (gravity) -> AddAnimationAttraction -> Collide -> constraints.
    // Attraction is the cloth's only damper here, so each fixed substep gets one pass;
    // it is NOT looped by m_nExtraGoalIterations (which gates the empty goal-spring set).
    solveGoals(rt, substep.dt);
    applyRuntimeReverseOffsetReconstructions(rt);
    solveCollisions(rt);
    applyRuntimeReverseOffsetReconstructions(rt);

    for (let i = 0; i < constraintIterations; i++) {
      solveRods(rt);
      restorePinnedSolverNodes(rt.nodes);
      applyRuntimeReverseOffsetReconstructions(rt);
    }
    // One final depenetration after the rods settle: the rod pass pulls nodes back
    // toward the body and can leave them just inside a collider (the reported
    // clipping). A single closing pass clears that without the outward over-push that
    // colliding on every iteration causes. Position-only, so it stays energy-neutral.
    solveCollisions(rt);
    solveAnimStrayRadii(rt);
    restorePinnedSolverNodes(rt.nodes);
    applyRuntimeReverseOffsetReconstructions(rt);
    applyRuntimeSettledReconstructions(rt);
  }

  writeBack(root, rt);
}

function collectClothHarnessMetrics(rt: ClothRuntime): ClothHarnessMetrics {
  let finite = Number.isFinite(rt.rmse) ? 1 : 0;
  let targetErrorSq = 0;
  let maxDistanceFromTarget = 0;
  let maxDistanceFromInit = 0;
  let maxFrameMotion = 0;
  let kinematicCount = 0;

  for (const node of rt.nodes) {
    const init = vec3(node.initPos);
    const targetDistance = node.pos.distanceTo(node.target);
    const initDistance = node.pos.distanceTo(init);
    const frameMotion = node.pos.distanceTo(node.prev);
    targetErrorSq += targetDistance * targetDistance;
    maxDistanceFromTarget = Math.max(maxDistanceFromTarget, targetDistance);
    maxDistanceFromInit = Math.max(maxDistanceFromInit, initDistance);
    maxFrameMotion = Math.max(maxFrameMotion, frameMotion);
    if (isKinematicNode(node)) kinematicCount += 1;

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
  return {
    finite,
    rmse: nodeCount > 0 ? Math.sqrt(targetErrorSq / nodeCount) : 0,
    fitRmse: rt.rmse,
    maxDistanceFromTarget,
    maxDistanceFromInit,
    maxFrameMotion,
    nodeCount,
    kinematicCount,
  };
}

export function createClothSimHarness(
  root: THREE.Object3D,
  femodel: ClothModel,
  options: ClothHarnessOptions = {},
): ClothSimHarness {
  const rt = buildRuntime(root, femodel);
  if (!rt) throw new Error('createClothSimHarness requires at least three matched cloth nodes');
  const harnessOptions = { ...options };
  return {
    step(delta: number): ClothHarnessMetrics {
      stepClothRuntime(root, rt, delta, harnessOptions);
      return collectClothHarnessMetrics(rt);
    },
    metrics(): ClothHarnessMetrics {
      return collectClothHarnessMetrics(rt);
    },
  };
}

export function useClothSim(
  root: THREE.Object3D | null,
  femodel: ClothModel | null,
): (delta: number) => void {
  const runtime = useRef<ClothRuntime | null>(null);
  const debugGroup = useRef<THREE.Group | null>(null);

  useEffect(() => {
    if (debugGroup.current) {
      debugGroup.current.removeFromParent();
      debugGroup.current = null;
    }
    runtime.current = null;
    if (!root || !femodel) return;
    const rt = buildRuntime(root, femodel);
    runtime.current = rt;
  }, [root, femodel]);

  return useCallback(
    (delta: number) => {
      const rt = runtime.current;
      if (!root || !rt) return;
      stepClothRuntime(root, rt, delta);
      updateDebug(root, rt, debugGroup);
    },
    [root],
  );
}
