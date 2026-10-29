import { describe, expect, it } from 'vitest';
import batch38Fixture20 from './__fixtures__/batch38_airheart_jetpack_ambient_thrust_constant.json';
import batch38Fixture19 from './__fixtures__/batch38_yamato_shadow_form_buff_timer.json';
import batch38Fixture18 from './__fixtures__/batch38_dynamo_anim_ui_hero_pose_ambient.json';
import batch38Fixture17 from './__fixtures__/batch38_fencer_sigil_explo_fluid.json';
import batch38Fixture0 from './__fixtures__/batch38_chessmaster_ambient_pieces_model.json';
import batch38Fixture1 from './__fixtures__/batch38_ratking_standard_bearer_eruption_pipe_water.json';
import batch38Fixture2 from './__fixtures__/batch38_necro_gravestone_ambient.json';
import batch38Fixture3 from './__fixtures__/batch38_chessmaster_ambient_pieces.json';
import batch38Fixture4 from './__fixtures__/batch38_frank_ambient_shoulder_l_bolt.json';
import batch38Fixture5 from './__fixtures__/batch38_haze_head_ambient_cable.json';
import batch38Fixture6 from './__fixtures__/batch38_mcginnis_sentry_ambient_energy.json';
import batch38Fixture7 from './__fixtures__/batch38_inferno_hand_ambient_flame.json';
import batch38Fixture8 from './__fixtures__/batch38_haze_head_ambient_parent.json';
import batch38Fixture9 from './__fixtures__/batch38_sticky_mine_ambient.json';
import batch38Fixture10 from './__fixtures__/batch38_haze_head_ambient_cylinder.json';
import batch38Fixture11 from './__fixtures__/batch38_familiar_helpinghand_debuff_minions_ambient_smoke.json';
import batch38Fixture12 from './__fixtures__/batch38_doorman_ambient_beam.json';
import batch38Fixture13 from './__fixtures__/batch38_airheart_weapon_charge_level_02_ambient_darkness.json';
import batch38Fixture14 from './__fixtures__/batch38_mcginnis_rocket_barrage_ambient_model.json';
import batch38Fixture15 from './__fixtures__/batch38_lash_death_slam_start_energy.json';
import batch38Fixture16 from './__fixtures__/batch38_priest_ambient_smoke.json';

import abramsBook from './__fixtures__/abrams_book.json';
import abramsBookGlow from './__fixtures__/abrams_book_glow.json';
import airheartEndcap from './__fixtures__/airheart_endcap.json';
import archerTrap from './__fixtures__/archer_trap.json';
import babaBeam from './__fixtures__/baba_beam.json';
import chessmasterHalo from './__fixtures__/chessmaster_halo.json';
import dotnetNumerics from './__fixtures__/dotnet_numerics.json';
import doormanPath from './__fixtures__/doorman_path.json';
import drifterPose from './__fixtures__/drifter_pose.json';
import engineerTracer from './__fixtures__/engineer_tracer.json';
import hazeSmokey from './__fixtures__/haze_smokey.json';
import mcginnis from './__fixtures__/mcginnis.json';
import mcginnisMagic from './__fixtures__/mcginnis_magic.json';
import meleeHeavyActivateLight from './__fixtures__/melee_heavy_activate_light.json';
import airDashStreaks from './__fixtures__/air_dash_streaks.json';
import necroFlameContour from './__fixtures__/necro_flame_contour.json';
import necroOrbit from './__fixtures__/necro_orbit.json';
import modelAbramsBook from './__fixtures__/model_abrams_book.json?raw';
import modelFamiliarBody from './__fixtures__/model_familiar_body.json?raw';
import modelHazeInkyTrace from './__fixtures__/model_haze_inky_trace.json?raw';
import modelNanoTowerElec from './__fixtures__/model_nano_tower_elec.json?raw';
import modelNecroWeapon from './__fixtures__/model_necro_weapon.json?raw';
import modelUnicornHorn from './__fixtures__/model_unicorn_horn.json?raw';
import { ParticleDiagnostics } from './diagnostics';
import type { KVObject } from './kv';
import {
  Matrix4x4,
  Quaternion,
  Vector3,
  cross,
  degreesToRadians,
  floatLerp,
  int32BitsToSingle,
  normalize,
  radiansToDegrees,
  transform,
  transformNormal,
} from './numerics';
import {
  type CompactOracleModel,
  type ControlPointInput,
  type OracleFrame,
  type OracleRun,
  ORACLE_VECTOR_FIELDS,
  compareRuns,
  expandModel,
  runRuntime,
  tableSource,
} from './oracleDiff';
import { type SerializedSnapshot, deserializeSnapshot } from './snapshotResource';
import { VRF_CLASSES, isPorted, portedClasses, type FunctionKind } from './registry';
import { upgradeToLatest } from './upgrade';
import { stringToken } from './utils/stringToken';

