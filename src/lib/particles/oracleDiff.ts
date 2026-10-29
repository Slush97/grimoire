// Runs the particle runtime the way tools/particle-oracle runs ValveResourceFormat, and compares the
// two per system, per field and per frame. Shared by scripts/particle-diff.ts and the fixture test.

import { readVector } from './buffer';
import { ParticleField } from './enums';
import type { KVObject } from './kv';
import { ParticleModel, type ParticleModelObject, type SerializedParticleModel, createTranslation } from './model';
import { Matrix4x4, Quaternion, Vector3, degreesToRadians, f32 } from './numerics';
import { type LoadedParticleSystem, type ParticleDefinitionSource, ParticleSystemSimulation } from './simulation';
import { type SerializedSnapshot, deserializeSnapshot } from './snapshotResource';
import { quaternionNormalize } from './utils/quaternionMath';
import type { ParticleSnapshot } from './utils/snapshotBinding';

/** The vector, float and integer fields the oracle dumps, in its order. */
export const ORACLE_VECTOR_FIELDS = [
  'Position', 'PositionPrevious', 'Color', 'Normal', 'HitboxOffsetPosition', 'ScratchVector',
  'GlowRgb', 'ScratchVector2', 'BoneWeights', 'BoxMins', 'BoxMaxs', 'BoxAngles', 'RopeSegmentData',
] as const;
export const ORACLE_SCALAR_FIELDS = [
  'LifeDuration',
  'Radius',
  'Roll',
  'RollSpeed',
  'Alpha',
  'CreationTime',
  'SequenceNumber',
  'TrailLength',
  'Yaw',
  'Pitch',
  'AlphaAlternate',
  'ScratchFloat',
  'SecondSequenceNumber',
  'GlowAlpha',
  'ScratchFloat1',
  'ScratchFloat2',
  'ForceScale',
  'ManualAnimationFrame',
  'ShaderExtraData1',
  'ShaderExtraData2',
] as const;
export const ORACLE_INTEGER_FIELDS = ['ParticleId'] as const;

export type OracleField = (typeof ORACLE_VECTOR_FIELDS)[number] | (typeof ORACLE_SCALAR_FIELDS)[number] | (typeof ORACLE_INTEGER_FIELDS)[number];

/** One system of the tree in one frame, as the oracle writes it. */
export interface OracleSystem {
  path: string;
  name: string;
  count: number;
  [field: string]: number[] | string | number;
}

/** A control point write the oracle made before a frame's update. */
export interface ControlPointInput {
  kind: 'position' | 'orientation';
  cp: number;
  value: [number, number, number];
}

export interface OracleFrame {
  t: number;
  /** The control point writes made before the update, when the run moves control points. */
  inputs?: ControlPointInput[];
  /** The bound model's placement and bone motions this frame, when the run binds a model. */
  model?: { transform: number[]; even: number[]; odd: number[] };
  systems: OracleSystem[];
}

/** A model as the oracle describes the one it bound (VRF's Model, read for the model functions). */
export interface OracleModel extends SerializedParticleModel {
  path: string;
  controlPoint: number;
  motion: boolean;
  move: [number, number, number];
  /** Every bone's bind pose in model space; the fixtures leave it out. */
  bindPose?: number[][];
}

/** A snapshot as the oracle dumps it: every attribute in stored order with its rows. */
export interface OracleSnapshot {
  path: string;
  snapshot: string;
  numParticles: number;
  columns: { name: string; type: string; values: (number | string | { jointNames: string[]; weights: number[] })[] }[];
}

/** The oracle's output: every frame of every system in the tree. */
export interface OracleRun {
  system: string;
  dt: number;
  /** The stored KV3 format of each system of the tree, by path. */
  formats?: Record<string, string>;
  /** Every snapshot the tree loaded, as VRF read it. */
  snapshots?: OracleSnapshot[];
  /** The model bound to a control point, as VRF read it. */
  model?: OracleModel;
  frames: OracleFrame[];
}

