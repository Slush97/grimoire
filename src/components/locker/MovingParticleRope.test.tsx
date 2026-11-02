import ReactThreeTestRenderer from '@react-three/test-renderer';
import * as THREE from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { MovingParticleRope } from './MovingParticleRope';
import type { FxDescriptor, FxRenderer } from './fxDescriptor';

beforeAll(() => { Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); });

const renderer: FxRenderer = {
  class: 'C_OP_RenderRopes', mode: 'rope', blendMode: null, textures: [],
  params: { m_flSelfIllumAmount: 1, m_vecTexturesInput: [{ m_bReplaceTextureWithGradient: true }] },
};

const system: FxDescriptor = {
  name: 'attached-smoke', constantRadius: 0, constantLifespan: 2,
  controlPoints: [{ cp: 3, attachType: 'PATTACH_POINT_FOLLOW', attachment: 'tip', entity: 'self' }],
  emitters: [{ class: 'C_OP_ContinuousEmitter', params: { m_flEmitRate: 6 } }],
  initializers: [{ class: 'C_INIT_CreateWithinSphereTransform', params: { m_TransformInput: { m_nControlPoint: 3 } } }],
  operators: [
    { class: 'C_OP_BasicMovement', params: {} },
    { class: 'C_OP_PositionLock', params: { m_flStartTime_min: .1, m_flEndTime_max: .4 } },
  ], renderers: [renderer], children: [],
};

describe('moving particle attachment', () => {
  it.each([
    { m_flStartTime_min: .1, m_flEndTime_max: .4 },
    {},
  ])('keeps young ribbon points on a moving tip through sparse emission and normalization: %j', async lock => {
    const model = new THREE.Group();
    const source = new THREE.Group(); source.name = 'skeleton'; source.scale.setScalar(.0254);
    source.quaternion.setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
    const bone = new THREE.Bone(); bone.name = 'weapon'; source.add(bone); model.add(source);
    const playback = { paused: false, speed: 1 };
    const descriptor = { ...system, operators: [system.operators[0], { class: 'C_OP_PositionLock', params: lock }] };
    const test = await ReactThreeTestRenderer.create(<group scale={.7} position={[2, -1, 3]}>
      <primitive object={model} />
      <MovingParticleRope system={descriptor} renderer={renderer} model={model} textureBaseUrl="/" delay={0} scale={1}
        attachments={[{ name: 'tip', bone: 'weapon', position: [0, 20, 0], rotation: [0, 0, 0, 1] }]} playback={playback} />
    </group>);
    try {
      for (let frame = 0; frame < 7; frame++) {
        bone.position.x += 5;
        await test.advanceFrames(1, .05);
      }
      const mesh = test.scene.instance.children[0].children.find(object => object instanceof THREE.Mesh);
      expect(mesh).toBeInstanceOf(THREE.Mesh);
      if (!(mesh instanceof THREE.Mesh) || !mesh.parent) throw new Error('Missing ribbon');
      expect(mesh.visible).toBe(true);
      const expected = mesh.parent.worldToLocal(bone.localToWorld(new THREE.Vector3(0, 20, 0)));
      const positions = mesh.geometry.getAttribute('position');
      const corners = Math.ceil(mesh.geometry.drawRange.count / 6) * 2 + 2;
      for (let i = 0; i < corners; i++) {
        expect(new THREE.Vector3().fromBufferAttribute(positions, i).distanceTo(expected)).toBeLessThan(1e-6);
      }
    } finally { await test.unmount(); }
  });
});