/** A trimmed oracle run: the inputs it was made with and a sample of its frames. */
interface OracleFixture {
  exact?: boolean;
  system: string;
  dt: number;
  frames: number;
  seed: number | null;
  controlPoints: { cp: number; position: [number, number, number] }[];
  moves?: { cp: number; velocity: [number, number, number] }[];
  spins?: { cp: number; degreesPerSecond: number }[];
  stopFrame?: number | null;
  inputs: ControlPointInput[][] | null;
  formats: Record<string, string>;
  /** The snapshots the tree loads, by path, read the way the app reads them. */
  snapshots?: Record<string, SerializedSnapshot>;
  /** The model the oracle bound, posed by its --model-move and --model-motion. */
  model?: CompactOracleModel | null;
  definitions: Record<string, KVObject>;
  expected: (OracleFrame & { frame: number; constants?: Record<string, Record<string, number>> })[];
}

const oracleFixtures: Record<string, OracleFixture> = {
  batch38_airheart_jetpack_ambient_thrust_constant: batch38Fixture20 as unknown as OracleFixture,
  batch38_yamato_shadow_form_buff_timer: batch38Fixture19 as unknown as OracleFixture,
  batch38_dynamo_anim_ui_hero_pose_ambient: batch38Fixture18 as unknown as OracleFixture,
  batch38_fencer_sigil_explo_fluid: batch38Fixture17 as unknown as OracleFixture,
  batch38_chessmaster_ambient_pieces_model: batch38Fixture0 as unknown as OracleFixture,
  batch38_ratking_standard_bearer_eruption_pipe_water: batch38Fixture1 as unknown as OracleFixture,
  batch38_necro_gravestone_ambient: batch38Fixture2 as unknown as OracleFixture,
  batch38_chessmaster_ambient_pieces: batch38Fixture3 as unknown as OracleFixture,
  batch38_frank_ambient_shoulder_l_bolt: batch38Fixture4 as unknown as OracleFixture,
  batch38_haze_head_ambient_cable: batch38Fixture5 as unknown as OracleFixture,
  batch38_mcginnis_sentry_ambient_energy: batch38Fixture6 as unknown as OracleFixture,
  batch38_inferno_hand_ambient_flame: batch38Fixture7 as unknown as OracleFixture,
  batch38_haze_head_ambient_parent: batch38Fixture8 as unknown as OracleFixture,
  batch38_sticky_mine_ambient: batch38Fixture9 as unknown as OracleFixture,
  batch38_haze_head_ambient_cylinder: batch38Fixture10 as unknown as OracleFixture,
  batch38_familiar_helpinghand_debuff_minions_ambient_smoke: batch38Fixture11 as unknown as OracleFixture,
  batch38_doorman_ambient_beam: batch38Fixture12 as unknown as OracleFixture,
  batch38_airheart_weapon_charge_level_02_ambient_darkness: batch38Fixture13 as unknown as OracleFixture,
  batch38_mcginnis_rocket_barrage_ambient_model: batch38Fixture14 as unknown as OracleFixture,
  batch38_lash_death_slam_start_energy: batch38Fixture15 as unknown as OracleFixture,
  batch38_priest_ambient_smoke: batch38Fixture16 as unknown as OracleFixture,

  abrams_book_glow: abramsBookGlow as unknown as OracleFixture,
  abrams_book: abramsBook as unknown as OracleFixture,
  necro_flame_contour: necroFlameContour as unknown as OracleFixture,
  chessmaster_halo: chessmasterHalo as unknown as OracleFixture,
  haze_smokey: hazeSmokey as unknown as OracleFixture,
  mcginnis: mcginnis as unknown as OracleFixture,
  drifter_pose: drifterPose as unknown as OracleFixture,
  doorman_path: doormanPath as unknown as OracleFixture,
  airheart_endcap: airheartEndcap as unknown as OracleFixture,
  mcginnis_magic: mcginnisMagic as unknown as OracleFixture,
  engineer_tracer: engineerTracer as unknown as OracleFixture,
  melee_heavy_activate_light: meleeHeavyActivateLight as unknown as OracleFixture,
  air_dash_streaks: airDashStreaks as unknown as OracleFixture,
  necro_orbit: necroOrbit as unknown as OracleFixture,
  archer_trap: archerTrap as unknown as OracleFixture,
  baba_beam: babaBeam as unknown as OracleFixture,

  // Read as text and parsed here: the JSON module import turns a negative zero that starts an array
  // into a positive one, which an exact replay must keep, and these fixtures hold such values
  model_abrams_book: JSON.parse(modelAbramsBook) as OracleFixture,
  model_familiar_body: JSON.parse(modelFamiliarBody) as OracleFixture,
  model_haze_inky_trace: JSON.parse(modelHazeInkyTrace) as OracleFixture,
  model_nano_tower_elec: JSON.parse(modelNanoTowerElec) as OracleFixture,
  model_necro_weapon: JSON.parse(modelNecroWeapon) as OracleFixture,
  model_unicorn_horn: JSON.parse(modelUnicornHorn) as OracleFixture,
};

