// Ported from ValveResourceFormat (MIT): ValveResourceFormat/Particles/ParticleSystemSimulation.cs,
// ParticleSystemSimulation.Simulation.cs, ParticleSystemSimulation.Children.cs,
// ParticleSystemSimulation.Storage.cs and ParticleSystemSimulation.Snapshots.cs.
//
// Runs a particle system (emitters, initializers, operators, forces, constraints, children) with no
// graphics backend. The partial classes are merged here in the same order.

import { ParticleBuffer } from './buffer';
import { MAX_GPU_PARTICLES, MAX_PARTICLES, ParticleCollection } from './collection';
import { ParticleDiagnostics } from './diagnostics';
import { ParticleDetailLevel, ParticleEventType, ParticleField } from './enums';
import { fieldMask, maskContains } from './fields';
import {
  type ControlPointDefaults,
  ParticleFunction,
  type ParticleFunctionConstraint,
  ParticleFunctionEmitter,
  type ParticleFunctionForceGenerator,
  ParticleFunctionInitializer,
  type ParticleFunctionOperator,
  type ParticleFunctionPreEmissionOperator,
} from './functions';
import { type KVObject, getArray, getObjectArray, getString, isCollection } from './kv';
import { ParticleNamedValues, type ParticleNamedValue, namedFloat, namedTransform, namedVector } from './namedValues';
import { FLOAT_MAX, Quaternion, Vector3, alignUp, clamp, f32, maxV, minV, toInt } from './numerics';
import { ParticleDefinitionParser } from './parser';
import { type FunctionKind, createFunction } from './registry';
import type { ParticleSpan } from './span';
import { type ControlPoint, FLOAT_MIN_VALUE, ParticleSystemState } from './state';
import { upgradeToLatest } from './upgrade';
import { FLOAT_EPSILON } from './utils/particleMath';
import { type ParticleSnapshot, SnapshotBinding } from './utils/snapshotBinding';
import { stringToken } from './utils/stringToken';

/** A particle system definition as a host loads it: the raw decoded KV3 and its stored format. */
export interface LoadedParticleSystem {
  /** The resource file name, as VRF reports it (`particles/x.vpcf_c`); root systems seed from it. */
  name: string;
  /** The definition's KV3 DATA block decoded to JSON, before any format upgrade. */
  data: KVObject;
  /** The stored KV3 format name (`vpcf61` ...), or null when unknown. */
  format: string | null;
}

/** Resolves the child systems and snapshots a definition names (VRF's IFileLoader). */
export interface ParticleDefinitionSource {
  /** The system at `path` as `m_ChildRef` names it (`particles/x.vpcf`), or null when missing. */
  loadSystem(path: string): LoadedParticleSystem | null;
  /** The snapshot at `path` as `m_hSnapshot` names it, or null. Optional: without it snapshots are absent. */
  loadSnapshot?(path: string): ParticleSnapshot | null;
}

/** What a drawing layer watching a system is told (IParticleSystemObserver). */
export interface ParticleSystemObserver {
  onFrameSimulated(particles: ParticleCollection, state: ParticleSystemState): void;
  onParticlesInitialized?(particles: ParticleCollection, state: ParticleSystemState, first: number, count: number): void;
  readonly observedEvents?: number;
  onParticleEvent?(particles: ParticleCollection, eventType: number, indices: readonly number[]): void;
}

export interface AABB {
  min: Vector3;
  max: Vector3;
}

function aabbCenter(box: AABB): Vector3 {
  return box.min.add(box.max).scale(0.5);
}

export interface SimulationOptions {
  diagnostics?: ParticleDiagnostics;
  /** A snapshot to publish to the system, when it runs off one. */
  particleSnapshot?: ParticleSnapshot | null;
  /** The state of the system running this one as a child. */
  parentSystemState?: ParticleSystemState | null;
}

/** The most substeps a pre-simulation runs; earlier time is skipped. */
const MAX_PRE_SIMULATION_STEPS = 2048;

/** Classes that only exist in a range of behavior versions, as (class, first version, last version). */
const CLASS_VERSION_RANGES: readonly [string, number, number][] = [
  ['C_INIT_CreateSequentialPath', -2147483648, 7],
  ['C_INIT_CreateSequentialPathV2', 8, 2147483647],
  ['C_OP_InheritFromParentParticles', -2147483648, 8],
  ['C_OP_InheritFromParentParticlesV2', 9, 2147483647],
  ['C_OP_LockToSavedSequentialPath', -2147483648, 7],
  ['C_OP_LockToSavedSequentialPathV2', 8, 2147483647],
];

/** Frame times below this are not simulated at all. */
const MINIMUM_FRAME_TIME = f32(1e-22);

/** The step length the first frame records for the control points' previous state. */
const FIRST_FRAME_STEP = f32(0.05);

/** All four emitters set the creation time. */
const EMITTED_WRITTEN_FIELDS = fieldMask(ParticleField.CreationTime);

/** The attributes that link a child particle to its parent particle. */
const PARENT_LINK_FIELDS = fieldMask(ParticleField.ParentParticleId) | fieldMask(ParticleField.ParentParticleIndex);

/** The attributes the system itself writes to every new particle. */
const SYSTEM_WRITTEN_FIELDS = fieldMask(ParticleField.ParticleId) | fieldMask(ParticleField.CreationTime);

const FUNCTION_LABELS: Record<FunctionKind, string> = {
  preEmission: 'pre-emission operator',
  emitter: 'emitter',
  initializer: 'initializer',
  operator: 'operator',
  forceGenerator: 'force generator',
  constraint: 'constraint',
};

export class ParticleSystemSimulation {
  private readonly preEmissionOperators: ParticleFunctionPreEmissionOperator[] = [];
  private readonly emitters: ParticleFunctionEmitter[] = [];
  private readonly initializers: ParticleFunctionInitializer[] = [];
  readonly operators: ParticleFunctionOperator[] = [];

  /** Run by BasicMovement rather than the operator loop. */
  readonly forceGenerators: ParticleFunctionForceGenerator[] = [];
  private readonly constraints: ParticleFunctionConstraint[] = [];

  /** Every function of the system, in the order the definition lists their kinds. */
  private readonly functions: ParticleFunction[];

  private bounds: AABB = { min: Vector3.zero, max: Vector3.zero };
  private boundsValid = false;
  private boundsComputed = false;

  readonly maxDrawDistanceSquared: number;
  readonly isScreenSpaceEffect: boolean;
  readonly depthSortBias: number;
  readonly noDrawTimeToGoToSleep: number;

  observer: ParticleSystemObserver | null = null;

  /** The file the system was loaded from. */
  name: string;
  readonly behaviorVersion: number;

  private readonly firstMultipleOverride: number;
  private readonly groupIdValue: number;
  private startDelay = 0;
  private childSlot = 0;
  private childSlotCount = 0;
  private pinnedSeed: number | null = null;

  /** Whether this child exists only for the parent's endcap (m_bEndCap). */
  isEndCapChild = false;

  readonly hitboxesFallBackToRenderBounds: boolean;
  readonly hitboxesFallBackToSnapshot: boolean;

