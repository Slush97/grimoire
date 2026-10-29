// Ported from ValveResourceFormat (MIT): ValveResourceFormat/Particles/ParticleSystemState.cs.
//
// Not ported: the local player and model particle control point runs. Nothing the simulation
// ports reads them yet.

import { ParticleDetailLevel, ParticleParentSetMode } from './enums';
import { NO_COLLISION, type ParticleCollision } from './collision';
import type { CollisionPlaneSet } from './constraints/collisionPlaneSet';
import type { ParticleModel, ParticleModelObject } from './model';
import { Matrix4x4, Quaternion, Vector3, f32, lerpV, saturate } from './numerics';
import { HitBoxCache } from './utils/hitBoxCache';
import { ParticleRandom, ThreadRandom } from './utils/random';
import { vectorVectors } from './utils/particleMath';
import type { ParticleSnapshot } from './utils/snapshotBinding';
import type { ParticleSpan } from './span';
import type { ParticleSystemSimulation } from './simulation';

/** The highest control point index a system holds. */
export const MAX_CONTROL_POINT = 63;

/** How many control points a system holds. */
export const CONTROL_POINT_COUNT = MAX_CONTROL_POINT + 1;

export const FLOAT_MIN_VALUE = -3.4028234663852886e38;

/** The lighting a system can query; unlit content reads white everywhere. */
export interface ParticleLighting {
  sampleAmbientLight(position: Vector3): Vector3;
}

export const UNLIT: ParticleLighting = { sampleAmbientLight: () => Vector3.one };

/** The state of one particle system, which every function of the system reads it through. */
export class ParticleSystemState {
  private static defaultInstance: ParticleSystemState | null = null;

  /** A state with no system behind it, read by functions evaluated outside a running system. */
  static defaultState(): ParticleSystemState {
    return (ParticleSystemState.defaultInstance ??= new ParticleSystemState(null, null));
  }

  readonly parentSystem: ParticleSystemState | null;
  readonly children: ParticleSystemState[] = [];

  /** The system this state belongs to. Null for the default state. */
  readonly data: ParticleSystemSimulation | null;

  constructor(parentSystem: ParticleSystemState | null, data: ParticleSystemSimulation | null) {
    this.parentSystem = parentSystem;
    this.data = data;
    parentSystem?.children.push(this);
  }

  get root(): ParticleSystemState {
    return this.parentSystem?.root ?? this;
  }

  private ownWorldTime = 0;

  /** The renderer's clock, shared by every system of the tree; children read the root's. */
  get worldTime(): number {
    return this.parentSystem?.worldTime ?? this.ownWorldTime;
  }

  set worldTime(value: number) {
    this.ownWorldTime = value;
  }

  private ownDetailLevel: number = ParticleDetailLevel.PARTICLEDETAIL_ULTRA;

  /** The active particle detail tier; children inherit the root's. */
  get detailLevel(): number {
    return this.parentSystem?.detailLevel ?? this.ownDetailLevel;
  }

  set detailLevel(value: number) {
    this.ownDetailLevel = value;
  }

  readonly random = new ParticleRandom();
  readonly threadRandom = new ThreadRandom();

  /** Whether the system is running its initializers over new particles. */
  initializingParticles = false;

  /** While initializers run, the collection index of the first particle of the batch. */
  initializedFirst = 0;

  /** While an initializer runs, the collection index the batch ends at, else 0. */
  initializerBatchEnd = 0;

  /** While an initializer runs, the collection index the particles of its current call end at, else 0. */
  initializerRunEnd = 0;

  /**
   * The particles the float inputs of a vector input are evaluated over: a fill that reaches the
   * end of an initializer call goes on to the end of the batch.
   */
  vectorInputParticles(particles: ParticleSpan): ParticleSpan {
    const end = particles.start + particles.length;

    if (end !== this.initializerRunEnd || this.initializerBatchEnd <= end) {
      return particles;
    }

    return particles.withEnd(this.initializerBatchEnd);
  }

  /** While initializers run, what spawnIndex adds to a particle's index. */
  spawnIndexBase = 0;

  /** While initializers run, what particleNumber adds to a particle's index. */
  particleNumberBase = 0;

  spawnIndex(index: number): number {
    return this.spawnIndexBase + index;
  }

  particleNumber(index: number): number {
    return this.particleNumberBase + index;
  }

  /** While initializers run, the mask of the attributes declared written so far. */
  initializedFields = 0n;

