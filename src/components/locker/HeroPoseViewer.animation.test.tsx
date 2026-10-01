import React from 'react';
import ReactThreeTestRenderer from '@react-three/test-renderer';
import * as THREE from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { CLOTH_TIMESTEP } from '../../lib/useClothSim';
import { parseFeModel } from '../../lib/feModel';
import { RiggedModel, type TurntableInteraction } from './HeroPoseViewer';

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

function makeRig() {
  const scene = new THREE.Group();
  const anchor = new THREE.Bone();
  const tip = new THREE.Bone();
  const end = new THREE.Bone();
  anchor.name = 'anchor';
  tip.name = 'tip';
  end.name = 'end';
  tip.position.x = 1;
  end.position.x = 1;
  anchor.add(tip);
  tip.add(end);
  const geometry = new THREE.BoxGeometry(1, 4, 1);
  const count = geometry.attributes.position.count;
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(new Uint16Array(count * 4), 4));
  const weights = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) weights[i * 4] = 1;
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(weights, 4));
  const mesh = new THREE.SkinnedMesh(geometry, new THREE.MeshStandardMaterial());
  mesh.add(anchor);
  scene.add(mesh);
  scene.updateWorldMatrix(true, true);
  mesh.bind(new THREE.Skeleton([anchor, tip, end]));
  const model = parseFeModel({
    m_CtrlName: ['anchor', 'tip', 'end'],
    m_nStaticNodes: 1,
    m_NodeInvMasses: [0, 1, 1],
    m_InitPose: [
      [0, 0, 0, 1, 0, 0, 0, 1],
      [1, 0, 0, 1, 0, 0, 0, 1],
      [2, 0, 0, 1, 0, 0, 0, 1],
    ],
    m_NodeIntegrator: [{}, { flGravity: 360 }, { flGravity: 360 }],
    m_SkelParents: [-1, 0, 1],
  })!;
  const clips = [
    new THREE.AnimationClip('first', 1, [
      new THREE.VectorKeyframeTrack('tip.position', [0, 1], [1, 0, 0, 1, 1, 0]),
    ]),
    new THREE.AnimationClip('second', 1, [
      new THREE.VectorKeyframeTrack('tip.position', [0, 1], [1, 2, 0, 1, 2, 0]),
    ]),
  ];
  return { scene, tip, end, model, clips };
}

