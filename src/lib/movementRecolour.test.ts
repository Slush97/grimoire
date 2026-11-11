import { describe, expect, it } from 'vitest';
import { movementFxSchema, type MovementFxChoice } from './movementFx';
import { DASH_STAMP_PATH, PARRY_SHIELD_PATH, PARRY_SHIELD_TEXTURE, applyMovementRecolour, paletteFor, parseTypedKV, planMovementRecolour, recolourSystem } from './movementRecolour';
import type { ParticleBundle } from './particles/host/bundle';
import type { KVObject } from './particles/kv';

// A 1x1 PNG
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==';
const choice = (value: Partial<MovementFxChoice> & { kind: MovementFxChoice['kind'] }) => movementFxSchema.parse({ color: '#ff0000', image: null, ...value });

const trail = (): KVObject => ({
  _class: 'CParticleSystemDefinition',
  m_ConstantColor: [100, 200, 50, 255],
  m_Renderers: [{ _class: 'C_OP_RenderRopes', m_nOutputBlendMode: 'PARTICLE_OUTPUT_BLEND_MODE_ADD', m_vecTexturesInput: [{ m_hTexture: 'materials/particle/beam.vtex' }] }],
  m_Operators: [],
});

describe('parseTypedKV', () => {
  it('keeps KV3 integers apart from doubles holding whole numbers', () => {
    expect(parseTypedKV('{"a": [1, 2.0, -3]}')).toEqual({ a: [1n, 2, -3n] });
  });
});

describe('planMovementRecolour', () => {
  it('finds integer colour arrays only and gives children their root part', async () => {
    const trees: Record<string, string> = {
      'particles/abilities/melee/melee_parry_success.vpcf_c': '{"_class": "CParticleSystemDefinition", "m_Children": [{"m_ChildRef": "particles/abilities/melee/melee_parry_shared.vpcf"}], "m_ColorMin": [255, 128, 0]}',
      'particles/abilities/melee/melee_parry_shared.vpcf_c': '{"_class": "CParticleSystemDefinition", "m_vecTint": [1.0, 0.5, 0.25], "m_Gradient": {"m_Stops": [{"m_Color": [10, 20, 30, 255]}]}}',
    };
    const plan = await planMovementRecolour('parry', ['particles/abilities/melee/melee_parry_success.vpcf_c'], async (entry) => parseTypedKV(trees[entry]));
    expect(plan.systems['particles/abilities/melee/melee_parry_success.vpcf_c']).toEqual({ part: 'catch', colors: [['m_ColorMin']] });
    expect(plan.systems['particles/abilities/melee/melee_parry_shared.vpcf_c']).toEqual({ part: 'catch', colors: [['m_Gradient', 'm_Stops', 0, 'm_Color']] });
  });
});

describe('recolourSystem', () => {
  it('scales each colour to the original peak and stamps a dash trail as alpha-blended sprites', () => {
    const out = recolourSystem(trail(), 'particles/generic/air_dash_trail.vpcf_c', { part: 'shield', colors: [['m_ConstantColor']] }, 'dash',
      choice({ kind: 'dash', color: '#00ff80', image: PNG }));
    expect(out.m_ConstantColor).toEqual([0, 200, 100, 255]);
    const renderer = (out.m_Renderers as KVObject[])[0];
    expect(renderer._class).toBe('C_OP_RenderSprites');
    expect(renderer.m_nOutputBlendMode).toBe('PARTICLE_OUTPUT_BLEND_MODE_ALPHA');
    expect((renderer.m_vecTexturesInput as KVObject[])[0].m_hTexture).toBe(DASH_STAMP_PATH);
    expect(renderer.m_flSelfIllumAmount).toEqual({ m_nType: 'PF_TYPE_LITERAL', m_flLiteralValue: 1 });
  });

  it('keeps an original parry part but for its stamp', () => {
    const shield: KVObject = { _class: 'CParticleSystemDefinition', m_ConstantColor: [10, 20, 30], m_Renderers: [{ _class: 'C_OP_RenderSprites', m_vecTexturesInput: [{ m_hTexture: PARRY_SHIELD_TEXTURE }] }] };
    const value = choice({ kind: 'parry', image: PNG, parts: { linked: false, shield: { original: true, color: '#00ff00', palette: { mode: 'solid' } },
      catch: { original: false, color: '#0000ff', palette: { mode: 'solid' } }, stun: { original: false, color: '#ffffff', palette: { mode: 'rainbow' } } } });
    const out = recolourSystem(shield, 'particles/abilities/melee/melee_parry_symbol.vpcf_c', { part: 'shield', colors: [['m_ConstantColor']] }, 'parry', value);
    expect(out.m_ConstantColor).toEqual([10, 20, 30]);
    expect(((out.m_Renderers as KVObject[])[0].m_vecTexturesInput as KVObject[])[0].m_hTexture).toBe(PARRY_SHIELD_PATH);
    expect(paletteFor(value, 'catch')).toEqual({ mode: 'solid', color: [0, 0, 255] });
    expect(paletteFor(value, 'stun')).toEqual({ mode: 'rainbow' });
  });
});

describe('applyMovementRecolour', () => {
  it('replaces the planned systems only and serves the stamp from its data URL', () => {
    const other: KVObject = { _class: 'CParticleSystemDefinition' };
    const bundle = { systems: { 'particles/generic/air_dash_trail.vpcf': { data: trail(), format: null }, 'particles/other.vpcf': { data: other, format: null } }, textures: {} } as unknown as ParticleBundle;
    const stamp = { width: 64, height: 64, format: 4, flags: 0, mipLevels: 7, motionVectorsMaxDistance: 0, sheet: null };
    const live = applyMovementRecolour(bundle, { systems: { 'particles/generic/air_dash_trail.vpcf': { part: 'shield', colors: [['m_ConstantColor']] } }, stamp },
      choice({ kind: 'dash', image: PNG }));
    expect(live.systems['particles/other.vpcf']).toBe(bundle.systems['particles/other.vpcf']);
    expect(live.systems['particles/generic/air_dash_trail.vpcf'].data.m_ConstantColor).toEqual([200, 0, 0, 255]);
    expect(live.textures[DASH_STAMP_PATH]).toEqual({ file: '', url: PNG, info: stamp });
    expect(bundle.systems['particles/generic/air_dash_trail.vpcf'].data.m_ConstantColor).toEqual([100, 200, 50, 255]);
  });
});