/** The classes that keep a fixture's systems from matching yet; their float fields are not in it. */
const knownUnsupported: Record<string, string[]> = {};

describe('particle runtime against the ValveResourceFormat oracle', () => {
  it('rejects a signed zero mismatch in exact mode', () => {
    const expected: OracleRun = { system: 'signed-zero', dt: 1 / 64, frames: [
      { t: 1 / 64, systems: [{ path: '0', name: 'signed-zero', count: 1, ParticleId: [0], Roll: [0] }] },
    ] };
    const actual: OracleRun = { ...expected, frames: [
      { t: 1 / 64, systems: [{ path: '0', name: 'signed-zero', count: 1, ParticleId: [0], Roll: [-0] }] },
    ] };
    expect(compareRuns(expected, actual)[0].matches).toBe(true);
    expect(compareRuns(expected, actual, undefined, true)[0].matches).toBe(false);
  });
  it.each(Object.keys(oracleFixtures))('%s matches every sampled frame', (name) => {
    const fixture = oracleFixtures[name];
    const snapshots = Object.fromEntries(Object.entries(fixture.snapshots ?? {}).map(([path, snapshot]) => [path, deserializeSnapshot(snapshot)]));
    const { run, simulation } = runRuntime(fixture.system, tableSource(fixture.definitions, fixture.formats, snapshots), {
      frames: fixture.frames,
      dt: fixture.dt,
      seed: fixture.seed ?? undefined,
      controlPoints: fixture.controlPoints,
      moves: fixture.moves,
      spins: fixture.spins,
      stopFrame: fixture.stopFrame ?? undefined,
      frameInputs: fixture.inputs ?? undefined,
      model: fixture.model ? expandModel(fixture.model) : undefined,
    });

    const expected: OracleRun = { system: fixture.system, dt: fixture.dt, frames: fixture.expected.map((frame) => ({
      ...frame,
      systems: frame.systems.map((system) => ({ ...system, ...Object.fromEntries(
        Object.entries(frame.constants?.[system.path] ?? {}).map(([field, value]) => [field,
          new Array<number>(system.count * (ORACLE_VECTOR_FIELDS.some((name) => name === field) ? 3 : 1)).fill(value)]),
      ) })),
    })) };
    const actual: OracleRun = { system: fixture.system, dt: fixture.dt, frames: fixture.expected.map(({ frame }) => run.frames[frame]) };
    const reports = compareRuns(expected, actual, undefined, fixture.exact ?? false);

    expect(reports.length).toBeGreaterThan(0);

    for (const report of reports) {
      expect(report.matches).toBe(true);
      expect({ path: report.path, firstCountMismatch: report.firstCountMismatch, firstIdMismatch: report.firstIdMismatch }).toEqual({
        path: report.path,
        firstCountMismatch: null,
        firstIdMismatch: null,
      });

      for (const field of report.fields) {
        expect({ path: report.path, field: field.field, maxError: field.maxError }).toEqual({ path: report.path, field: field.field, maxError: 0 });
      }
    }

    // Particles were actually simulated
    expect(fixture.expected.some((frame) => frame.systems.some((system) => system.count > 0))).toBe(true);

    const unsupported = simulation.diagnostics.ofKind('unsupported-class').map((entry) => entry.message);
    const expectedUnsupported = knownUnsupported[name] ?? [];
    expect(unsupported).toHaveLength(expectedUnsupported.length);

    for (const className of expectedUnsupported) {
      expect(unsupported.some((message) => message.includes(className))).toBe(true);
    }
  });
});

