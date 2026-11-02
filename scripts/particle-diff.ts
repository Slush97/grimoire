// Diffs the TypeScript particle runtime (src/lib/particles) against ValveResourceFormat through the
// particle oracle (tools/particle-oracle), with identical inputs: same dt, frame count, control
// points and seed policy. Reports, per system path and field, the first divergent frame and the
// largest error.
//
// usage: pnpm exec tsx scripts/particle-diff.ts <particles/...vpcf> [--frames 192] [--dt 0.015625]
//        [--seed N] [--cp N=x,y,z]... [--cp-move N=vx,vy,vz]... [--cp-spin N=deg/s]... [--stop-frame N] [--exact] [--refresh] [--oracle cached.json] [--fixture out.json]
//        [--fixture-frames 0,1,2,...] [--vpk pak01_dir.vpk] [--corpus fx-corpus/json] [--oracle-exe path]
//        [--model models/...vmdl [--model-cp N] [--model-move vx,vy,vz] [--model-motion]] [--vpkmerge path]
//
// The oracle output is cached under .codex-run/oracle/; --refresh reruns it. Definitions are read
// from the decoded corpus (the JSON the app produces at runtime). --fixture writes a trimmed fixture
// for src/lib/particles/particles.test.ts.
//
// Snapshots the tree loads are read the way the app reads them (the compiled file from the VPK, its DATA
// block decoded by vpkmerge, the SNAP block by src/lib/particles/snapshotResource.ts) and checked against
// the snapshots the oracle loaded. With --model the oracle binds that model, and the runtime replays the
// model as the oracle describes it; the harness also checks every bone's bind pose and every frame's bone
// motion bit for bit, and the model the app's reader builds from the vpkmerge-decoded file against VRF's.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type KVObject, type KVValue, isCollection } from '../src/lib/particles/kv';
import {
  type OracleRun,
  type OracleSystem,
  type SystemReport,
  compactModel,
  compareRuns,
  formatsByName,
  modelFromOracle,
  modelMotionAt,
  runRuntime,
  snapshotFromOracle,
  tableSource,
} from '../src/lib/particles/oracleDiff';
import { ParticleModel } from '../src/lib/particles/model';
import { Matrix4x4 } from '../src/lib/particles/numerics';
import { readSnapshotResource, serializeSnapshot } from '../src/lib/particles/snapshotResource';
import type { ParticleSnapshot } from '../src/lib/particles/utils/snapshotBinding';
import { readVpkEntryBytes } from '../electron/main/services/vpk';
import { readParticleModelSync } from '../electron/main/services/particleModelExport';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

interface Options {
  system: string;
  frames: number;
  dt: number;
  seed?: number;
  cps: { cp: number; position: [number, number, number] }[];
  moves: { cp: number; velocity: [number, number, number] }[];
  spins: { cp: number; degreesPerSecond: number }[];
  stopFrame?: number;
  exact: boolean;
  refresh: boolean;
  oracle?: string;
  fixture?: string;
  fixtureFrames?: number[];
  vpk: string;
  corpus: string;
  oracleExe: string;
  vpkmerge: string;
  model?: string;
  modelControlPoint: number;
  modelMove: [number, number, number];
  modelMotion: boolean;
}