describe('rigged preview motion lifecycle', () => {
  it('chooses Rem showcase before a standing fallback and holds its last pose', async () => {
    const { scene, tip, clips } = makeRig();
    clips[0].name = 'ui_shop';
    clips[1].name = 'primary_stand_idle';
    const progressRef = { current: { time: 0, duration: 0 } };
    const renderer = await ReactThreeTestRenderer.create(
      <RiggedModel heroName="Rem" scene={scene} clips={clips} clipName="" reset={0}
        interaction={{ current: { dragging: false, paused: true } }} progressRef={progressRef}
        playback={{ paused: false, speed: 1 }} clothEnabled={false} clothModel={null} />,
    );
    await renderer.advanceFrames(20, 0.1);
    expect(tip.position.y).toBeCloseTo(1);
    expect(progressRef.current).toEqual({ time: 1, duration: 1 });
    await renderer.advanceFrames(10, 0.1);
    expect(tip.position.y).toBeCloseTo(1);
    await renderer.unmount();
  });

  it('keeps a reviewed Wraith shop idle repeating', async () => {
    const { scene, tip, clips } = makeRig();
    clips[0].name = 'ui_shop_idle';
    const renderer = await ReactThreeTestRenderer.create(
      <RiggedModel heroName="Wraith" scene={scene} clips={clips} clipName="ui_shop_idle" reset={0}
        interaction={{ current: { dragging: false, paused: true } }}
        playback={{ paused: false, speed: 1 }} clothEnabled={false} clothModel={null} />,
    );
    await renderer.advanceFrames(12, 0.1);
    expect(tip.position.y).toBeCloseTo(0.2);
    await renderer.unmount();
  });

  it.each([false, true])('applies a paused motion switch immediately with cloth=%s', async (clothEnabled) => {
    const { scene, tip, end, model, clips } = makeRig();
    const interaction = { current: { dragging: false, paused: true } satisfies TurntableInteraction };
    const props = { scene, clips, interaction, clothModel: model, clothEnabled, reset: 0 };
    const renderer = await ReactThreeTestRenderer.create(
      <RiggedModel {...props} clipName="first" playback={{ paused: false, speed: 1 }} />,
    );
    await renderer.advanceFrames(10, CLOTH_TIMESTEP);
    const scale = (renderer.scene.children[0].instance as THREE.Group).scale.x;
    await renderer.update(
      <RiggedModel {...props} clipName="second" playback={{ paused: true, speed: 1 }} />,
    );
    expect(tip.position.toArray()).toEqual([1, 2, 0]);
    expect(end.position.toArray()).toEqual([1, 0, 0]);
    await renderer.advanceFrames(3, CLOTH_TIMESTEP);
    expect(tip.position.toArray()).toEqual([1, 2, 0]);
    await renderer.update(
      <RiggedModel {...props} clipName="second" playback={{ paused: true, speed: 1 }} reset={1} />,
    );
    expect(tip.position.toArray()).toEqual([1, 2, 0]);
    expect((renderer.scene.children[0].instance as THREE.Group).scale.x).toBe(scale);
    await renderer.update(
      <RiggedModel {...props} clipName="second" playback={{ paused: false, speed: 1 }} reset={1} />,
    );
    await renderer.advanceFrames(1, CLOTH_TIMESTEP);
    expect(tip.position.y).toBeCloseTo(clothEnabled ? 2 - 360 * CLOTH_TIMESTEP ** 2 : 2);
    await renderer.unmount();
    expect(tip.position.toArray()).toEqual([1, 0, 0]);
    expect(end.position.toArray()).toEqual([1, 0, 0]);
  });

  it.each([false, true])('seeks forward and backward while paused, then resumes cleanly with cloth=%s', async (clothEnabled) => {
    const { scene, tip, end, model, clips } = makeRig();
    const progressRef = { current: { time: 0, duration: 0 } };
    const props = { scene, clips, clipName: 'first', reset: 0, clothModel: model, clothEnabled,
      interaction: { current: { dragging: false, paused: true } }, progressRef };
    const renderer = await ReactThreeTestRenderer.create(
      <RiggedModel {...props} playback={{ paused: false, speed: 1 }} />,
    );
    await renderer.advanceFrames(10, CLOTH_TIMESTEP);
    await renderer.update(
      <RiggedModel {...props} seek={{ time: 0.75, revision: 1 }} playback={{ paused: true, speed: 1 }} />,
    );
    expect(tip.position.toArray()).toEqual([1, 0.75, 0]);
    expect(end.position.toArray()).toEqual([1, 0, 0]);
    expect(progressRef.current).toEqual({ time: 0.75, duration: 1 });
    await renderer.advanceFrames(3, CLOTH_TIMESTEP);
    expect(tip.position.y).toBe(0.75);
    const seek = { time: 0.25, revision: 2 };
    await renderer.update(
      <RiggedModel {...props} seek={seek} playback={{ paused: true, speed: 1 }} />,
    );
    expect(tip.position.toArray()).toEqual([1, 0.25, 0]);
    await renderer.update(
      <RiggedModel {...props} seek={seek} playback={{ paused: false, speed: 1 }} />,
    );
    await renderer.advanceFrames(1, CLOTH_TIMESTEP);
    expect(tip.position.y).toBeCloseTo(0.25 + CLOTH_TIMESTEP - (clothEnabled ? 360 * CLOTH_TIMESTEP ** 2 : 0));
    expect(progressRef.current.time).toBeCloseTo(0.25 + CLOTH_TIMESTEP);
    await renderer.unmount();
    expect(tip.position.toArray()).toEqual([1, 0, 0]);
  });

  it('clamps out-of-range seeks and holds the final pose rather than wrapping', async () => {
    const { scene, tip, clips } = makeRig();
    const props = { scene, clips, clipName: 'first', reset: 0, clothModel: null, clothEnabled: false,
      interaction: { current: { dragging: false, paused: true } }, playback: { paused: true, speed: 1 } };
    const renderer = await ReactThreeTestRenderer.create(<RiggedModel {...props} seek={{ time: 999, revision: 1 }} />);
    expect(tip.position.y).toBeCloseTo(1);
    await renderer.update(<RiggedModel {...props} seek={{ time: -5, revision: 2 }} />);
    expect(tip.position.y).toBe(0);
    await renderer.unmount();
  });

  it('keeps paused first-frame animation through StrictMode effect replay', async () => {
    const { scene, tip, model, clips } = makeRig();
    const renderer = await ReactThreeTestRenderer.create(
      <React.StrictMode>
        <RiggedModel scene={scene} clips={clips} clipName="second" reset={0}
          interaction={{ current: { dragging: false, paused: true } }}
          playback={{ paused: true, speed: 1 }} clothEnabled clothModel={model} />
      </React.StrictMode>,
    );
    expect(tip.position.toArray()).toEqual([1, 2, 0]);
    await renderer.unmount();
    expect(tip.position.toArray()).toEqual([1, 0, 0]);
  });
});
