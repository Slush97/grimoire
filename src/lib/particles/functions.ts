// Ported from ValveResourceFormat (MIT): ValveResourceFormat/Particles/ParticleFunction.cs,
// Emitters/ParticleFunctionEmitter.cs, Initializers/ParticleFunctionInitializer.cs,
// Operators/ParticleFunctionOperator.cs, PreEmissionOperators/ParticleFunctionPreEmissionOperator.cs,
// ForceGenerators/ParticleFunctionForceGenerator.cs and Constraints/ParticleFunctionConstraint.cs.
//
// Every ported function class extends one of the kind bases here. See operators/decay.ts for the
// pattern a port follows.

import type { ParticleCollection } from './collection';
import type { ParticleDiagnostics } from './diagnostics';
import { ParticleEndCapMode, ParticleEventType, ParticleField } from './enums';
import { fieldMask, readsInitialValue } from './fields';
import { Vector3, alignUp, f32, remap } from './numerics';
import { LiteralNumberProvider, type NumberProvider } from './numberProviders';
import type { ParticleDefinitionParser } from './parser';
import type { ParticleSpan } from './span';
import type { ParticleSystemState } from './state';
import type { ParticleSystemSimulation } from './simulation';
import { ParticleRandom } from './utils/random';

/** The control points a function reads whose use implies a nonzero preview value (see controlPointDefaults.ts). */
export interface ControlPointDefaults {
  addColor(controlPoint: number): void;
  addScale(controlPoint: number, component?: number): void;
  addField(controlPoint: number, field: number, component?: number): void;
  add(controlPoint: number, value: Vector3): void;
}

export abstract class ParticleFunction {
  /** The Source 2 class name the function was created from, set by the system that created it. */
  className = '';

  private readonly opStrengthInput: NumberProvider;
  private readonly opEndCapState: number;
  readonly opStartFadeInTime: number;
  readonly opEndFadeInTime: number;
  readonly opStartFadeOutTime: number;
  readonly opEndFadeOutTime: number;
  readonly opFadeOscillatePeriod: number;
  private readonly normalizeToStopTime: boolean;
  private readonly opTimeOffsetMin: number;
  private readonly opTimeOffsetMax: number;
  // Seeds drawing a per-instance offset and scale of the time the fade curve reads; 0 disables each
  private readonly opTimeOffsetSeed: number;
  private readonly opTimeScaleSeed: number;
  private readonly opTimeScaleMin: number;
  private readonly opTimeScaleMax: number;

  /** Every field feeding the fade curve is at its default, so the curve is always 1. */
  private readonly fadeCurveIsUnity: boolean;

  /** The curve is unity and the strength is a literal 1, so the whole evaluation folds away. */
  private readonly strengthFastPath: boolean;

  protected readonly logger: ParticleDiagnostics;

  constructor(parse: ParticleDefinitionParser) {
    this.logger = parse.logger;
    this.opStrengthInput = parse.numberProvider('m_flOpStrength', new LiteralNumberProvider(1));
    this.opEndCapState = parse.enum('m_nOpEndCapState', ParticleEndCapMode, ParticleEndCapMode.PARTICLE_ENDCAP_ALWAYS_ON);
    this.opStartFadeInTime = parse.float('m_flOpStartFadeInTime');
    this.opEndFadeInTime = parse.float('m_flOpEndFadeInTime');
    this.opStartFadeOutTime = parse.float('m_flOpStartFadeOutTime');
    this.opEndFadeOutTime = parse.float('m_flOpEndFadeOutTime');
    this.opFadeOscillatePeriod = parse.float('m_flOpFadeOscillatePeriod');
    this.opTimeOffsetMin = parse.float('m_flOpTimeOffsetMin', 0);
    this.opTimeOffsetMax = parse.float('m_flOpTimeOffsetMax', 0);
    this.opTimeScaleMin = parse.float('m_flOpTimeScaleMin', 1);
    this.opTimeScaleMax = parse.float('m_flOpTimeScaleMax', 1);
    this.normalizeToStopTime = parse.boolean('m_bNormalizeToStopTime');
    this.opTimeOffsetSeed = parse.int32('m_nOpTimeOffsetSeed', 0);
    this.opTimeScaleSeed = parse.int32('m_nOpTimeScaleSeed', 0);

    this.fadeCurveIsUnity =
      this.opStartFadeInTime === 0 &&
      this.opEndFadeInTime === 0 &&
      this.opStartFadeOutTime === 0 &&
      this.opEndFadeOutTime === 0 &&
      (this.opTimeOffsetSeed === 0 || (this.opTimeOffsetMin === 0 && this.opTimeOffsetMax === 0)) &&
      (this.opTimeScaleSeed === 0 || (this.opTimeScaleMin === 1 && this.opTimeScaleMax === 1));

    this.strengthFastPath =
      this.fadeCurveIsUnity &&
      this.opEndCapState === ParticleEndCapMode.PARTICLE_ENDCAP_ALWAYS_ON &&
      this.opStrengthInput instanceof LiteralNumberProvider &&
      this.opStrengthInput.value === 1;
  }