function parseArgs(argv: string[]): Options {
  const options: Options = {
    system: '',
    frames: 192,
    dt: 1 / 64,
    cps: [],
    moves: [],
    spins: [],
    exact: false,
    refresh: false,
    vpk: process.env.DEADLOCK_VPK ?? 'C:/Program Files (x86)/Steam/steamapps/common/Deadlock/game/citadel/pak01_dir.vpk',
    corpus: process.env.PARTICLE_CORPUS ?? join(root, '.codex-run/fx-corpus/json'),
    oracleExe: join(root, '.codex-run/particle-oracle/bin/Release/net10.0', process.platform === 'win32' ? 'ParticleOracle.exe' : 'ParticleOracle'),
    vpkmerge: process.env.VPKMERGE ?? join(root, 'resources/vpkmerge', process.platform === 'win32' ? 'vpkmerge-windows-x86_64.exe' : 'vpkmerge-linux-x86_64'),
    modelControlPoint: 0,
    modelMove: [0, 0, 0],
    modelMotion: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const value = () => {
      const next = argv[++i];
      if (next === undefined) {
        throw new Error(`Missing value for ${arg}`);
      }
      return next;
    };

    switch (arg) {
      case '--frames':
        options.frames = Number.parseInt(value(), 10);
        break;
      case '--dt':
        options.dt = Number(value());
        break;
      case '--seed':
        options.seed = Number.parseInt(value(), 10);
        break;
      case '--cp': {
        const [cp, xyz] = value().split('=');
        const [x, y, z] = xyz.split(',').map(Number);
        options.cps.push({ cp: Number.parseInt(cp, 10), position: [x, y, z] });
        break;
      }
      case '--cp-move': {
        const [cp, xyz] = value().split('=');
        const [x, y, z] = xyz.split(',').map(Number);
        options.moves.push({ cp: Number.parseInt(cp, 10), velocity: [x, y, z] });
        break;
      }
      case '--cp-spin': {
        const [cp, rate] = value().split('=');
        options.spins.push({ cp: Number.parseInt(cp, 10), degreesPerSecond: Number(rate) });
        break;
      }
      case '--refresh':
        options.refresh = true;
        break;
      case '--stop-frame':
        options.stopFrame = Number.parseInt(value(), 10);
        break;
      case '--exact':
        options.exact = true;
        break;
      case '--oracle':
        options.oracle = value();
        break;
      case '--fixture':
        options.fixture = value();
        break;
      case '--fixture-frames':
        options.fixtureFrames = value().split(',').map((frame) => Number.parseInt(frame, 10));
        break;
      case '--vpk':
        options.vpk = value();
        break;
      case '--corpus':
        options.corpus = value();
        break;
      case '--oracle-exe':
        options.oracleExe = value();
        break;
      case '--vpkmerge':
        options.vpkmerge = value();
        break;
      case '--model':
        options.model = value().replace(/_c$/, '');
        break;
      case '--model-cp':
        options.modelControlPoint = Number.parseInt(value(), 10);
        break;
      case '--model-move': {
        const [x, y, z] = value().split(',').map(Number);
        options.modelMove = [x, y, z];
        break;
      }
      case '--model-motion':
        options.modelMotion = true;
        break;
      default:
        if (arg.startsWith('--') || options.system !== '') {
          throw new Error(`Unknown argument ${arg}`);
        }
        options.system = arg.replace(/_c$/, '');
    }
  }

  if (options.system === '') {
    throw new Error('usage: particle-diff.ts <particles/...vpcf> [--frames N] [--dt s] [--seed N] [--cp N=x,y,z]');
  }

  return options;
}

function oracleRun(options: Options): OracleRun {
  if (options.oracle !== undefined) {
    return JSON.parse(readFileSync(options.oracle, 'utf8')) as OracleRun;
  }

  const key = [
    options.system.replace(/[^a-z0-9]+/gi, '_'),
    `f${options.frames}`,
    `dt${options.dt}`,
    options.seed !== undefined ? `s${options.seed}` : 'sname',
    ...options.cps.map(({ cp, position }) => `cp${cp}_${position.join('_')}`),
    ...options.moves.map(({ cp, velocity }) => `mv${cp}_${velocity.join('_')}`),
    ...options.spins.map(({ cp, degreesPerSecond }) => `sp${cp}_${degreesPerSecond}`),
    ...(options.stopFrame === undefined ? [] : [`stop${options.stopFrame}`]),
    ...(options.model === undefined ? [] : [`m${options.model.replace(/[^a-z0-9]+/gi, '_')}_cp${options.modelControlPoint}_mv${options.modelMove.join('_')}${options.modelMotion ? '_motion' : ''}`]),
  ].join('__');
  const cached = join(root, '.codex-run/oracle', `${key}.json`);

  if (options.refresh || !existsSync(cached)) {
    mkdirSync(dirname(cached), { recursive: true });
    const args = ['--vpk', options.vpk, '--system', options.system, '--frames', String(options.frames), '--dt', String(options.dt), '--out', cached];

    if (options.seed !== undefined) {
      args.push('--seed', String(options.seed));
    }

    if (options.stopFrame !== undefined) {
      args.push('--stop-frame', String(options.stopFrame));
    }

    for (const { cp, position } of options.cps) {
      args.push('--cp', `${cp}=${position.join(',')}`);
    }

    for (const { cp, velocity } of options.moves) {
      args.push('--cp-move', `${cp}=${velocity.join(',')}`);
    }

    for (const { cp, degreesPerSecond } of options.spins) {
      args.push('--cp-spin', `${cp}=${degreesPerSecond}`);
    }

    if (options.model !== undefined) {
      args.push('--model', options.model, '--model-cp', String(options.modelControlPoint), '--model-move', options.modelMove.join(','));

      if (options.modelMotion) {
        args.push('--model-motion');
      }
    }

    execFileSync(options.oracleExe, args, { stdio: 'inherit' });
  }

  return JSON.parse(readFileSync(cached, 'utf8')) as OracleRun;
}