  private detailLevel: number = ParticleDetailLevel.PARTICLEDETAIL_LOW;

  private readonly initialParticles: number;
  private readonly maxParticles: number;
  private readonly minimumTimeStep: number;
  private readonly maximumTimeStep: number;

  /** The length of the step being simulated. */
  currentFrameTime: number;

  private readonly minimumSimTime: number;
  private readonly maximumSimTime: number;
  private readonly minimumFrames: number;
  private readonly preSimulationTime: number;
  private readonly stopSimulationAfterTime: number;

  /** Added over the particle's radius when calculating the bounding box. */
  private readonly particleBoundingBox: AABB;
  private readonly infiniteBounds: boolean;

  private readonly childSimulations: ParticleSystemSimulation[] = [];
  readonly diagnostics: ParticleDiagnostics;
  private readonly source: ParticleDefinitionSource;

  private firstFramePending = true;
  private previousControlPointsValid = false;
  private finishedBeforeStartAllowed = false;
  private preSimFrames = 0;
  private skipDepth = 0;
  private eventListenMask = 0;

  private readonly particleCollection: ParticleCollection;
  private particlesCreated = 0;
  private particlesCreatedThisFrame = 0;
  private particlesCreatedThisStep = 0;
  private particleIdCounter = 0;
  private readonly systemState: ParticleSystemState;

  /** The upgraded definition this system was built from. */
  readonly definition: KVObject;

  /** The system's named values. */
  readonly namedValues: ParticleNamedValues;

  // Storage
  private readonly initialReads = { value: 0n };
  private initializedFields = SYSTEM_WRITTEN_FIELDS;
  private updatedFields = 0n;
  private rendererInitialReads = 0n;

  // Simulation scratch
  private readonly eventIndices: number[] = [];
  private readonly indexById = new Map<number, number>();

  constructor(particleSystem: LoadedParticleSystem, source: ParticleDefinitionSource, options: SimulationOptions = {}) {
    const parentSystemState = options.parentSystemState ?? null;
    this.source = source;
    this.diagnostics = options.diagnostics ?? new ParticleDiagnostics();
    this.name = particleSystem.name;

    const rootData = upgradeToLatest(particleSystem.data, particleSystem.format, this.diagnostics, this.name);
    this.definition = rootData;

    let parse = new ParticleDefinitionParser(rootData, this.diagnostics, this.initialReads);
    this.behaviorVersion = parse.int32('m_nBehaviorVersion', 0);
    parse = parse.withBehaviorVersion(this.behaviorVersion);
    this.firstMultipleOverride = parse.int32('m_nFirstMultipleOverride_BackwardCompat', -1);
    this.groupIdValue = parse.int32('m_nGroupID', 0);
    this.initialParticles = Math.max(0, parse.int32('m_nInitialParticles', 0));

    // The pool is capped whatever the file asks for; GPU simulated systems get a far larger one
    const particleCeiling = parse.boolean('m_bIsGPUParticleSystem', false) ? MAX_GPU_PARTICLES : MAX_PARTICLES;
    this.maxParticles = clamp(parse.int32('m_nMaxParticles', 1000), 1, particleCeiling);
    this.minimumTimeStep = parse.float('m_flMinimumTimeStep', 0);
    const authoredMaximumTimeStep = parse.float('m_flMaximumTimeStep', f32(0.1));
    this.maximumTimeStep = authoredMaximumTimeStep > 0 ? authoredMaximumTimeStep : f32(0.1);
    this.minimumSimTime = parse.float('m_flMinimumSimTime', 0);
    this.maximumSimTime = parse.float('m_flMaximumSimTime', 0);
    this.minimumFrames = parse.int32('m_nMinimumFrames', 0);
    this.preSimulationTime = parse.float('m_flPreSimulationTime', 0);
    this.stopSimulationAfterTime = parse.float('m_flStopSimulationAfterTime', f32(1e9));
    this.hitboxesFallBackToRenderBounds = parse.boolean('m_bShouldHitboxesFallbackToRenderBounds', true);
    this.hitboxesFallBackToSnapshot = parse.boolean('m_bShouldHitboxesFallbackToSnapshot', false);

    // Non-positive distances, and ones large enough to overflow when squared, draw at any range
    const maxDrawDistance = parse.float('m_flMaxDrawDistance', -1);
    this.maxDrawDistanceSquared = maxDrawDistance <= 0 || maxDrawDistance >= 1e10 ? FLOAT_MAX : f32(maxDrawDistance * maxDrawDistance);

    this.isScreenSpaceEffect = parse.boolean('m_bScreenSpaceEffect', false);
    this.depthSortBias = parse.float('m_flDepthSortBias', 0);

    // A negative time keeps the system awake for practically ever
    const noDrawTimeToGoToSleep = parse.float('m_flNoDrawTimeToGoToSleep', 8);
    this.noDrawTimeToGoToSleep = noDrawTimeToGoToSleep < 0 ? 65536 : noDrawTimeToGoToSleep;

    this.currentFrameTime = this.maximumTimeStep;

    this.infiniteBounds = parse.boolean('m_bInfiniteBounds', false);
    this.particleBoundingBox = {
      min: parse.vector3('m_BoundingBoxMin', Vector3.splat(-10)),
      max: parse.vector3('m_BoundingBoxMax', Vector3.splat(10)),
    };

    const constantAttributes = ParticleBuffer.createConstants(parse);
    this.particleCollection = new ParticleCollection(constantAttributes, this.maxParticles);

    this.systemState = new ParticleSystemState(parentSystemState, this);

    const functions = (key: string) => getObjectArray(rootData, key);

    this.setupFunctions(parse, functions('m_PreEmissionOperators'), 'preEmission', this.preEmissionOperators);
    this.setupFunctions(parse, functions('m_Emitters'), 'emitter', this.emitters);
    this.setupFunctions(parse, functions('m_Initializers'), 'initializer', this.initializers);
    this.setupFunctions(parse, functions('m_Operators'), 'operator', this.operators);
    this.setupFunctions(parse, functions('m_ForceGenerators'), 'forceGenerator', this.forceGenerators);
    this.setupFunctions(parse, functions('m_Constraints'), 'constraint', this.constraints);
    this.functions = [
      ...this.preEmissionOperators,
      ...this.emitters,
      ...this.initializers,
      ...this.operators,
      ...this.forceGenerators,
      ...this.constraints,
    ];
    this.declareFunctionFields();

    this.setupChildParticles(functions('m_Children'));

    this.namedValues = new ParticleNamedValues(rootData, this.childSimulations.map((child) => child.namedValues));

    this.publishSnapshot(parse, options.particleSnapshot ?? null);

    this.particleCollection.preserveOrderOnKill = this.isOrderImportant(functions('m_Renderers'));

    for (const childSimulation of this.childSimulations) {
      for (const emitter of childSimulation.emitters) {
        this.eventListenMask |= emitter.eventTypeMask;
      }
    }

    if (parentSystemState === null) {
      this.seedRandom(stringToken(this.name) | 0);
    }
  }