  /** The state the particles were left in by their initializers, or the particles themselves while initializers run. */
  initialOf(particles: ParticleSpan): ParticleSpan {
    if (this.initializingParticles || this.data === null || particles.start + particles.length > this.data.particles.count) {
      return particles;
    }

    return this.data.particles.initialSpan.slice(particles.start, particles.length);
  }

  /** How many particles the system currently holds. */
  particleCount = 0;

  /** The system's clock, in seconds. */
  age = 0;

  /** The age, or 0 for an endcap child that has not started. */
  get startedAge(): number {
    return this.age === FLOAT_MIN_VALUE ? 0 : this.age;
  }

  timeScale = 1;

  /** The age at the start of the step being simulated. */
  stepStartAge = f32(1e23);

  /** The real time the system has been asked to simulate, summed over its frames. */
  requestedAge = 0;

  /** The length of the step being simulated, 0 before the first one. */
  currentStep = 0;

  /** The length of the previous step. */
  previousStep = f32(0.05);

  perPreviousSecond(value: number): number {
    return f32(value / Math.max(1e-20, this.previousStep));
  }

  /** The age the fade window of every function is measured from, set by a restart. */
  operatorTimeBase = 0;

  cameraPosition = Vector3.zero;

  /** Sequence lengths of the sheet the system's particles animate with, set by whatever draws it. */
  sequenceDurations: number[] | null = null;

  lighting: ParticleLighting = UNLIT;
  collision: ParticleCollision = NO_COLLISION;
  private ownCollisionPlaneSets: (CollisionPlaneSet | null)[] | null = null;
  get collisionPlaneSets(): (CollisionPlaneSet | null)[] {
    return this.parentSystem?.collisionPlaneSets ?? (this.ownCollisionPlaneSets ??= new Array<CollisionPlaneSet | null>(3).fill(null));
  }

  /** The control point the tint light was last sampled at, or -1. */
  tintCacheControlPoint = -1;
  tintCacheColor = Vector3.zero;

  /** Whether the system is playing its endcap. */
  inEndCap = false;

  /** The age at which the endcap began, or float.MinValue. */
  endCapStartAge = FLOAT_MIN_VALUE;

  get endCapAge(): number {
    return this.inEndCap ? f32(this.age - this.endCapStartAge) : 0;
  }

  /** Whether simulation is held in place, with every system below it. */
  frozen = false;

  emissionStopped = false;

  /** The parent's indices of the particles the event being handed to this system's emitters was raised on. */
  emitterEventParticles: readonly number[] | null = null;

  get emitterEventCount(): number {
    return this.emitterEventParticles?.length ?? 0;
  }

  listensFor(eventType: number): boolean {
    return this.data !== null && (this.data.listenedEvents & eventType) !== 0;
  }

  // Control points

  private readonly controlPoints: (ControlPoint | null)[] = new Array<ControlPoint | null>(CONTROL_POINT_COUNT).fill(null);
  private functionWrites: Map<number, ControlPointSavedState> | null = null;
  private highestBeforeFunctionWrites: number | null = null;
  private ownFunctionsRunning = false;

  /** Whether the functions of this system's tree are running. Only the root's value counts. */
  get functionsRunning(): boolean {
    return this.parentSystem?.functionsRunning ?? this.ownFunctionsRunning;
  }

  set functionsRunning(value: boolean) {
    this.ownFunctionsRunning = value;
  }

  /** One of this system's control points, created at its default on first use. */
  getControlPoint(cp: number): ControlPoint {
    if (cp < 0 || cp > MAX_CONTROL_POINT) {
      return new ControlPoint(null, 0);
    }

    return (this.controlPoints[cp] ??= new ControlPoint(this, cp));
  }

  /** The model bound to a control point, or null when none is. */
  getControlPointModel(cp: number): ParticleModel | null {
    return cp >= 0 && cp <= MAX_CONTROL_POINT ? (this.controlPoints[cp]?.model ?? null) : null;
  }

  getControlPointSnapshot(cp: number): ParticleSnapshot | null {
    return cp >= 0 && cp <= MAX_CONTROL_POINT ? (this.controlPoints[cp]?.snapshot ?? null) : null;
  }

  /** Binds a snapshot to a control point of this system and every system below it. */
  setControlPointSnapshot(cp: number, snapshot: ParticleSnapshot): void {
    if (cp < 0 || cp > MAX_CONTROL_POINT) {
      return;
    }

    this.getControlPoint(cp).snapshot = snapshot;

    for (const child of this.children) {
      child.setControlPointSnapshot(cp, snapshot);
    }
  }