/** Reads the decoded definitions from the corpus as the runtime asks for them, remembering which it read. */
function corpusDefinitions(corpus: string): { definitions: Record<string, KVObject>; read: Set<string> } {
  const read = new Set<string>();
  const definitions = new Proxy({} as Record<string, KVObject>, {
    get(cache, path: string) {
      if (!(path in cache)) {
        const file = join(corpus, `${path.replace(/\.vpcf$/, '')}.json`);

        if (!existsSync(file)) {
          return undefined;
        }

        cache[path] = JSON.parse(readFileSync(file, 'utf8')) as KVObject;
      }

      read.add(path);
      return cache[path];
    },
  });

  return { definitions, read };
}

/** Decodes a compiled resource's DATA block to JSON with vpkmerge, as the app does. */
function decodeData(options: Options, entry: string): KVObject {
  return JSON.parse(execFileSync(options.vpkmerge, ['soundevents', entry, '--from-vpk', options.vpk], { maxBuffer: 1 << 30, stdio: ['ignore', 'pipe', 'ignore'] }).toString()) as KVObject;
}

/** Every snapshot the oracle loaded, read the way the app reads it, failing on any difference. */
function appSnapshots(options: Options, oracle: OracleRun): Record<string, ParticleSnapshot> {
  const snapshots: Record<string, ParticleSnapshot> = {};

  for (const dumped of oracle.snapshots ?? []) {
    const entry = `${dumped.snapshot}_c`;
    const bytes = readVpkEntryBytes(options.vpk, entry);

    if (bytes === null) {
      throw new Error(`Snapshot not in VPK: ${entry}`);
    }

    const snapshot = readSnapshotResource(bytes, decodeData(options, entry));
    const expected = JSON.stringify(serializeSnapshot(snapshotFromOracle(dumped)));
    const actual = JSON.stringify(serializeSnapshot(snapshot));
    console.log(`snapshot ${dumped.snapshot}: ${snapshot.numParticles} rows, reader ${expected === actual ? 'MATCH' : 'DIVERGES'}`);

    if (expected !== actual) {
      process.exitCode = 1;
    }

    snapshots[dumped.snapshot] = snapshot;
  }

  return snapshots;
}

/** Checks the bound model: bind pose and bone motions bit for bit, and the app's reader against VRF's model. */
function checkModel(options: Options, oracle: OracleRun): void {
  const description = oracle.model!;
  const model = modelFromOracle(description);
  const bindPose = new Array<Matrix4x4>(model.skeleton.bones.length);
  model.getBindPose(bindPose);
  const bindMatches = description.bindPose?.every((expected, i) => expected.every((value, k) => Object.is(Math.fround(value), bindPose[i].m[k]))) ?? false;
  const motionMatches = oracle.frames.every((frame, i) => {
    const [even, odd] = description.motion ? modelMotionAt(i) : [Matrix4x4.identity(), Matrix4x4.identity()];
    return frame.model === undefined || (frame.model.even.every((value, k) => Object.is(Math.fround(value), even.m[k]))
      && frame.model.odd.every((value, k) => Object.is(Math.fround(value), odd.m[k])));
  });

  const parsed = ParticleModel.deserialize(readParticleModelSync(readVpkEntryBytes(options.vpk, `${description.path}_c`)!, (resource) => decodeLoose(options, resource),
    (path) => readVpkEntryBytes(options.vpk, path) === null ? null : decodeData(options, path)));
  const sameBounds = parsed.bounds.min.equals(model.bounds.min) && parsed.bounds.max.equals(model.bounds.max);
  const sameBones = parsed.skeleton.bones.length === model.skeleton.bones.length && parsed.skeleton.bones.every((bone, i) => {
    const other = model.skeleton.bones[i];
    return bone.name === other.name && (bone.parent?.index ?? -1) === (other.parent?.index ?? -1) && bone.position.equals(other.position)
      && bone.angle.x === other.angle.x && bone.angle.y === other.angle.y && bone.angle.z === other.angle.z && bone.angle.w === other.angle.w;
  });
  const sameHitboxes = JSON.stringify(parsed.hitboxSets) === JSON.stringify(model.hitboxSets);

  console.log(`model ${description.path}: ${model.skeleton.bones.length} bones, bind pose ${bindMatches ? 'MATCH' : 'DIVERGES'}, ` +
    `motion ${motionMatches ? 'MATCH' : 'DIVERGES'}, app skeleton ${sameBones ? 'MATCH' : 'DIVERGES'}, app hitboxes ${sameHitboxes ? 'MATCH' : 'DIVERGES'}, app bounds ${sameBounds ? 'MATCH' : 'DIVERGES'}`);

  if (!bindMatches || !motionMatches || !sameBones || !sameHitboxes || !sameBounds) {
    process.exitCode = 1;
  }
}