  /** The box containing the system's particles and its children's, relative to its first control point. */
  get localBoundingBox(): AABB {
    if (this.infiniteBounds || !this.boundsComputed) {
      return { min: Vector3.splat(-FLOAT_MAX), max: Vector3.splat(FLOAT_MAX) };
    }

    const origin = this.mainControlPoint.position;
    return this.boundsValid ? { min: this.bounds.min.sub(origin), max: this.bounds.max.sub(origin) } : { min: Vector3.zero, max: Vector3.zero };
  }

  /** The world-space box around the system's particles and children while it is valid, or null. */
  get worldBoundingBox(): AABB | null {
    if (this.infiniteBounds) {
      return { min: Vector3.splat(-FLOAT_MAX), max: Vector3.splat(FLOAT_MAX) };
    }

    return this.boundsComputed && this.boundsValid ? this.bounds : null;
  }

  get localBoundingBoxCenter(): Vector3 {
    return aabbCenter(this.localBoundingBox);
  }

  /** Control point 0, which places the system in the world. */
  get mainControlPoint(): ControlPoint {
    return this.getControlPoint(0);
  }

  /** Publishes the render camera position to this system and every child. */
  setCameraPosition(position: Vector3): void {
    this.systemState.cameraPosition = position;

    for (const childSimulation of this.childSimulations) {
      childSimulation.setCameraPosition(position);
    }
  }

  getControlPoint(cp: number): ControlPoint {
    return this.systemState.getControlPoint(cp);
  }

  /** Builds the running state of every function in the tree, children before their parent. */
  private initializeTree(): void {
    for (const childSimulation of this.childSimulations) {
      childSimulation.initializeTree();
    }

    this.resetFunctions();
    this.applyNamedValueLocals();
  }

  private applyNamedValueLocals(): void {
    for (const { name, value } of this.namedValues.locals) {
      this.setNamedValueOf(name, value);
    }
  }

  /** Sets a float named value on this system and every system below it, read by the next simulation step. */
  setNamedValue(name: string, value: number): boolean {
    return this.setNamedValueOf(name, namedFloat(value));
  }

  setNamedVector(name: string, value: Vector3): boolean {
    return this.setNamedValueOf(name, namedVector(value));
  }

  setNamedTransform(name: string, position: Vector3, rotation: Quaternion): boolean {
    return this.setNamedValueOf(name, namedTransform(position, rotation));
  }

  private setNamedValueOf(name: string, value: ParticleNamedValue): boolean {
    const result = this.namedValues.set(name, value);

    for (const childSimulation of this.childSimulations) {
      childSimulation.setNamedValueOf(name, value);
    }

    return result;
  }

  /** The live particle states this frame. */
  get currentParticles(): ParticleSpan {
    return this.particleCollection.currentSpan;
  }

  /** The most particles this system can hold at once. */
  get particleCapacity(): number {
    return this.particleCollection.capacity;
  }

  /** Sets the particle detail tier for this system; child systems inherit it. */
  setDetailLevel(level: number): void {
    this.systemState.detailLevel = level;
  }

  /**
   * Seeds this system and its children and rebuilds every function's state from it. Every entry of
   * m_Children steps the seed by 129, including skipped entries.
   */
  seedRandom(seed: number): void {
    this.applySeed(seed, 0);
    this.initializeTree();
  }

  /** Fixes the seed this system and its children start over from each time they replay. */
  pinRandomSeed(seed: number | null): void {
    this.pinnedSeed = seed;
  }

  private applySeed(seed: number, counter: number): void {
    for (let i = 0; i < this.childSimulations.length; i++) {
      const child = this.childSimulations[i];
      child.applySeed(childSeed(seed, child.childSlot), (i + 1) * child.maxParticles);
    }

    this.systemState.random.start(childSeed(seed, this.childSlotCount - 1), counter);
    this.particleIdCounter = 0;
  }

  /** The systems this one runs as children, in definition order. */
  get children(): readonly ParticleSystemSimulation[] {
    return this.childSimulations;
  }

  /** This system's live particles. */
  get particles(): ParticleCollection {
    return this.particleCollection;
  }

  /** The state every function of this system reads it through. */
  get renderState(): ParticleSystemState {
    return this.systemState;
  }

  /** The parent particle events any child of this system emits from. */
  get listenedEvents(): number {
    return this.eventListenMask;
  }

  /** Spawns throwaway particles so a drawing layer can prime buffers, and captures the state they disturb. */
  beginPrewarm(count: number): { particleCount: number; particleIdCounter: number } | null {
    if (this.particleCollection.count > 0) {
      return null;
    }

    const scope = { particleCount: this.systemState.particleCount, particleIdCounter: this.particleIdCounter };

    for (let i = 0; i < count; i++) {
      this.addParticle(this.systemState.age);
    }

    this.initializeNewParticles(0, this.particleCollection.count, 0n, -1, false);

    return scope;
  }

  endPrewarm(scope: { particleCount: number; particleIdCounter: number }): void {
    this.particleCollection.clear();
    this.particleIdCounter = scope.particleIdCounter;
    this.systemState.particleCount = scope.particleCount;
  }

  private setupFunctions<T extends ParticleFunction>(parse: ParticleDefinitionParser, data: KVObject[], kind: FunctionKind, target: T[]): void {
    let definitionIndex = 0;
    let listIndex = 0;

    for (const info of data) {
      const className = getString(info, '_class') ?? '';
      const disabled = this.isOperatorDisabled(info);

      if (disabled || !this.isInVersionRange(className)) {
        if (disabled && this.behaviorVersion < 5) {
          listIndex++;
        }

        definitionIndex++;
        continue;
      }

      const functionParse = parse.function(info);
      const created = createFunction(kind, className, functionParse);

      if (created.function !== null) {
        const fn = created.function;

        if (fn instanceof ParticleFunctionInitializer) {
          fn.definitionIndex = definitionIndex;
          fn.hasRandomInput = functionParse.randomInputs!.value;
        } else if (fn instanceof ParticleFunctionEmitter) {
          fn.emitterIndex = listIndex;
        }

        fn.className = className;
        target.push(fn as T);
        listIndex++;
      } else {
        const label = FUNCTION_LABELS[kind];
        const reason = created.knownToVrf ? 'not ported yet' : 'unknown to ValveResourceFormat';
        this.diagnostics.report('unsupported-class', `Unsupported ${label} class '${className}' (${reason})`, this.name);
      }

      definitionIndex++;
    }
  }

  private isInVersionRange(className: string): boolean {
    for (const [name, minVersion, maxVersion] of CLASS_VERSION_RANGES) {
      if (name === className) {
        return this.behaviorVersion >= minVersion && this.behaviorVersion <= maxVersion;
      }
    }

    return true;
  }

  /** Whether a function or renderer of this system, or any child, needs particle order kept when particles are removed. */
  private isOrderImportant(rendererData: KVObject[]): boolean {
    if (this.operators.some((op) => op.isOrderImportant) || this.childSimulations.some((child) => child.particleCollection.preserveOrderOnKill)) {
      return true;
    }

    for (const renderer of rendererData) {
      if (this.isOperatorDisabled(renderer)) {
        continue;
      }

      const className = getString(renderer, '_class');
      const materialVars = getArray(renderer, 'm_MaterialVars');

      if (className === 'C_OP_RenderRopes' || (className === 'C_OP_RenderProjected' && materialVars !== null && materialVars.length > 0)) {
        return true;
      }
    }

    return false;
  }