  /** The highest control point index any write has reached. */
  highestControlPoint = 0;

  raiseHighestControlPoint(cp: number): void {
    this.highestControlPoint = Math.max(this.highestControlPoint, cp);
  }

  /**
   * Called before `point` is written. A write by a function remembers the point as it was before
   * the first such write, and a write by the host drops that memory.
   */
  noteControlPointWrite(point: ControlPoint): void {
    if (!this.functionsRunning) {
      this.functionWrites?.delete(point.index);

      if (this.highestBeforeFunctionWrites !== null) {
        this.highestBeforeFunctionWrites = Math.max(this.highestBeforeFunctionWrites, point.index);
      }

      return;
    }

    this.highestBeforeFunctionWrites ??= this.highestControlPoint;
    this.functionWrites ??= new Map();

    if (!this.functionWrites.has(point.index)) {
      this.functionWrites.set(point.index, point.save());
    }
  }

  /** Puts every control point functions have written back to how it was before they first did. */
  undoFunctionControlPointWrites(): void {
    if (this.functionWrites !== null) {
      for (const [index, state] of this.functionWrites) {
        this.controlPoints[index]!.restore(state);
      }

      this.functionWrites.clear();
    }

    if (this.highestBeforeFunctionWrites !== null) {
      this.highestControlPoint = this.highestBeforeFunctionWrites;
      this.highestBeforeFunctionWrites = null;
    }

    for (const child of this.children) {
      child.undoFunctionControlPointWrites();
    }
  }

  /** Copies a control point's position and orientation into this system's one at `cp` and every system below. */
  setControlPoint(cp: number, point: ControlPoint): void {
    const target = this.getControlPoint(cp);
    target.position = point.position;
    target.setOrientation(point.forward, point.left, point.up);
    target.attachType = point.attachType;
  }

  setControlPointValue(cp: number, position: Vector3): void {
    this.getControlPoint(cp).position = position;
  }

  setControlPointValueComponent(cp: number, component: number, value: number): void {
    this.getControlPoint(cp).setComponent(component, value);
  }

  /** Sets the orientation of a control point from a forward direction alone. */
  setControlPointOrientation(cp: number, forward: Vector3): void {
    this.getControlPoint(cp).orientation = forward;
  }

  setControlPointAxes(cp: number, forward: Vector3, left: Vector3, up: Vector3): void {
    this.getControlPoint(cp).setOrientation(forward, left, up);
  }

  setControlPointRotation(cp: number, rotation: Quaternion): void {
    this.getControlPoint(cp).setRotation(rotation);
  }

  /** The system a function's control point writes go to under `mode`. */
  getSetParentTarget(mode: number): ParticleSystemState {
    if (mode === ParticleParentSetMode.PARTICLE_SET_PARENT_IMMEDIATE) {
      return this.parentSystem ?? this;
    }

    if (mode === ParticleParentSetMode.PARTICLE_SET_PARENT_ROOT) {
      return this.root;
    }

    return this;
  }

  /** Records every control point's current state as its previous state, and `elapsed` as the previous step length. */
  updatePreviousControlPoints(elapsed: number): void {
    this.previousStep = elapsed;

    for (const point of this.controlPoints) {
      point?.recordStep(elapsed);
    }
  }

  /** Moves every control point that has changed back to a change at age 0. */
  rewindControlPointChanges(): void {
    for (const point of this.controlPoints) {
      if (point === null) {
        continue;
      }

      point.rewindChange();
      point.recordStep(0);
    }
  }
}

export interface ControlPointSavedState {
  position: Vector3;
  forward: Vector3;
  left: Vector3;
  up: Vector3;
  changeTime: number;
  isWritten: boolean;
}

/**
 * A control point. Each system holds its own copy, and a write reaches the same control point of
 * every system below the one it is made on, never the systems above.
 */
export class ControlPoint {
  readonly owner: ParticleSystemState | null;
  readonly index: number;

  private currentPosition = Vector3.zero;
  private currentForward = Vector3.unitX;
  private currentLeft = Vector3.unitY;
  private currentUp = Vector3.unitZ;

  constructor(owner: ParticleSystemState | null, index: number) {
    this.owner = owner;
    this.index = index;
  }

  get position(): Vector3 {
    return this.currentPosition;
  }