/** Decodes one loose single-block resource with vpkmerge. */
function decodeLoose(options: Options, resource: Buffer): KVObject {
  const file = join(root, '.codex-run/oracle', `block-${process.pid}.vsndevts_c`);
  writeFileSync(file, resource);
  return JSON.parse(execFileSync(options.vpkmerge, ['soundevents', file], { maxBuffer: 1 << 30, stdio: ['ignore', 'pipe', 'ignore'] }).toString()) as KVObject;
}

function formatError(value: number): string {
  return value === 0 ? '0' : value.toExponential(2);
}

function printReports(reports: SystemReport[], exact: boolean): void {
  for (const report of reports) {
    const matches = report.matches && (!exact || report.fields.every((field) => field.maxError === 0));
    const status = matches ? 'MATCH' : 'DIVERGES';
    console.log(`\n${report.path} ${report.name} [${status}] frames=${report.framesCompared}`);
    console.log(
      `  counts: ${report.firstCountMismatch === null ? 'exact' : `first mismatch at frame ${report.firstCountMismatch}`}` +
        `   ids: ${report.firstIdMismatch === null ? 'exact' : `first mismatch at frame ${report.firstIdMismatch}`}`,
    );

    for (const field of report.fields) {
      const divergence = field.firstDivergence === null ? '' : `  first divergence at frame ${field.firstDivergence}`;
      console.log(`  ${field.field.padEnd(16)} max ${formatError(field.maxError).padEnd(9)} (tol ${field.tolerance})${divergence}`);
    }
  }
}

function main(): void {
  const options = parseArgs(process.argv.slice(2));
  const oracle = oracleRun(options);
  const { definitions, read } = corpusDefinitions(options.corpus);
  const formats = formatsByName(oracle);
  const snapshots = appSnapshots(options, oracle);

  if (oracle.model !== undefined) {
    checkModel(options, oracle);
  }

  const { run, simulation } = runRuntime(options.system, tableSource(definitions, formats, snapshots), {
    frames: options.frames,
    dt: oracle.dt,
    seed: options.seed,
    controlPoints: options.cps,
    moves: options.moves,
    spins: options.spins,
    stopFrame: options.stopFrame,
    frameInputs: oracle.frames.map((frame) => frame.inputs),
    model: oracle.model,
  });

  const reports = compareRuns(oracle, run, undefined, options.exact);
  console.log(`${options.system}: ${options.frames} frames at dt ${oracle.dt}`);
  printReports(reports, options.exact);

  if (simulation.diagnostics.entries.length > 0) {
    console.log('\ndiagnostics:');
    for (const entry of simulation.diagnostics.entries) {
      console.log(`  [${entry.kind}] ${entry.system ?? ''} ${entry.message}`);
    }
  }

  if (options.fixture !== undefined) {
    const frameIndices = options.fixtureFrames ?? defaultFixtureFrames(options.frames);
    const fixture = {
      exact: options.exact,
      system: options.system,
      dt: oracle.dt,
      frames: options.frames,
      seed: options.seed ?? null,
      controlPoints: options.cps,
      moves: options.moves,
      spins: options.spins,
      stopFrame: options.stopFrame ?? null,
      inputs: oracle.frames.some((frame) => frame.inputs !== undefined) ? oracle.frames.map((frame) => frame.inputs ?? []) : null,
      formats,
      snapshots: Object.fromEntries(Object.entries(snapshots).map(([path, snapshot]) => [path, serializeSnapshot(snapshot)])),
      model: oracle.model === undefined ? null : compactModel(oracle.model),
      definitions: Object.fromEntries([...read].sort().map((path) => [path, trimDefinition(definitions[path])])),
      expected: frameIndices
        .filter((frame) => frame < oracle.frames.length)
        .map((frame) => {
          const constants: Record<string, Record<string, number>> = {};
          const systems = oracle.frames[frame].systems.map((system) => {
            const trimmed = { ...trimSystem(system, reports) };
            for (const [field, values] of Object.entries(trimmed)) {
              // A packed negative zero would not survive the test's JSON import, so such a column stays whole
              if (Array.isArray(values) && values.length > 1 && !Object.is(values[0], -0) && values.every((value) => Object.is(value, values[0]))) {
                (constants[system.path] ??= {})[field] = values[0];
                delete trimmed[field];
              }
            }
            return trimmed;
          });
          return { frame, t: oracle.frames[frame].t, systems, constants };
        }),
    };
    // JSON.stringify normally erases negative zero, which an exact replay must retain.
    const serialized = JSON.stringify(fixture, (_key, value: unknown) => typeof value === 'number' && Object.is(value, -0) ? '__particle_negative_zero__' : value)
      .replaceAll('"__particle_negative_zero__"', '-0');
    writeFileSync(options.fixture, `${serialized}\n`);
    console.log(`\nwrote ${options.fixture}`);
  }

  if (reports.some((report) => !report.matches || (options.exact && report.fields.some((field) => field.maxError !== 0))) ||
    (options.exact && simulation.diagnostics.ofKind('unsupported-class').length > 0)) {
    process.exitCode = 1;
  }
}

