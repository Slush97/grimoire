import { describe, expect, it } from 'vitest';
import modelFixtureText from '../__fixtures__/model_abrams_book.json?raw';
import type { KVObject } from '../kv';
import { createTranslation } from '../model';
import { Matrix4x4, Vector3, transform } from '../numerics';
import { type CompactOracleModel, expandModel } from '../oracleDiff';
import type { BundleEffect, ParticleBundle } from './bundle';
import { HeroParticleHost } from './heroParticleHost';
import { ParticleField } from '../enums';

const fixture = JSON.parse(modelFixtureText) as { system: string; definitions: Record<string, KVObject>; formats: Record<string, string>; model: CompactOracleModel; snapshots: ParticleBundle['snapshots'] };
const model = expandModel(fixture.model);
const bone = model.bones[1].name;

function bundle(effect: Partial<BundleEffect>, configuration?: KVObject): ParticleBundle {
  const systems = Object.fromEntries(Object.entries(fixture.definitions).map(([path, data]) => [path, { data, format: fixture.formats[`${path}_c`] ?? null }]));
  const root = systems[fixture.system];
  systems[fixture.system] = { ...root, data: { ...root.data, m_controlPointConfigurations: configuration ? [configuration] : [] } };
  return {
    version: 1, hero: 'Abrams', modelEntry: 'models/x.vmdl_c',
    effects: [{ id: '0', system: fixture.system, source: 'model-particle-cfg', evidence: 'test', configuration: 'preview', attachment: null, attachmentCp1: null, ...effect }],
    systems, snapshots: fixture.snapshots, textures: {}, model,
    attachments: [{ name: 'hand_fx', ignoreRotation: false, influences: [{ bone, offset: [1, 2, 3], rotation: [0, 0, 0, 1], weight: 1, rootTransform: false }] }],
    diagnostics: [],
  };
}

const listener = { added: () => {}, removed: () => {} };
const camera = new Vector3(0, -100, 50);

describe('HeroParticleHost', () => {
  it('supplies the candle input before emission without replacing other CP components', () => {
    const candle = 'particles/abilities/familiar/familiar_ambient_candle.vpcf';
    const input = bundle({ system: candle });
    input.systems[candle] = { format: null, data: {
      _class: 'CParticleSystemDefinition',
      m_controlPointConfigurations: [{ m_name: 'preview', m_drivers: [{ m_iControlPoint: 2, m_vecOffset: [0, 7, 9] }] }],
      m_Emitters: [{ _class: 'C_OP_InstantaneousEmitter', m_nParticlesToEmit: 1 }],
      m_Initializers: [{ _class: 'C_INIT_InitFloat', m_nOutputField: ParticleField.LifeDuration,
        m_InputValue: { m_nType: 'PF_TYPE_CONTROL_POINT_COMPONENT', m_nControlPoint: 2, m_nVectorComponent: 0 } }],
    } };
    const host = new HeroParticleHost(input, listener);
    expect(host.failures).toEqual([]);
    const effect = host.activeHosts[0];
    expect(effect.simulation.getControlPoint(2).position).toEqual(new Vector3(1, 7, 9));
    host.update(1 / 60, 1, false, camera);
    expect(effect.simulation.currentParticles.readFloats(ParticleField.LifeDuration)[0]).toBe(1);
    effect.simulation.replay();
    host.update(1 / 60, 1, false, camera);
    expect(effect.simulation.getControlPoint(2).position).toEqual(new Vector3(1, 7, 9));
  });
  it('places configuration drivers on the posed attachment and keeps following ones there', () => {
    const host = new HeroParticleHost(bundle({}, {
      m_name: 'preview',
      m_drivers: [
        { m_iControlPoint: 1, m_iAttachType: 'PATTACH_POINT_FOLLOW', m_attachmentName: 'hand_fx', m_entityName: 'self' },
        { m_iControlPoint: 2, m_iAttachType: 'PATTACH_WORLDORIGIN', m_vecOffset: [5, 0, 0], m_entityName: 'self' },
      ],
    }), listener);
    expect(host.failures).toEqual([]);
    const [effect] = host.activeHosts;
    const bind = new Array<Matrix4x4>(model.bones.length);
    effect.simulation.getControlPoint(0).modelObject!.model.getBindPose(bind);

    host.update(0.1, 1, false, camera);
    const atBind = effect.simulation.getControlPoint(1).position;
    // The influence offset carried by the bone's bind pose
    const expected = transform(new Vector3(1, 2, 3), bind[1]);
    expect(atBind.sub(expected).length()).toBeLessThan(1e-4);
    expect(effect.simulation.getControlPoint(2).position).toEqual(new Vector3(5, 0, 0));
    // Control point 0 follows the first driver's attachment, as VRF's preview does
    expect(effect.simulation.getControlPoint(0).position).toEqual(atBind);

    // Move the bone: the following control point moves with it, the world origin one does not
    host.pose.bones[1] = bind[1].multiply(createTranslation(new Vector3(0, 0, 10)));
    host.update(0.1, 1, false, camera);
    expect(effect.simulation.getControlPoint(1).position.z).toBeCloseTo(atBind.z + 10, 4);
    expect(effect.simulation.getControlPoint(2).position).toEqual(new Vector3(5, 0, 0));
    expect(effect.simulation.getControlPoint(0).modelObject).not.toBeNull();
  });

  it('steps the tree by the frame time at the playback speed and pauses', () => {
    const host = new HeroParticleHost(bundle({}), listener);
    const [effect] = host.activeHosts;
    host.update(0.05, 2, false, camera);
    const age = effect.simulation.renderState.age;
    expect(age).toBeCloseTo(0.1, 6);
    host.update(1, 1, true, camera);
    expect(effect.simulation.renderState.age).toBe(age);
    host.update(0.2, 1, false, camera);
    expect(effect.simulation.children.some((child) => child.currentParticles.length > 0)).toBe(true);
  });

  it('attaches a model particle to its attachment frame and plays animation events with the clip', () => {
    const attached = new HeroParticleHost(bundle({ source: 'model-particles-list', configuration: null, attachment: { type: 'point_follow', point: 'hand_fx', offset: [0, 0, 0] } }), listener);
    attached.update(0.05, 1, false, camera);
    const point = attached.activeHosts[0].simulation.getControlPoint(0).position;
    expect(point.length()).toBeGreaterThan(0);

    const events = new HeroParticleHost(bundle({
      source: 'anim-event', configuration: 'preview',
      clip: { name: 'ui_pose', start: 0.5, stops: [{ time: 0.9, immediately: true, endCap: false }], stopOnClipChange: true },
    }), listener);
    expect(events.activeHosts).toHaveLength(0);
    events.setClip({ name: 'ui_pose', time: 0.4, duration: 1 });
    expect(events.activeHosts).toHaveLength(0);
    events.setClip({ name: 'ui_pose', time: 0.6, duration: 1 });
    expect(events.activeHosts).toHaveLength(1);
    events.update(0.2, 1, false, camera);
    events.setClip({ name: 'ui_pose', time: 0.95, duration: 1 });
    expect(events.activeHosts[0].stopped).toBe(true);
    events.update(0.1, 1, false, camera);
    expect(events.activeHosts).toHaveLength(0);
  });
});