  /** Setting a different value counts as a change of the control point. */
  set position(value: Vector3) {
    this.owner?.noteControlPointWrite(this);
    this.isWritten = true;

    if (!value.equals(this.currentPosition)) {
      this.currentPosition = value;
      this.stamp();
    }

    if (this.owner === null) {
      return;
    }

    this.owner.raiseHighestControlPoint(this.index);

    for (const child of this.owner.children) {
      child.getControlPoint(this.index).position = value;
    }
  }

  get forward(): Vector3 {
    return this.currentForward;
  }

  get left(): Vector3 {
    return this.currentLeft;
  }

  get up(): Vector3 {
    return this.currentUp;
  }

  setOrientation(forward: Vector3, left: Vector3, up: Vector3): void {
    this.owner?.noteControlPointWrite(this);
    this.isWritten = true;

    if (!forward.equals(this.currentForward) || !left.equals(this.currentLeft) || !up.equals(this.currentUp)) {
      this.currentForward = forward;
      this.currentLeft = left;
      this.currentUp = up;
      this.stamp();
    }

    if (this.owner === null) {
      return;
    }

    this.owner.raiseHighestControlPoint(this.index);

    for (const child of this.owner.children) {
      child.getControlPoint(this.index).setOrientation(forward, left, up);
    }
  }

  /** Sets the three axes from a rotation, which carries +X to forward. */
  setRotation(rotation: Quaternion): void {
    const matrix = Matrix4x4.fromQuaternion(rotation);
    this.setOrientation(rowOf(matrix, 0), rowOf(matrix, 1), rowOf(matrix, 2));
  }

  /** The forward direction. Setting it builds left and up around it; zero restores the default axes. */
  get orientation(): Vector3 {
    return this.currentForward;
  }

  set orientation(value: Vector3) {
    if (value.equals(Vector3.zero)) {
      this.setOrientation(Vector3.unitX, Vector3.unitY, Vector3.unitZ);
      return;
    }

    const direction = value.div(value.length());
    const { left, up } = vectorVectors(direction);
    this.setOrientation(direction, left, up);
  }

  /** The owner's age when the position or orientation last changed, or -1 when neither has. */
  changeTime = -1;

  get changeAge(): number {
    return f32((this.owner?.age ?? 0) - this.changeTime);
  }

  /** Whether the position or orientation has ever been written, even with the value it already had. */
  isWritten = false;

  private stamp(): void {
    this.changeTime = this.owner?.age ?? 0;
  }

  save(): ControlPointSavedState {
    return {
      position: this.currentPosition,
      forward: this.currentForward,
      left: this.currentLeft,
      up: this.currentUp,
      changeTime: this.changeTime,
      isWritten: this.isWritten,
    };
  }

  restore(state: ControlPointSavedState): void {
    this.currentPosition = state.position;
    this.currentForward = state.forward;
    this.currentLeft = state.left;
    this.currentUp = state.up;
    this.changeTime = state.changeTime;
    this.isWritten = state.isWritten;
  }

  rewindChange(): void {
    if (this.changeTime !== -1) {
      this.changeTime = 0;
    }
  }

  /** The position at the end of the previous frame. */
  positionPrevious = Vector3.zero;
  forwardPrevious = Vector3.unitX;
  leftPrevious = Vector3.unitY;
  upPrevious = Vector3.unitZ;

  /** Real time the move recorded in positionPrevious took, in seconds. */
  previousStepTime = 0;

  recordStep(elapsed: number): void {
    this.positionPrevious = this.currentPosition;
    this.forwardPrevious = this.currentForward;
    this.leftPrevious = this.currentLeft;
    this.upPrevious = this.currentUp;
    this.previousStepTime = elapsed;
  }

  get stepDelta(): Vector3 {
    return this.currentPosition.sub(this.positionPrevious);
  }

  /** The velocity in units per second, zero until a step has been recorded. */
  get velocity(): Vector3 {
    return this.previousStepTime > 0 ? this.stepDelta.div(this.previousStepTime) : Vector3.zero;
  }

  /** How far from the previous to the current state `time` falls within the step `state` is simulating, in [0, 1]. */
  static stepFraction(state: ParticleSystemState, time: number): number {
    const step = state.currentStep;

    if (step === 0 || state.age === time) {
      return 1;
    }

    return saturate(f32(f32(step - f32(state.age - time)) / step));
  }

  /** The position at `time` within the step the owner is simulating. */
  getPositionAtTime(time: number): Vector3 {
    return this.owner === null
      ? this.currentPosition
      : lerpV(this.positionPrevious, this.currentPosition, ControlPoint.stepFraction(this.owner, time));
  }

