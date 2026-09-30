import ReactThreeTestRenderer from '@react-three/test-renderer';
import * as THREE from 'three';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { ParticleEffect } from './ParticleEffect';
import type { FxDescriptor } from './fxDescriptor';
beforeAll(() => { (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });
const descriptor: FxDescriptor = {
  name: 'hand', constantRadius: 5, maxParticles: 64,
  controlPoints: [{ cp: 2, attachment: 'ability_cast', attachType: 'PATTACH_POINT_FOLLOW', entity: 'self' }],
  emitters: [{ class: 'C_OP_ContinuousEmitter', params: { m_flEmitRate: 2, m_bForceEmitOnFirstUpdate: true } }],
  initializers: [{ class: 'C_INIT_InitFloat', params: { m_nOutputField: 1, m_InputValue: 3 } }],
  operators: [{ class: 'C_OP_PositionLock', params: {} }],
  renderers: [{ class: 'C_OP_RenderSprites', mode: 'sprite', blendMode: 'ADD', params: {}, textures: [] }], children: [],
};
describe('particle playback and model units', () => {
  it('anchors sprites at the hand, follows motion, and pauses ages and emission', async () => {
    const model = new THREE.Group();
    const skeleton = new THREE.Group(); skeleton.name = 'skeleton'; skeleton.scale.setScalar(0.0254);
    const hand = new THREE.Bone(); hand.name = 'hand_R'; hand.position.set(10, 20, 30);
    skeleton.add(hand); model.add(skeleton);
    const render = (paused: boolean) => <group scale={0.5}><primitive object={model} />
      <ParticleEffect descriptor={descriptor} textureBaseUrl="/" model={model} playback={{ paused, speed: 1 }} />
    </group>;
    const renderer = await ReactThreeTestRenderer.create(render(false));
    try {
      await renderer.advanceFrames(1, 0.05);
      let mesh: THREE.Mesh | undefined;
      renderer.scene.instance.traverse((o) => { if (o instanceof THREE.Mesh) mesh = o; });
      const geometry = mesh!.geometry as THREE.InstancedBufferGeometry;
      const position = geometry.getAttribute('aPosition');
      expect(geometry.instanceCount).toBe(1);
      expect(position.getX(0)).toBeCloseTo(10*0.0254);
      expect(position.getY(0)).toBeCloseTo(20*0.0254);
      expect(geometry.getAttribute('aRadius').getX(0)).toBeCloseTo(5*0.0254);
      hand.position.x += 10;
      await renderer.advanceFrames(1, 0.05);
      expect(position.getX(0)).toBeCloseTo(20*0.0254);
      await renderer.update(render(true));
      const frozen = Array.from(position.array);
      await renderer.advanceFrames(30, 0.05);
      expect(geometry.instanceCount).toBe(1); expect(Array.from(position.array)).toEqual(frozen);
      await renderer.update(render(false));
      await renderer.advanceFrames(10, 0.05);
      expect(geometry.instanceCount).toBe(2);
    } finally { await renderer.unmount(); }
  });
  it('disposes GPU resources on unmount', async () => {
    const disposeGeometry = vi.spyOn(THREE.InstancedBufferGeometry.prototype, 'dispose');
    const disposeMaterial = vi.spyOn(THREE.ShaderMaterial.prototype, 'dispose');
    const renderer = await ReactThreeTestRenderer.create(<ParticleEffect descriptor={descriptor} textureBaseUrl="/" />);
    await renderer.unmount();
    expect(disposeGeometry).toHaveBeenCalled(); expect(disposeMaterial).toHaveBeenCalled();
    vi.restoreAllMocks();
  });
});