  /** Whether the authored m_nOpEndCapState lets the function run in the phase the system is in. */
  runsInCurrentPhase(state: ParticleSystemState): boolean {
    return (
      this.opEndCapState === ParticleEndCapMode.PARTICLE_ENDCAP_ALWAYS_ON ||
      state.inEndCap === (this.opEndCapState === ParticleEndCapMode.PARTICLE_ENDCAP_ENDCAP_ON)
    );
  }

  /** Whether removing particles must keep the survivors in order while this function is part of the system. */
  get isOrderImportant(): boolean {
    return false;
  }

  /** The mask of the attributes this function writes, which the system must therefore store. */
  get storedFields(): bigint {
    return 0n;
  }

  /** The mask of the attributes whose initial value this function overwrites. */
  get initialWrittenFields(): bigint {
    return 0n;
  }

  /** The mask of the attributes an emitter or initializer also rewrites on particles created earlier. */
  get liveWrittenFields(): bigint {
    return 0n;
  }

  /** Builds the per-instance running state the function starts with. */
  reset(): void {}

  /** Builds the running state when the system is created or replayed; reset unless overridden. */
  initialize(_state: ParticleSystemState): void {
    this.reset();
  }

  /** Called when the system restarts without being destroyed; keeps the running state unless overridden. */
  restart(_state: ParticleSystemState): void {}

  addControlPointDefaults(_defaults: ControlPointDefaults): void {}

  /** Whether the fade window has closed for good, past m_flOpEndFadeOutTime. */
  protected isPastFadeOut(state: ParticleSystemState): boolean {
    return this.opFadeOscillatePeriod === 0 && this.opEndFadeOutTime > 0 && this.getFunctionTime(state) > this.opEndFadeOutTime;
  }

  /** CheckIfOperatorShouldRun: the strength the function runs at this step, 0 to skip it. */
  getOperatorRunStrength(state: ParticleSystemState): number {
    if (this.strengthFastPath) {
      return 1;
    }

    if (!this.runsInCurrentPhase(state)) {
      return 0;
    }

    const opStrength = this.opStrengthInput.nextNumber(state);

    if (this.fadeCurveIsUnity || opStrength <= 0) {
      return opStrength;
    }

    const strength = fadeInOut(this.opStartFadeInTime, this.opEndFadeInTime, this.opStartFadeOutTime, this.opEndFadeOutTime, this.getFunctionTime(state));

    return f32(Math.max(0, opStrength) * strength);
  }

  /** The time the fade window is measured against. */
  protected getFunctionTime(state: ParticleSystemState): number {
    if (this.opFadeOscillatePeriod > 0) {
      return f32(f32(f32(1 / this.opFadeOscillatePeriod) * state.age) % 1);
    }

    let time = Math.max(0, f32(state.age - state.operatorTimeBase));

    if (this.normalizeToStopTime && this.opEndCapState === ParticleEndCapMode.PARTICLE_ENDCAP_ENDCAP_ON) {
      time = Math.max(0, f32(time - state.endCapStartAge));
    }

    if (this.opTimeOffsetSeed !== 0) {
      time = f32(time + ParticleRandom.forSampleBetween((state.random.seed + this.opTimeOffsetSeed) | 0, this.opTimeOffsetMin, this.opTimeOffsetMax));
      time = Math.max(0, time);
    }

    if (this.opTimeScaleSeed !== 0 && time > this.opStartFadeInTime) {
      const timeScale = f32(1 / Math.max(f32(0.0001), ParticleRandom.forSampleBetween((state.random.seed + this.opTimeScaleSeed) | 0, this.opTimeScaleMin, this.opTimeScaleMax)));
      time = f32(this.opStartFadeInTime + f32(timeScale * f32(time - this.opStartFadeInTime)));
    }

    return time;
  }
}

function fadeInOut(fadeInStart: number, fadeInEnd: number, fadeOutStart: number, fadeOutEnd: number, time: number): number {
  if (fadeInStart > time) {
    return 0;
  }

  if (fadeOutEnd > 0 && fadeOutEnd < time) {
    return 0;
  }

  // Handle out of order cases
  fadeInEnd = Math.max(fadeInEnd, fadeInStart);
  fadeOutStart = Math.max(fadeOutStart, fadeInEnd);
  fadeOutEnd = Math.max(fadeOutEnd, fadeOutStart);

  let strength = 1;

  if (fadeInEnd > time && fadeInEnd > fadeInStart) {
    strength = Math.min(strength, remap(time, fadeInStart, fadeInEnd));
  }

  if (time > fadeOutStart && fadeOutEnd > fadeOutStart) {
    strength = Math.min(strength, remap(time, fadeOutEnd, fadeOutStart));
  }

  return strength;
}

