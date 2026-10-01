import ReactThreeTestRenderer from '@react-three/test-renderer';
import * as THREE from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { ParticleRopes } from './ParticleRopes';
import type { FxDescriptor } from './fxDescriptor';
beforeAll(() => { (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });
describe('snapshot ribbon playback', () => {
  it('follows animated bones, retains authored width/index curves and freezes texture age during pause', async () => {
    const model = new THREE.Group(), root = new THREE.Group(); root.name = 'skeleton'; root.scale.setScalar(.0254); model.add(root);
    const bone = new THREE.Bone(); bone.name = 'head'; root.add(bone);
    const skin = new THREE.SkinnedMesh(); skin.skeleton = new THREE.Skeleton([bone], [new THREE.Matrix4()]); root.add(skin);
    const d: FxDescriptor = { name: 'trace', scale: 1, constantColor: [93,150,255], controlPoints: [], emitters: [{ class: 'C_OP_InstantaneousEmitter', params: { m_nParticlesToEmit: 28 } }],
      snapshot: { points: [0, 1, 2].map((x) => ({ position: [x, 0, 80], joints: ['head', '', '', ''], weights: [1, 0, 0, 0] })) },
      initializers: [{ class: 'C_INIT_InitSkinnedPositionFromCPSnapshot', params: {} }, { class: 'C_INIT_InitFloat', params: { m_InputValue: 5 } }, { class: 'C_INIT_InitFloat', params: { m_nOutputField: 39, m_InputValue: .75 } },
        { class: 'C_INIT_InitFloat', params: { m_nSetMethod: 'PARTICLE_SET_SCALE_INITIAL_VALUE', m_InputValue: { pf: 'PF_TYPE_PARTICLE_NUMBER_NORMALIZED', curve: { m_spline: [{ x: 0, y: 1 }, { x: 1, y: 0 }] } } } }],
      operators: [{ class: 'C_OP_SnapshotRigidSkinToBones', params: {} }], children: [], renderers: [{ class: 'C_OP_RenderRopes', mode: 'rope', blendMode: 'ADD', textures: [], params: {
        m_nMaxTesselation: 8, m_flSelfIllumAmount: 1, m_flDiffuseAmount: 0, m_flDepthBias: -5, m_flRadiusScale: 2, m_flTextureVWorldSize: 50,
        m_vecTexturesInput: [{ m_bReplaceTextureWithGradient: true, m_Gradient: { m_Stops: [{ m_flPosition: 0, m_Color: [255, 0, 0] }, { m_flPosition: 1, m_Color: [0, 0, 255] }] },
          m_TextureControls: { m_flFinalTextureOffsetV: { pf: 'PF_TYPE_COLLECTION_AGE', mult: .3 } } }],
      } }] };
    const playback = { paused: false, speed: 1 };
    const renderer = await ReactThreeTestRenderer.create(<group><primitive object={model} /><ParticleRopes descriptor={d} model={model} textureBaseUrl="/" playback={playback} /></group>);
    try {
      await renderer.advanceFrames(1, .1);
      let mesh: THREE.Mesh | undefined; renderer.scene.instance.traverse((object) => { if (object instanceof THREE.Mesh && !(object instanceof THREE.SkinnedMesh)) mesh = object; });
      const position = mesh!.geometry.getAttribute('position');
      expect(position.count).toBe(34); // snapshot count, not the emitter's inactive literal28
      expect(new THREE.Vector3().fromBufferAttribute(position, 0).distanceTo(new THREE.Vector3().fromBufferAttribute(position, 1))).toBeCloseTo(20*.0254);
      expect(new THREE.Vector3().fromBufferAttribute(position, 32).distanceTo(new THREE.Vector3().fromBufferAttribute(position, 33))).toBeCloseTo(20*.0254/3);
      const before = position.getX(2); bone.position.x = 10; await renderer.advanceFrames(1, .1); expect(position.getX(2)-before).toBeCloseTo(10*.0254);
      const material = mesh!.material as THREE.ShaderMaterial; expect(material.uniforms.uv0.value.w).toBeCloseTo(.06);
      expect(mesh!.geometry.getAttribute('aAlpha').getX(0)).toBeCloseTo(.75);
      expect(mesh!.geometry.getAttribute('aColor').getZ(0)).toBe(1);
      expect(mesh!.geometry.getAttribute('aColor').getX(0)).toBeLessThan(.2);
      expect(material.uniforms.ropeDepthBias.value).toBeCloseTo(-5*.0254);
      playback.paused = true; await renderer.advanceFrames(2, .1); expect(material.uniforms.uv0.value.w).toBeCloseTo(.06);
      expect((material.uniforms.tex0.value as THREE.DataTexture).image.width).toBe(256);
    } finally { await renderer.unmount(); }
  });
});