  private isOperatorDisabled(op: KVObject): boolean {
    return new ParticleDefinitionParser(op, this.diagnostics, { value: 0n }).boolean('m_bDisableOperator', false);
  }

  // Simulation

  private get isSkipping(): boolean {
    return this.skipDepth > 0 || (this.systemState.parentSystem?.data?.isSkipping ?? false);
  }

  /** Lets the system and its children emit again after a stop. Endcap children keep waiting for an endcap. */
  start(): void {
    this.systemState.emissionStopped = false;

    for (const emitter of this.emitters) {
      emitter.startEmission(this.systemState);
    }

    for (const childSimulation of this.childSimulations) {
      if (!childSimulation.isEndCapChild) {
        childSimulation.start();
      }
    }
  }

  /** Stops emission on the system and its children, leaving live particles to finish. */
  stop(): void {
    this.stopEmission(false, false);
  }

  /** Stops emission on the system and its children and plays the endcap. */
  playEndCap(): void {
    this.stopEmission(false, true);
  }

  /** Stops emission on the system and its children within the current frame. */
  stopEmission(removeAllParticles: boolean, playEndCap: boolean): void {
    if (this.systemState.frozen) {
      this.systemState.frozen = false;
      removeAllParticles = true;
      playEndCap = false;
    }

    this.systemState.emissionStopped = true;

    if (this.firstFramePending && !removeAllParticles && !this.finishedBeforeStartAllowed) {
      const root = this.systemState.root;
      const wasRunning = root.functionsRunning;
      root.functionsRunning = true;

      try {
        this.simulateFirstFrame();
      } finally {
        root.functionsRunning = wasRunning;
      }
    }

    for (const emitter of this.emitters) {
      emitter.stopEmission();
    }

    if (removeAllParticles) {
      this.killAllParticles();
    }

    if (!this.isEndCapChild || playEndCap) {
      this.systemState.inEndCap = true;
    }

    if (playEndCap) {
      this.systemState.endCapStartAge = this.systemState.age;
    }

    for (const childSimulation of this.childSimulations) {
      if (!childSimulation.isEndCapChild || !playEndCap) {
        childSimulation.stopEmission(removeAllParticles, playEndCap);
        continue;
      }

      childSimulation.systemState.age = 0;
      childSimulation.systemState.endCapStartAge = 0;
      childSimulation.enterEndCap();
      childSimulation.start();
    }
  }

  private enterEndCap(): void {
    this.systemState.inEndCap = true;

    for (const childSimulation of this.childSimulations) {
      childSimulation.enterEndCap();
    }
  }

  /** Holds every system below this one in place. */
  freezeChildren(): void {
    for (const childSimulation of this.childSimulations) {
      childSimulation.systemState.frozen = true;
      childSimulation.freezeChildren();
    }
  }

  /** Whether no emitter can create more particles and, unless `emissionEndIsEnough`, every particle dies within the step. */
  hasFinishedEmitting(emissionEndIsEnough: boolean, includeChildren: boolean): boolean {
    if (this.isEndCapChild) {
      return true;
    }

    for (const emitter of this.emitters) {
      if (emitter.mayCreateMoreParticles(this.systemState)) {
        return false;
      }
    }

    if (!emissionEndIsEnough) {
      let dying = 0;
      const current = this.particleCollection.currentSpan;
      const creationTimes = current.floats(ParticleField.CreationTime);
      const lifetimes = current.readFloats(ParticleField.LifeDuration);

      for (let i = 0; i < current.length; i++) {
        if (f32(f32(this.systemState.age - creationTimes[i]) + this.systemState.currentStep) > lifetimes[i]) {
          dying++;
        }
      }

      if (dying < this.particleCollection.count) {
        return false;
      }
    }

    if (includeChildren) {
      for (const childSimulation of this.childSimulations) {
        if (!childSimulation.hasFinishedEmitting(emissionEndIsEnough, true)) {
          return false;
        }
      }
    }

    return true;
  }

  /** Replays the system from scratch, discarding the particles still alive first. */
  replay(): void {
    this.stopEmission(true, false);

    if (this.pinnedSeed !== null) {
      this.systemState.undoFunctionControlPointWrites();
      this.applySeed(this.pinnedSeed, 0);
    }

    this.rewind();
    this.start();
  }

  /** Plays the endcap by itself. */
  playEndCapOnly(): void {
    this.replay();
    this.stopEmission(true, true);
  }

  private rewind(): void {
    for (const childSimulation of this.childSimulations) {
      childSimulation.rewind();
    }

    this.particlesCreated = 0;
    this.particlesCreatedThisFrame = 0;
    this.particlesCreatedThisStep = 0;
    this.preSimFrames = 0;
    this.firstFramePending = true;
    this.finishedBeforeStartAllowed = false;
    this.boundsComputed = false;
    this.boundsValid = false;
    this.particleCollection.releasePreviousStep();

    const state = this.systemState;
    state.age = state.parentSystem === null ? 0 : this.isEndCapChild ? FLOAT_MIN_VALUE : -this.startDelay;
    state.requestedAge = 0;
    state.stepStartAge = f32(1e23);
    state.currentStep = 0;
    state.previousStep = FIRST_FRAME_STEP;
    state.operatorTimeBase = 0;
    state.endCapStartAge = FLOAT_MIN_VALUE;
    state.inEndCap = false;
    state.frozen = false;
    state.rewindControlPointChanges();
    this.previousControlPointsValid = false;
    this.currentFrameTime = this.maximumTimeStep;

    state.random.redrawInputSeeds();
    this.resetFunctions();
    this.namedValues.reset();
    this.applyNamedValueLocals();
  }

  /** Restarts the system and its children without destroying the particles alive or rewinding the clock. */
  restart(): void {
    this.preSimFrames = 0;
    this.systemState.random.redrawInputSeeds();
    this.namedValues.recapture();

    if (this.isEndCapChild) {
      this.systemState.age = FLOAT_MIN_VALUE;
      this.systemState.operatorTimeBase = 0;
    } else {
      this.systemState.operatorTimeBase = this.systemState.startedAge;
    }

    this.systemState.inEndCap = false;

    for (const fn of this.functions) {
      fn.restart(this.systemState);
    }

    for (const childSimulation of this.childSimulations) {
      childSimulation.restart();
    }
  }

  private resetFunctions(): void {
    for (const fn of this.functions) {
      fn.initialize(this.systemState);
    }
  }

  /** Advances the system by one frame, in as many substeps as the definition's time step needs. */
  update(frameTime: number, worldTime: number): void {
    // Only the root carries it; children read it back through their parent chain
    this.systemState.worldTime = f32(worldTime);

    const root = this.systemState.root;
    const wasRunning = root.functionsRunning;
    root.functionsRunning = true;

    try {
      this.simulateInternal(f32(f32(frameTime) * this.systemState.timeScale));
    } finally {
      root.functionsRunning = wasRunning;
    }
  }