/** Every one of the first 4 frames, then every 24th, and the last. */
function defaultFixtureFrames(frames: number): number[] {
  const indices = new Set<number>();

  for (let frame = 0; frame < Math.min(4, frames); frame++) {
    indices.add(frame);
  }

  for (let frame = 23; frame < frames; frame += 24) {
    indices.add(frame);
  }

  indices.add(frames - 1);
  return [...indices].sort((a, b) => a - b);
}

/** Renderer members the simulation reads (ParticleSystemSimulation.IsOrderImportant). */
const RENDERER_KEYS = ['_class', 'm_bDisableOperator', 'm_MaterialVars'];

/** Whether a block references a named value, which declares a member of the system's named values. */
function referencesNamedValue(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.some(referencesNamedValue);
  }

  if (value === null || typeof value !== 'object') {
    return false;
  }

  const record = value as Record<string, unknown>;
  return (typeof record.m_NamedValue === 'string' && record.m_NamedValue !== '') || Object.values(record).some(referencesNamedValue);
}

/**
 * A definition with what the simulation never reads dropped, to keep fixtures small: the editor's
 * preview configurations, and every renderer member but those the simulation reads. A renderer that
 * references a named value is kept whole.
 */
function trimDefinition(definition: KVObject): KVObject {
  const trimmed: KVObject = { ...definition };
  delete trimmed.m_controlPointConfigurations;

  const renderers = definition.m_Renderers;

  if (Array.isArray(renderers)) {
    trimmed.m_Renderers = renderers.map((renderer) => {
      if (renderer === null || typeof renderer !== 'object' || Array.isArray(renderer) || referencesNamedValue(renderer)) {
        return renderer;
      }

      return Object.fromEntries(Object.entries(renderer).filter(([key]) => RENDERER_KEYS.includes(key)));
    });
  }

  return trimLiteralInputs(trimmed);
}

/** Literal input constructors read only their literal. Remap inputs still read mapping fields. */
function trimLiteralInputs(value: KVObject, key?: string): KVObject;
function trimLiteralInputs(value: KVValue, key?: string): KVValue;
function trimLiteralInputs(value: KVValue, key = ''): KVValue {
  if (Array.isArray(value)) { return value.map((item) => trimLiteralInputs(item)); }
  if (!isCollection(value)) { return value; }
  const type = value.m_nType;
  const literalKey = type === 'PF_TYPE_LITERAL' ? 'm_flLiteralValue'
    : type === 'PVEC_TYPE_LITERAL' ? 'm_vLiteralValue'
      : type === 'PVEC_TYPE_LITERAL_COLOR' ? 'm_LiteralColor' : null;
  if (literalKey !== null && key !== 'm_flOutputRemap' && !referencesNamedValue(value)) {
    return { m_nType: type, ...(literalKey in value ? { [literalKey]: value[literalKey] } : {}) };
  }
  return Object.fromEntries(Object.entries(value).map(([name, item]) => [name, trimLiteralInputs(item, name)]));
}

/** A system the runtime cannot match yet (an unsupported class) keeps only its counts and ids. */
function trimSystem(system: OracleSystem, reports: SystemReport[]): OracleSystem {
  if (reports.find((report) => report.path === system.path)?.matches !== false) {
    return system;
  }

  return { path: system.path, name: system.name, count: system.count, ParticleId: system.ParticleId };
}

main();
