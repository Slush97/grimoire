import ReactThreeTestRenderer from '@react-three/test-renderer';
import * as THREE from 'three';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { ParticleEffect } from './ParticleEffect';
import { remapSpriteNormal, spriteInitialColor, spriteParamsFor, type FxDescriptor, type FxNode } from './fxDescriptor';
beforeAll(() => { (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });
const initializers: FxNode[] = [
  { class: 'C_INIT_SetAttributeToScalarExpression', params: { m_nExpression: 'SCALAR_EXPRESSION_MOD', m_nOutputField: 18, m_flInput1: { pf: 'PF_TYPE_PARTICLE_NUMBER' }, m_flInput2: 2 } },
  { class: 'C_INIT_InitVec', params: { m_InputValue: { m_nType: 'PVEC_TYPE_FLOAT_INTERP_GRADIENT', m_FloatInterp: { pf: 'PF_TYPE_PARTICLE_FLOAT', field: 18 }, m_Gradient: { m_Stops: [{ m_flPosition: 0, m_Color: [52, 67, 70] }, { m_flPosition: 1, m_Color: [162, 159, 152] }] } } } },
];
describe('normal-oriented authored particles', () => {
  it('distinguishes position field zero from radius field three', () => {
    const d: FxDescriptor = { name: 'fields', constantRadius: 5, controlPoints: [], emitters: [], operators: [], children: [],
      initializers: [{ class: 'C_INIT_InitFloat', params: { m_nOutputField: 0, m_InputValue: 100 } }, { class: 'C_INIT_InitFloat', params: { m_nOutputField: 3, m_InputValue: 7 } }],
      renderers: [{ class: 'C_OP_RenderSprites', mode: 'sprite', blendMode: null, textures: [], params: {} }] };
    expect(spriteParamsFor(d)?.radius).toEqual([7, 7]);
    expect(spriteParamsFor({ ...d, initializers: d.initializers.slice(0, 1) })?.radius).toEqual([5, 5]);
  });
  it('uses ordered scalar scratch values to alternate replacement colors', () => {
    expect(spriteInitialColor(initializers, 0)).toEqual([52/255, 67/255, 70/255]);
    expect(spriteInitialColor(initializers, 1)).toEqual([162/255, 159/255, 152/255]);
    expect(spriteInitialColor(initializers, 2)).toEqual(spriteInitialColor(initializers, 0));
    expect(spriteInitialColor([...initializers].reverse(), 0)).toBeNull();
  });
  it('preserves Source non-unit-axis rotation and epsilon normalization', () => {
    const value = remapSpriteNormal([2, 3, 4], [1, 0, 1], Math.PI/2, false);
    expect(value[0]).toBeCloseTo(3); expect(value[1]).toBeCloseTo(-2); expect(value[2]).toBeCloseTo(9);
    expect(remapSpriteNormal([0, 0, 0], [1, 0, 1], Math.PI/2, true)).toEqual([0, 0, 1]);
  });
  it('spawns in a rotated attachment ring, follows its translation, rotates its normal and freezes when paused', async () => {
    const random = vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const model = new THREE.Group(), skeleton = new THREE.Group(); skeleton.name = 'skeleton'; skeleton.scale.setScalar(0.0254);
    const bone = new THREE.Bone(); bone.name = 'hand'; skeleton.add(bone); model.add(skeleton);
    const d: FxDescriptor = { name: 'ring', controlPoints: [{ cp: 0, attachment: 'apply', attachType: 'PATTACH_POINT_FOLLOW', entity: 'self' }],
      attachments: [{ name: 'apply', bone: 'hand', position: [0, 0, 0], rotation: [0, 0, Math.SQRT1_2, Math.SQRT1_2] }],
      emitters: [{ class: 'C_OP_InstantaneousEmitter', params: { m_nParticlesToEmit: 1 } }],
      initializers: [{ class: 'C_INIT_RingWave', params: { m_flInitialRadius: 40, m_flThickness: 0 } },
        { class: 'C_INIT_InitFloat', params: { m_nOutputField: 1, m_InputValue: 5 } },
        { class: 'C_INIT_RemapInitialDirectionToTransformToVector', params: { m_nFieldOutput: 21, m_vecOffsetAxis: [1, 0, 1], m_flOffsetRot: 90, m_bNormalize: true } }, ...initializers],
      operators: [{ class: 'C_OP_PositionLock', params: {} }, { class: 'C_OP_RotateVector', params: { m_vecRotAxisMin: [0, 0, 1], m_vecRotAxisMax: [0, 0, 1], m_flRotRateMin: 90, m_flRotRateMax: 90 } }],
      renderers: [{ class: 'C_OP_RenderSprites', mode: 'sprite', blendMode: null, textures: [], params: { m_nOrientationType: 'PARTICLE_ORIENTATION_ALIGN_TO_PARTICLE_NORMAL' } }], children: [] };
    const playback = { paused: false, speed: 1 };
    const renderer = await ReactThreeTestRenderer.create(<group><primitive object={model} /><ParticleEffect descriptor={d} textureBaseUrl="/" model={model} playback={playback} /></group>);
    try {
      await renderer.advanceFrames(1, 0.1);
      let mesh: THREE.Mesh | undefined; renderer.scene.instance.traverse((o) => { if (o instanceof THREE.Mesh) mesh = o; });
      const p = mesh!.geometry.getAttribute('aPosition'), right = mesh!.geometry.getAttribute('aRight');
      expect(p.getX(0)).toBeCloseTo(0); expect(p.getY(0)).toBeCloseTo(-40*0.0254);
      expect(new THREE.Vector3().fromBufferAttribute(right, 0).length()).toBeCloseTo(1);
      const before = right.array.slice(); bone.position.x = 10; await renderer.advanceFrames(1, 0.1);
      expect(p.getX(0)).toBeCloseTo(10*0.0254); expect(right.array).not.toEqual(before);
      playback.paused = true; const paused = right.array.slice(); await renderer.advanceFrames(2, 0.1); expect(right.array).toEqual(paused);
      expect((mesh!.material as THREE.ShaderMaterial).uniforms.uAlignNormal.value).toBe(1);
    } finally { await renderer.unmount(); random.mockRestore(); }
  });
});