export interface RunOptions {
  frames: number;
  dt: number;
  /** Seeds the tree as the oracle's --seed does; omitted, the root seeds from its name. */
  seed?: number;
  /** Control point positions set before the system starts, as the oracle's --cp. */
  controlPoints?: { cp: number; position: [number, number, number] }[];
  /** Control points moved from their start at a constant velocity before every update, as the oracle's --cp-move. */
  moves?: { cp: number; velocity: [number, number, number] }[];
  /** Control points whose forward axis turns about +Z before every update, as the oracle's --cp-spin. */
  spins?: { cp: number; degreesPerSecond: number }[];
  /** Stops emission and plays the end cap before updating this zero-based frame. */
  stopFrame?: number;
  /**
   * The exact control point writes of each frame, replayed in place of moves and spins. The oracle
   * records them because .NET's MathF.Cos and MathF.Sin are not always correctly rounded, so
   * recomputing a spin here can differ from the oracle's input by an ulp.
   */
  frameInputs?: (ControlPointInput[] | undefined)[];
  /** A model to bind to a control point, posed as the oracle's --model-move and --model-motion pose it. */
  model?: OracleModel;
}

/** The resource file name VRF reports for a definition path. */
export function resourceName(path: string): string {
  return path.endsWith('_c') ? path : `${path}_c`;
}

/**
 * A definition source over an in-memory table of decoded definitions by path, with the stored
 * formats taken from an oracle run (by resource name).
 */
export function tableSource(definitions: Record<string, KVObject>, formatsByName: Record<string, string>, snapshots: Record<string, ParticleSnapshot> = {}): ParticleDefinitionSource {
  return {
    loadSnapshot(path: string): ParticleSnapshot | null {
      return snapshots[path.replace(/_c$/, '')] ?? null;
    },
    loadSystem(path: string): LoadedParticleSystem | null {
      const data = definitions[path.replace(/_c$/, '')];

      if (data === undefined) {
        return null;
      }

      const name = resourceName(path);
      return { name, data, format: formatsByName[name] ?? null };
    },
  };
}

/** The stored format of each system the oracle ran, by resource name. */
export function formatsByName(oracle: OracleRun): Record<string, string> {
  const formats: Record<string, string> = {};
  const first = oracle.frames[0];

  if (oracle.formats === undefined || first === undefined) {
    return formats;
  }

  for (const system of first.systems) {
    const format = oracle.formats[system.path];

    if (format !== undefined) {
      formats[system.name] = format;
    }
  }

  return formats;
}

/** Runs `rootPath` for `options.frames` frames and dumps it as the oracle does. */
export function runRuntime(
  rootPath: string,
  source: ParticleDefinitionSource,
  options: RunOptions,
): { run: OracleRun; simulation: ParticleSystemSimulation } {
  const loaded = source.loadSystem(rootPath);

  if (loaded === null) {
    throw new Error(`Particle system not found: ${rootPath}`);
  }

  const simulation = new ParticleSystemSimulation(loaded, source);

  if (options.seed !== undefined) {
    simulation.seedRandom(options.seed);
  }

  const modelObject = options.model === undefined ? null : new ReplayModelObject(modelFromOracle(options.model));

  if (modelObject !== null) {
    simulation.getControlPoint(options.model!.controlPoint).modelObject = modelObject;
  }

  for (const { cp, position } of options.controlPoints ?? []) {
    simulation.renderState.setControlPointValue(cp, new Vector3(position[0], position[1], position[2]));
  }

  simulation.start();

  const dt = f32(options.dt);
  const frames: OracleFrame[] = [];
  let time = 0;

  for (let frame = 0; frame < options.frames; frame++) {
    const inputs = options.frameInputs?.[frame] ?? computedInputs(options, time);

    for (const { kind, cp, value } of inputs) {
      const vector = new Vector3(value[0], value[1], value[2]);

      if (kind === 'position') {
        simulation.renderState.setControlPointValue(cp, vector);
      } else {
        simulation.renderState.setControlPointOrientation(cp, vector);
      }
    }

    if (modelObject !== null) {
      const move = options.model!.move;
      modelObject.transform = createTranslation(new Vector3(move[0], move[1], move[2]).scale(time));
      [modelObject.evenMotion, modelObject.oddMotion] = options.model!.motion ? modelMotionAt(frame) : [Matrix4x4.identity(), Matrix4x4.identity()];
    }

    if (frame === options.stopFrame) {
      simulation.playEndCap();
    }

    simulation.update(dt, time);
    time = f32(time + dt);
    frames.push({ t: time, systems: dumpTree(simulation, '0') });
  }

  return { run: { system: rootPath, dt, frames }, simulation };
}