/** Creates a particle at the given creation time. */
export type EmitCallback = (creationTime: number) => void;

/** Spawns new particles into a system over time. */
export abstract class ParticleFunctionEmitter extends ParticleFunction {
  /** The emitter's position in the system's emitter list, which initializers bind to. */
  emitterIndex = 0;

  /** The parent particle events this emitter spawns from, or none for an emitter that runs every step. */
  get eventTypeMask(): number {
    return ParticleEventType.PARTICLE_EVENT_TYPE_MASK_NONE;
  }

  get storedFields(): bigint {
    return fieldMask(ParticleField.CreationTime);
  }

  abstract reset(): void;

  /** Lets the emitter emit again, at the age of the system. */
  abstract startEmission(state: ParticleSystemState): void;

  abstract stopEmission(): void;

  /** Whether the emitter can still create particles. */
  abstract mayCreateMoreParticles(state: ParticleSystemState): boolean;

  /** Runs one step of emission, calling `emit` with each particle's creation time. */
  abstract emit(state: ParticleSystemState, strength: number, emit: EmitCallback): void;

  /** Called after the system jumped forward to `time`, so the emitter can simulate the span it skipped. */
  skipToTime(_time: number, _simulation: ParticleSystemSimulation): void {}

  /** How many more particles the system has room for. */
  protected static freeSlots(state: ParticleSystemState): number {
    const simulation = state.data;
    return simulation !== null ? simulation.particleCapacity - simulation.particles.count : 0;
  }
}

/** Runs once when particles are created, setting their initial attribute values. */
export abstract class ParticleFunctionInitializer extends ParticleFunction {
  /** The only emitter whose particles this initializer runs on, or -1 for every emitter and the initial ones. */
  readonly associatedEmitterIndex: number;

  /** Position in the definition's initializer list, counting dropped entries. */
  definitionIndex = -1;

  /** Whether the initializer declares a random float input, which advances the particle id counter. */
  hasRandomInput = false;

  constructor(parse: ParticleDefinitionParser) {
    super(parse);
    this.associatedEmitterIndex = parse.int32('m_nAssociatedEmitterIndex', -1);
  }

  /**
   * Runs the initializer over the particles one emission created, in the calls splitIntoCalls gives,
   * each with its inputs evaluated afresh.
   */
  initializeParticles(batch: ParticleSpan, particles: ParticleCollection, state: ParticleSystemState): void {
    const [head, blocks, tail] = splitIntoCalls(batch);

    state.initializerBatchEnd = batch.start + batch.length;

    const headRun = batch.range(head[0], head[1]);

    if (!headRun.isEmpty) {
      beginCall(headRun, state);
      this.initializeCall(headRun, particles, state);
    }

    const blockRun = batch.range(blocks[0], blocks[1]);

    if (!blockRun.isEmpty) {
      beginCall(blockRun, state);
      this.initializeBlocks(blockRun, particles, state);
    }

    const tailRun = batch.range(tail[0], tail[1]);

    if (!tailRun.isEmpty) {
      beginCall(tailRun, state);
      this.initializeCall(tailRun, particles, state);
    }

    state.initializerBatchEnd = 0;
    state.initializerRunEnd = 0;
  }

  /** Initializes the particles of `run`, which is never empty, as a single call. */
  protected abstract initializeCall(run: ParticleSpan, particles: ParticleCollection, state: ParticleSystemState): void;

  /** Initializes the whole blocks of four of a batch of 16 or more particles as a single call. */
  protected initializeBlocks(run: ParticleSpan, particles: ParticleCollection, state: ParticleSystemState): void {
    this.initializeCall(run, particles, state);
  }

  /** Whether the initializer takes part in initializing the particles being created now. */
  shouldRun(_state: ParticleSystemState): boolean {
    return true;
  }

  /** Whether `field` is still unwritten for the particles being initialized. */
  protected static isUnwritten(state: ParticleSystemState, field: number): boolean {
    return (state.initializedFields & fieldMask(field)) === 0n;
  }

  /** The float `field` of `run` while it is still unwritten, or null when a function before this one wrote it. */
  protected static unwrittenFloats(run: ParticleSpan, state: ParticleSystemState, field: number): Float32Array | null {
    return ParticleFunctionInitializer.isUnwritten(state, field) ? run.floats(field) : null;
  }

  protected static unwrittenIntegers(run: ParticleSpan, state: ParticleSystemState, field: number): Int32Array | null {
    return ParticleFunctionInitializer.isUnwritten(state, field) ? run.integers(field) : null;
  }

