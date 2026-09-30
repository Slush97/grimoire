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
  it('adds sprite radiance while accumulating canvas coverage separately', async () => {
    const unanchored = { ...descriptor, controlPoints: [] };
    const renderer = await ReactThreeTestRenderer.create(<ParticleEffect descriptor={unanchored} textureBaseUrl="/" />);
    try {
      let material: THREE.ShaderMaterial | undefined;
      renderer.scene.instance.traverse((o) => { if (o instanceof THREE.Mesh) material = o.material as THREE.ShaderMaterial; });
      expect(material!.blending).toBe(THREE.CustomBlending);
      expect(material!.blendSrc).toBe(THREE.SrcAlphaFactor);
      expect(material!.blendDst).toBe(THREE.OneFactor);
      expect(material!.blendSrcAlpha).toBe(THREE.OneFactor);
      expect(material!.blendDstAlpha).toBe(THREE.OneMinusSrcAlphaFactor);
      expect(material!.uniforms.uAdditive.value).toBe(1);
      await renderer.update(<ParticleEffect descriptor={{ ...unanchored, renderers: [{ ...descriptor.renderers[0], blendMode: 'ALPHA' }] }} textureBaseUrl="/" />);
      renderer.scene.instance.traverse((o) => { if (o instanceof THREE.Mesh) material = o.material as THREE.ShaderMaterial; });
      expect(material!.blending).toBe(THREE.NormalBlending);
      expect(material!.uniforms.uAdditive.value).toBe(0);
    } finally { await renderer.unmount(); }
  });
  it('composes a nonidentity authored frame with the bone once across motion', async () => {
    const model = new THREE.Group();
    const skeleton = new THREE.Group(); skeleton.name = 'skeleton'; skeleton.scale.setScalar(0.0254);
    const hand = new THREE.Bone(); hand.name = 'hand_L'; hand.position.set(10, 20, 30);
    skeleton.add(hand); model.add(skeleton);
    const rotation = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI/2);
    model.userData.grimoireAttachments = [{ name: 'ability_cast', bone: 'hand_L', position: [2, 0, 0], rotation: rotation.toArray() }];
    const d: FxDescriptor = { ...descriptor,
      emitters: [{ class: 'C_OP_InstantaneousEmitter', params: { m_nParticlesToEmit: 1 } }],
      initializers: [{ class: 'C_INIT_PositionOffset', params: { m_bLocalCoords: true, m_OffsetMin: [4, 0, 0], m_OffsetMax: [4, 0, 0] } }],
      operators: [{ class: 'C_OP_PositionLock', params: { m_bLockRot: true } }],
    };
    const renderer = await ReactThreeTestRenderer.create(<group><primitive object={model} /><ParticleEffect descriptor={d} textureBaseUrl="/" model={model} /></group>);
    try {
      let mesh: THREE.Mesh | undefined;
      renderer.scene.instance.traverse((o) => { if (o instanceof THREE.Mesh) mesh = o; });
      const p = mesh!.geometry.getAttribute('aPosition');
      await renderer.advanceFrames(1, 1/30);
      expect(p.getX(0)).toBeCloseTo(12*0.0254); expect(p.getY(0)).toBeCloseTo(24*0.0254);
      hand.rotation.z = Math.PI/2;
      await renderer.advanceFrames(1, 1/30);
      expect(p.getX(0)).toBeCloseTo(6*0.0254); expect(p.getY(0)).toBeCloseTo(22*0.0254);
      expect(p.getZ(0)).toBeCloseTo(30*0.0254);
    } finally { await renderer.unmount(); }
  });
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
  it('distinguishes Source world offsets from local attachment velocity under rotated roots', async () => {
    const model = new THREE.Group();
    const skeleton = new THREE.Group(); skeleton.name = 'skeleton'; skeleton.scale.setScalar(0.0254);
    skeleton.rotation.z = Math.PI/2;
    const hand = new THREE.Bone(); hand.name = 'ability_cast'; hand.rotation.y = Math.PI/2;
    skeleton.add(hand); model.add(skeleton);
    const d: FxDescriptor = { ...descriptor,
      emitters: [{ class: 'C_OP_InstantaneousEmitter', params: { m_nParticlesToEmit: 1 } }],
      operators: [{ class: 'C_OP_BasicMovement', params: {} }],
      initializers: [
        { class: 'C_INIT_PositionOffset', params: { m_OffsetMin: [4, 0, 0], m_OffsetMax: [4, 0, 0] } },
        { class: 'C_INIT_CreateWithinSphereTransform', params: {
          m_TransformInput: { m_nControlPoint: 2 },
          m_LocalCoordinateSystemSpeedMin: [10, 0, 0], m_LocalCoordinateSystemSpeedMax: [10, 0, 0],
        } },
      ],
    };
    const renderer = await ReactThreeTestRenderer.create(<group><primitive object={model} />
      <ParticleEffect descriptor={d} textureBaseUrl="/" model={model} />
    </group>);
    try {
      await renderer.advanceFrames(1, 0.05);
      let mesh: THREE.Mesh | undefined;
      renderer.scene.instance.traverse((o) => { if (o instanceof THREE.Mesh) mesh = o; });
      const p = mesh!.geometry.getAttribute('aPosition');
      expect(p.getX(0)).toBeCloseTo(0);
      expect(p.getY(0)).toBeCloseTo(4*0.0254);
      expect(p.getZ(0)).toBeCloseTo(-0.5*0.0254);
      await renderer.advanceFrames(1, 0.05);
      expect(p.getZ(0)).toBeCloseTo(-1*0.0254);
    } finally { await renderer.unmount(); }
  });
  it('freezes delayed emitters while paused and resets their clocks when a descriptor changes', async () => {
    const delayed: FxDescriptor = { ...descriptor, controlPoints: [],
      emitters: [{ class: 'C_OP_InstantaneousEmitter', params: { m_flStartTime: 0.2, m_nParticlesToEmit: 2 } }],
    };
    const render = (paused: boolean, d = delayed) => <ParticleEffect descriptor={d} textureBaseUrl="/" playback={{ paused, speed: 1 }} />;
    const renderer = await ReactThreeTestRenderer.create(render(false));
    try {
      let mesh: THREE.Mesh | undefined;
      renderer.scene.instance.traverse((o) => { if (o instanceof THREE.Mesh) mesh = o; });
      await renderer.advanceFrames(2, 0.05);
      expect((mesh!.geometry as THREE.InstancedBufferGeometry).instanceCount).toBe(0);
      await renderer.update(render(true));
      await renderer.advanceFrames(30, 0.05);
      expect((mesh!.geometry as THREE.InstancedBufferGeometry).instanceCount).toBe(0);
      await renderer.update(render(false));
      await renderer.advanceFrames(2, 0.05);
      expect((mesh!.geometry as THREE.InstancedBufferGeometry).instanceCount).toBe(2);
      await renderer.update(render(false, { ...delayed, name: 'replacement' }));
      await renderer.advanceFrames(1, 0.05);
      expect((mesh!.geometry as THREE.InstancedBufferGeometry).instanceCount).toBe(0);
    } finally { await renderer.unmount(); }
  });
  it('honors movement operators and Source drag while full rotation locks preserve local offsets', async () => {
    const model = new THREE.Group();
    const skeleton = new THREE.Group(); skeleton.name = 'skeleton'; skeleton.scale.setScalar(0.0254);
    const hand = new THREE.Bone(); hand.name = 'ability_cast'; skeleton.add(hand); model.add(skeleton);
    const d: FxDescriptor = { ...descriptor,
      emitters: [{ class: 'C_OP_InstantaneousEmitter', params: { m_nParticlesToEmit: 1 } }],
      initializers: [
        { class: 'C_INIT_PositionOffset', params: { m_bLocalCoords: true, m_OffsetMin: [4, 0, 0], m_OffsetMax: [4, 0, 0] } },
        { class: 'C_INIT_CreateWithinSphereTransform', params: {
          m_TransformInput: { m_nControlPoint: 2 },
          m_LocalCoordinateSystemSpeedMin: [10, 0, 0], m_LocalCoordinateSystemSpeedMax: [10, 0, 0],
        } },
      ],
      operators: [{ class: 'C_OP_PositionLock', params: { m_bLockRot: true } }],
    };
    const render = (effect: FxDescriptor) => <group><primitive object={model} />
      <ParticleEffect descriptor={effect} textureBaseUrl="/" model={model} />
    </group>;
    const renderer = await ReactThreeTestRenderer.create(render(d));
    try {
      let mesh: THREE.Mesh | undefined;
      renderer.scene.instance.traverse((o) => { if (o instanceof THREE.Mesh) mesh = o; });
      const p = mesh!.geometry.getAttribute('aPosition');
      await renderer.advanceFrames(1, 1/30);
      expect(p.getX(0)).toBeCloseTo(4*0.0254);
      hand.rotation.z = Math.PI/2;
      await renderer.advanceFrames(1, 1/30);
      expect(p.getX(0)).toBeCloseTo(0); expect(p.getY(0)).toBeCloseTo(4*0.0254);
      hand.rotation.z = 0;
      await renderer.update(render({ ...d, operators: [{ class: 'C_OP_BasicMovement', params: { m_fDrag: 0.5 } }] }));
      await renderer.advanceFrames(1, 1/30);
      expect(p.getX(0)).toBeCloseTo((4 + 5/30)*0.0254);
      await renderer.advanceFrames(1, 1/30);
      expect(p.getX(0)).toBeCloseTo((4 + 5/30 + 2.5/30)*0.0254);
    } finally { await renderer.unmount(); }
  });
  it('rotates authored world axes independently of an attachment frame', async () => {
    const model = new THREE.Group();
    const skeleton = new THREE.Group(); skeleton.name = 'skeleton'; skeleton.scale.setScalar(0.0254);
    skeleton.rotation.z = Math.PI/2;
    const hand = new THREE.Bone(); hand.name = 'ability_cast'; hand.rotation.y = Math.PI/2;
    skeleton.add(hand); model.add(skeleton);
    const d: FxDescriptor = { ...descriptor,
      emitters: [{ class: 'C_OP_InstantaneousEmitter', params: { m_nParticlesToEmit: 1 } }],
      initializers: [{ class: 'C_INIT_PositionOffset', params: { m_OffsetMin: [4, 0, 0], m_OffsetMax: [4, 0, 0] } }],
      operators: [{ class: 'C_OP_MovementRotateParticleAroundAxis', params: { m_vecRotAxis: [0, 1, 0], m_flRotRate: 900 } }],
    };
    const renderer = await ReactThreeTestRenderer.create(<group><primitive object={model} />
      <ParticleEffect descriptor={d} textureBaseUrl="/" model={model} />
    </group>);
    try {
      await renderer.advanceFrames(1, 0.1);
      let mesh: THREE.Mesh | undefined;
      renderer.scene.instance.traverse((o) => { if (o instanceof THREE.Mesh) mesh = o; });
      const p = mesh!.geometry.getAttribute('aPosition');
      // The operator's zero-X rule substitutes Source +Z, so +Y rotates to -X.
      expect(p.getX(0)).toBeCloseTo(-4*0.0254);
      expect(p.getY(0)).toBeCloseTo(0);
      expect(p.getZ(0)).toBeCloseTo(0);
    } finally { await renderer.unmount(); }
  });
});