  /**
   * Advances the system, then its children, by one frame. A frame longer than the maximum time step
   * is split into steps of that length; a remainder shorter than the minimum time step is simulated
   * as a full minimum step, and later frames are skipped until real time catches up.
   */
  private simulateInternal(frameTime: number): void {
    const state = this.systemState;

    if (state.frozen) {
      return;
    }

    this.namedValues.beginFrame();

    if (state.age < 0) {
      if (frameTime >= MINIMUM_FRAME_TIME) {
        state.age = f32(state.age + frameTime);
        this.updatePreviousControlPoints(frameTime);
      }

      return;
    }

    if (this.preSimulationTime !== 0 && this.firstFramePending) {
      this.skipToTime(this.preSimulationTime);

      if (!this.isSkipping) {
        this.refreshRenderState();
      }

      return;
    }

    if (this.firstFramePending) {
      this.simulateFirstFrame();
    } else if (!this.previousControlPointsValid) {
      this.updatePreviousControlPoints(state.previousStep);
    }

    this.particlesCreatedThisFrame = 0;

    if (frameTime < MINIMUM_FRAME_TIME) {
      return;
    }

    let requested = frameTime;

    if (this.maximumSimTime !== 0 && this.preSimFrames <= this.minimumFrames) {
      if (f32(state.age + frameTime) > this.maximumSimTime) {
        requested = Math.max(this.minimumSimTime, f32(this.maximumSimTime - state.age));
      }

      this.preSimFrames++;
    }

    let remaining = Math.min(requested, f32(this.maximumTimeStep * 10));

    state.requestedAge = f32(state.requestedAge + remaining);

    if (state.requestedAge >= state.stepStartAge && state.age > state.requestedAge) {
      remaining = 0;
    }

    let overshoot = false;

    while (remaining > 0) {
      let step: number;

      if (remaining > this.maximumTimeStep) {
        step = this.maximumTimeStep;
      } else if (this.minimumTimeStep > remaining) {
        step = this.minimumTimeStep;
        overshoot = true;
      } else {
        step = remaining;
      }

      remaining = f32(remaining - step);
      this.simulateStep(step, overshoot);
    }

    for (const childSimulation of this.childSimulations) {
      if (childSimulation.detailLevel > state.detailLevel) {
        continue;
      }

      childSimulation.simulateInternal(frameTime);
    }

    this.particlesCreated += this.particlesCreatedThisFrame;
    this.updatePreviousControlPoints(frameTime);
    this.calculateBounds();

    if (state.age > this.stopSimulationAfterTime) {
      state.frozen = true;
    }

    this.namedValues.endFrame();
  }

  private simulateStep(step: number, overshoot: boolean): void {
    const state = this.systemState;

    if (state.currentStep !== 0) {
      state.previousStep = state.currentStep;
    }

    state.stepStartAge = state.age;
    state.age = f32(state.age + step);
    state.currentStep = step;

    this.currentFrameTime = step;

    if (overshoot) {
      this.particleCollection.capturePreviousStep();
    } else {
      this.particleCollection.releasePreviousStep();
    }

    // Ages are measured from the end of the step
    this.particleCollection.time = state.age;

    // Each function that runs displaces the per-particle draws of the ones after it. Emitters and
    // initializers inherit whatever the pre-emission walk left behind.
    state.random.resetOperatorOffset();

    for (const preEmissionOperator of this.preEmissionOperators) {
      if (preEmissionOperator.runOnce) {
        continue;
      }

      const strength = preEmissionOperator.getOperatorRunStrength(state);

      if (strength <= 0) {
        continue;
      }

      preEmissionOperator.operate(state, step, strength);
      state.random.advanceOperatorOffset();
    }

    this.emit(ParticleEventType.PARTICLE_EVENT_TYPE_MASK_NONE, null);

    state.random.resetOperatorOffset();

    if (this.particleCollection.count > 0) {
      for (const particleOperator of this.operators) {
        const strength = particleOperator.getOperatorRunStrength(state);

        if (strength <= 0) {
          continue;
        }

        particleOperator.operate(this.particleCollection, step, state, strength);

        this.applyKills();

        if (this.particleCollection.count === 0) {
          break;
        }

        state.random.advanceOperatorOffset();
      }
    }

    if (!this.isSkipping) {
      this.observer?.onFrameSimulated(this.particleCollection, state);
    }
  }

  /** The system's first frame: every pre-emission operator once, run-once ones included, then the initial particles. */
  private simulateFirstFrame(): void {
    const state = this.systemState;
    this.firstFramePending = false;
    state.currentStep = 0;
    state.stepStartAge = f32(1e23);
    this.preSimFrames = 0;

    if (!this.previousControlPointsValid) {
      this.updatePreviousControlPoints(FIRST_FRAME_STEP);
    }

    state.random.resetOperatorOffset();

    for (const preEmissionOperator of this.preEmissionOperators) {
      const strength = preEmissionOperator.getOperatorRunStrength(state);

      if (strength > 0) {
        preEmissionOperator.operate(state, state.currentStep, strength);
        this.updatePreviousControlPoints(FIRST_FRAME_STEP);
      }

      state.random.advanceOperatorOffset();
    }

    const initialCount = Math.min(this.initialParticles, this.maxParticles);
    const first = this.particleCollection.count;

    for (let i = 0; i < initialCount; i++) {
      this.addParticle(state.age);
    }

    this.initializeNewParticles(first, this.particleCollection.count - first, 0n, -1);
  }

  private updatePreviousControlPoints(elapsed: number): void {
    this.systemState.updatePreviousControlPoints(elapsed);
    this.previousControlPointsValid = true;
  }

  /** Jumps the clock forward to `time` for the pre-simulation; the emitters then simulate the span they skipped. */
  private skipToTime(time: number): void {
    const state = this.systemState;

    if (time <= state.age || (this.finishedBeforeStartAllowed && state.age === FLOAT_MIN_VALUE)) {
      return;
    }

    if (this.firstFramePending) {
      this.simulateFirstFrame();
    }

    this.updatePreviousControlPoints(f32(time - state.age));
    state.age = time;
    state.requestedAge = time;

    this.skipDepth++;

    try {
      for (const emitter of this.emitters) {
        emitter.skipToTime(time, this);
      }

      for (const childSimulation of this.childSimulations) {
        if (!childSimulation.isEndCapChild || state.inEndCap) {
          childSimulation.skipToTime(f32(time - childSimulation.startDelay));
        }
      }
    } finally {
      this.skipDepth--;
    }
  }

  /** Simulates the system, children included, from `from` to `to` in maximum time steps. */
  resimulate(from: number, to: number): void {
    const neededSteps = toInt(Math.ceil(f32(f32(to - from) / this.maximumTimeStep)));

    if (neededSteps > MAX_PRE_SIMULATION_STEPS) {
      this.diagnostics.warn(`Effect wants ${neededSteps} pre-simulation substeps, capped at ${MAX_PRE_SIMULATION_STEPS}`, this.name);
      from = f32(to - f32(MAX_PRE_SIMULATION_STEPS * this.maximumTimeStep));
    }

    this.systemState.requestedAge = from;
    this.skipDepth++;

    try {
      for (let time = from; to > time; time = f32(time + this.maximumTimeStep)) {
        this.systemState.age = time;
        this.simulateInternal(this.maximumTimeStep);
      }
    } finally {
      this.skipDepth--;
    }
  }