/** The writes the oracle's --cp-move and --cp-spin make before the update at `time`. */
function computedInputs(options: RunOptions, time: number): ControlPointInput[] {
  const inputs: ControlPointInput[] = [];

  for (const { cp, velocity } of options.moves ?? []) {
    const start = options.controlPoints?.filter((point) => point.cp === cp).at(-1)?.position ?? [0, 0, 0];
    const position = new Vector3(start[0], start[1], start[2]).add(new Vector3(velocity[0], velocity[1], velocity[2]).scale(time));
    inputs.push({ kind: 'position', cp, value: [position.x, position.y, position.z] });
  }

  for (const { cp, degreesPerSecond } of options.spins ?? []) {
    const angle = degreesToRadians(f32(f32(degreesPerSecond) * time));
    inputs.push({ kind: 'orientation', cp, value: [f32(Math.cos(angle)), f32(Math.sin(angle)), 0] });
  }

  return inputs;
}

/** The model the oracle describes, rebuilt for the runtime. */
export function modelFromOracle(description: OracleModel): ParticleModel {
  return ParticleModel.deserialize(description);
}

/** A model as a fixture stores it: the bones as parallel arrays, without the bind pose the runtime recomputes. */
export interface CompactOracleModel extends Omit<OracleModel, 'bones' | 'bindPose'> {
  boneNames: string[];
  boneParents: number[];
  /** x, y, z per bone. */
  bonePositions: number[];
  /** x, y, z, w per bone. */
  boneRotations: number[];
}

export function compactModel(model: OracleModel): CompactOracleModel {
  const { bones, bindPose: _bindPose, ...rest } = model;
  return {
    ...rest,
    boneNames: bones.map((bone) => bone.name),
    boneParents: bones.map((bone) => bone.parent),
    bonePositions: bones.flatMap((bone) => [...bone.position]),
    boneRotations: bones.flatMap((bone) => [...bone.rotation]),
  };
}

export function expandModel(model: CompactOracleModel): OracleModel {
  const { boneNames, boneParents, bonePositions, boneRotations, ...rest } = model;
  return {
    ...rest,
    bones: boneNames.map((name, i) => ({
      name,
      parent: boneParents[i],
      position: bonePositions.slice(i * 3, i * 3 + 3),
      rotation: boneRotations.slice(i * 4, i * 4 + 4),
    })),
  };
}

/** A snapshot the oracle dumped, rebuilt for the runtime. */
export function snapshotFromOracle(snapshot: OracleSnapshot): ParticleSnapshot {
  const serialized: SerializedSnapshot = {
    numParticles: snapshot.numParticles,
    columns: snapshot.columns.map(({ name, type, values }) => ({
      name,
      type,
      kind: type === 'skinning' ? 'skinning' : type === 'string' || type === 'bone' ? 'string' : type === 'float3' || type === 'vector' ? 'vector' : type === 'int' ? 'int' : 'float',
      values: values as number[],
    })),
  };
  return deserializeSnapshot(serialized);
}

/** The oracle's ModelMotion.At: the even and odd bone motions of --model-motion at a frame. */
export function modelMotionAt(frame: number): [Matrix4x4, Matrix4x4] {
  const s = f32((frame % 64) / 64);
  const motion = (q: Quaternion, t: Vector3) => Matrix4x4.fromQuaternion(quaternionNormalize(q)).multiply(createTranslation(t));
  return [
    motion(new Quaternion(f32(f32(0.1) * s), f32(f32(0.05) * s), f32(f32(0.2) * s), 1), new Vector3(3 * s, -2 * s, s)),
    motion(new Quaternion(f32(f32(-0.15) * s), f32(f32(0.1) * s), f32(f32(0.05) * s), 1), new Vector3(-s, 2 * s, 4 * s)),
  ];
}

/** The oracle's OracleModelObject: every bone's bind pose followed by the even or odd motion. */
class ReplayModelObject implements ParticleModelObject {
  readonly model: ParticleModel;
  transform = Matrix4x4.identity();
  evenMotion = Matrix4x4.identity();
  oddMotion = Matrix4x4.identity();
  readonly sequenceIndex = -1;
  readonly sequenceRate = 1;

  constructor(model: ParticleModel) {
    this.model = model;
  }

  getBonePose(bones: Matrix4x4[]): void {
    this.model.getBindPose(bones);

    for (let i = 0; i < bones.length; i++) {
      bones[i] = bones[i].multiply((i & 1) === 0 ? this.evenMotion : this.oddMotion);
    }
  }
}