  /** The axes as rows and getPositionAtTime as the translation; the previous axes exactly at the step start. */
  getBasisAtTime(time: number): Matrix4x4 {
    const owner = this.owner;
    const atStepStart = owner !== null && owner.currentStep !== 0 && time === f32(owner.age - owner.currentStep);
    const basis = atStepStart ? this.getPreviousRotationMatrix() : this.getRotationMatrix();
    return basis.withTranslation(this.getPositionAtTime(time));
  }

  getRotationMatrix(): Matrix4x4 {
    return Matrix4x4.createBasis(this.currentForward, this.currentLeft, this.currentUp);
  }

  getTransform(): Matrix4x4 {
    return this.getRotationMatrix().withTranslation(this.currentPosition);
  }

  getPreviousRotationMatrix(): Matrix4x4 {
    return Matrix4x4.createBasis(this.forwardPrevious, this.leftPrevious, this.upPrevious);
  }

  getRotation(): Quaternion {
    return Quaternion.fromRotationMatrix(this.getRotationMatrix());
  }

  getPreviousRotation(): Quaternion {
    return Quaternion.fromRotationMatrix(this.getPreviousRotationMatrix());
  }

  attachType = 0;

  /** The snapshot bound to this control point, or null. */
  snapshot: ParticleSnapshot | null = null;

  private modelValue: ParticleModel | null = null;

  /**
   * The model bound to this control point, such as the model an effect is attached to, or null.
   * Setting it reaches the same control point of every system below and does not count as a change.
   */
  get model(): ParticleModel | null {
    return this.modelValue;
  }

  set model(value: ParticleModel | null) {
    this.modelValue = value;

    for (const child of this.owner?.children ?? []) {
      child.getControlPoint(this.index).model = value;
    }
  }

  private modelObjectValue: ParticleModelObject | null = null;
  private standInModelObject: ControlPointModelObject | null = null;

  /**
   * The object carrying a model this control point is bound to, or null. Setting it also sets
   * `model`, and like that it does not count as a change of the control point.
   */
  get modelObject(): ParticleModelObject | null {
    return this.modelObjectValue;
  }

  set modelObject(value: ParticleModelObject | null) {
    this.modelObjectValue = value;
    this.model = value?.model ?? null;

    for (const child of this.owner?.children ?? []) {
      child.getControlPoint(this.index).modelObject = value;
    }
  }

  /**
   * The object the model functions read: `modelObject`, or for a control point that carries only a
   * model, that model in its bind pose placed on the control point.
   */
  resolveModelObject(): ParticleModelObject | null {
    if (this.modelObjectValue !== null) {
      return this.modelObjectValue;
    }

    if (this.modelValue === null) {
      return null;
    }

    if (this.standInModelObject?.model !== this.modelValue) {
      this.standInModelObject = new ControlPointModelObject(this, this.modelValue);
    }

    return this.standInModelObject;
  }

  private hitBoxCache: HitBoxCache | null = null;

  /** The hitboxes or bones of the control point's model, as this system's model functions last read them. */
  get hitBoxes(): HitBoxCache {
    return (this.hitBoxCache ??= new HitBoxCache());
  }

  /** Writes one component of the position, for the particles to read. */
  setComponent(component: number, value: number): void {
    const clamped = Math.min(Math.max(component, 0), 2);
    const p = this.currentPosition;
    this.position = clamped === 0 ? p.withX(value) : clamped === 1 ? p.withY(value) : p.withZ(value);
  }
}

/** A model bound to a control point with nothing posing it: its bind pose, placed on the control point. */
class ControlPointModelObject implements ParticleModelObject {
  readonly sequenceIndex = -1;
  readonly sequenceRate = 1;
  readonly model: ParticleModel;
  private readonly controlPoint: ControlPoint;

  constructor(controlPoint: ControlPoint, model: ParticleModel) {
    this.controlPoint = controlPoint;
    this.model = model;
  }

  get transform(): Matrix4x4 {
    return this.controlPoint.getTransform();
  }

  getBonePose(bones: Matrix4x4[]): void {
    this.model.getBindPose(bones);
  }
}

function rowOf(matrix: Matrix4x4, row: number): Vector3 {
  return new Vector3(matrix.m[row * 4], matrix.m[row * 4 + 1], matrix.m[row * 4 + 2]);
}