  protected static unwrittenVectors(run: ParticleSpan, state: ParticleSystemState, field: number): Float32Array | null {
    return ParticleFunctionInitializer.isUnwritten(state, field) ? run.vectors(field) : null;
  }

  /** The previous positions a creator places along with the positions, or null when already written. */
  protected static spawnPreviousPositions(run: ParticleSpan, state: ParticleSystemState): Float32Array | null {
    return ParticleFunctionInitializer.unwrittenVectors(run, state, ParticleField.PositionPrevious);
  }

  /** How far back to move a new particle's previous position to give it `velocity`. */
  protected static velocityStep(state: ParticleSystemState, velocity: Vector3, perStep: boolean): Vector3 {
    return perStep ? velocity : velocity.scale(state.previousStep);
  }

  /** The mask of the attributes this initializer declares it writes. */
  abstract get writtenFields(): bigint;

  get storedFields(): bigint {
    return this.writtenFields;
  }
}

function beginCall(run: ParticleSpan, state: ParticleSystemState): void {
  state.random.beginFunctionCall();
  state.initializerRunEnd = run.start + run.length;
}

/**
 * Splits a batch into the runs the particles are initialized in, as offset ranges: the whole batch
 * below 16 particles, else the particles before the first collection index that is a multiple of
 * four, the whole blocks of four from there, and the rest.
 */
function splitIntoCalls(batch: ParticleSpan): [[number, number], [number, number], [number, number]] {
  if (batch.length < 16) {
    return [[0, batch.length], [batch.length, batch.length], [batch.length, batch.length]];
  }

  const first = batch.start;
  const blocksStart = alignUp(first, 4) - first;
  const blocksEnd = ((first + batch.length) & ~3) - first;

  return [[0, blocksStart], [blocksStart, blocksEnd], [blocksEnd, batch.length]];
}

/** Runs each simulation step to modify particle attributes. */
export abstract class ParticleFunctionOperator extends ParticleFunction {
  /** Updates the particles for a step of `frameTime` seconds, at `strength`. */
  abstract operate(particles: ParticleCollection, frameTime: number, state: ParticleSystemState, strength: number): void;

  /** Moves `current` toward `value` by `strength`; 1 or more gives `value` itself. */
  protected static blendByStrength(current: number, value: number, strength: number): number {
    return strength >= 1 ? value : f32(f32(value * strength) + f32(current * f32(1 - strength)));
  }

  protected static blendByStrengthV(current: Vector3, value: Vector3, strength: number): Vector3 {
    return strength >= 1 ? value : value.scale(strength).add(current.scale(f32(1 - strength)));
  }

  /** Records the initial value read of an operator writing `field` by `method`. */
  protected static addInitialReadOf(parse: ParticleDefinitionParser, method: number, field: number): void {
    if (readsInitialValue(method)) {
      parse.addInitialRead(field);
    }
  }

  /** Kills a culled particle, raising the killed on cull event for the children that listen for it. */
  protected static killCulled(particles: ParticleCollection, index: number, state: ParticleSystemState): void {
    particles.kill(index);

    if (state.listensFor(ParticleEventType.PARTICLE_EVENT_TYPE_MASK_KILLED_ON_CULL)) {
      particles.raiseEvent(index, ParticleEventType.PARTICLE_EVENT_TYPE_MASK_KILLED_ON_CULL);
    }
  }
}

/** Runs once per step before particles are emitted, acting on the system state. */
export abstract class ParticleFunctionPreEmissionOperator extends ParticleFunction {
  /** Whether this operator runs only in the system's first frame. */
  readonly runOnce: boolean;

  constructor(parse: ParticleDefinitionParser) {
    super(parse);
    this.runOnce = parse.boolean('m_bRunOnce', false);
  }

  abstract operate(state: ParticleSystemState, frameTime: number, strength: number): void;
}

/** Accumulates an acceleration per particle for BasicMovement to integrate. */
export abstract class ParticleFunctionForceGenerator extends ParticleFunction {
  /** The gravity of the C_OP_BasicMovement running this generator, set before every call. */
  movementGravity = Vector3.zero;

  /** Adds this generator's acceleration for each particle to `forces` (three floats each). */
  abstract generateForces(particles: ParticleCollection, forces: Float32Array, frameTime: number, state: ParticleSystemState, strength: number): void;
}

/** Relaxes particle positions after BasicMovement's integration. */
export abstract class ParticleFunctionConstraint extends ParticleFunction {
  /** Whether the constraint runs once after the relaxation passes of the others. */
  get isFinalConstraint(): boolean {
    return false;
  }

  /** Applies one relaxation pass; true when it may have moved particles. */
  abstract applyConstraint(particles: ParticleCollection, frameTime: number, state: ParticleSystemState, strength: number): boolean;
}