  /** Runs the observer updates and bounds a fast-forward skipped, children first. */
  private refreshRenderState(): void {
    for (const childSimulation of this.childSimulations) {
      childSimulation.refreshRenderState();
    }

    this.observer?.onFrameSimulated(this.particleCollection, this.systemState);
    this.calculateBounds();
  }

  /**
   * Runs the emitters and initializes what they create: with no event type, the emitters that run
   * every step; otherwise the ones listening for `eventType`, for an event the parent raised.
   */
  private emit(eventType: number, parentIndices: number[] | null): void {
    const forEvent = eventType !== ParticleEventType.PARTICLE_EVENT_TYPE_MASK_NONE;
    const state = this.systemState;
    state.emitterEventParticles = parentIndices;
    this.particlesCreatedThisStep = 0;

    for (const emitter of this.emitters) {
      const listens = forEvent
        ? (emitter.eventTypeMask & eventType) !== 0
        : emitter.eventTypeMask === ParticleEventType.PARTICLE_EVENT_TYPE_MASK_NONE;

      if (!listens) {
        continue;
      }

      const strength = emitter.getOperatorRunStrength(state);

      if (strength <= 0) {
        continue;
      }

      const first = this.particleCollection.count;
      emitter.emit(state, strength, this.addParticleAction);

      const count = this.particleCollection.count - first;
      this.initializeNewParticles(first, count, EMITTED_WRITTEN_FIELDS, emitter.emitterIndex);
      this.particlesCreatedThisStep += count;

      if (!forEvent) {
        this.particlesCreatedThisFrame += count;
      }
    }

    state.emitterEventParticles = null;
  }

  private readonly addParticleAction = (creationTime: number): void => this.addParticle(creationTime);

  /** Creates a particle at `creationTime`, leaving it for initializeNewParticles. */
  private addParticle(creationTime: number): void {
    const index = this.particleCollection.add();

    if (index < 0) {
      return;
    }

    this.particleCollection.currentSpan.floats(ParticleField.CreationTime)[index] = creationTime;
  }

  /**
   * Runs the initializers over the `count` particles from `first`, one initializer over the whole
   * batch before the next. `writtenFields` are the attributes the creator already wrote, and
   * `emitterIndex` the emitter that did, or -1.
   */
  private initializeNewParticles(first: number, count: number, writtenFields: bigint, emitterIndex: number, raiseEvents = true): void {
    if (count <= 0) {
      return;
    }

    const state = this.systemState;
    state.particleCount = this.particleCollection.count;
    this.particleCollection.time = state.age;

    const batch = this.particleCollection.currentSpan.slice(first, count);

    // Below behavior version 6 the first writer of an attribute wins
    let written = writtenFields;
    state.initializingParticles = true;
    state.initializedFirst = first;
    state.spawnIndexBase = this.particlesCreated - first;
    state.particleNumberBase = this.particlesCreated + this.particlesCreatedThisStep - first;

    for (const initializer of this.initializers) {
      if (initializer.associatedEmitterIndex !== -1 && initializer.associatedEmitterIndex !== emitterIndex) {
        continue;
      }

      if (!initializer.shouldRun(state) || initializer.getOperatorRunStrength(state) <= 0) {
        continue;
      }

      const fields = initializer.writtenFields;

      if (
        this.behaviorVersion < 6 &&
        (this.firstMultipleOverride < 0 || initializer.definitionIndex < this.firstMultipleOverride) &&
        (fields & ~written) === 0n
      ) {
        continue;
      }

      state.initializedFields = written;

      this.fillParticleIds(first, count);

      initializer.initializeParticles(batch, this.particleCollection, state);

      if (initializer.hasRandomInput) {
        this.advanceParticleIds(first, count);
      }

      written |= fields;
    }

    state.initializingParticles = false;
    this.fillParticleIds(first, count);
    this.advanceParticleIds(first, count);

    this.particleCollection.saveInitial(first, count);
    this.particleCollection.setPreviousStep(first, count);

    if (raiseEvents) {
      this.observer?.onParticlesInitialized?.(this.particleCollection, state, first, count);
      this.dispatchSpawnEvents(first, count);
    }
  }

  /** Gives the particles the next particle ids, without taking them from the counter. */
  private fillParticleIds(first: number, count: number): void {
    const seed = this.systemState.random.seed;
    const particleIds = this.particleCollection.currentSpan.integers(ParticleField.ParticleId);

    for (let i = 0; i < count; i++) {
      particleIds[first + i] = (this.particleIdCounter + i + seed) & 0xfff;
    }
  }

  /** Takes the ids fillParticleIds gave from the counter, in whole blocks of four. */
  private advanceParticleIds(first: number, count: number): void {
    this.particleIdCounter += alignUp(first + count, 4) - first;
  }

  private dispatchSpawnEvents(first: number, count: number): void {
    const listened = this.eventListenMask | (this.observer?.observedEvents ?? ParticleEventType.PARTICLE_EVENT_TYPE_MASK_NONE);

    if ((listened & (ParticleEventType.PARTICLE_EVENT_TYPE_MASK_SPAWNED | ParticleEventType.PARTICLE_EVENT_TYPE_MASK_CULLED_ON_SPAWN)) === 0) {
      return;
    }

    this.dispatchSpawnEvent(first, count, ParticleEventType.PARTICLE_EVENT_TYPE_MASK_CULLED_ON_SPAWN, true);
    this.dispatchSpawnEvent(first, count, ParticleEventType.PARTICLE_EVENT_TYPE_MASK_SPAWNED, false);
  }

  private dispatchSpawnEvent(first: number, count: number, eventType: number, culled: boolean): void {
    this.eventIndices.length = 0;

    const current = this.particleCollection.currentSpan;

    for (let index = first; index < first + count; index++) {
      if (current.readFloat(ParticleField.LifeDuration, index) > 0 !== culled) {
        this.eventIndices.push(index);
      }
    }

    if (this.eventIndices.length > 0) {
      this.dispatchEvent(eventType, this.eventIndices);
    }
  }

  /** Hands the events the last function raised to the observer and the listening children, then removes the killed particles. */
  private applyKills(): void {
    this.dispatchPendingEvents();

    if (!this.particleCollection.hasKills) {
      return;
    }

    this.dispatchEvent(ParticleEventType.PARTICLE_EVENT_TYPE_MASK_KILLED, this.particleCollection.sortKills());
    this.removeKilledParticles();
  }

  private dispatchPendingEvents(): void {
    const pending = this.particleCollection.pendingEvents;

    while (pending.length > 0) {
      const eventType = pending[0].type;
      let kept = 0;
      this.eventIndices.length = 0;

      for (let i = 0; i < pending.length; i++) {
        const raised = pending[i];

        if (raised.type !== eventType) {
          pending[kept++] = raised;
        } else if (raised.index < this.particleCollection.count) {
          this.eventIndices.push(raised.index);
        }
      }

      pending.length = kept;

      if (this.eventIndices.length > 0) {
        this.dispatchEvent(eventType, this.eventIndices);
      }
    }
  }