describe('numerics against System.Numerics', () => {
  const cases = dotnetNumerics as Record<string, number[] | number>[];
  const float = (bits: number) => int32BitsToSingle(bits | 0);
  const floats = (bits: number[] | number) => (Array.isArray(bits) ? bits : [bits]).map(float);
  const matrix = (bits: number[] | number) => new Matrix4x4(floats(bits));
  const vector = (bits: number[] | number) => {
    const [x, y, z] = floats(bits);
    return new Vector3(x, y, z);
  };
  const quaternion = (bits: number[] | number) => {
    const [x, y, z, w] = floats(bits);
    return new Quaternion(x, y, z, w);
  };
  const v3 = (v: Vector3) => [v.x, v.y, v.z];
  const q4 = (q: Quaternion) => [q.x, q.y, q.z, q.w];

  it.each(cases.map((testCase, index) => [index, testCase] as const))('case %i is bit-exact', (_index, c) => {
    const a = matrix(c.a);
    const v = vector(c.v);
    const t = float(c.t as number);

    expect(v3(transform(v, a))).toEqual(floats(c.transform));
    expect(v3(transformNormal(v, a))).toEqual(floats(c.transformNormal));
    expect(Array.from(a.multiply(matrix(c.b)).m)).toEqual(floats(c.multiply));
    expect(Array.from(a.invert()!.m)).toEqual(floats(c.invert));
    // Slerp goes through MathF.Sin, the C runtime's sinf, which is not always correctly rounded: an ulp apart at most
    const slerp = q4(Quaternion.slerp(quaternion(c.q1), quaternion(c.q2), t));
    floats(c.slerp).forEach((component, i) => expect(slerp[i]).toBeCloseTo(component, 6));
    expect(q4(Quaternion.fromRotationMatrix(matrix(c.b)))).toEqual(floats(c.fromMatrix));
    expect(Array.from(Matrix4x4.fromQuaternion(quaternion(c.q1)).m)).toEqual(floats(c.toMatrix));
    expect(v3(normalize(v))).toEqual(floats(c.normalize));
    expect(v.length()).toBe(float(c.length as number));
    expect(v3(cross(v, vector(c.w)))).toEqual(floats(c.cross));
    expect(floatLerp(v.x, v.y, t)).toBe(float(c.lerp as number));

    const angle = float(c.angle as number);
    expect(degreesToRadians(Math.fround(angle * 90))).toBe(float(c.toRadians as number));
    expect(radiansToDegrees(angle)).toBe(float(c.toDegrees as number));
  });
});

describe('registry', () => {
  const kinds: FunctionKind[] = ['preEmission', 'emitter', 'initializer', 'operator', 'forceGenerator', 'constraint'];

  it('lists every class ValveResourceFormat registers', () => {
    expect(kinds.reduce((total, kind) => total + VRF_CLASSES[kind].length, 0)).toBe(308);
  });

  it('only ports classes ValveResourceFormat knows', () => {
    for (const kind of kinds) {
      for (const className of portedClasses(kind)) {
        expect(VRF_CLASSES[kind]).toContain(className);
        expect(isPorted(kind, className)).toBe(true);
      }
    }
  });
});

describe('format upgrade', () => {
  const sphere = (input: KVObject): KVObject => ({
    m_Initializers: [{ _class: 'C_INIT_CreateWithinSphereTransform', m_LocalCoordinateSystemSpeedMin: input }],
  });

  it('negates the local speed Y of CreateWithinSphereTransform from vpcf61', () => {
    const literal = { m_nType: 'PVEC_TYPE_LITERAL', m_vLiteralValue: [1, 2, 3], m_LiteralColor: [0, 0, 0] };
    const upgraded = upgradeToLatest(sphere(literal), 'vpcf61', new ParticleDiagnostics());
    const initializer = (upgraded.m_Initializers as KVObject[])[0];

    expect(initializer.m_LocalCoordinateSystemSpeedMin).toEqual({ m_nType: 'PVEC_TYPE_LITERAL', m_vLiteralValue: [1, -2, 3] });
  });

  it('leaves the newest format alone and does not edit its input', () => {
    const literal = { m_nType: 'PVEC_TYPE_LITERAL', m_vLiteralValue: [1, 2, 3] };
    const definition = sphere(literal);
    const upgraded = upgradeToLatest(definition, 'vpcf66', new ParticleDiagnostics());

    expect(upgraded).toEqual(definition);
    expect(upgraded).not.toBe(definition);
  });

  it('reports formats whose upgrade steps are not ported', () => {
    const diagnostics = new ParticleDiagnostics();
    upgradeToLatest({}, null, diagnostics);
    upgradeToLatest({}, 'vpcf40', diagnostics);

    expect(diagnostics.ofKind('unsupported-upgrade')).toHaveLength(2);
  });
});

describe('string token', () => {
  it('hashes case-insensitively', () => {
    expect(stringToken('particles/Abilities/X.vpcf_c')).toBe(stringToken('particles/abilities/x.vpcf_c'));
    expect(stringToken('')).toBe(0);
  });
});
