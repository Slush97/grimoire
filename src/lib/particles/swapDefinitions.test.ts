import { describe, expect, it } from 'vitest';
import { ParticleField } from './enums';
import type { KVObject } from './kv';
import { f32 } from './numerics';
import { tableSource } from './oracleDiff';
import { ParticleSystemSimulation } from './simulation';
import { LATEST_FORMAT } from './upgrade';

const literal = (value: number) => ({ m_nType: 'PF_TYPE_LITERAL', m_flLiteralValue: value });

/** A system whose particles take a random colour between two at spawn and fade toward a third. */
function definition(min: number[], max: number[], fade: number[], extra: KVObject[] = []): KVObject {
  return {
    _class: 'CParticleSystemDefinition',
    m_nBehaviorVersion: 12,
    m_nMaxParticles: 64,
    m_Emitters: [{ _class: 'C_OP_ContinuousEmitter', m_flEmitRate: literal(40) }],
    m_Initializers: [
      { _class: 'C_INIT_CreateWithinSphereTransform', m_fRadiusMax: 10, m_fSpeedMax: 50 },
      { _class: 'C_INIT_InitFloat', m_InputValue: literal(2), m_nOutputField: 1 },
      { _class: 'C_INIT_RandomColor', m_ColorMin: min, m_ColorMax: max },
    ],
    m_Operators: [
      { _class: 'C_OP_BasicMovement' },
      { _class: 'C_OP_ColorInterpolate', m_ColorFade: fade },
      { _class: 'C_OP_Decay' },
      ...extra,
    ],
  };
}

const PATH = 'particles/test/recolour.vpcf';
const source = (data: KVObject) => tableSource({ [PATH]: data }, { [`${PATH}_c`]: LATEST_FORMAT });
const DT = f32(1 / 30);

function running(data: KVObject): ParticleSystemSimulation {
  const simulation = new ParticleSystemSimulation(source(data).loadSystem(PATH)!, source(data));
  simulation.seedRandom(7);
  simulation.start();
  for (let frame = 0; frame < 20; frame++) simulation.update(DT, frame * DT);
  return simulation;
}

const snapshot = (simulation: ParticleSystemSimulation) => {
  const current = simulation.particles.currentSpan;
  return {
    count: simulation.particles.count,
    positions: [...current.readVectors(ParticleField.Position)],
    ages: [...current.readAges()],
    ids: [...current.readIntegers(ParticleField.ParticleId)],
    spawnColors: [...simulation.particles.initialSpan.readVectors(ParticleField.Color)],
    colors: [...current.readVectors(ParticleField.Color)],
  };
};

describe('ParticleSystemSimulation.swapDefinitions', () => {
  it('recolours a running system in place: same particles, positions and ages, new colours', () => {
    const before = definition([255, 0, 0], [255, 255, 0], [0, 0, 255]);
    // The recolour: other spawn colours, another fade, and a colour operator appended (a gradient)
    const after = definition([0, 255, 0], [0, 255, 255], [255, 0, 255], [{ _class: 'C_OP_RemapScalar', m_nFieldInput: 3, m_nFieldOutput: 16 }]);
    const kept = running(before);
    const swapped = running(before);
    expect(snapshot(swapped)).toEqual(snapshot(kept));
    expect(kept.particles.count).toBeGreaterThan(10);

    expect(swapped.swapDefinitions(source(after))).toBe(true);
    kept.update(DT, 20 * DT);
    swapped.update(DT, 20 * DT);

    const was = snapshot(kept), now = snapshot(swapped);
    expect(now.count).toBe(was.count);
    expect(now.ids).toEqual(was.ids);
    expect(now.positions).toEqual(was.positions);
    expect(now.ages).toEqual(was.ages);
    // Each particle keeps its own draw between the colours: red to yellow by green, now green to cyan by blue
    for (let i = 0; i < now.count; i++) {
      const draw = was.spawnColors[i * 3 + 1];
      expect(now.spawnColors[i * 3]).toBeCloseTo(0, 5);
      expect(now.spawnColors[i * 3 + 1]).toBeCloseTo(1, 5);
      expect(now.spawnColors[i * 3 + 2]).toBeCloseTo(draw, 5);
    }
    expect(now.colors).not.toEqual(was.colors);
  });

  it('takes a new constant colour on live particles no initializer colours', () => {
    const plain = (color: number[]): KVObject => ({ ...definition([255, 255, 255], [255, 255, 255], [255, 255, 255]), m_ConstantColor: color,
      m_Initializers: (definition([0, 0, 0], [0, 0, 0], [0, 0, 0]).m_Initializers as KVObject[]).slice(0, 2), m_Operators: [{ _class: 'C_OP_BasicMovement' }, { _class: 'C_OP_Decay' }] });
    const simulation = running(plain([255, 0, 0, 255]));
    const count = simulation.particles.count;
    expect(simulation.swapDefinitions(source(plain([0, 0, 255, 255])))).toBe(true);
    simulation.update(DT, 20 * DT);
    expect(simulation.particles.count).toBeGreaterThanOrEqual(count);
    const { values, constant } = simulation.particles.currentSpan.tryGetVectors(ParticleField.Color);
    if (values) for (let i = 0; i < count; i++) expect([values[i * 3], values[i * 3 + 2]]).toEqual([0, 1]);
    else expect([constant.x, constant.z]).toEqual([0, 1]);
  });

  it('refuses a definition that emits differently, changing nothing', () => {
    const before = definition([255, 0, 0], [255, 255, 0], [0, 0, 255]);
    const simulation = running(before);
    const was = snapshot(simulation);
    const emitsMore = { ...before, m_Emitters: [{ _class: 'C_OP_ContinuousEmitter', m_flEmitRate: literal(80) }] };
    expect(simulation.swapDefinitions(source(emitsMore))).toBe(false);
    expect(snapshot(simulation)).toEqual(was);
  });
});