  private dispatchEvent(eventType: number, indices: number[]): void {
    this.observer?.onParticleEvent?.(this.particleCollection, eventType, indices);

    if ((this.eventListenMask & eventType) === 0) {
      return;
    }

    for (const childSimulation of this.childSimulations) {
      childSimulation.emit(eventType, indices);
    }
  }

  /** Removes every particle at once, without raising events. */
  private killAllParticles(): void {
    this.particleCollection.pendingEvents.length = 0;
    this.particleCollection.clear();
    this.systemState.particleCount = this.particleCollection.count;

    this.rebindChildParents();
  }

  private removeKilledParticles(): void {
    this.particleCollection.pruneExpired();
    this.systemState.particleCount = this.particleCollection.count;

    this.rebindChildParents();
  }

  /** Points every child particle's parent index back at its parent particle after this system's particles moved. */
  private rebindChildParents(): void {
    let indexBuilt = false;

    for (const childSimulation of this.childSimulations) {
      const childParticles = childSimulation.particleCollection.currentSpan;

      // A child that stores no parent links has none to point back, and one that stores only one of them is skipped too
      if ((childSimulation.particleCollection.storedFields & PARENT_LINK_FIELDS) !== PARENT_LINK_FIELDS) {
        continue;
      }

      const parentIds = childParticles.integers(ParticleField.ParentParticleId);
      const parentIndices = childParticles.integers(ParticleField.ParentParticleIndex);

      for (let i = 0; i < parentIds.length; i++) {
        const parentId = parentIds[i];

        if (parentId === -2147483648) {
          continue;
        }

        if (!indexBuilt) {
          this.buildIndexById();
          indexBuilt = true;
        }

        const parentIndex = this.indexById.get(parentId);

        if (parentIndex !== undefined) {
          parentIndices[i] = parentIndex;
        } else {
          parentIds[i] = -2147483648;
        }
      }
    }
  }

  private buildIndexById(): void {
    const particleIds = this.particleCollection.currentSpan.integers(ParticleField.ParticleId);
    this.indexById.clear();

    for (let i = 0; i < particleIds.length; i++) {
      if (!this.indexById.has(particleIds[i])) {
        this.indexById.set(particleIds[i], i);
      }
    }
  }

  /**
   * Runs the constraints for BasicMovement once it has moved the particles: up to `maxPasses`
   * relaxation passes, in which a constraint runs again only after another one moved particles,
   * then each final constraint once.
   */
  runConstraints(particles: ParticleCollection, frameTime: number, maxPasses: number): void {
    if (this.constraints.length === 0 || particles.count === 0) {
      return;
    }

    const settled = new Array<boolean>(this.constraints.length).fill(false);

    for (let pass = 0; pass < maxPasses; pass++) {
      let changed = false;

      for (let i = 0; i < this.constraints.length; i++) {
        const constraint = this.constraints[i];

        if (settled[i] || constraint.isFinalConstraint) {
          continue;
        }

        settled[i] = true;

        const strength = constraint.getOperatorRunStrength(this.systemState);

        if (strength <= 0) {
          continue;
        }

        if (constraint.applyConstraint(particles, frameTime, this.systemState, strength)) {
          changed = true;

          for (let j = 0; j < this.constraints.length; j++) {
            if (j !== i) {
              settled[j] = false;
            }
          }
        }
      }

      if (!changed) {
        break;
      }
    }

    for (const constraint of this.constraints) {
      if (!constraint.isFinalConstraint) {
        continue;
      }

      const strength = constraint.getOperatorRunStrength(this.systemState);

      if (strength > 0) {
        constraint.applyConstraint(particles, frameTime, this.systemState, strength);
      }
    }
  }

  /** Whether the system is done: no particles in the tree, its clock started, no emitter can create more, every child finished. */
  isFinished(): boolean {
    if ((this.firstFramePending || this.systemState.age <= 0) && !this.finishedBeforeStartAllowed) {
      return false;
    }

    if (this.hasParticlesInTree()) {
      return false;
    }

    for (const emitter of this.emitters) {
      if (emitter.mayCreateMoreParticles(this.systemState)) {
        return false;
      }
    }

    for (const childSimulation of this.childSimulations) {
      if (childSimulation.isEndCapChild && !childSimulation.systemState.inEndCap) {
        continue;
      }

      if (!childSimulation.isFinished()) {
        return false;
      }
    }

    return true;
  }

  private hasParticlesInTree(): boolean {
    return this.particleCollection.count > 0 || this.childSimulations.some((child) => child.hasParticlesInTree());
  }

  private calculateBounds(): void {
    this.boundsComputed = true;

    if (this.infiniteBounds) {
      this.boundsValid = true;
      return;
    }

    let hasBounds = false;
    let min = Vector3.splat(FLOAT_MAX);
    let max = Vector3.splat(-FLOAT_MAX);

    if (this.particleCollection.count > 0) {
      const particles = this.particleCollection.currentSpan;
      const radii = particles.readFloats(ParticleField.Radius);
      const positions = particles.readVectors(ParticleField.Position);

      // Each particle grown by its radius
      for (let i = 0; i < particles.length; i++) {
        const radius = Vector3.splat(radii[i]);
        const position = new Vector3(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]);
        min = minV(min, position.sub(radius));
        max = maxV(max, position.add(radius));
      }

      min = min.add(this.particleBoundingBox.min);
      max = max.add(this.particleBoundingBox.max);
      hasBounds = true;
    }

    for (const childSimulation of this.childSimulations) {
      if (!childSimulation.boundsValid || childSimulation.infiniteBounds) {
        continue;
      }

      min = minV(min, childSimulation.bounds.min);
      max = maxV(max, childSimulation.bounds.max);
      hasBounds = true;
    }

    this.boundsValid = hasBounds;