function dumpTree(system: ParticleSystemSimulation, path: string, out: OracleSystem[] = []): OracleSystem[] {
  const particles = system.particles.currentSpan;
  const dump: OracleSystem = { path, name: system.name, count: particles.length };

  for (const field of ORACLE_VECTOR_FIELDS) {
    const values = particles.readVectors(ParticleField[field]);
    const list: number[] = [];

    for (let i = 0; i < particles.length; i++) {
      const v = readVector(values, i);
      list.push(v.x, v.y, v.z);
    }

    dump[field] = list;
  }

  for (const field of ORACLE_SCALAR_FIELDS) {
    dump[field] = Array.from(particles.readFloats(ParticleField[field]));
  }

  for (const field of ORACLE_INTEGER_FIELDS) {
    dump[field] = Array.from(particles.readIntegers(ParticleField[field]));
  }

  out.push(dump);
  system.children.forEach((child, i) => dumpTree(child, `${path}.${i}`, out));
  return out;
}

/** The absolute tolerance each float field is held to. */
export const DEFAULT_TOLERANCES: Record<string, number> = {
  Position: 1e-3,
  PositionPrevious: 1e-3,
  Color: 1e-4,
  Normal: 1e-4,
  Alpha: 1e-4,
  AlphaAlternate: 1e-4,
};

/** Tolerance for the float fields DEFAULT_TOLERANCES does not name. */
export const DEFAULT_FIELD_TOLERANCE = 1e-4;

export interface FieldReport {
  field: string;
  /** The largest absolute difference over every compared frame and particle. */
  maxError: number;
  /** The first frame where the difference passed the tolerance, or null. */
  firstDivergence: number | null;
  tolerance: number;
}

export interface SystemReport {
  path: string;
  name: string;
  framesCompared: number;
  /** The first frame where the particle counts differ, or null. */
  firstCountMismatch: number | null;
  /** The first frame where the particle ids differ, or null. */
  firstIdMismatch: number | null;
  fields: FieldReport[];
  /** Whether counts and ids matched every frame and every field stayed within tolerance. */
  matches: boolean;
}

/**
 * Compares two runs frame by frame. Counts and ids must match exactly; float fields are compared only
 * on frames where the counts match.
 */
export function compareRuns(
  expected: OracleRun,
  actual: OracleRun,
  tolerances: Record<string, number> = DEFAULT_TOLERANCES,
  exact = false,
): SystemReport[] {
  const reports = new Map<string, SystemReport>();
  const floatFields = [...ORACLE_VECTOR_FIELDS, ...ORACLE_SCALAR_FIELDS];

  const frameCount = Math.min(expected.frames.length, actual.frames.length);

  for (let frame = 0; frame < frameCount; frame++) {
    const actualByPath = new Map(actual.frames[frame].systems.map((system) => [system.path, system]));

    for (const want of expected.frames[frame].systems) {
      let report = reports.get(want.path);

      if (report === undefined) {
        report = {
          path: want.path,
          name: want.name,
          framesCompared: 0,
          firstCountMismatch: null,
          firstIdMismatch: null,
          fields: floatFields.map((field) => ({
            field,
            maxError: 0,
            firstDivergence: null,
            tolerance: tolerances[field] ?? DEFAULT_FIELD_TOLERANCE,
          })),
          matches: true,
        };
        reports.set(want.path, report);
      }

      report.framesCompared++;
      const got = actualByPath.get(want.path);

      if (got === undefined || got.count !== want.count) {
        report.firstCountMismatch ??= frame;
        continue;
      }

      const wantIds = want.ParticleId as number[] | undefined;
      const gotIds = got.ParticleId as number[] | undefined;

      if (wantIds !== undefined && gotIds !== undefined && wantIds.some((id, i) => id !== gotIds[i])) {
        report.firstIdMismatch ??= frame;
      }

      for (const fieldReport of report.fields) {
        const wantValues = want[fieldReport.field] as number[] | undefined;
        const gotValues = got[fieldReport.field] as number[] | undefined;

        if (wantValues === undefined || gotValues === undefined) {
          continue;
        }

        for (let i = 0; i < wantValues.length; i++) {
          const error = Math.abs(f32(wantValues[i]) - gotValues[i]);
          const diverged = exact
            ? !Object.is(f32(wantValues[i]), gotValues[i])
            : Number.isNaN(error) ? !(Number.isNaN(wantValues[i]) && Number.isNaN(gotValues[i])) : error > fieldReport.tolerance;

          if (!Number.isNaN(error)) {
            fieldReport.maxError = Math.max(fieldReport.maxError, error);
          }

          if (diverged) {
            fieldReport.firstDivergence ??= frame;
          }
        }
      }
    }
  }

  for (const report of reports.values()) {
    report.matches =
      report.firstCountMismatch === null && report.firstIdMismatch === null && report.fields.every((field) => field.firstDivergence === null);
  }

  return [...reports.values()];
}