    if (hasBounds) {
      this.bounds = { min, max };
    }
  }

  // Children

  /** Holds every direct child tagged with `groupId` before its start until a selection releases it. */
  holdChildrenInGroup(groupId: number): void {
    for (const child of this.childSimulations) {
      if (child.groupIdValue === groupId) {
        child.hold(true);
      }
    }
  }

  /**
   * Restarts `numberOfChildren` of the direct children tagged with `groupId`, rounded up, picked at
   * random, and stops the rest of the group with their particles removed.
   */
  chooseRandomChildrenInGroup(groupId: number, numberOfChildren: number): void {
    this.holdChildrenInGroup(groupId);

    const candidates = this.childSimulations.filter((child) => child.groupIdValue === groupId && child.systemState.age < 0);

    if (candidates.length !== 0 && numberOfChildren > 0) {
      let picked = 0;

      do {
        if (candidates.length !== 0) {
          const index = this.systemState.random.nextIndex(candidates.length);
          const child = candidates[index];

          child.systemState.age = 0;
          child.restart();
          candidates.splice(index, 1);
        }

        picked++;
      } while (numberOfChildren > picked);
    }

    for (const child of this.childSimulations) {
      if (child.groupIdValue === groupId && child.systemState.age === FLOAT_MIN_VALUE) {
        child.systemState.age = 0;
        child.stopEmission(true, false);
      }
    }
  }

  /** Appends the render states of the direct children tagged with `groupId`, in definition order. */
  collectChildStatesInGroup(groupId: number, destination: ParticleSystemState[]): void {
    for (const child of this.childSimulations) {
      if (child.groupIdValue === groupId) {
        destination.push(child.systemState);
      }
    }
  }

  /** Restarts every direct child tagged with `groupId`. */
  restartChildrenInGroup(groupId: number): void {
    for (const child of this.childSimulations) {
      if (child.groupIdValue === groupId) {
        child.restart();
      }
    }
  }

  /** Whether `state` belongs to a system tagged with `groupId`. */
  static isInGroup(state: ParticleSystemState, groupId: number): boolean {
    return state.data?.groupIdValue === groupId;
  }

  /** The group this system belongs to among its parent's children (m_nGroupID). */
  get groupId(): number {
    return this.groupIdValue;
  }

  /** Holds this child before its start until a group operator starts it again. */
  hold(finishedWhileHeld: boolean): void {
    if (finishedWhileHeld) {
      this.finishedBeforeStartAllowed = true;
    }

    this.systemState.age = FLOAT_MIN_VALUE;
  }

  private setupChildParticles(children: KVObject[]): void {
    this.childSlotCount = children.length;
    const placesControlPointsOnModels = this.operators.some((op) => op.className === 'C_OP_SetControlPointsToModelParticles');

    for (let slot = 0; slot < children.length; slot++) {
      const childInfo = children[slot];
      const parse = new ParticleDefinitionParser(childInfo, this.diagnostics, { value: 0n }, this.behaviorVersion);

      if (parse.boolean('m_bDisableChild', false)) {
        continue;
      }

      const childName = getString(childInfo, 'm_ChildRef') ?? '';
      const childResource = this.source.loadSystem(childName);

      if (childResource === null) {
        this.diagnostics.warn(`Child system ${childName} could not be loaded`, this.name);
        continue;
      }

      if (this.isSelfOrAncestor(childResource.name)) {
        this.diagnostics.warn(`Skipped child ${childName}, because it is that system or one of its parents`, this.name);
        continue;
      }

      const delay = parse.float('m_flDelay', 0);

      const childSystem = new ParticleSystemSimulation(childResource, this.source, {
        diagnostics: this.diagnostics,
        parentSystemState: this.systemState,
      });

      childSystem.startDelay = delay === 0 && placesControlPointsOnModels ? FLOAT_EPSILON : delay;
      childSystem.isEndCapChild = parse.boolean('m_bEndCap', false);
      childSystem.detailLevel = parse.enum('m_nDetailLevel', ParticleDetailLevel, ParticleDetailLevel.PARTICLEDETAIL_LOW);
      childSystem.systemState.age = childSystem.isEndCapChild ? FLOAT_MIN_VALUE : -childSystem.startDelay;
      childSystem.childSlot = slot;

      this.childSimulations.push(childSystem);
    }
  }

  private isSelfOrAncestor(fileName: string): boolean {
    for (let state: ParticleSystemState | null = this.systemState; state !== null; state = state.parentSystem) {
      if (state.data !== null && state.data.name.toLowerCase() === fileName.toLowerCase()) {
        return true;
      }
    }

    return false;
  }

  /** Whether this child is currently allowed to run under `parentState`: started, and its detail tier active. */
  shouldRunAsChildOf(parentState: ParticleSystemState): boolean {
    return this.detailLevel <= parentState.detailLevel && this.systemState.age >= 0;
  }

  // Storage

  /** Gathers what the functions write and read, then lays out the particle storage for it. */
  private declareFunctionFields(): void {
    for (const fn of this.functions) {
      this.addFunctionFields(fn, fn instanceof ParticleFunctionEmitter || fn instanceof ParticleFunctionInitializer);
    }

    this.updateStorage();
  }

  /** Adds what a renderer drawing this system writes, reads as initial, and blends, and lays out the storage again. */
  addRendererFields(writtenFields: bigint, initialReads: bigint, blendedFields: bigint): void {
    this.initializedFields |= writtenFields;
    this.updatedFields |= writtenFields;
    this.rendererInitialReads |= initialReads;
    this.particleCollection.addBlendedFields(blendedFields);

    this.updateStorage();
  }

  private addFunctionFields(fn: ParticleFunction, initializes: boolean): void {
    const written = fn.storedFields;

    if (initializes) {
      this.initializedFields |= written;
    } else {
      this.updatedFields |= written;
    }

    this.initializedFields |= fn.initialWrittenFields;
    this.updatedFields |= fn.liveWrittenFields;
  }

  /**
   * Stores what is written. The initial particles keep a copy of what is written both at creation
   * and later and read as initial, share the current arrays for what is only written at creation,
   * and read the constant for the rest.
   */
  private updateStorage(): void {
    const readInitial = this.initialReads.value | this.rendererInitialReads;
    const stored = this.initializedFields | this.updatedFields;
    const initialStored = this.updatedFields & this.initializedFields & readInitial;
    const initialShared = readInitial & this.initializedFields & ~this.updatedFields;

    this.particleCollection.setStorage(stored, initialStored, initialShared);
  }

  /** Whether the system stores `field` per particle. */
  /** Adds the control points this system and its children read whose use implies a nonzero preview value. */
  addControlPointDefaults(defaults: ControlPointDefaults): void {
    for (const fn of this.functions) {
      fn.addControlPointDefaults(defaults);
    }

    for (const childSimulation of this.childSimulations) {
      childSimulation.addControlPointDefaults(defaults);
    }
  }

  storesField(field: number): boolean {
    return maskContains(this.particleCollection.storedFields, field);
  }

  // Snapshots

  /** Binds the authored (or runtime) snapshot to its control point on this system and every child. */
  private publishSnapshot(parse: ParticleDefinitionParser, runtimeSnapshot: ParticleSnapshot | null): void {
    const controlPoint = parse.int32('m_nSnapshotControlPoint', 0);
    const loader = this.source.loadSnapshot ? (path: string) => this.source.loadSnapshot!(path) : null;
    const snapshot = runtimeSnapshot ?? SnapshotBinding.loadAuthored(parse, loader);

    if (snapshot !== null) {
      this.systemState.setControlPointSnapshot(controlPoint, snapshot);
    } else if (isCollection(parse.data) && (getString(parse.data, 'm_hSnapshot') ?? '') !== '') {
      this.diagnostics.report('unsupported-input', `Snapshot ${getString(parse.data, 'm_hSnapshot')} is not available`, this.name);
    }
  }

  /** Replaces the control point's snapshot with one built at runtime, on this system and every child. */
  setControlPointSnapshot(controlPoint: number, snapshot: ParticleSnapshot): void {
    this.systemState.setControlPointSnapshot(controlPoint, snapshot);
  }
}

/** The seed of the m_Children entry in `slot`, stepped from its parent's. */
function childSeed(seed: number, slot: number): number {
  return (seed + Math.imul(129, slot + 1)) | 0;
}
